"""
Canon Entry Resolution Utilities

Resolves raw entity mentions to ``CanonEntry`` rows within a specific ``Canon``
using alias matching and embedding-based similarity. Uses pgvector SQL for
all supported dimensions.

Resolution always scopes to a single canon (``canon_id`` is required). The
caller is responsible for resolving graph→canon upstream — see
``tasks/curation.py:_resolve_target_canon``. Cross-canon entry reuse is
forbidden by design: the same ``(name, type)`` curated into two different
canons produces two different CanonEntry rows.

Embedding is produced via ``modules/embedding/embed.embed_texts``; callers
enable embedding similarity by passing ``use_embeddings=True``. Credentials
follow the infospace owner.
"""
import logging
from typing import List, Dict, Any, Optional, Tuple

from sqlmodel import Session
from sqlalchemy import text

from app.api.modules.graph.models import CanonEntry

logger = logging.getLogger(__name__)


def norm_type(entity_type: Optional[str]) -> str:
    """Normalize an entity type for use as a *matching* key.

    ``CanonEntry.type`` is the resolution key, so its casing decides identity.
    Extraction cannot guarantee casing — the model picks it, and a multi-type
    field offers several spellings — so ``Person`` and ``person`` used to
    resolve to two separate populations for the same entity. Worse than a
    duplicate: because the type gates every lookup, no later alias or embedding
    match could ever reunite them.

    The stored value keeps its original casing (display), exactly like
    ``canonical`` does for names; only comparisons normalize. Every lookup that
    filters on type must go through this — SQL predicates pair it with
    ``LOWER(TRIM(type))``, in-memory dicts key on it.
    """
    return (entity_type or "").strip().lower()


def find_by_alias(
    session: Session,
    canon_id: int,
    raw_name: str,
    entity_type: str,
    exclude_entry_id: Optional[int] = None,
) -> Optional[CanonEntry]:
    """Find a CanonEntry in a canon by exact ``canonical`` or alias match.

    Uses SQL-level matching for scalability (no in-memory scan).

    Both halves of the key are compared case- and whitespace-insensitively.
    The type used to be compared raw while the name was normalized, so
    ``Person`` / ``person`` resolved to two different populations for the same
    human — and because the type is the matching key, that split was permanent:
    no later alias or embedding match could reunite them. Extraction has no way
    to guarantee casing (the model picks it, and multi-type fields offer several
    spellings), so normalizing here is the only place that can hold the
    invariant.
    """
    normalized_name = raw_name.strip().lower()
    if not normalized_name:
        return None

    exclude_clause = "AND id != :exclude_id" if exclude_entry_id is not None else ""
    params: Dict[str, Any] = {
        "cid": canon_id,
        "etype": norm_type(entity_type),
        "name": normalized_name,
    }
    if exclude_entry_id is not None:
        params["exclude_id"] = exclude_entry_id
    exact_sql = text(f"""
        SELECT id FROM canon_entry
        WHERE canon_id = :cid AND LOWER(TRIM(type)) = :etype {exclude_clause}
        AND (
            LOWER(TRIM(canonical)) = :name
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE(aliases::jsonb, '[]'::jsonb)) AS elem
                WHERE LOWER(TRIM(elem::text)) = :name
            )
        )
        LIMIT 1
    """)
    row = session.execute(exact_sql, params).fetchone()
    if row:
        return session.get(CanonEntry, row[0])

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
) -> Optional[CanonEntry]:
    """Find a CanonEntry by pgvector SQL (no embedding generation). Used by resolve_entities_batch."""
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

    dim = len(vec)
    if dim not in EMBEDDING_SUPPORTED_DIMS:
        return None
    col_name = f"embedding_{dim}"
    vec_str = "[" + ",".join(str(x) for x in vec) + "]"
    params: Dict[str, Any] = {
        "cid": canon_id,
        "etype": norm_type(entity_type),
        "vec": vec_str,
        "thresh": 1.0 - similarity_threshold,
    }
    sql = text(f"""
        SELECT id, ({col_name} <=> CAST(:vec AS vector)) AS dist
        FROM canon_entry
        WHERE canon_id = :cid AND LOWER(TRIM(type)) = :etype
          AND {col_name} IS NOT NULL
        ORDER BY {col_name} <=> CAST(:vec AS vector)
        LIMIT 1
    """)
    row = session.execute(sql, params).fetchone()
    if row and row[1] is not None and row[1] <= (1.0 - similarity_threshold):
        return session.get(CanonEntry, row[0])
    return None


def find_similar_entries_sql(
    session: Session,
    canon_id: int,
    entity_type: str,
    vec: List[float],
    limit: int = 5,
    similarity_threshold: float = 0.75,
) -> List[int]:
    """Top-N canon entry ids most embedding-similar to ``vec``, same type/canon.

    For *suggestions* on a staged proposal — these are shown to a human, never
    auto-applied — so the threshold is looser than the auto-merge gate. Returns
    ``[]`` for unsupported dims (caller degrades to "create new?").
    """
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

    dim = len(vec)
    if dim not in EMBEDDING_SUPPORTED_DIMS:
        return []
    col_name = f"embedding_{dim}"
    vec_str = "[" + ",".join(str(x) for x in vec) + "]"
    sql = text(f"""
        SELECT id FROM canon_entry
        WHERE canon_id = :cid AND LOWER(TRIM(type)) = :etype
          AND {col_name} IS NOT NULL
          AND ({col_name} <=> CAST(:vec AS vector)) <= :dist
        ORDER BY {col_name} <=> CAST(:vec AS vector)
        LIMIT :lim
    """)
    rows = session.execute(sql, {
        "cid": canon_id, "etype": norm_type(entity_type), "vec": vec_str,
        "dist": 1.0 - similarity_threshold, "lim": limit,
    }).fetchall()
    return [r[0] for r in rows]


async def find_by_embedding(
    session: Session,
    infospace_id: int,
    canon_id: int,
    raw_name: str,
    entity_type: str,
    similarity_threshold: float = 0.85,
    exclude_entry_id: Optional[int] = None,
) -> Optional[CanonEntry]:
    """Find a CanonEntry in a canon by embedding similarity.

    Uses pgvector SQL for all supported dimensions (384, 512, 768, 1024, 1536).
    ``infospace_id`` is required for embedding provider selection (separate
    from the canon scoping which uses ``canon_id``).
    """
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS
    from app.api.modules.embedding.embed import embed_texts
    from app.api.modules.foundation_service_providers import get_configured_foundation_provider

    try:
        sel = get_configured_foundation_provider(session, infospace_id, "embedding")
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
    exclude_clause = "AND id != :exclude_id" if exclude_entry_id is not None else ""
    params: Dict[str, Any] = {
        "cid": canon_id,
        "etype": norm_type(entity_type),
        "vec": vec_str,
        "thresh": 1.0 - similarity_threshold,
    }
    if exclude_entry_id is not None:
        params["exclude_id"] = exclude_entry_id

    sql = text(f"""
        SELECT id, ({col_name} <=> CAST(:vec AS vector)) AS dist
        FROM canon_entry
        WHERE canon_id = :cid AND LOWER(TRIM(type)) = :etype {exclude_clause}
          AND {col_name} IS NOT NULL
        ORDER BY {col_name} <=> CAST(:vec AS vector)
        LIMIT 1
    """)
    row = session.execute(sql, params).fetchone()
    if row and row[1] is not None and row[1] <= (1.0 - similarity_threshold):
        return session.get(CanonEntry, row[0])
    return None


async def resolve_entity(
    session: Session,
    infospace_id: int,
    canon_id: int,
    raw_name: str,
    entity_type: str,
    use_embeddings: bool = True,
    similarity_threshold: float = 0.85,
) -> CanonEntry:
    """Resolve a raw entity mention to a CanonEntry row in the target canon.

    Strategy:
    1. Exact alias match within ``canon_id`` (``canonical`` or aliases).
    2. If no match and ``use_embeddings``, embedding similarity within canon.
    3. If still no match, create a new CanonEntry in the canon.
    """
    existing = find_by_alias(session, canon_id, raw_name, entity_type)
    if existing:
        logger.debug(f"Alias match: '{raw_name}' -> '{existing.canonical}'")
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

    entry = CanonEntry(
        infospace_id=infospace_id,
        canon_id=canon_id,
        canonical=raw_name,
        type=entity_type,
        aliases=[raw_name],
    )
    session.add(entry)
    session.flush()
    logger.info(f"Created new CanonEntry in canon {canon_id}: '{raw_name}' ({entity_type})")
    return entry


async def resolve_entities_batch(
    session: Session,
    infospace_id: int,
    canon_id: int,
    entities: List[Tuple[str, str]],
    use_embeddings: bool = True,
    similarity_threshold: float = 0.85,
    settled_only: bool = False,
) -> Dict[Tuple[str, str], CanonEntry]:
    """Resolve multiple raw entities in a single batch into the target canon.

    Returns a map of ``(raw_name, entity_type) → CanonEntry``. Missing entries
    are created in ``canon_id``. Caller owns the transaction boundary.

    ``settled_only=True`` ("resolve into canon" mode): match by exact/alias only —
    no embedding similarity (which would auto-merge), no create. An unmatched pair
    is simply absent from the result map, and the caller stages it as a proposal.
    """
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS
    from sqlalchemy import select as sa_select

    result: Dict[Tuple[str, str], CanonEntry] = {}
    if not entities:
        return result

    from sqlalchemy import func as sa_func

    entity_types = list({norm_type(et) for _, et in entities})
    # Lightweight projection: only columns needed for alias lookup (no embeddings).
    # Candidate load and lookup key both normalize the type — a raw ``IN`` here
    # would load only the exact-cased rows and then miss them anyway.
    alias_stmt = sa_select(
        CanonEntry.id,
        CanonEntry.canonical,
        CanonEntry.type,
        CanonEntry.aliases,
    ).where(
        CanonEntry.canon_id == canon_id,
        sa_func.lower(sa_func.trim(CanonEntry.type)).in_(entity_types),
    )
    alias_rows = session.execute(alias_stmt).all()

    # In-memory exact alias lookup: (norm_type, normalized_name) -> entry_id
    alias_lookup: Dict[Tuple[str, str], int] = {}
    for row in alias_rows:
        entry_id, canonical, row_entity_type, aliases = row
        row_type = norm_type(row_entity_type)
        canon_norm = (canonical or "").strip().lower()
        if canon_norm:
            alias_lookup[(row_type, canon_norm)] = entry_id
        for alias in (aliases or []):
            alias_norm = (str(alias)).strip().lower()
            if alias_norm:
                alias_lookup[(row_type, alias_norm)] = entry_id

    raw_names = [e[0] for e in entities]
    raw_embeddings: Optional[List[List[float]]] = None
    if use_embeddings and raw_names and not settled_only:
        try:
            from app.api.modules.embedding.embed import embed_texts
            from app.api.modules.foundation_service_providers import get_configured_foundation_provider
            sel = get_configured_foundation_provider(session, infospace_id, "embedding")
            if sel and sel.model_name:
                vectors, _em = await embed_texts(session, infospace_id, raw_names)
                if vectors:
                    raw_embeddings = vectors
        except Exception as e:
            logger.warning(f"Batch embedding failed: {e}")

    for raw_name, entity_type in entities:
        norm = (raw_name or "").strip().lower()
        key = (norm_type(entity_type), norm)
        if norm and key in alias_lookup:
            matched_id = alias_lookup[key]
            result[(raw_name, entity_type)] = session.get(CanonEntry, matched_id)
            continue
        existing = find_by_alias(session, canon_id, raw_name, entity_type)
        if existing:
            result[(raw_name, entity_type)] = existing
            continue
        if settled_only:
            # No exact/alias match → leave it out; the caller stages a proposal.
            # Never embedding-merge (that's a suggestion) and never auto-create.
            continue
        # Resolve this mention's vector once (from the batch embed above) — used
        # both for fuzzy match and for embed-on-create below.
        vec: Optional[List[float]] = None
        dim = 0
        if raw_embeddings:
            idx = next((i for i, e in enumerate(entities) if e == (raw_name, entity_type)), -1)
            if 0 <= idx < len(raw_embeddings) and raw_embeddings[idx]:
                vec = raw_embeddings[idx]
                dim = len(vec)
        embeddable = vec is not None and dim in EMBEDDING_SUPPORTED_DIMS

        if embeddable:
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

        entry = CanonEntry(
            infospace_id=infospace_id,
            canon_id=canon_id,
            canonical=raw_name,
            type=entity_type,
            aliases=[raw_name],
        )
        # Embed-on-create: persist the vector we already computed, so fuzzy
        # resolution + suggestions work against this entry next time — zero extra cost.
        if embeddable:
            setattr(entry, f"embedding_{dim}", vec)
        session.add(entry)
        session.flush()
        result[(raw_name, entity_type)] = entry

    # No commit — caller owns the transaction boundary.
    return result


# ─── CanonResolver — strict-matching for projection-time lookups ──────────


class CanonResolver:
    """Pre-loaded ``(name, entity_type) → CanonEntry.id`` map for synchronous
    lookup inside the projection engine's per-row Python loop.

    Built once per query via :func:`build_canon_resolver`; held by value
    on the projection executor. ``resolve()`` is dictionary-only — no I/O,
    no embedding calls. Names are matched after lower/trim normalisation
    against ``canonical`` and every alias loaded from the canon_entry table.

    This is the strict-matching gate: a row whose role-bound value
    doesn't resolve to a known CanonEntry is dropped from the
    projection (or surfaced as ``<unresolved>`` when the projection opts
    in).

    ``id_to_entry`` is also populated so callers that need the canonical
    name / metadata of a resolved id can read it without a second query.
    """

    __slots__ = ("_lookup", "_entry_by_id")

    def __init__(
        self,
        lookup: Dict[Tuple[str, str], int],
        entry_by_id: Dict[int, "CanonEntry"],
    ) -> None:
        self._lookup = lookup
        self._entry_by_id = entry_by_id

    def resolve(self, name: str, entity_type: str) -> Optional[int]:
        """Return the CanonEntry id for ``(name, entity_type)`` or
        ``None`` if unresolved. Both halves match case-insensitively,
        trim-tolerant — see :func:`norm_type`.
        """
        if not name:
            return None
        norm = name.strip().lower()
        if not norm:
            return None
        return self._lookup.get((norm_type(entity_type), norm))

    def entry(self, entry_id: int) -> Optional["CanonEntry"]:
        """Return the cached CanonEntry for an id, or ``None`` if not loaded."""
        return self._entry_by_id.get(entry_id)

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
    """Pre-load a canon's entries into a synchronous lookup map.

    Scoped to one ``canon_id``. ``entity_types=None`` loads all types in
    the canon; passing a subset (e.g. ``["Behoerde", "Konzern"]``) keeps
    memory tight when the projection only binds a few role types. Aliases
    contribute additional lookup keys, so "die GGL" / "Glücksspielbehörde
    der Länder" / "GGL" all resolve to the same CanonEntry id.

    Run-scoped: rebuild per query. Infospaces have at most ~tens of
    thousands of entries; a single canon's slice is small enough to load
    into memory without paging.
    """
    from sqlalchemy import func as sa_func, select as sa_select

    stmt = sa_select(
        CanonEntry.id,
        CanonEntry.canonical,
        CanonEntry.type,
        CanonEntry.aliases,
    ).where(CanonEntry.canon_id == canon_id)
    if entity_types:
        stmt = stmt.where(
            sa_func.lower(sa_func.trim(CanonEntry.type)).in_(
                [norm_type(t) for t in entity_types]
            )
        )

    rows = session.execute(stmt).all()

    lookup: Dict[Tuple[str, str], int] = {}
    for entry_id, canonical, entity_type, aliases in rows:
        row_type = norm_type(entity_type)
        canon_norm = (canonical or "").strip().lower()
        if canon_norm:
            lookup[(row_type, canon_norm)] = entry_id
        for alias in aliases or []:
            alias_norm = str(alias).strip().lower()
            if alias_norm:
                lookup[(row_type, alias_norm)] = entry_id

    # Lazy entry-by-id cache: hydrate when callers ask. Avoids loading
    # full CanonEntry rows (with embeddings) up front.
    entry_by_id: Dict[int, CanonEntry] = {}

    return CanonResolver(lookup=lookup, entry_by_id=entry_by_id)
