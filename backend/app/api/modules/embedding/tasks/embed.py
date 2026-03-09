"""
Embedding enricher task — single entry point for all embedding generation.

Follows the three-phase enricher pattern (load → compute → write) used by
geocoding, OCR, and hash enrichers.  Replaces the four legacy tasks.

Credentials:
  user_id/api_keys present  → user-triggered  → resolve() with merged credentials
  both absent               → reactive watcher → system credentials only
"""

import logging
from typing import Dict, List, Optional

from sqlmodel import Session, select

from app.core.celery_app import celery
from app.core.db import engine
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


@celery.task(name="enrich_embedding")
def enrich_embedding_task(
    asset_ids: List[int] | int,
    user_id: Optional[int] = None,
    api_keys: Optional[Dict[str, str]] = None,
    overwrite: bool = False,
):
    """
    Generate embeddings for a batch of assets.

    Phase 1 — Load + Chunk (DB session open)
    Phase 2 — Generate embeddings (no DB session)
    Phase 3 — Store vectors + emit events (fresh DB session)
    """
    if isinstance(asset_ids, int):
        asset_ids = [asset_ids]
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    async def _run():
        return await _three_phase(asset_ids, user_id, api_keys, overwrite)

    return run_async_in_celery(_run)


# ── internals ────────────────────────────────────────────────────────────────


async def _three_phase(
    asset_ids: List[int],
    user_id: Optional[int],
    api_keys: Optional[Dict[str, str]],
    overwrite: bool,
) -> dict:
    from app.models import Asset, AssetChunk, Infospace, EmbeddingModel
    from app.api.modules.content.models import get_embedding_column_for_dimension
    from app.api.modules.embedding.services.chunking_service import ChunkingService
    from app.api.modules.foundation_service_providers.base import (
        EmbeddingProvider as EmbeddingProviderProtocol,
        ProviderSelection,
    )
    from app.api.modules.foundation_service_providers.registry import resolve, load_credentials
    from app.core.config import settings as app_settings
    from app.api.modules.embedding.services.embedding_service import EmbeddingService

    # ── Phase 1: Load + Chunk ────────────────────────────────────────────
    # One session block.  Collects work items grouped by infospace.
    # Provider instances (plain HTTP clients) survive session closure.

    groups: Dict[int, dict] = {}  # infospace_id → group info

    with Session(engine) as session:
        credentials = load_credentials(session, user_id, api_keys) if user_id else (api_keys or {})
        chunking = ChunkingService(session)
        embedding_svc = EmbeddingService(session, user_id=user_id, runtime_api_keys=api_keys)

        assets = session.exec(
            select(Asset).where(Asset.id.in_(asset_ids))
        ).all()

        for asset in assets:
            iid = asset.infospace_id
            if iid not in groups:
                infospace = session.get(Infospace, iid)
                if not infospace or not infospace.embedding_configured:
                    continue

                sel = infospace.embedding_selection
                if isinstance(sel, dict):
                    sel = ProviderSelection(**sel)

                # Resolve provider
                provider_instance = resolve(
                    EmbeddingProviderProtocol,
                    sel.type_key,
                    app_settings,
                    credentials,
                )
                if not provider_instance:
                    logger.warning(f"No embedding provider for infospace {iid} ({sel.type_key})")
                    continue

                # Ensure dimension cache entry exists
                em = await embedding_svc.ensure_embedding_model_registered(
                    provider=sel.type_key,
                    model_name=sel.model_name,
                )
                col_name = get_embedding_column_for_dimension(em.dimension)
                if not col_name:
                    logger.error(f"Unsupported dimension {em.dimension} for {sel.model_name}")
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
                    "work": [],  # [(chunk_id, text)]
                    "asset_ids": set(),
                }

            grp = groups.get(iid)
            if not grp:
                continue

            # Chunk if needed
            existing = session.exec(
                select(AssetChunk).where(AssetChunk.asset_id == asset.id)
            ).all()

            if not existing:
                if not asset.text_content:
                    continue
                existing = chunking.chunk_asset(
                    asset=asset,
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
                if overwrite or not has_embedding:
                    grp["work"].append((chunk.id, chunk.text_content or ""))
                    grp["asset_ids"].add(asset.id)

        session.commit()  # persist any new chunks

    # ── Phase 2: Generate embeddings (no DB session) ─────────────────────

    results: Dict[int, list] = {}  # infospace_id → [(chunk_id, vector)]

    for iid, grp in groups.items():
        if not grp["work"]:
            continue
        chunk_ids = [w[0] for w in grp["work"]]
        texts = [w[1] for w in grp["work"]]
        try:
            vectors = await grp["provider"].embed_texts(texts, grp["model_name"])
            if len(vectors) != len(chunk_ids):
                logger.error(f"Infospace {iid}: vector count mismatch ({len(vectors)} vs {len(chunk_ids)})")
                continue
            # Validate dimension
            if vectors and len(vectors[0]) != grp["dimension"]:
                logger.error(
                    f"Infospace {iid}: model {grp['model_name']} returned "
                    f"{len(vectors[0])}d, expected {grp['dimension']}d"
                )
                continue
            results[iid] = list(zip(chunk_ids, vectors))
        except Exception as e:
            logger.error(f"Embedding failed for infospace {iid}: {e}", exc_info=True)

    # ── Phase 3: Store + emit events ─────────────────────────────────────

    from app.core.events import emit

    total_stored = 0
    enriched_assets: set = set()

    with Session(engine) as session:
        for iid, pairs in results.items():
            grp = groups[iid]
            for chunk_id, vector in pairs:
                chunk = session.get(AssetChunk, chunk_id)
                if not chunk:
                    continue
                setattr(chunk, grp["col_name"], vector)
                chunk.embedding_model_id = grp["em_id"]
                session.add(chunk)
                total_stored += 1
                enriched_assets.add(chunk.asset_id)
        session.commit()

    for aid in enriched_assets:
        emit("asset.enriched", {"asset_id": aid, "enricher_name": "embedding"})

    total = sum(len(grp["work"]) for grp in groups.values())
    failed = total - total_stored
    logger.info(f"enrich_embedding: {total_stored}/{total} chunks embedded, {len(enriched_assets)} assets enriched")

    return {"total": total, "enriched": total_stored, "failed": failed}
