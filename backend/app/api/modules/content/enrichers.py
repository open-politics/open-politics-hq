"""
Enrichment system: @enricher decorator and enricher functions.

@enricher wraps @task with enrichment defaults:
- enrichment_resolved gate (GIN-indexed, prevents re-dispatch)
- EnrichmentContext with done/fail/skip/provider
- dispatch_filter checks ENABLED_ENRICHERS + enrichment_config + capability

Six enrichers: ocr, geocoding, hash, language_detection, quality_score, embedding.
"""

import hashlib
import io
import logging
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Generator, Optional

from sqlalchemy import literal_column, text, update, exists
from sqlmodel import Session, select

from app.api.modules.content.models import Asset, AssetChunk, AssetKind, ProcessingStatus
from app.api.modules.content.utils.watcher_filters import non_superseded_filter
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


# ── EnrichmentContext ─────────────────────────────────────────────────────────

class EnrichmentContext(TaskContext):
    """Extended context for enrichment domain.

    ``provider()`` is inherited from TaskContext unchanged — the enrichment_config
    lookup is handled inside resolve() itself, keyed by infospace_id.
    """

    def __init__(self, enricher_name: str = "", enrichment_config=None, **kwargs):
        super().__init__(**kwargs)
        self._enricher_name = enricher_name
        self.enrichment_config = enrichment_config

    def _mark_resolved(self, session: Session, asset_id: int):
        """Add enricher name to enrichment_resolved (idempotent, dedup guard)."""
        session.execute(text(
            "UPDATE asset SET enrichment_resolved = "
            "array_append(COALESCE(enrichment_resolved, ARRAY[]::text[]), :name) "
            "WHERE id = :id "
            "AND NOT (COALESCE(enrichment_resolved, ARRAY[]::text[]) @> ARRAY[:name]::text[])"
        ), {"name": self._enricher_name, "id": asset_id})

    def done(self, session: Session, asset_id: int, facets: dict | None = None):
        """Mark enrichment complete for one asset. Event emitted once per batch by wrapper."""
        self._mark_resolved(session, asset_id)
        if facets:
            from app.api.modules.content.facets import merge_facets
            merge_facets(session, asset_id, facets)
        self.stat("done")

    def fail(self, session: Session, asset_id: int, reason: str):
        """Mark failed. Prevents re-dispatch + records diagnostics."""
        self._mark_resolved(session, asset_id)
        now_iso = datetime.now(timezone.utc).isoformat()
        session.execute(text(
            "UPDATE asset SET enrichment_errors = "
            "CASE WHEN jsonb_typeof(enrichment_errors) = 'object' "
            "     THEN enrichment_errors ELSE '{}'::jsonb END "
            "|| jsonb_build_object(:name, jsonb_build_object('reason', :reason, 'at', :ts)) "
            "WHERE id = :id"
        ), {"name": self._enricher_name, "id": asset_id, "reason": reason, "ts": now_iso})
        self.item_failed(asset_id)
        self.stat("failed")

    def skip(self, session: Session, asset_id: int):
        """Prevent re-dispatch without marking enriched."""
        self._mark_resolved(session, asset_id)
        self.stat("skipped")


# ── retry_enrichment utility ──────────────────────────────────────────────────

def retry_enrichment(session: Session, asset_id: int, enricher_name: str):
    """Clear enrichment state so asset is eligible for re-enrichment."""
    session.execute(text(
        "UPDATE asset SET "
        "  enrichment_resolved = array_remove(COALESCE(enrichment_resolved, ARRAY[]::text[]), :name),"
        "  enrichment_errors = CASE WHEN jsonb_typeof(enrichment_errors) = 'object' "
        "    THEN enrichment_errors - :name ELSE enrichment_errors END "
        "WHERE id = :id"
    ), {"name": enricher_name, "id": asset_id})
    try:
        from app.core.redis import get_redis
        get_redis().delete(f"task:{enricher_name}:{asset_id}:failures")
    except Exception:
        pass


# ── @enricher decorator ───────────────────────────────────────────────────────

def _enrichment_dispatch_filter(enricher_name: str, capability: str | None = None):
    """Build dispatch_filter for an enricher: checks ENABLED_ENRICHERS + enrichment_config + capability."""
    def _filter(infospace) -> bool:
        from app.core.dispatch import _get_enabled_enrichers
        enabled = _get_enabled_enrichers()
        # None = all enrichers enabled ("*"), set = whitelist (empty set = nothing)
        if enabled is not None and enricher_name not in enabled:
            return False

        # Check enrichment_config
        config = getattr(infospace, "enrichment_config", None)
        if config is not None:
            # EnrichmentConfig exists — enricher must be explicitly enabled
            if isinstance(config, dict):
                from app.api.modules.foundation_service_providers.base import EnrichmentConfig
                config = EnrichmentConfig(**config)
            if not config.is_enabled(enricher_name):
                return False
        elif capability:
            # Capability-gated enrichers (embedding, ocr, geocoding) need
            # explicit per-infospace opt-in via enrichment_config
            return False

        # Check capability availability
        if capability:
            from app.core.dispatch import _is_capability_configured
            if not _is_capability_configured(capability):
                return False

        return True
    return _filter


def enricher(
    name: str,
    check: Callable,
    *,
    capability: str | None = None,
    triggers: list[str] | None = None,
    **overrides,
):
    """
    @enricher wraps @task. Sets enrichment defaults, swaps in EnrichmentContext.

    The check callable takes a base query (already scoped to infospace + READY + not resolved)
    and adds enricher-specific conditions.
    """
    triggers = triggers or []
    defaults = dict(
        schedule=60,
        queue="processing",
        tags=frozenset({"enrichment"}),
    )
    defaults.update(overrides)

    def enricher_check(infospace_id: int):
        """Build complete query: base conditions + enricher-specific check."""
        base = (
            select(Asset.id)
            .where(
                Asset.infospace_id == infospace_id,
                Asset.processing_status == ProcessingStatus.READY,
                # GIN-indexable containment negation:
                ~literal_column(f"enrichment_resolved @> ARRAY['{name}']::text[]"),
            )
        )
        # non_superseded_filter handles is_superseded + parent_is_superseded
        for clause in non_superseded_filter():
            base = base.where(clause)
        return check(base)  # enricher lambda adds .where() conditions

    # Build a custom context_cls factory
    class _EnrichmentContextFactory(EnrichmentContext):
        def __init__(self, **kwargs):
            kwargs["enricher_name"] = name
            # Load enrichment_config from infospace (one short session, closed before function runs)
            config = None
            try:
                from app.core.db import engine
                from app.api.modules.identity_infospace_user.models import Infospace
                with Session(engine) as s:
                    infospace = s.get(Infospace, kwargs.get("infospace_id"))
                    if infospace:
                        config = infospace.enrichment_config
                        if isinstance(config, dict):
                            from app.api.modules.foundation_service_providers.base import EnrichmentConfig as EC
                            config = EC(**config)
            except Exception as e:
                logger.warning("Failed to load enrichment_config: %s", e)
            kwargs["enrichment_config"] = config
            super().__init__(**kwargs)

    return task(
        name=name,
        check=enricher_check,
        context_cls=_EnrichmentContextFactory,
        capability=capability,
        dispatch_filter=_enrichment_dispatch_filter(name, capability),
        triggers=triggers,
        **defaults,
    )


# ── Enricher functions ────────────────────────────────────────────────────────


@enricher("ocr",
          check=lambda q: q.where(
              Asset.kind == AssetKind.PDF_PAGE,
              Asset.parent_asset_id.isnot(None),
              text("discovered_modalities @> '[\"image\"]'::jsonb"),
          ),
          capability="ocr", batch=10, queue="external_api", timeout=600,
          triggers=["asset.processed"])
def enrich_ocr(ctx: EnrichmentContext, asset_ids: list[int]):
    """OCR assets (PDF_PAGE children) with image modality."""
    from collections import defaultdict
    import asyncio
    import fitz

    from app.api.modules.content.utils.resolve_source_file import resolve_source_file

    # Phase 1: Load assets, group by parent
    pages_by_parent: dict[int, list[tuple[int, int | None]]] = defaultdict(list)
    blob_path_by_parent: dict[int, str] = {}

    with ctx.session() as session:
        for asset_id in asset_ids:
            asset = session.get(Asset, asset_id)
            if not asset or asset.kind != AssetKind.PDF_PAGE or not asset.parent_asset_id:
                ctx.skip(session, asset_id)
                continue
            blob_path, page_index = resolve_source_file(asset, session)
            pages_by_parent[asset.parent_asset_id].append((asset.id, page_index))
            if asset.parent_asset_id not in blob_path_by_parent:
                blob_path_by_parent[asset.parent_asset_id] = blob_path
        session.commit()

    # Resolve providers
    try:
        ocr = ctx.provider("ocr")
        storage = ctx.provider("storage")
    except Exception as e:
        logger.warning("OCR provider not available: %s", e)
        return

    # Phase 2: Load PDFs, run OCR — no DB session
    ocr_results: list[tuple[int, str | None, str, float]] = []
    ocr_failed: list[tuple[int, str]] = []

    async def _run_ocr():
        for parent_id, page_list in pages_by_parent.items():
            blob_path = blob_path_by_parent.get(parent_id)
            if not blob_path:
                for aid, _ in page_list:
                    ocr_failed.append((aid, "no blob_path for parent"))
                continue
            try:
                from app.api.modules.content.storage_access import read_to_bytes
                pdf_bytes = io.BytesIO(await read_to_bytes(storage, blob_path))

                for asset_id, page_index in page_list:
                    try:
                        pdf_bytes.seek(0)
                        doc = fitz.open(stream=pdf_bytes.read(), filetype="pdf")
                        try:
                            page = doc.load_page(page_index or 0)
                            pix = page.get_pixmap(dpi=150)
                            image_bytes = pix.tobytes("png")
                        finally:
                            doc.close()
                        result = await ocr.extract_text(image_bytes)
                        ocr_results.append((asset_id, result.text, result.engine, result.confidence))
                    except Exception as e:
                        ocr_failed.append((asset_id, str(e)))
            except Exception as e:
                for aid, _ in page_list:
                    ocr_failed.append((aid, str(e)))

    from app.core.task_utils import run_async_in_celery
    run_async_in_celery(_run_ocr)

    # Phase 3: Write results
    with ctx.session() as session:
        for asset_id, text_content, engine, confidence in ocr_results:
            session.execute(
                update(Asset).where(Asset.id == asset_id).values(text_content=text_content)
            )
            ctx.done(session, asset_id, facets={
                "ocr_used": True, "ocr_engine": engine, "ocr_confidence": confidence,
            })
        for asset_id, reason in ocr_failed:
            ctx.fail(session, asset_id, reason)
        session.commit()

    from app.core.events import emit
    emit("asset.enriched", {"enricher_name": "ocr", "infospace_id": ctx.infospace_id})


@enricher("geocoding",
          check=lambda q: q.where(
              text("metadata->>'location' IS NOT NULL"),
              text("metadata->>'location' != ''"),
              text("metadata->>'location_lat' IS NULL"),
          ),
          capability="geocoding", batch=20, queue="external_api",
          triggers=["asset.processed"])
def enrich_geocoding(ctx: EnrichmentContext, asset_ids: list[int]):
    """Geocode assets with location facet but missing coordinates.

    Lookup chain:
    1. **Geo canon hit-first.** If the infospace has ``default_geo_canon_id``
       set, look up an Entity of type ``location`` whose canonical_name or
       aliases match the location string AND whose ``properties.coords`` is
       populated. If hit, use those coords directly — provider call skipped.
    2. **Provider fallback.** Misses fall through to the geocoding provider.

    The geo canon is the trusted reference (e.g., countries, capitals,
    ISO 3166 entries). Provider results are NOT auto-written into the canon
    — population stays user-curated. To promote a provider result into the
    canon, the user does so explicitly.
    """
    from app.api.modules.content.facets import get_facet
    from app.api.modules.graph.resolution import find_by_alias
    from app.api.modules.identity_infospace_user.models import Infospace

    # Phase 1: Load — collect (asset_id, location_string) pairs.
    candidates: list[tuple[int, str]] = []
    with ctx.session() as session:
        for asset_id in asset_ids:
            asset = session.get(Asset, asset_id)
            if not asset:
                continue
            facets = asset.facets or {}
            location = get_facet(facets, "location")
            if not location or not isinstance(location, str) or not location.strip():
                ctx.skip(session, asset_id)
                continue
            candidates.append((asset.id, location.strip()))
        session.commit()

    if not candidates:
        return

    # Phase 2: Canon hit-first. Resolve each location against the infospace's
    # geo canon (when set). Hits get patched immediately; misses go to the
    # provider work list.
    cached_writes: list[tuple[int, dict]] = []
    work: list[tuple[int, str]] = []
    with ctx.session() as session:
        infospace = session.get(Infospace, ctx.infospace_id)
        geo_canon_id = infospace.default_geo_canon_id if infospace else None

        for asset_id, location in candidates:
            cached = None
            if geo_canon_id is not None:
                ent = find_by_alias(
                    session, canon_id=geo_canon_id,
                    raw_name=location, entity_type="location",
                )
                if ent and isinstance(ent.properties, dict):
                    coords = ent.properties.get("coords")
                    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                        cached = {
                            "location_lon": float(coords[0]),
                            "location_lat": float(coords[1]),
                            "location": ent.canonical_name,
                        }
            if cached is not None:
                cached_writes.append((asset_id, cached))
            else:
                work.append((asset_id, location))

        # Apply canon-cached writes immediately.
        for asset_id, patch in cached_writes:
            ctx.done(session, asset_id, facets=patch)
        session.commit()

    # Phase 3: Provider for misses.
    if work:
        geocoding = ctx.provider("geocoding")
        results: list[tuple[int, dict | None]] = []

        async def _geocode():
            for asset_id, location in work:
                try:
                    result = await geocoding.geocode(location)
                    results.append((asset_id, result))
                except Exception as e:
                    results.append((asset_id, None))
                    logger.warning("Geocoding failed for asset %d: %s", asset_id, e)

        from app.core.task_utils import run_async_in_celery
        run_async_in_celery(_geocode)

        with ctx.session() as session:
            for asset_id, result in results:
                if not result or "coordinates" not in result:
                    ctx.fail(session, asset_id, "no coordinates returned")
                    continue
                coords = result["coordinates"]
                if len(coords) < 2:
                    ctx.fail(session, asset_id, "invalid coordinates")
                    continue
                patch = {
                    "location_lon": float(coords[0]),
                    "location_lat": float(coords[1]),
                }
                if result.get("display_name"):
                    patch["location"] = result["display_name"]
                ctx.done(session, asset_id, facets=patch)
            session.commit()

    from app.core.events import emit
    emit("asset.enriched", {"enricher_name": "geocoding", "infospace_id": ctx.infospace_id})


@enricher("hash",
          check=lambda q: q.where(
              Asset.blob_path.isnot(None),
              Asset.content_hash.is_(None),
              Asset.parent_asset_id.is_(None),
          ),
          capability="storage", batch=50, queue="processing",
          triggers=["asset.processed"])
def enrich_hash(ctx: EnrichmentContext, asset_ids: list[int]):
    """Compute SHA-256 for assets with blob_path but no content_hash."""
    # Phase 1: Load
    work: list[tuple[int, str]] = []
    with ctx.session() as session:
        for asset_id in asset_ids:
            asset = session.get(Asset, asset_id)
            if not asset or not asset.blob_path or asset.content_hash:
                continue
            work.append((asset.id, asset.blob_path))

    if not work:
        return

    storage = ctx.provider("storage")

    # Phase 2: Compute hashes
    hashes: list[tuple[int, str | None]] = []

    async def _compute():
        import asyncio
        from app.api.modules.content.storage_access import read_to_path
        for asset_id, blob_path in work:
            try:
                path, is_temp = await read_to_path(storage, blob_path)
                try:
                    def _sha256(p):
                        h = hashlib.sha256()
                        with open(p, "rb") as f:
                            while chunk := f.read(65536):
                                h.update(chunk)
                        return h.hexdigest()
                    computed = await asyncio.to_thread(_sha256, path)
                    hashes.append((asset_id, computed))
                finally:
                    if is_temp:
                        try: path.unlink()
                        except OSError: pass
            except FileNotFoundError:
                hashes.append((asset_id, None))
            except Exception as e:
                logger.warning("Hash failed for asset %d: %s", asset_id, e)
                hashes.append((asset_id, None))

    from app.core.task_utils import run_async_in_celery
    run_async_in_celery(_compute)

    # Phase 3: Write
    with ctx.session() as session:
        for asset_id, computed in hashes:
            if computed:
                session.execute(
                    update(Asset).where(Asset.id == asset_id).values(content_hash=computed)
                )
                ctx.done(session, asset_id)
            else:
                ctx.fail(session, asset_id, "hash computation failed")
        session.commit()

    from app.core.events import emit
    emit("asset.enriched", {"enricher_name": "hash", "infospace_id": ctx.infospace_id})


@enricher("language_detection",
          check=lambda q: q.where(Asset.text_content.isnot(None)),
          batch=50, queue="processing",
          triggers=["asset.processed"])
def enrich_language(ctx: EnrichmentContext, asset_ids: list[int]):
    """Detect language for assets with text_content."""
    try:
        import langdetect
    except ImportError:
        logger.warning("langdetect not installed; skipping language detection")
        return

    with ctx.session() as session:
        assets = session.exec(select(Asset).where(Asset.id.in_(asset_ids))).all()

    results = []
    for asset in assets:
        if not asset.text_content or not asset.text_content.strip():
            results.append((asset.id, None))
            continue
        try:
            detected = langdetect.detect(asset.text_content[:5000])
            results.append((asset.id, detected))
        except Exception:
            results.append((asset.id, None))

    with ctx.session() as session:
        for asset_id, lang in results:
            if lang:
                ctx.done(session, asset_id, facets={"language": lang})
            else:
                ctx.skip(session, asset_id)
        session.commit()

    from app.core.events import emit
    emit("asset.enriched", {"enricher_name": "language_detection", "infospace_id": ctx.infospace_id})


@enricher("quality_score",
          check=lambda q: q.where(Asset.text_content.isnot(None)),
          batch=50, queue="processing",
          triggers=["asset.processed"])
def enrich_quality_score(ctx: EnrichmentContext, asset_ids: list[int]):
    """Entropy-based quality score for assets with text_content."""
    from collections import Counter
    import math

    def _entropy(text: str) -> float:
        if not text or len(text) < 10:
            return 0.0
        c = Counter(text)
        n = len(text)
        return -sum((count / n) * math.log2(count / n) for count in c.values() if count > 0)

    with ctx.session() as session:
        assets = session.exec(select(Asset).where(Asset.id.in_(asset_ids))).all()

    results = []
    for asset in assets:
        if not asset.text_content or not asset.text_content.strip():
            results.append((asset.id, None))
            continue
        score = round(_entropy(asset.text_content[:10000]), 4)
        results.append((asset.id, score))

    with ctx.session() as session:
        for asset_id, score in results:
            if score is not None:
                ctx.done(session, asset_id, facets={"quality_score": score})
            else:
                ctx.skip(session, asset_id)
        session.commit()

    from app.core.events import emit
    emit("asset.enriched", {"enricher_name": "quality_score", "infospace_id": ctx.infospace_id})


@enricher("embedding",
          check=lambda q: q.where(
              Asset.text_content.isnot(None),
          ),
          capability="embedding",
          depends_on="ocr", batch=20, queue="embedding", timeout=1800,
          max_concurrency=1, self_chain=True,
          triggers=["asset.enriched"])
def enrich_embedding(ctx: EnrichmentContext, asset_ids: list[int]):
    """Generate embeddings for assets with text_content and no chunks.

    Preserves the three-phase pattern from the legacy embed task:
    Phase 1 — Load + Chunk (DB session open)
    Phase 2 — Generate embeddings (no DB session)
    Phase 3 — Store vectors + emit events (fresh DB session)
    """
    from app.api.modules.content.models import get_embedding_column_for_dimension

    # Phase 1: Load + Chunk
    groups: dict[int, dict] = {}  # infospace_id → group info

    with ctx.session() as session:
        from app.api.modules.embedding import chunk as chunk_mod
        from app.api.modules.embedding.embed import ensure_embedding_model
        from app.api.modules.identity_infospace_user.models import Infospace
        from app.api.modules.foundation_service_providers import get_selection

        assets = session.exec(select(Asset).where(Asset.id.in_(asset_ids))).all()

        for asset in assets:
            iid = asset.infospace_id
            if iid not in groups:
                infospace = session.get(Infospace, iid)
                if not infospace:
                    continue

                sel = get_selection(session, iid, "embedding")
                if not sel or not sel.model_name:
                    continue
                dim_override = infospace.get_embedding_dimension_override()

                # All assets in this batch share ctx.infospace_id, so the cache
                # key is stable per-worker. Resolve() reads sel from the
                # infospace's enrichment_config internally too, but we pass
                # explicit args so the per-worker cache key matches.
                provider_instance = ctx.provider(
                    "embedding", sel.provider_key, sel.model_name,
                )

                from app.core.task_utils import run_async_in_celery
                em = run_async_in_celery(
                    ensure_embedding_model,
                    session, sel.provider_key, sel.model_name,
                    dimension=dim_override,
                    infospace_id=iid,
                )
                col_name = get_embedding_column_for_dimension(em.dimension)
                if not col_name:
                    logger.error("Unsupported dimension %d for %s", em.dimension, sel.model_name)
                    continue

                groups[iid] = {
                    "provider": provider_instance,
                    "model_name": sel.model_name,
                    "em_id": em.id,
                    "col_name": col_name,
                    "dimension": em.dimension,
                    "chunk_strategy": infospace.chunk_strategy or "token",
                    "chunk_size": infospace.chunk_size or 512,
                    "chunk_overlap": infospace.chunk_overlap or 50,
                    "work": [],
                    "asset_ids": set(),
                }

            grp = groups.get(iid)
            if not grp:
                continue

            existing = session.exec(
                select(AssetChunk).where(AssetChunk.asset_id == asset.id)
            ).all()

            if not existing:
                if not asset.text_content:
                    continue
                existing = chunk_mod.chunk_asset(
                    session,
                    asset,
                    strategy=grp["chunk_strategy"],
                    chunk_size=grp["chunk_size"],
                    chunk_overlap=grp["chunk_overlap"],
                    overwrite_existing=False,
                )

            for chunk in existing:
                has_embedding = (
                    chunk.embedding_model_id == grp["em_id"]
                    and getattr(chunk, grp["col_name"], None) is not None
                )
                if not has_embedding:
                    grp["work"].append((chunk.id, chunk.text_content or ""))
                    grp["asset_ids"].add(asset.id)

        session.commit()

    # Phase 2: Generate embeddings (no DB session)
    results: dict[int, list] = {}

    EMBED_BATCH = 64  # texts per HTTP call — keeps Ollama requests under timeout

    async def _embed():
        for iid, grp in groups.items():
            if not grp["work"]:
                continue
            chunk_ids = [w[0] for w in grp["work"]]
            texts = [w[1] for w in grp["work"]]
            target_dim = grp["dimension"]
            all_vectors: list[list[float]] = []
            try:
                for start in range(0, len(texts), EMBED_BATCH):
                    batch_texts = texts[start : start + EMBED_BATCH]
                    batch_vecs = await grp["provider"].embed_texts(batch_texts, grp["model_name"])
                    if len(batch_vecs) != len(batch_texts):
                        logger.error("Vector count mismatch for infospace %d batch at %d", iid, start)
                        raise RuntimeError("vector count mismatch")
                    # Truncate for Matryoshka dimension override (native dim > target dim)
                    if batch_vecs and len(batch_vecs[0]) > target_dim:
                        batch_vecs = [v[:target_dim] for v in batch_vecs]
                    elif batch_vecs and len(batch_vecs[0]) != target_dim:
                        logger.error("Dimension mismatch for infospace %d: got %d, need %d",
                                     iid, len(batch_vecs[0]), target_dim)
                        raise RuntimeError("dimension mismatch")
                    all_vectors.extend(batch_vecs)
                    logger.info("Embedded batch %d–%d / %d for infospace %d",
                                start, start + len(batch_texts), len(texts), iid)
                results[iid] = list(zip(chunk_ids, all_vectors))
            except Exception as e:
                logger.error("Embedding failed for infospace %d: %s", iid, e, exc_info=True)

    from app.core.task_utils import run_async_in_celery
    run_async_in_celery(_embed)

    # Phase 3: Store + mark done
    with ctx.session() as session:
        for iid, pairs in results.items():
            grp = groups[iid]
            for chunk_id, vector in pairs:
                chunk = session.get(AssetChunk, chunk_id)
                if not chunk:
                    continue
                setattr(chunk, grp["col_name"], vector)
                chunk.embedding_model_id = grp["em_id"]
                session.add(chunk)

        # Mark all enriched assets as done
        enriched_assets: set[int] = set()
        for iid, pairs in results.items():
            for chunk_id, _ in pairs:
                chunk = session.get(AssetChunk, chunk_id)
                if chunk:
                    enriched_assets.add(chunk.asset_id)

        for aid in enriched_assets:
            ctx.done(session, aid)

        session.commit()
