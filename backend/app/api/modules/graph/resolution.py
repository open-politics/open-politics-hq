"""
Entity Resolution Utilities

Resolves raw entity mentions to canonical entities using alias matching
and embedding-based similarity. Uses pgvector SQL for all supported dimensions.
"""
import logging
from typing import List, Dict, Any, Optional, Tuple
from sqlmodel import Session
from sqlalchemy import text

from app.api.modules.graph.models import EntityCanonical
from app.api.modules.embedding.services import EmbeddingService

logger = logging.getLogger(__name__)


def find_by_alias(
    session: Session,
    infospace_id: int,
    raw_name: str,
    entity_type: str,
    graph_id: Optional[int] = None,
    exclude_entity_id: Optional[int] = None,
) -> Optional[EntityCanonical]:
    """
    Find canonical entity by exact alias match or substring match.
    Uses SQL-level matching for scalability (no in-memory scan).

    When graph_id is provided, only matches canonicals in that graph.
    When graph_id is None, matches canonicals with graph_id IS NULL (infospace default).
    """
    normalized_name = raw_name.strip().lower()
    if not normalized_name:
        return None

    # 1. Exact match: canonical_name or any alias (SQL)
    graph_clause = "AND graph_id = :gid" if graph_id is not None else "AND graph_id IS NULL"
    exclude_clause = "AND id != :exclude_id" if exclude_entity_id is not None else ""
    params: Dict[str, Any] = {
        "iid": infospace_id,
        "etype": entity_type,
        "name": normalized_name,
    }
    if graph_id is not None:
        params["gid"] = graph_id
    if exclude_entity_id is not None:
        params["exclude_id"] = exclude_entity_id
    exact_sql = text(f"""
        SELECT id FROM entitycanonical
        WHERE infospace_id = :iid AND entity_type = :etype {graph_clause} {exclude_clause}
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
        return session.get(EntityCanonical, row[0])

    # 2. Substring match (LIKE) with minimum length guard; prefer longer matches.
    # Substring matching disabled for names < 6 chars to avoid false merges (e.g. EU -> European Union).
    if len(normalized_name) < 6:
        return None
    substr_sql = text(f"""
        SELECT id FROM entitycanonical
        WHERE infospace_id = :iid AND entity_type = :etype {graph_clause} {exclude_clause}
        AND (
            LOWER(TRIM(canonical_name)) LIKE '%' || :name || '%'
            OR :name LIKE '%' || LOWER(TRIM(canonical_name)) || '%'
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE(aliases::jsonb, '[]'::jsonb)) AS elem
                WHERE LOWER(TRIM(elem::text)) LIKE '%' || :name || '%'
                   OR :name LIKE '%' || LOWER(TRIM(elem::text)) || '%'
            )
        )
        ORDER BY LENGTH(canonical_name) DESC
        LIMIT 1
    """)
    result = session.execute(substr_sql, params).fetchone()
    if result:
        return session.get(EntityCanonical, result[0])
    return None


def _find_by_embedding_sql(
    session: Session,
    infospace_id: int,
    entity_type: str,
    vec: List[float],
    similarity_threshold: float = 0.85,
    graph_id: Optional[int] = None,
) -> Optional[EntityCanonical]:
    """Find canonical entity by pgvector SQL (no embedding generation). Used by resolve_entities_batch."""
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

    dim = len(vec)
    if dim not in EMBEDDING_SUPPORTED_DIMS:
        return None
    col_name = f"embedding_{dim}"
    vec_str = "[" + ",".join(str(x) for x in vec) + "]"
    graph_clause = "AND graph_id = :gid" if graph_id is not None else "AND graph_id IS NULL"
    params: Dict[str, Any] = {
        "iid": infospace_id,
        "etype": entity_type,
        "vec": vec_str,
        "thresh": 1.0 - similarity_threshold,
    }
    if graph_id is not None:
        params["gid"] = graph_id
    sql = text(f"""
        SELECT id, ({col_name} <=> :vec::vector) AS dist
        FROM entitycanonical
        WHERE infospace_id = :iid AND entity_type = :etype
          AND {col_name} IS NOT NULL
        {graph_clause}
        ORDER BY {col_name} <=> :vec::vector
        LIMIT 1
    """)
    row = session.execute(sql, params).fetchone()
    if row and row[1] is not None and row[1] <= (1.0 - similarity_threshold):
        return session.get(EntityCanonical, row[0])
    return None


async def find_by_embedding(
    session: Session,
    infospace_id: int,
    raw_name: str,
    entity_type: str,
    embedding_service: EmbeddingService,
    similarity_threshold: float = 0.85,
    graph_id: Optional[int] = None,
    exclude_entity_id: Optional[int] = None,
) -> Optional[EntityCanonical]:
    """
    Find canonical entity by embedding similarity.
    Uses pgvector SQL for all supported dimensions (384, 512, 768, 1024, 1536).
    """
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

    try:
        from app.api.modules.identity_infospace_user.models import Infospace
        infospace = session.get(Infospace, infospace_id)
        if not infospace or not infospace.embedding_configured:
            logger.debug(f"No embedding configured for infospace {infospace_id}")
            return None

        sel = infospace.get_embedding_selection()

        embedding_result = await embedding_service.generate_embeddings_for_chunks(
            chunks=[raw_name],
            model_name=sel.model_name,
            provider=sel.provider_key,
        )

        if not embedding_result or not embedding_result[0].get('embedding'):
            logger.warning(f"Failed to generate embedding for '{raw_name}'")
            return None

        raw_embedding = embedding_result[0]['embedding']
        dim = len(raw_embedding) if raw_embedding else 0
        if dim not in EMBEDDING_SUPPORTED_DIMS:
            logger.debug(f"Embedding dimension {dim} not supported; skipping")
            return None
    except Exception as e:
        logger.warning(f"Error generating embedding for '{raw_name}': {e}")
        return None

    col_name = f"embedding_{dim}"
    vec_str = "[" + ",".join(str(x) for x in raw_embedding) + "]"
    graph_clause = "AND graph_id = :gid" if graph_id is not None else "AND graph_id IS NULL"
    exclude_clause = "AND id != :exclude_id" if exclude_entity_id is not None else ""
    params: Dict[str, Any] = {
        "iid": infospace_id,
        "etype": entity_type,
        "vec": vec_str,
        "thresh": 1.0 - similarity_threshold,
    }
    if graph_id is not None:
        params["gid"] = graph_id
    if exclude_entity_id is not None:
        params["exclude_id"] = exclude_entity_id

    sql = text(f"""
        SELECT id, ({col_name} <=> :vec::vector) AS dist
        FROM entitycanonical
        WHERE infospace_id = :iid AND entity_type = :etype {graph_clause} {exclude_clause}
          AND {col_name} IS NOT NULL
        ORDER BY {col_name} <=> :vec::vector
        LIMIT 1
    """)
    row = session.execute(sql, params).fetchone()
    if row and row[1] is not None and row[1] <= (1.0 - similarity_threshold):
        return session.get(EntityCanonical, row[0])
    return None


async def resolve_entity(
    session: Session,
    infospace_id: int,
    raw_name: str,
    entity_type: str,
    embedding_service: Optional[EmbeddingService] = None,
    similarity_threshold: float = 0.85
) -> EntityCanonical:
    """
    Resolve a raw entity mention to a canonical entity.

    Strategy:
    1. Check exact alias match (canonical_name or aliases)
    2. If no match and embedding_service provided, check embedding similarity
    3. If still no match, create new canonical entity

    Args:
        session: Database session
        infospace_id: Infospace ID
        raw_name: Raw entity name from triplet
        entity_type: Entity type (PERSON, ORGANIZATION, etc.)
        embedding_service: Optional embedding service for similarity matching
        similarity_threshold: Minimum similarity for embedding match (0-1)

    Returns:
        EntityCanonical instance (existing or newly created)
    """
    # 1. Exact alias match
    existing = find_by_alias(session, infospace_id, raw_name, entity_type)
    if existing:
        logger.debug(f"Alias match: '{raw_name}' -> '{existing.canonical_name}'")
        return existing

    # 2. Embedding similarity (if service provided)
    if embedding_service:
        match = await find_by_embedding(
            session, infospace_id, raw_name, entity_type,
            embedding_service, similarity_threshold
        )
        if match:
            # Add raw_name as alias for future exact matching
            if raw_name not in match.aliases:
                match.aliases.append(raw_name)
                session.add(match)
                session.flush()
            return match

    # 3. Create new canonical
    canonical = EntityCanonical(
        infospace_id=infospace_id,
        canonical_name=raw_name,
        entity_type=entity_type,
        aliases=[raw_name]
    )
    session.add(canonical)
    session.flush()
    logger.info(f"Created new canonical entity: '{raw_name}' ({entity_type})")
    return canonical


async def resolve_entities_batch(
    session: Session,
    infospace_id: int,
    entities: List[Tuple[str, str]],
    embedding_service: Optional[EmbeddingService] = None,
    similarity_threshold: float = 0.85,
    graph_id: Optional[int] = None,
) -> Dict[Tuple[str, str], EntityCanonical]:
    """
    Resolve multiple raw entities in a single batch.

    Args:
        session: Database session
        infospace_id: Infospace ID
        entities: List of (raw_name, entity_type) tuples
        embedding_service: Optional for embedding-based matching
        similarity_threshold: Min similarity for embedding match
        graph_id: Optional KnowledgeGraph ID; when set, resolve into that graph
    """
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS
    from sqlalchemy import select as sa_select

    result: Dict[Tuple[str, str], EntityCanonical] = {}
    if not entities:
        return result

    entity_types = list({et for _, et in entities})
    # Lightweight projection: only load columns needed for alias lookup (no embeddings)
    alias_stmt = sa_select(
        EntityCanonical.id,
        EntityCanonical.canonical_name,
        EntityCanonical.entity_type,
        EntityCanonical.aliases,
    ).where(
        EntityCanonical.infospace_id == infospace_id,
        EntityCanonical.entity_type.in_(entity_types),
    )
    if graph_id is not None:
        alias_stmt = alias_stmt.where(EntityCanonical.graph_id == graph_id)
    else:
        alias_stmt = alias_stmt.where(EntityCanonical.graph_id.is_(None))
    alias_rows = session.execute(alias_stmt).all()

    # In-memory exact alias lookup: (entity_type, normalized_name) -> entity_id
    # Eliminates ~70% of find_by_alias SQL calls; avoids loading embedding columns.
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
    if embedding_service and raw_names:
        try:
            from app.api.modules.identity_infospace_user.models import Infospace
            infospace = session.get(Infospace, infospace_id)
            if infospace and infospace.embedding_configured:
                sel = infospace.get_embedding_selection()
                emb_result = await embedding_service.generate_embeddings_for_chunks(
                    chunks=raw_names,
                    model_name=sel.model_name,
                    provider=sel.provider_key,
                )
                if emb_result:
                    raw_embeddings = [r.get("embedding", []) for r in emb_result if r.get("embedding")]
        except Exception as e:
            logger.warning(f"Batch embedding failed: {e}")

    for raw_name, entity_type in entities:
        norm = (raw_name or "").strip().lower()
        if norm and (entity_type, norm) in alias_lookup:
            matched_id = alias_lookup[(entity_type, norm)]
            result[(raw_name, entity_type)] = session.get(EntityCanonical, matched_id)
            continue
        # Fall back to SQL for substring match (find_by_alias)
        existing = find_by_alias(session, infospace_id, raw_name, entity_type, graph_id)
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
                        infospace_id=infospace_id,
                        entity_type=entity_type,
                        vec=vec,
                        similarity_threshold=similarity_threshold,
                        graph_id=graph_id,
                    )
                    if best_match:
                        if raw_name not in best_match.aliases:
                            best_match.aliases.append(raw_name)
                            session.add(best_match)
                        result[(raw_name, entity_type)] = best_match
                        continue
        canonical = EntityCanonical(
            infospace_id=infospace_id,
            graph_id=graph_id,
            canonical_name=raw_name,
            entity_type=entity_type,
            aliases=[raw_name],
        )
        session.add(canonical)
        session.flush()
        result[(raw_name, entity_type)] = canonical

    session.commit()
    return result
