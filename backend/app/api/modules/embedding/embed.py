"""
Flat embedding primitives.

`embed_texts` is the single text-to-vector entrypoint. Provider resolution
goes through the registry keyed by infospace owner; BYOK flows via runtime_key.

`ensure_embedding_model` registers (or finds) the EmbeddingModel row backing a
given (provider, model_name, dimension) triple. Callers that already have an
embedding_model_id can use `embed_texts(embedding_model_id=...)` to skip
config lookup on the infospace.

`embedding_stats` / `clear_embeddings` / `reset_for_assets` are plain DB
aggregates — no provider calls.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, or_, text as sa_text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models import Asset, AssetChunk, EmbeddingModel
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
        from app.api.modules.foundation_service_providers.registry import get_model_spec
        from app.api.modules.foundation_service_providers.base import EmbeddingModelSpec
        spec = get_model_spec("embedding", provider, model_name)
        if isinstance(spec, EmbeddingModelSpec):
            dimension = spec.dimension

        if dimension is None:
            if infospace_id is None:
                raise ValueError(
                    "ensure_embedding_model needs infospace_id to probe dimension when "
                    "no static spec is available"
                )
            from app.api.modules.foundation_service_providers.registry import resolve
            provider_instance = resolve(
                "embedding", provider, model_name,
                infospace_id=infospace_id,
                runtime_key=runtime_key,
                session=session,
            )
            if hasattr(provider_instance._instance, "_probe_model"):
                info = await provider_instance._probe_model(model_name)
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
    """Turn arbitrary strings into vectors.

    Resolution precedence:
    - ``embedding_model_id`` given → use that row.
    - ``provider`` + ``model_name`` given → register (or reuse) that row.
    - Neither → use the infospace's configured embedding selection.

    Returns ``(vectors, embedding_model)``. Vectors are truncated to the row's
    declared dimension when the provider returns a larger Matryoshka vector.
    """
    from app.api.modules.foundation_service_providers import get_selection, resolve

    if not texts:
        infospace = session.get(Infospace, infospace_id)
        if not infospace:
            raise ValueError(f"Infospace {infospace_id} not found")
        sel = get_selection(session, infospace_id, "embedding")
        if not sel or not sel.model_name:
            raise ValueError(f"Infospace {infospace_id} has no embedding configured")
        em = await ensure_embedding_model(
            session, sel.provider_key, sel.model_name,
            dimension=infospace.get_embedding_dimension_override(),
            infospace_id=infospace_id, runtime_key=runtime_key,
        )
        return [], em

    if embedding_model_id is not None:
        em = session.get(EmbeddingModel, embedding_model_id)
        if em is None:
            raise ValueError(f"Embedding model {embedding_model_id} not found")
        resolve_provider, resolve_model = em.provider, em.name
    elif provider and model_name:
        em = await ensure_embedding_model(
            session, provider, model_name,
            infospace_id=infospace_id, runtime_key=runtime_key,
        )
        resolve_provider, resolve_model = provider, model_name
    else:
        infospace = session.get(Infospace, infospace_id)
        if not infospace:
            raise ValueError(f"Infospace {infospace_id} not found")
        sel = get_selection(session, infospace_id, "embedding")
        if not sel or not sel.model_name:
            raise ValueError(f"Infospace {infospace_id} has no embedding configured")
        dim_override = infospace.get_embedding_dimension_override()
        em = await ensure_embedding_model(
            session, sel.provider_key, sel.model_name,
            dimension=dim_override,
            infospace_id=infospace_id, runtime_key=runtime_key,
        )
        resolve_provider, resolve_model = sel.provider_key, sel.model_name


    p = resolve(
        "embedding", resolve_provider, resolve_model,
        infospace_id=infospace_id,
        runtime_key=runtime_key,
        session=session,
    )
    vectors = await p.embed_texts(texts, resolve_model)

    if len(vectors) != len(texts):
        raise RuntimeError(
            f"Embedding count mismatch: {len(vectors)} vectors vs {len(texts)} texts"
        )

    target_dim = em.dimension
    if vectors and len(vectors[0]) > target_dim:
        vectors = [v[:target_dim] for v in vectors]
    elif vectors and len(vectors[0]) != target_dim:
        raise RuntimeError(
            f"Dimension mismatch for {resolve_model}: got {len(vectors[0])}, need {target_dim}"
        )
    return vectors, em


def embedding_stats(session: Session, infospace_id: int) -> Dict[str, Any]:
    """Aggregate coverage for an infospace. No provider calls."""
    asset_counts = session.exec(
        select(
            func.count(Asset.id),
            func.count(Asset.id).filter(Asset.parent_asset_id.is_(None)),
        ).where(Asset.infospace_id == infospace_id, Asset.text_content.isnot(None))
    ).one()
    total_assets, documents = asset_counts
    sub_assets = total_assets - documents

    dim_conditions = [getattr(AssetChunk, f"embedding_{d}").isnot(None) for d in EMBEDDING_SUPPORTED_DIMS]
    chunk_counts = session.exec(
        select(
            func.count(AssetChunk.id),
            func.count(AssetChunk.id).filter(or_(*dim_conditions)),
        ).join(Asset).where(Asset.infospace_id == infospace_id)
    ).one()
    total_chunks, embedded_chunks = chunk_counts

    models_used = session.exec(
        select(EmbeddingModel.name, func.count(AssetChunk.id))
        .join(AssetChunk)
        .join(Asset)
        .where(Asset.infospace_id == infospace_id)
        .where(AssetChunk.embedding_model_id.isnot(None))
        .group_by(EmbeddingModel.name)
    ).all()

    coverage = (embedded_chunks / total_chunks * 100) if total_chunks > 0 else 0.0
    return {
        "total_assets": total_assets,
        "documents": documents,
        "sub_assets": sub_assets,
        "total_chunks": total_chunks,
        "embedded_chunks": embedded_chunks,
        "coverage_percentage": round(coverage, 2),
        "models_used": {name: count for name, count in models_used},
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
