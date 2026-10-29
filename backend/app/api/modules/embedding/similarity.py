"""
Flat semantic primitives over AssetChunk.

- ``weigh(meaning)`` — how close every embedded document in scope is to a meaning:
  its best chunk's similarity, scored exactly. What AQL's ``~`` thresholds or
  ranks; complete, so neither stops at a top-k.

- ``weigh_texts(meaning, texts)`` — the same for short texts embedded before
  (``TextVector``): a graph's names, read by what they say.

- ``describe(meaning, within)`` — meaning → words: the passages of some
  documents closest to a meaning, and the closest of some short texts.

A **meaning** is a phrase, embedded, or ``Like(documents, unlike)``: the
centroid of documents, less the centroid of others — "more like these than
those". Every reader above takes either.

- ``similarity_search(query_vector, embedding_model_id)`` — the nearest chunks,
  pure pgvector SQL. No provider resolution, no embedding work. Caller passes a
  vector that's already sized to the model's dimension (Matryoshka truncation
  applied upstream).

- ``search_by_text(query_text)`` — the nearest chunks to a phrase, for callers
  that want passages (RAG, MCP).

A phrase is compared only with chunks of the model it was embedded with: both
``weigh`` and ``search_by_text`` embed it once per model the infospace's
chunks are in (``models_in``), never with whatever the infospace is configured
to embed new documents with — after a model switch the old chunks stay
readable until they are embedded again.

``ChunkHit`` is the result shape — same attribute surface as the old
``SearchResult``, so MCP/RAG consumers don't need restructuring.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Union

from sqlalchemy import String, any_, bindparam
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlmodel import Session, select

from app.api.modules.content.models import (
    EMBEDDING_SUPPORTED_DIMS,
    get_embedding_column_for_dimension,
)
from app.api.modules.embedding.embed import _digest, embed_texts
from app.api.modules.identity_infospace_user.access import PackageScope
from app.models import Asset, AssetChunk, AssetKind, EmbeddingModel, TextVector

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


def _vec(v: List[float]) -> str:
    return "[" + ",".join(str(x) for x in v) + "]"


def _scope_sql(
    params: Dict[str, Any],
    *,
    asset_kinds: Optional[List[AssetKind]] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    bundle_id: Optional[int] = None,
    parent_asset_id: Optional[int] = None,
    scope: Optional[PackageScope] = None,
) -> str:
    """The ``AND …`` narrowing the documents ``a`` a search reads, its binds
    added to *params*. Empty when nothing narrows."""
    where: List[str] = []
    if asset_kinds:
        where.append("a.kind = ANY(:asset_kinds)")
        params["asset_kinds"] = [k.value for k in asset_kinds]
    if date_from:
        where.append("a.created_at >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where.append("a.created_at <= :date_to")
        params["date_to"] = date_to
    if bundle_id is not None:
        where.append("a.bundle_ids @> ARRAY[:bundle_id]::int[]")
        params["bundle_id"] = bundle_id
    if parent_asset_id is not None:
        where.append("a.parent_asset_id = :parent_asset_id")
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
            where.append("(" + " OR ".join(scope_parts) + ")")
        else:
            where.append("FALSE")

    return " AND " + " AND ".join(where) if where else ""


def models_in(session: Session, infospace_id: int) -> List[EmbeddingModel]:
    """The models an infospace's chunks are embedded with — what a phrase must be
    embedded with to be compared with them."""
    used = (
        select(AssetChunk.id)
        .join(Asset, Asset.id == AssetChunk.asset_id)
        .where(AssetChunk.embedding_model_id == EmbeddingModel.id)
        .where(Asset.infospace_id == infospace_id)
        .exists()
    )
    return list(session.exec(select(EmbeddingModel).where(used)).all())


@dataclass(frozen=True)
class Like:
    """A meaning made of documents: their centroid, less the centroid of
    *unlike*. A room reads as ``Like(room, unlike=run)`` — what sets it apart,
    not what every document of the run shares."""

    documents: tuple[int, ...]
    unlike: tuple[int, ...] = ()


Meaning = Union[str, Like]


def _documents(params: Dict[str, Any], key: str, documents: Sequence[int]) -> str:
    """A join of chunked assets ``a`` to the *documents* they count toward —
    each document itself and its parts — binding the ids as *key*."""
    params[key] = list(documents)
    return f"""JOIN (SELECT id AS asset, id AS document FROM asset WHERE id = ANY(:{key})
                    UNION ALL
                    SELECT id, parent_asset_id FROM asset WHERE parent_asset_id = ANY(:{key})
                   ) d ON d.asset = a.id"""


def centroid(session: Session, infospace_id: int, documents: Sequence[int], em: EmbeddingModel) -> Optional[List[float]]:
    """The mean of *documents* under *em*: each document's chunks, its parts
    among them, averaged into one vector, and those averaged — so a long
    document counts once, as a short one does. None when none has a chunk."""
    if not documents:
        return None
    col = get_embedding_column_for_dimension(em.dimension)
    assert col, f"chunks under {em.name} at an unsupported dimension {em.dimension}"
    params: Dict[str, Any] = {"infospace_id": infospace_id, "embedding_model_id": em.id}
    of = _documents(params, "documents", documents)
    mean = session.execute(sa_text(f"""
        SELECT CAST(avg(m) AS text) FROM (
            SELECT avg(c.{col}) AS m
            FROM assetchunk c
            JOIN asset a ON c.asset_id = a.id
            {of}
            WHERE a.infospace_id = :infospace_id
              AND c.embedding_model_id = :embedding_model_id
              AND c.{col} IS NOT NULL
            GROUP BY d.document
        ) per_document
    """), params).scalar()
    return json.loads(mean) if mean else None


async def vector_of(session: Session, infospace_id: int, meaning: Meaning, em: EmbeddingModel) -> Optional[List[float]]:
    """*meaning* as a vector of *em*'s: a phrase embedded by it, or documents'
    centroid under it. None when the documents have no chunks of *em*'s.

    ``Like`` with nothing to set it apart — the documents are all of
    *unlike*, near enough — reads as its own centroid."""
    if isinstance(meaning, str):
        (vector,), _ = await embed_texts(session, infospace_id, [meaning], embedding_model_id=em.id)
        return vector
    own = centroid(session, infospace_id, meaning.documents, em)
    against = centroid(session, infospace_id, meaning.unlike, em) if own and meaning.unlike else None
    if not against:
        return own
    apart = [a - b for a, b in zip(own, against)]
    return apart if math.hypot(*apart) > 1e-3 * math.hypot(*own) else own


async def weigh(
    session: Session,
    infospace_id: int,
    meaning: Meaning,
    *,
    asset_kinds: Optional[List[AssetKind]] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    bundle_id: Optional[int] = None,
    parent_asset_id: Optional[int] = None,
    scope: Optional[PackageScope] = None,
    within: Optional[Sequence[int]] = None,
) -> Dict[int, float]:
    """How close every embedded document in scope is to *meaning*: asset id →
    its best chunk's cosine similarity.

    Scored exactly — no index, no top-k — so whatever thresholds or ranks the
    result sees every document. Each model the infospace's chunks are in reads
    its own chunks with the meaning as that model reads it; a document with
    chunks under two (mid-switch) keeps its best.

    *within* reads only those documents, each with its parts — a page's chunks
    count toward its document — and keys the result by them.
    """
    params: Dict[str, Any] = {"infospace_id": infospace_id}
    extra_sql = _scope_sql(
        params, asset_kinds=asset_kinds, date_from=date_from, date_to=date_to,
        bundle_id=bundle_id, parent_asset_id=parent_asset_id, scope=scope,
    )
    # Each chunked asset's document: itself, unless *within* folds parts in.
    document, of = "a.id", ""
    if within is not None:
        if not within:
            return {}
        document, of = "d.document", _documents(params, "within", within)
    out: Dict[int, float] = {}
    for em in models_in(session, infospace_id):
        col = get_embedding_column_for_dimension(em.dimension)
        assert col, f"chunks under {em.name} at an unsupported dimension {em.dimension}"
        vector = await vector_of(session, infospace_id, meaning, em)
        if vector is None:
            continue
        rows = session.execute(sa_text(f"""
            SELECT {document} AS asset_id, max(1 - (c.{col} <=> CAST(:query_vec AS vector))) AS similarity
            FROM assetchunk c
            JOIN asset a ON c.asset_id = a.id
            {of}
            WHERE a.infospace_id = :infospace_id
              AND c.embedding_model_id = :embedding_model_id
              AND c.{col} IS NOT NULL
              {extra_sql}
            GROUP BY 1
        """), {**params, "query_vec": _vec(vector), "embedding_model_id": em.id}).all()
        for asset_id, similarity in rows:
            if asset_id not in out or similarity > out[asset_id]:
                out[asset_id] = float(similarity)
    return out


async def weigh_texts(
    session: Session,
    infospace_id: int,
    meaning: Meaning,
    texts: Sequence[str],
) -> Dict[str, float]:
    """How close each of *texts* is to *meaning*: text → cosine similarity, by
    the vectors this infospace remembers for them (``TextVector``). A text
    never embedded is left out — absent, not far — and nothing is embedded
    here but a phrase.

    Each model holding vectors for them reads its own with the meaning as that
    model reads it; a text under two (mid-switch) keeps its best.
    """
    by_digest = {_digest(t): t for t in dict.fromkeys(texts)}
    if not by_digest:
        return {}
    digests = bindparam("digests", list(by_digest), type_=PG_ARRAY(String))
    held = session.exec(
        select(TextVector.embedding_model_id).distinct()
        .where(TextVector.infospace_id == infospace_id)
        .where(TextVector.digest == any_(digests))
    ).all()
    out: Dict[str, float] = {}
    for em in session.exec(select(EmbeddingModel).where(EmbeddingModel.id.in_(held))).all():
        col = get_embedding_column_for_dimension(em.dimension)
        assert col, f"text vectors under {em.name} at an unsupported dimension {em.dimension}"
        vector = await vector_of(session, infospace_id, meaning, em)
        if vector is None:
            continue
        rows = session.execute(sa_text(f"""
            SELECT digest, 1 - ({col} <=> CAST(:query_vec AS vector)) AS similarity
            FROM text_vector
            WHERE infospace_id = :infospace_id
              AND embedding_model_id = :embedding_model_id
              AND digest = ANY(:digests)
              AND {col} IS NOT NULL
        """), {"infospace_id": infospace_id, "embedding_model_id": em.id,
               "query_vec": _vec(vector), "digests": list(by_digest)}).all()
        for digest, similarity in rows:
            t = by_digest[digest]
            if t not in out or similarity > out[t]:
                out[t] = float(similarity)
    return out


#: How much of a passage ``describe`` returns, in characters.
PASSAGE = 480


async def describe(
    session: Session,
    infospace_id: int,
    meaning: Meaning,
    *,
    within: Sequence[int],
    texts: Sequence[str] = (),
    passages: int = 3,
    terms: int = 8,
) -> Dict[str, List[Dict[str, Any]]]:
    """Meaning → words. ``passages``: the chunks of *within* — documents, their
    parts counted toward them — closest to *meaning*, one per document, best
    first, as ``{asset_id, title, text, similarity}``. ``terms``: the closest
    of *texts* by their remembered vectors (``weigh_texts``), as ``{text,
    similarity}``. Each model reads its own chunks; the best of any wins."""
    found: Dict[int, Dict[str, Any]] = {}
    if within and passages > 0:
        for em in models_in(session, infospace_id):
            col = get_embedding_column_for_dimension(em.dimension)
            assert col, f"chunks under {em.name} at an unsupported dimension {em.dimension}"
            vector = await vector_of(session, infospace_id, meaning, em)
            if vector is None:
                continue
            params: Dict[str, Any] = {"infospace_id": infospace_id, "embedding_model_id": em.id,
                                      "query_vec": _vec(vector), "limit": passages}
            of = _documents(params, "within", within)
            rows = session.execute(sa_text(f"""
                SELECT per.document, doc.title, per.text, per.similarity
                FROM (
                    SELECT DISTINCT ON (d.document) d.document, c.text_content AS text,
                           1 - (c.{col} <=> CAST(:query_vec AS vector)) AS similarity
                    FROM assetchunk c
                    JOIN asset a ON c.asset_id = a.id
                    {of}
                    WHERE a.infospace_id = :infospace_id
                      AND c.embedding_model_id = :embedding_model_id
                      AND c.{col} IS NOT NULL
                    ORDER BY d.document, c.{col} <=> CAST(:query_vec AS vector)
                ) per
                JOIN asset doc ON doc.id = per.document
                ORDER BY per.similarity DESC
                LIMIT :limit
            """), params).all()
            for document, title, text, similarity in rows:
                if document not in found or similarity > found[document]["similarity"]:
                    found[document] = {"asset_id": document, "title": title or "",
                                       "text": (text or "")[:PASSAGE], "similarity": float(similarity)}
    near = await weigh_texts(session, infospace_id, meaning, texts) if texts and terms > 0 else {}
    return {
        "passages": sorted(found.values(), key=lambda p: -p["similarity"])[:passages],
        "terms": [{"text": t, "similarity": s} for t, s in sorted(near.items(), key=lambda x: -x[1])[:terms]],
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
    params: Dict[str, Any] = {
        "query_vec": _vec(query_vector),
        "infospace_id": infospace_id,
        "embedding_model_id": embedding_model_id,
        "limit": limit,
    }
    extra_sql = _scope_sql(
        params, asset_kinds=asset_kinds, date_from=date_from, date_to=date_to,
        bundle_id=bundle_id, parent_asset_id=parent_asset_id, scope=scope,
    )
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
    """The *limit* chunks nearest ``query_text`` — under ``embedding_model_id``,
    else under every model the infospace's chunks are in, the phrase embedded by
    each."""
    model_ids = [embedding_model_id] if embedding_model_id is not None else [
        em.id for em in models_in(session, infospace_id)
    ]
    hits: List[ChunkHit] = []
    for model_id in model_ids:
        (vector,), _ = await embed_texts(
            session, infospace_id, [query_text],
            runtime_key=runtime_key,
            embedding_model_id=model_id,
        )
        hits += await similarity_search(
            session, infospace_id, vector, model_id,
            limit=limit,
            distance_threshold=distance_threshold,
            distance_function=distance_function,
            asset_kinds=asset_kinds,
            date_from=date_from, date_to=date_to,
            bundle_id=bundle_id, parent_asset_id=parent_asset_id,
            scope=scope,
        )
    hits.sort(key=lambda h: h.similarity, reverse=True)
    return hits[:limit]
