"""
Compute representative vectors for an asset.

Used by ``find_similar_assets``-style flows. Each helper resolves the asset,
pulls the right source (title, chunks, text, images), and returns a vector
sized to the infospace's configured embedding model.

Returns ``None`` when the asset lacks the required source (e.g. chunk-mean for
an asset with no chunks). Callers decide whether to fall back or raise.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy import func
from sqlmodel import Session, select

from app.models import Asset, AssetChunk
from app.api.modules.content.models import (
    EMBEDDING_SUPPORTED_DIMS,
    get_embedding_column_for_dimension,
)
from app.api.modules.embedding.embed import embed_texts

logger = logging.getLogger(__name__)


async def vector_from_title(
    session: Session, asset_id: int, *, runtime_key: Optional[str] = None,
) -> Optional[List[float]]:
    """Embed the asset's title via the infospace's configured model."""
    asset = session.get(Asset, asset_id)
    if not asset or not asset.title:
        return None
    vectors, _em = await embed_texts(
        session, asset.infospace_id, [asset.title], runtime_key=runtime_key,
    )
    return vectors[0] if vectors else None


async def vector_from_text(
    session: Session, asset_id: int, *, runtime_key: Optional[str] = None,
) -> Optional[List[float]]:
    """Embed the asset's full text content."""
    asset = session.get(Asset, asset_id)
    if not asset or not asset.text_content:
        return None
    vectors, _em = await embed_texts(
        session, asset.infospace_id, [asset.text_content], runtime_key=runtime_key,
    )
    return vectors[0] if vectors else None


async def vector_from_chunks(
    session: Session, asset_id: int, *, aggregation: str = "mean",
) -> Optional[List[float]]:
    """Aggregate pre-computed chunk vectors into one representative vector.

    No provider call — reads the stored pgvector columns. Requires chunks to
    have been embedded already.
    """
    asset = session.get(Asset, asset_id)
    if not asset:
        return None

    # Probe which dimension column has values — take the first non-null column.
    for dim in EMBEDDING_SUPPORTED_DIMS:
        col_name = get_embedding_column_for_dimension(dim)
        if not col_name:
            continue
        col = getattr(AssetChunk, col_name)
        rows = session.exec(
            select(col).where(AssetChunk.asset_id == asset_id).where(col.isnot(None))
        ).all()
        if not rows:
            continue

        # pgvector returns values as list[float] when hydrated via SQLAlchemy.
        vecs = [list(v) for v in rows if v is not None]
        if not vecs:
            continue

        if aggregation == "mean":
            out = [sum(col_vals) / len(col_vals) for col_vals in zip(*vecs)]
            return out
        elif aggregation == "max":
            out = [max(col_vals) for col_vals in zip(*vecs)]
            return out
        else:
            raise ValueError(f"Unknown aggregation: {aggregation}")
    return None


async def vector_from_images(
    session: Session, asset_id: int, *, aggregation: str = "mean",
) -> Optional[List[float]]:
    """Aggregate image embeddings for an asset.

    Not yet implemented — no visual embedding pipeline ships in v2.
    See docs/plans/hq-v2/ROADMAP.md § 'What v2 does NOT ship'.
    """
    raise NotImplementedError(
        "Visual embedding pipeline not yet available. "
        "See docs/plans/hq-v2/ROADMAP.md § 'What v2 does NOT ship'."
    )
