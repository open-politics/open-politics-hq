"""
Entity Resolution Utilities

Resolves raw entity mentions to ``Entity`` rows within a specific ``Canon``
using alias matching and embedding-based similarity. Uses pgvector SQL for
all supported dimensions.

Resolution always scopes to a single canon (``canon_id`` is required). The
caller is responsible for resolving graph→canon upstream — see
``tasks/curation.py:_resolve_target_canon``. Cross-canon entity reuse is
forbidden by design: the same ``(name, type)`` curated into two different
canons produces two different Entity rows.

Embedding is produced via ``modules/embedding/embed.embed_texts``; callers
enable embedding similarity by passing ``use_embeddings=True``. Credentials
follow the infospace owner.
"""
import logging
from typing import List, Dict, Any, Optional, Tuple

from sqlmodel import Session
from sqlalchemy import text

from app.api.modules.graph.models import Entity

logger = logging.getLogger(__name__)


def find_by_alias(
    session: Session,
    canon_id: int,
    raw_name: str,
    entity_type: str,
    exclude_entity_id: Optional[int] = None,
) -> Optional[Entity]:
    """Find Entity in a canon by exact canonical_name or alias match.

    Uses SQL-level matching for scalability (no in-memory scan).
    """
    normalized_name = raw_name.strip().lower()
    if not normalized_name:
        return None

    exclude_clause = "AND id != :exclude_id" if exclude_entity_id is not None else ""
    params: Dict[str, Any] = {
        "cid": canon_id,
        "etype": entity_type,
        "name": normalized_name,
    }
    if exclude_entity_id is not None:
        params["exclude_id"] = exclude_entity_id
    exact_sql = text(f"""
        SELECT id FROM entity
        WHERE canon_id = :cid AND entity_type = :etype {exclude_clause}
        AND (
            LOWER(TRIM(canonical_name)) = :name
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE(aliases::jsonb, '[]'::jsonb)) AS elem
                WHERE LOWER(TRIM(elem::text)) = :name
            )
        )
        LIMIT 1
    """)
    row = session.execute(exact_sql, params).fetchone()
    if row:
        return session.get(Entity, row[0])

    # No substring matching — too many false merges (e.g. "Washington" matching
    # "George Washington" and "Washington Post"). Embedding similarity handles
    # the fuzzy cases; exact alias catches known names. When embedding resolution
    # finds a match, it adds the raw name as an alias for future exact lookups.
    return None


def _find_by_embedding_sql(
    session: Session,
    canon_id: int,
    entity_type: str,
    vec: List[float],
    similarity_threshold: float = 0.85,
) -> Optional[Entity]:
    """Find Entity by pgvector SQL (no embedding generation). Used by resolve_entities_batch."""
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

    dim = len(vec)
    if dim not in EMBEDDING_SUPPORTED_DIMS:
        return None
    col_name = f"embedding_{dim}"
    vec_str = "[" + ",".join(str(x) for x in vec) + "]"
    params: Dict[str, Any] = {
        "cid": canon_id,
        "etype": entity_type,
        "vec": vec_str,
        "thresh": 1.0 - similarity_threshold,
    }
    sql = text(f"""
        SELECT id, ({col_name} <=> CAST(:vec AS vector)) AS dist
        FROM entity
        WHERE canon_id = :cid AND entity_type = :etype
          AND {col_name} IS NOT NULL
        ORDER BY {col_name} <=> CAST(:vec AS vector)
        LIMIT 1
    """)
    row = session.execute(sql, params).fetchone()
    if row and row[1] is not None and row[1] <= (1.0 - similarity_threshold):
        return session.get(Entity, row[0])
    return None


async def find_by_embedding(
    session: Session,
    infospace_id: int,
    canon_id: int,
    raw_name: str,
    entity_type: str,
    similarity_threshold: float = 0.85,
    exclude_entity_id: Optional[int] = None,
) -> Optional[Entity]:
    """Find Entity in a canon by embedding similarity.

    Uses pgvector SQL for all supported dimensions (384, 512, 768, 1024, 1536).
    ``infospace_id`` is required for embedding provider selection (separate
    from the canon scoping which uses ``canon_id``).
    """
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS
    from app.api.modules.embedding.embed import embed_texts
    from app.api.modules.foundation_service_providers import get_selection

    try:
        sel = get_selection(session, infospace_id, "embedding")
        if not sel or not sel.model_name:
            logger.debug(f"No embedding configured for infospace {infospace_id}")
            return None

        vectors, _em = await embed_texts(session, infospace_id, [raw_name])
        if not vectors:
            logger.warning(f"Failed to generate embedding for '{raw_name}'")
            return None

        raw_embedding = vectors[0]
        dim = len(raw_embedding) if raw_embedding else 0
        if dim not in EMBEDDING_SUPPORTED_DIMS:
            logger.debug(f"Embedding dimension {dim} not supported; skipping")
            return None
    except Exception as e:
        logger.warning(f"Error generating embedding for '{raw_name}': {e}")
        return None

    col_name = f"embedding_{dim}"
    vec_str = "[" + ",".join(str(x) for x in raw_embedding) + "]"
    exclude_clause = "AND id != :exclude_id" if exclude_entity_id is not None else ""
    params: Dict[str, Any] = {
        "cid": canon_id,
        "etype": entity_type,
        "vec": vec_str,
        "thresh": 1.0 - similarity_threshold,
    }
    if exclude_entity_id is not None:
        params["exclude_id"] = exclude_entity_id

    sql = text(f"""
        SELECT id, ({col_name} <=> CAST(:vec AS vector)) AS dist
        FROM entity
        WHERE canon_id = :cid AND entity_type = :etype {exclude_clause}
          AND {col_name} IS NOT NULL
        ORDER BY {col_name} <=> CAST(:vec AS vector)
        LIMIT 1
    """)
    row = session.execute(sql, params).fetchone()
    if row and row[1] is not None and row[1] <= (1.0 - similarity_threshold):
        return session.get(Entity, row[0])
    return None


async def resolve_entity(
    session: Session,
    infospace_id: int,
    canon_id: int,
    raw_name: str,
    entity_type: str,
    use_embeddings: bool = True,
    similarity_threshold: float = 0.85,
) -> Entity:
    """Resolve a raw entity mention to an Entity row in the target canon.

    Strategy:
    1. Exact alias match within ``canon_id`` (canonical_name or aliases).
    2. If no match and ``use_embeddings``, embedding similarity within canon.
    3. If still no match, create a new Entity in the canon.
    """
    existing = find_by_alias(session, canon_id, raw_name, entity_type)
    if existing:
        logger.debug(f"Alias match: '{raw_name}' -> '{existing.canonical_name}'")
        return existing

    if use_embeddings:
        match = await find_by_embedding(
            session, infospace_id, canon_id, raw_name, entity_type,
            similarity_threshold,
        )
        if match:
            if raw_name not in match.aliases:
                match.aliases.append(raw_name)
                session.add(match)
                session.flush()
            return match

    entity = Entity(
        infospace_id=infospace_id,
        canon_id=canon_id,
        canonical_name=raw_name,
        entity_type=entity_type,
        aliases=[raw_name],
    )
    session.add(entity)
    session.flush()
    logger.info(f"Created new Entity in canon {canon_id}: '{raw_name}' ({entity_type})")
    return entity


async def resolve_entities_batch(
    session: Session,
    infospace_id: int,
    canon_id: int,
    entities: List[Tuple[str, str]],
    use_embeddings: bool = True,
    similarity_threshold: float = 0.85,
) -> Dict[Tuple[str, str], Entity]:
    """Resolve multiple raw entities in a single batch into the target canon.

    Returns a map of ``(raw_name, entity_type) → Entity``. Missing entries
    are created in ``canon_id``. Caller owns the transaction boundary.
    """
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS
    from sqlalchemy import select as sa_select

    result: Dict[Tuple[str, str], Entity] = {}
    if not entities:
        return result

    entity_types = list({et for _, et in entities})
    # Lightweight projection: only columns needed for alias lookup (no embeddings).
    alias_stmt = sa_select(
        Entity.id,
        Entity.canonical_name,
        Entity.entity_type,
        Entity.aliases,
    ).where(
        Entity.canon_id == canon_id,
        Entity.entity_type.in_(entity_types),
    )
    alias_rows = session.execute(alias_stmt).all()

    # In-memory exact alias lookup: (entity_type, normalized_name) -> entity_id
    alias_lookup: Dict[Tuple[str, str], int] = {}
    for row in alias_rows:
        entity_id, canonical_name, row_entity_type, aliases = row
        canon_norm = (canonical_name or "").strip().lower()
        if canon_norm:
            alias_lookup[(row_entity_type, canon_norm)] = entity_id
        for alias in (aliases or []):
            alias_norm = (str(alias)).strip().lower()
            if alias_norm:
                alias_lookup[(row_entity_type, alias_norm)] = entity_id

    raw_names = [e[0] for e in entities]
    raw_embeddings: Optional[List[List[float]]] = None
    if use_embeddings and raw_names:
        try:
            from app.api.modules.embedding.embed import embed_texts
            from app.api.modules.foundation_service_providers import get_selection
            sel = get_selection(session, infospace_id, "embedding")
            if sel and sel.model_name:
                vectors, _em = await embed_texts(session, infospace_id, raw_names)
                if vectors:
                    raw_embeddings = vectors
        except Exception as e:
            logger.warning(f"Batch embedding failed: {e}")

    for raw_name, entity_type in entities:
        norm = (raw_name or "").strip().lower()
        if norm and (entity_type, norm) in alias_lookup:
            matched_id = alias_lookup[(entity_type, norm)]
            result[(raw_name, entity_type)] = session.get(Entity, matched_id)
            continue
        existing = find_by_alias(session, canon_id, raw_name, entity_type)
        if existing:
            result[(raw_name, entity_type)] = existing
            continue
        if raw_embeddings:
            idx = next((i for i, e in enumerate(entities) if e == (raw_name, entity_type)), -1)
            if idx >= 0 and idx < len(raw_embeddings) and raw_embeddings[idx]:
                vec = raw_embeddings[idx]
                dim = len(vec)
                if dim in EMBEDDING_SUPPORTED_DIMS:
                    best_match = _find_by_embedding_sql(
                        session,
                        canon_id=canon_id,
                        entity_type=entity_type,
                        vec=vec,
                        similarity_threshold=similarity_threshold,
                    )
                    if best_match:
                        if raw_name not in best_match.aliases:
                            best_match.aliases.append(raw_name)
                            session.add(best_match)
                        result[(raw_name, entity_type)] = best_match
                        continue
        entity = Entity(
            infospace_id=infospace_id,
            canon_id=canon_id,
            canonical_name=raw_name,
            entity_type=entity_type,
            aliases=[raw_name],
        )
        session.add(entity)
        session.flush()
        result[(raw_name, entity_type)] = entity

    # No commit — caller owns the transaction boundary.
    return result


# ─── CanonResolver — strict-matching for projection-time lookups ──────────


class CanonResolver:
    """Pre-loaded ``(name, entity_type) → Entity.id`` map for synchronous
    lookup inside the projection engine's per-row Python loop.

    Built once per query via :func:`build_canon_resolver`; held by value
    on the projection executor. ``resolve()`` is dictionary-only — no I/O,
    no embedding calls. Names are matched after lower/trim normalisation
    against canonical_name and every alias loaded from the entity table.

    This is the strict-matching gate: a row whose role-bound value
    doesn't resolve to a known canon Entity is dropped from the
    projection (or surfaced as ``<unresolved>`` when the projection opts
    in).

    ``id_to_entity`` is also populated so callers that need the canonical
    name / metadata of a resolved id can read it without a second query.
    """

    __slots__ = ("_lookup", "_entity_by_id")

    def __init__(
        self,
        lookup: Dict[Tuple[str, str], int],
        entity_by_id: Dict[int, "Entity"],
    ) -> None:
        self._lookup = lookup
        self._entity_by_id = entity_by_id

    def resolve(self, name: str, entity_type: str) -> Optional[int]:
        """Return the canon Entity id for ``(name, entity_type)`` or
        ``None`` if unresolved. Match is case-insensitive, trim-tolerant.
        """
        if not name:
            return None
        norm = name.strip().lower()
        if not norm:
            return None
        return self._lookup.get((entity_type, norm))

    def entity(self, entity_id: int) -> Optional["Entity"]:
        """Return the cached Entity for an id, or ``None`` if not loaded."""
        return self._entity_by_id.get(entity_id)

    def known_types(self) -> List[str]:
        """All entity types loaded into this resolver (for diagnostics)."""
        return sorted({et for et, _ in self._lookup.keys()})

    def __len__(self) -> int:
        return len(self._lookup)


def build_canon_resolver(
    session: Session,
    canon_id: int,
    entity_types: Optional[List[str]] = None,
) -> CanonResolver:
    """Pre-load a canon's entities into a synchronous lookup map.

    Scoped to one ``canon_id``. ``entity_types=None`` loads all types in
    the canon; passing a subset (e.g. ``["Behoerde", "Konzern"]``) keeps
    memory tight when the projection only binds a few role types. Aliases
    contribute additional lookup keys, so "die GGL" / "Glücksspielbehörde
    der Länder" / "GGL" all resolve to the same Entity id.

    Run-scoped: rebuild per query. Infospaces have at most ~tens of
    thousands of entities; a single canon's slice is small enough to load
    into memory without paging.
    """
    from sqlalchemy import select as sa_select

    stmt = sa_select(
        Entity.id,
        Entity.canonical_name,
        Entity.entity_type,
        Entity.aliases,
    ).where(Entity.canon_id == canon_id)
    if entity_types:
        stmt = stmt.where(Entity.entity_type.in_(entity_types))

    rows = session.execute(stmt).all()

    lookup: Dict[Tuple[str, str], int] = {}
    for entity_id, canonical_name, entity_type, aliases in rows:
        canon_norm = (canonical_name or "").strip().lower()
        if canon_norm:
            lookup[(entity_type, canon_norm)] = entity_id
        for alias in aliases or []:
            alias_norm = str(alias).strip().lower()
            if alias_norm:
                lookup[(entity_type, alias_norm)] = entity_id

    # Lazy entity-by-id cache: hydrate when callers ask. Avoids loading
    # full Entity rows (with embeddings) up front.
    entity_by_id: Dict[int, Entity] = {}

    return CanonResolver(lookup=lookup, entity_by_id=entity_by_id)
