"""
Flat embedding primitives.

`embed_texts` is the single text-to-vector entrypoint, and it remembers: a text
is embedded once per infospace and model (``TextVector``). Provider resolution
goes through the registry keyed by infospace owner; BYOK flows via runtime_key.

`ensure_embedding_model` registers (or finds) the EmbeddingModel row backing a
given (provider, model_name, dimension) triple. Callers that already have an
embedding_model_id can use `embed_texts(embedding_model_id=...)` to skip
config lookup on the infospace.

`embedding_stats` / `clear_embeddings` / `reset_for_assets` are plain DB
aggregates — no provider calls.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import String, any_, bindparam, delete as sa_delete
from sqlalchemy import func, or_, text as sa_text
from sqlalchemy.dialects.postgresql import ARRAY, insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models import Asset, AssetChunk, EmbeddingModel, TextVector
from app.api.modules.content.models import (
    EMBEDDING_SUPPORTED_DIMS,
    get_embedding_column_for_dimension,
)
from app.api.modules.identity_infospace_user.models import Infospace

logger = logging.getLogger(__name__)


async def ensure_embedding_model(
    session: Session,
    provider: str,
    model_name: str,
    *,
    dimension: Optional[int] = None,
    infospace_id: Optional[int] = None,
    runtime_key: Optional[str] = None,
) -> EmbeddingModel:
    """Find or register an EmbeddingModel row.

    When ``dimension`` is explicit, look up (name, provider, dimension) — Matryoshka
    models get separate rows per effective dimension. When None, look up
    (name, provider) and auto-detect dimension via static spec or a live probe.

    Dimension probing needs an ``infospace_id`` so the registry can load owner
    credentials. If the model already exists in the DB, no probe is needed.
    """
    prov = provider.lower()

    if dimension is not None:
        existing = session.exec(
            select(EmbeddingModel)
            .where(EmbeddingModel.name == model_name)
            .where(EmbeddingModel.provider == prov)
            .where(EmbeddingModel.dimension == dimension)
        ).first()
        if existing:
            return existing
    else:
        existing = session.exec(
            select(EmbeddingModel)
            .where(EmbeddingModel.name == model_name)
            .where(EmbeddingModel.provider == prov)
        ).first()
        if existing:
            return existing

        # Static spec first — no credentials needed.
        from app.api.modules.foundation_service_providers import get_model_spec
        from app.api.modules.foundation_service_providers import EmbeddingModelSpec
        spec = get_model_spec("embedding", provider, model_name)
        if isinstance(spec, EmbeddingModelSpec):
            dimension = spec.dimension

        if dimension is None:
            if infospace_id is None:
                raise ValueError(
                    "ensure_embedding_model needs infospace_id to probe dimension when "
                    "no static spec is available"
                )
            from app.api.modules.foundation_service_providers import resolve
            provider_instance = resolve(
                "embedding", provider, model_name,
                infospace_id=infospace_id,
                runtime_key=runtime_key,
                session=session,
            )
            # `probe_model` is a declared feature, so asking for it is an
            # honest question about this endpoint rather than a guess at a
            # private attribute. Endpoints without it fall through to measuring
            # a real vector, which always works and costs one tiny request.
            if hasattr(provider_instance, "probe_model"):
                info = await provider_instance.probe_model(model_name)
                dimension = info.get("dimension") or 0
            if not dimension:
                test_vec = await provider_instance.embed_single(" ", model_name)
                dimension = len(test_vec)

    em = EmbeddingModel(
        name=model_name, provider=prov, dimension=dimension, is_active=True,
    )
    session.add(em)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.exec(
            select(EmbeddingModel)
            .where(EmbeddingModel.name == model_name)
            .where(EmbeddingModel.provider == prov)
            .where(EmbeddingModel.dimension == dimension)
        ).first()
        if existing:
            return existing
        raise
    session.refresh(em)
    logger.info("Registered embedding model: %s (%s) dim=%d", model_name, provider, dimension)
    return em


async def _model_for(
    session: Session,
    infospace_id: int,
    *,
    runtime_key: Optional[str],
    embedding_model_id: Optional[int],
    model_name: Optional[str],
    provider: Optional[str],
) -> EmbeddingModel:
    """The model texts are embedded with: the row named by id, else the one for
    ``provider`` + ``model_name``, else the infospace's configured selection."""
    from app.api.modules.foundation_service_providers import get_configured_foundation_provider

    if embedding_model_id is not None:
        em = session.get(EmbeddingModel, embedding_model_id)
        if em is None:
            raise ValueError(f"Embedding model {embedding_model_id} not found")
        return em
    if provider and model_name:
        return await ensure_embedding_model(
            session, provider, model_name,
            infospace_id=infospace_id, runtime_key=runtime_key,
        )
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise ValueError(f"Infospace {infospace_id} not found")
    sel = get_configured_foundation_provider(session, infospace_id, "embedding")
    if not sel or not sel.model_name:
        raise ValueError(f"Infospace {infospace_id} has no embedding configured")
    return await ensure_embedding_model(
        session, sel.provider_key, sel.model_name,
        dimension=infospace.get_embedding_dimension_override(),
        infospace_id=infospace_id, runtime_key=runtime_key,
    )


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _recalled(
    session: Session, infospace_id: int, em: EmbeddingModel, col: str, texts: List[str],
) -> Dict[str, List[float]]:
    """The texts this infospace has embedded under *em* before, with their vectors."""
    by_digest = {_digest(t): t for t in texts}
    column = getattr(TextVector, col)
    rows = session.exec(
        select(TextVector.digest, column)
        .where(TextVector.infospace_id == infospace_id)
        .where(TextVector.embedding_model_id == em.id)
        .where(TextVector.digest == any_(bindparam("digests", list(by_digest), type_=ARRAY(String))))
        .where(column.isnot(None))
    ).all()
    return {by_digest[d]: [float(x) for x in v] for d, v in rows}


def _remember(infospace_id: int, em: EmbeddingModel, col: str, fresh: Dict[str, List[float]]) -> None:
    """Keep vectors just embedded — in their own transaction: a memo is no part
    of the caller's unit of work, and a read-only caller never commits."""
    from app.core.db import engine

    rows = [
        {"infospace_id": infospace_id, "embedding_model_id": em.id, "digest": _digest(t), col: v}
        for t, v in fresh.items()
    ]
    with Session(engine) as s:
        for start in range(0, len(rows), 1000):
            s.execute(
                insert(TextVector).values(rows[start:start + 1000])
                .on_conflict_do_nothing(index_elements=["infospace_id", "embedding_model_id", "digest"])
            )
        s.commit()


async def embed_texts(
    session: Session,
    infospace_id: int,
    texts: List[str],
    *,
    runtime_key: Optional[str] = None,
    embedding_model_id: Optional[int] = None,
    model_name: Optional[str] = None,
    provider: Optional[str] = None,
) -> Tuple[List[List[float]], EmbeddingModel]:
    """Turn arbitrary strings into vectors, embedding each text once.

    Resolution precedence:
    - ``embedding_model_id`` given → use that row.
    - ``provider`` + ``model_name`` given → register (or reuse) that row.
    - Neither → use the infospace's configured embedding selection.

    A text this infospace has embedded under the model before comes from
    ``TextVector``; only the rest go to the provider, and are kept. Returns
    ``(vectors, embedding_model)``, a vector per text in order. Vectors are
    truncated to the row's declared dimension when the provider returns a larger
    Matryoshka vector.
    """
    from app.api.modules.foundation_service_providers import resolve

    em = await _model_for(
        session, infospace_id, runtime_key=runtime_key,
        embedding_model_id=embedding_model_id, model_name=model_name, provider=provider,
    )
    if not texts:
        return [], em

    col = get_embedding_column_for_dimension(em.dimension)
    known = _recalled(session, infospace_id, em, col, texts) if col else {}
    missing = [t for t in dict.fromkeys(texts) if t not in known]
    if missing:
        p = resolve(
            "embedding", em.provider, em.name,
            infospace_id=infospace_id,
            runtime_key=runtime_key,
            session=session,
        )
        vectors = await p.embed_texts(missing, em.name)
        if len(vectors) != len(missing):
            raise RuntimeError(
                f"Embedding count mismatch: {len(vectors)} vectors vs {len(missing)} texts"
            )
        if vectors and len(vectors[0]) > em.dimension:
            vectors = [v[:em.dimension] for v in vectors]
        elif vectors and len(vectors[0]) != em.dimension:
            raise RuntimeError(
                f"Dimension mismatch for {em.name}: got {len(vectors[0])}, need {em.dimension}"
            )
        fresh = dict(zip(missing, vectors))
        if col:
            _remember(infospace_id, em, col, fresh)
        known.update(fresh)
    return [known[t] for t in texts], em


def embedding_stats(session: Session, infospace_id: int) -> Dict[str, Any]:
    """Aggregate coverage for an infospace. No provider calls.

    Coverage is of **documents** — top-level assets with text that meaning can
    reach, through a vector on their own chunks or on any part's (a PDF's
    pages, an archive's files). Chunk counts say how far along the chunks that
    exist are, which is not coverage: a document never chunked has no chunks to
    count against it.
    """
    asset_counts = session.exec(
        select(
            func.count(Asset.id),
            func.count(Asset.id).filter(Asset.parent_asset_id.is_(None)),
        ).where(Asset.infospace_id == infospace_id, Asset.text_content.isnot(None))
    ).one()
    total_assets, documents = asset_counts
    sub_assets = total_assets - documents

    embedded_sql = " OR ".join(f"c.embedding_{d} IS NOT NULL" for d in EMBEDDING_SUPPORTED_DIMS)
    dim_conditions = [getattr(AssetChunk, f"embedding_{d}").isnot(None) for d in EMBEDDING_SUPPORTED_DIMS]
    chunk_counts = session.exec(
        select(
            func.count(AssetChunk.id),
            func.count(AssetChunk.id).filter(or_(*dim_conditions)),
        ).join(Asset).where(Asset.infospace_id == infospace_id)
    ).one()
    total_chunks, embedded_chunks = chunk_counts

    # Up from every asset with an embedded chunk to its root; the roots with
    # text are the documents meaning reaches. Walked a level at a time by
    # primary key: as a recursive CTE, Postgres hashes the whole asset table
    # on every level (55 s on 700k assets).
    rows = session.execute(sa_text(f"""
        SELECT DISTINCT a.id, a.parent_asset_id
        FROM assetchunk c JOIN asset a ON a.id = c.asset_id
        WHERE a.infospace_id = :iid AND ({embedded_sql})
    """), {"iid": infospace_id}).all()
    roots: set[int] = set()
    level = {parent for asset_id, parent in rows if parent is not None}
    roots.update(asset_id for asset_id, parent in rows if parent is None)
    walked: set[int] = set()
    while level - walked:
        walked |= level
        rows = session.execute(
            sa_text("SELECT id, parent_asset_id FROM asset WHERE id = ANY(:ids)"),
            {"ids": list(level)},
        ).all()
        roots.update(asset_id for asset_id, parent in rows if parent is None)
        level = {parent for _, parent in rows if parent is not None}
    embedded_documents = session.execute(
        sa_text("SELECT count(*) FROM asset WHERE id = ANY(:ids) AND text_content IS NOT NULL"),
        {"ids": list(roots)},
    ).scalar_one() if roots else 0

    models_used = session.exec(
        select(EmbeddingModel.name, EmbeddingModel.dimension, func.count(AssetChunk.id))
        .join(AssetChunk)
        .join(Asset)
        .where(Asset.infospace_id == infospace_id)
        .where(AssetChunk.embedding_model_id.isnot(None))
        .group_by(EmbeddingModel.name, EmbeddingModel.dimension)
        .order_by(func.count(AssetChunk.id).desc())
    ).all()

    coverage = (embedded_documents / documents * 100) if documents > 0 else 0.0
    return {
        "total_assets": total_assets,
        "documents": documents,
        "embedded_documents": embedded_documents,
        "sub_assets": sub_assets,
        "total_chunks": total_chunks,
        "embedded_chunks": embedded_chunks,
        "coverage_percentage": round(coverage, 2),
        "models_used": {name: count for name, _dim, count in models_used},
        # The stored vectors' dimension — the most used model's.
        "dimension": models_used[0][1] if models_used else None,
    }


def clear_embeddings(session: Session, infospace_id: int) -> int:
    """Null out every embedding vector in an infospace. Commits. Returns chunks touched."""
    chunks_query = (
        select(AssetChunk.id)
        .join(Asset)
        .where(Asset.infospace_id == infospace_id)
    )
    chunk_ids = list(session.exec(chunks_query).all())
    if not chunk_ids:
        return 0

    for chunk_id in chunk_ids:
        chunk = session.get(AssetChunk, chunk_id)
        if chunk:
            chunk.embedding_model_id = None
            for dim in EMBEDDING_SUPPORTED_DIMS:
                setattr(chunk, f"embedding_{dim}", None)
            session.add(chunk)
    session.commit()
    logger.info("Cleared embeddings for %d chunks in infospace %d", len(chunk_ids), infospace_id)
    return len(chunk_ids)


def reset_for_assets(session: Session, asset_ids: List[int]) -> None:
    """Drop chunks + clear enrichment tracking for embedding, so the enricher picks them up again."""
    if not asset_ids:
        return
    session.execute(
        sa_delete(AssetChunk).where(AssetChunk.asset_id.in_(asset_ids))
    )
    session.execute(sa_text(
        "UPDATE asset SET "
        "  enrichment_resolved = array_remove(COALESCE(enrichment_resolved, ARRAY[]::text[]), 'embedding'),"
        "  enrichment_errors = CASE WHEN jsonb_typeof(enrichment_errors) = 'object' "
        "    THEN enrichment_errors - 'embedding' ELSE enrichment_errors END "
        "WHERE id = ANY(:ids)"
    ), {"ids": asset_ids})
    session.commit()
