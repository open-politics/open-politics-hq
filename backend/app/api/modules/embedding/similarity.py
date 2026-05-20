"""
Flat semantic-search primitives over AssetChunk.

- ``similarity_search(query_vector, embedding_model_id)`` — pure pgvector SQL.
  No provider resolution, no embedding work. Caller passes a vector that's
  already sized to the model's dimension (Matryoshka truncation applied
  upstream).

- ``search_by_text(query_text)`` — convenience: embed the query via
  ``embed.embed_texts`` using the infospace's configured model (or an explicit
  ``embedding_model_id``), then call ``similarity_search``.

``ChunkHit`` is the result shape — same attribute surface as the old
``SearchResult``, so MCP/RAG consumers don't need restructuring.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import text as sa_text
from sqlmodel import Session

from app.models import Asset, AssetChunk, AssetKind, Infospace
from app.api.modules.content.models import (
    EMBEDDING_SUPPORTED_DIMS,
    get_embedding_column_for_dimension,
)
from app.api.modules.embedding.embed import embed_texts
from app.api.modules.identity_infospace_user.access import PackageScope

logger = logging.getLogger(__name__)


class ChunkHit:
    """One chunk returned from similarity search."""

    __slots__ = (
        "chunk_id", "chunk_index", "chunk_text", "chunk_metadata",
        "asset_id", "asset_uuid", "asset_title", "asset_kind", "asset_created_at",
        "parent_asset_id", "similarity", "distance",
    )

    def __init__(self, chunk: AssetChunk, asset: Asset, similarity: float, distance: float):
        self.chunk_id = chunk.id
        self.chunk_index = chunk.chunk_index
        self.chunk_text = chunk.text_content
        self.chunk_metadata = chunk.chunk_metadata
        self.asset_id = asset.id
        self.asset_uuid = asset.uuid
        self.asset_title = asset.title
        self.asset_kind = asset.kind
        self.asset_created_at = asset.created_at
        self.parent_asset_id = asset.parent_asset_id
        self.similarity = similarity
        self.distance = distance

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "chunk_index": self.chunk_index,
            "chunk_text": self.chunk_text,
            "chunk_metadata": self.chunk_metadata,
            "asset_id": self.asset_id,
            "asset_uuid": self.asset_uuid,
            "asset_title": self.asset_title,
            "asset_kind": self.asset_kind.value if hasattr(self.asset_kind, "value") else str(self.asset_kind),
            "asset_created_at": self.asset_created_at.isoformat() if self.asset_created_at else None,
            "parent_asset_id": self.parent_asset_id,
            "similarity": round(self.similarity, 4),
            "distance": round(self.distance, 4),
        }


async def similarity_search(
    session: Session,
    infospace_id: int,
    query_vector: List[float],
    embedding_model_id: int,
    *,
    limit: int = 20,
    distance_threshold: Optional[float] = None,
    distance_function: str = "cosine",
    asset_kinds: Optional[List[AssetKind]] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    bundle_id: Optional[int] = None,
    parent_asset_id: Optional[int] = None,
    scope: Optional[PackageScope] = None,
) -> List[ChunkHit]:
    """Pure pgvector-backed similarity search.

    ``query_vector`` must already be sized to the ``embedding_model_id``'s
    dimension. Use ``embed.embed_texts`` to produce one.
    """
    from app.models import EmbeddingModel

    em = session.get(EmbeddingModel, embedding_model_id)
    if em is None:
        raise ValueError(f"Embedding model {embedding_model_id} not found")
    dim = em.dimension
    col_name = get_embedding_column_for_dimension(dim)
    if not col_name:
        raise ValueError(
            f"Embedding dimension {dim} not supported for search. "
            f"Supported: {', '.join(str(d) for d in EMBEDDING_SUPPORTED_DIMS)}."
        )

    if len(query_vector) > dim:
        query_vector = query_vector[:dim]
    if len(query_vector) != dim:
        raise ValueError(
            f"query_vector has {len(query_vector)} dims but model expects {dim}"
        )
    vec_str = "[" + ",".join(str(x) for x in query_vector) + "]"

    extra_where: List[str] = []
    params: Dict[str, Any] = {
        "query_vec": vec_str,
        "infospace_id": infospace_id,
        "embedding_model_id": embedding_model_id,
        "limit": limit,
    }
    if asset_kinds:
        extra_where.append("a.kind = ANY(:asset_kinds)")
        params["asset_kinds"] = [k.value for k in asset_kinds]
    if date_from:
        extra_where.append("a.created_at >= :date_from")
        params["date_from"] = date_from
    if date_to:
        extra_where.append("a.created_at <= :date_to")
        params["date_to"] = date_to
    if bundle_id is not None:
        extra_where.append("a.bundle_ids @> ARRAY[:bundle_id]::int[]")
        params["bundle_id"] = bundle_id
    if parent_asset_id is not None:
        extra_where.append("a.parent_asset_id = :parent_asset_id")
        params["parent_asset_id"] = parent_asset_id

    if scope is not None:
        scope_parts: List[str] = []
        if scope.bundle_ids:
            scope_parts.append("a.bundle_ids && CAST(:scope_bids AS int[])")
            params["scope_bids"] = list(scope.bundle_ids)
        if scope.asset_ids:
            scope_parts.append("a.id = ANY(:scope_aids)")
            params["scope_aids"] = list(scope.asset_ids)
        if scope.run_ids:
            scope_parts.append(
                "a.id IN (SELECT DISTINCT asset_id FROM annotation WHERE run_id = ANY(:scope_rids))"
            )
            params["scope_rids"] = list(scope.run_ids)
        if scope_parts:
            extra_where.append("(" + " OR ".join(scope_parts) + ")")
        else:
            extra_where.append("FALSE")

    extra_sql = " AND " + " AND ".join(extra_where) if extra_where else ""
    sql = sa_text(f"""
        SELECT c.id as chunk_id, c.asset_id, a.id as asset_id,
               (c.{col_name} <=> CAST(:query_vec AS vector)) as distance
        FROM assetchunk c
        JOIN asset a ON c.asset_id = a.id
        WHERE a.infospace_id = :infospace_id
          AND c.embedding_model_id = :embedding_model_id
          AND c.{col_name} IS NOT NULL
          {extra_sql}
        ORDER BY c.{col_name} <=> CAST(:query_vec AS vector)
        LIMIT :limit
    """)
    rows = session.execute(sql, params).all()
    if not rows:
        return []

    hits: List[ChunkHit] = []
    for row in rows:
        distance = float(row.distance)
        if distance_threshold is not None and distance > distance_threshold:
            continue
        similarity = 1.0 - distance if distance_function == "cosine" else distance
        chunk = session.get(AssetChunk, row.chunk_id)
        asset = session.get(Asset, row.asset_id)
        if chunk and asset:
            hits.append(ChunkHit(chunk, asset, similarity, distance))

    logger.info(
        "Similarity search in infospace %d: %d results (pgvector indexed)",
        infospace_id, len(hits),
    )
    return hits


async def search_by_text(
    session: Session,
    infospace_id: int,
    query_text: str,
    *,
    runtime_key: Optional[str] = None,
    embedding_model_id: Optional[int] = None,
    limit: int = 20,
    distance_threshold: Optional[float] = None,
    distance_function: str = "cosine",
    asset_kinds: Optional[List[AssetKind]] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    bundle_id: Optional[int] = None,
    parent_asset_id: Optional[int] = None,
    scope: Optional[PackageScope] = None,
) -> List[ChunkHit]:
    """Embed ``query_text`` via the infospace's configured model, then search."""
    vectors, em = await embed_texts(
        session, infospace_id, [query_text],
        runtime_key=runtime_key,
        embedding_model_id=embedding_model_id,
    )
    if not vectors:
        return []
    return await similarity_search(
        session, infospace_id, vectors[0], em.id,
        limit=limit,
        distance_threshold=distance_threshold,
        distance_function=distance_function,
        asset_kinds=asset_kinds,
        date_from=date_from, date_to=date_to,
        bundle_id=bundle_id, parent_asset_id=parent_asset_id,
        scope=scope,
    )
