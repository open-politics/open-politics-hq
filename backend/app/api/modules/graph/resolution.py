"""
Entity Resolution Utilities

Resolves raw entity mentions to canonical entities using alias matching
and embedding-based similarity.
"""
import logging
from typing import List, Dict, Any, Optional, Tuple
from sqlmodel import Session, select
from sqlalchemy import func
import numpy as np

from app.api.graph.models import EntityCanonical
from app.api.embedding.services import EmbeddingService

logger = logging.getLogger(__name__)


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    if not vec1 or not vec2:
        return 0.0
    
    v1 = np.array(vec1)
    v2 = np.array(vec2)
    
    dot_product = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    
    if norm1 == 0 or norm2 == 0:
        return 0.0
    
    return float(dot_product / (norm1 * norm2))


def find_by_alias(
    session: Session,
    infospace_id: int,
    raw_name: str,
    entity_type: str
) -> Optional[EntityCanonical]:
    """
    Find canonical entity by exact alias match or substring match.
    
    Strategy:
    1. Exact match on canonical_name or aliases
    2. Substring match: if raw_name is a substring of canonical_name or vice versa
       (case-insensitive, normalized)
    
    Checks both canonical_name and aliases list.
    """
    normalized_name = raw_name.strip().lower()
    
    # Get all canonicals of this type
    all_canonicals = session.exec(
        select(EntityCanonical).where(
            EntityCanonical.infospace_id == infospace_id,
            EntityCanonical.entity_type == entity_type
        )
    ).all()
    
    # 1. Exact match on canonical name
    for canonical in all_canonicals:
        if canonical.canonical_name.strip().lower() == normalized_name:
            return canonical
    
    # 2. Exact match on aliases
    for canonical in all_canonicals:
        if canonical.aliases:
            normalized_aliases = [alias.strip().lower() for alias in canonical.aliases]
            if normalized_name in normalized_aliases:
                return canonical
    
    # 3. Substring matching: check if raw_name is substring of canonical_name or vice versa
    # Prefer longer matches (more specific)
    best_match = None
    best_match_length = 0
    
    for canonical in all_canonicals:
        canonical_normalized = canonical.canonical_name.strip().lower()
        
        # Check if raw_name is substring of canonical_name
        if normalized_name in canonical_normalized:
            if len(canonical_normalized) > best_match_length:
                best_match = canonical
                best_match_length = len(canonical_normalized)
        
        # Check if canonical_name is substring of raw_name
        elif canonical_normalized in normalized_name:
            if len(normalized_name) > best_match_length:
                best_match = canonical
                best_match_length = len(normalized_name)
        
        # Check aliases for substring matches
        if canonical.aliases:
            for alias in canonical.aliases:
                alias_normalized = alias.strip().lower()
                
                if normalized_name in alias_normalized:
                    if len(alias_normalized) > best_match_length:
                        best_match = canonical
                        best_match_length = len(alias_normalized)
                
                elif alias_normalized in normalized_name:
                    if len(normalized_name) > best_match_length:
                        best_match = canonical
                        best_match_length = len(normalized_name)
    
    # Only return substring match if it's substantial (at least 3 characters overlap)
    if best_match and best_match_length >= 3:
        logger.debug(
            f"Substring match: '{raw_name}' -> '{best_match.canonical_name}' "
            f"(matched length: {best_match_length})"
        )
        return best_match
    
    return None


async def find_by_embedding(
    session: Session,
    infospace_id: int,
    raw_name: str,
    entity_type: str,
    embedding_service: EmbeddingService,
    similarity_threshold: float = 0.85
) -> Optional[EntityCanonical]:
    """
    Find canonical entity by embedding similarity.
    
    Generates embedding for raw_name and compares against existing
    canonical entities with embeddings.
    """
    # Generate embedding for raw name
    try:
        # Get infospace to determine embedding model
        from app.api.identity.models import Infospace
        infospace = session.get(Infospace, infospace_id)
        if not infospace or not infospace.embedding_model:
            logger.debug(f"No embedding model configured for infospace {infospace_id}")
            return None
        
        # Generate embedding
        embedding_result = await embedding_service.generate_embeddings_for_chunks(
            chunks=[raw_name],
            model_name=infospace.embedding_model,
            provider=None  # Auto-detect from model
        )
        
        if not embedding_result or not embedding_result[0].get('embedding'):
            logger.warning(f"Failed to generate embedding for '{raw_name}'")
            return None
        
        raw_embedding = embedding_result[0]['embedding']
        
    except Exception as e:
        logger.warning(f"Error generating embedding for '{raw_name}': {e}")
        return None
    
    # Find all canonicals of same type with embeddings
    stmt = select(EntityCanonical).where(
        EntityCanonical.infospace_id == infospace_id,
        EntityCanonical.entity_type == entity_type,
        EntityCanonical.embedding.isnot(None)
    )
    candidates = session.exec(stmt).all()
    
    best_match = None
    best_similarity = 0.0
    
    for candidate in candidates:
        if not candidate.embedding:
            continue
        
        similarity = cosine_similarity(raw_embedding, candidate.embedding)
        if similarity > best_similarity:
            best_similarity = similarity
            best_match = candidate
    
    if best_match and best_similarity >= similarity_threshold:
        logger.debug(
            f"Found embedding match: '{raw_name}' -> '{best_match.canonical_name}' "
            f"(similarity: {best_similarity:.3f})"
        )
        return best_match
    
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
    similarity_threshold: float = 0.85
) -> Dict[Tuple[str, str], EntityCanonical]:
    """
    Resolve multiple raw entities in a single batch. Uses one embedding query and
    one alias query, then matches in-memory for scale.

    Args:
        session: Database session
        infospace_id: Infospace ID
        entities: List of (raw_name, entity_type) tuples
        embedding_service: Optional for embedding-based matching
        similarity_threshold: Min similarity for embedding match

    Returns:
        Dict mapping (raw_name, entity_type) -> EntityCanonical
    """
    result: Dict[Tuple[str, str], EntityCanonical] = {}
    if not entities:
        return result

    entity_types = list({et for _, et in entities})
    all_canonicals = session.exec(
        select(EntityCanonical).where(
            EntityCanonical.infospace_id == infospace_id,
            EntityCanonical.entity_type.in_(entity_types)
        )
    ).all()
    canonicals_by_type: Dict[str, List[EntityCanonical]] = {}
    for c in all_canonicals:
        canonicals_by_type.setdefault(c.entity_type, []).append(c)

    raw_names = [e[0] for e in entities]
    raw_embeddings: Optional[List[List[float]]] = None
    if embedding_service and raw_names:
        try:
            from app.api.identity.models import Infospace
            infospace = session.get(Infospace, infospace_id)
            if infospace and infospace.embedding_model:
                emb_result = await embedding_service.generate_embeddings_for_chunks(
                    chunks=raw_names,
                    model_name=infospace.embedding_model,
                    provider=None
                )
                if emb_result:
                    raw_embeddings = [r.get("embedding", []) for r in emb_result if r.get("embedding")]
        except Exception as e:
            logger.warning(f"Batch embedding failed: {e}")

    for raw_name, entity_type in entities:
        existing = find_by_alias(session, infospace_id, raw_name, entity_type)
        if existing:
            result[(raw_name, entity_type)] = existing
            continue
        if raw_embeddings:
            idx = next((i for i, e in enumerate(entities) if e == (raw_name, entity_type)), -1)
            if idx >= 0 and idx < len(raw_embeddings) and raw_embeddings[idx]:
                vec = raw_embeddings[idx]
                candidates = canonicals_by_type.get(entity_type, [])
                best_match, best_sim = None, 0.0
                for c in candidates:
                    if not c.embedding:
                        continue
                    sim = cosine_similarity(vec, c.embedding)
                    if sim > best_sim:
                        best_sim, best_match = sim, c
                if best_match and best_sim >= similarity_threshold:
                    if raw_name not in best_match.aliases:
                        best_match.aliases.append(raw_name)
                        session.add(best_match)
                    result[(raw_name, entity_type)] = best_match
                    continue
        canonical = EntityCanonical(
            infospace_id=infospace_id,
            canonical_name=raw_name,
            entity_type=entity_type,
            aliases=[raw_name]
        )
        session.add(canonical)
        session.flush()
        result[(raw_name, entity_type)] = canonical

    session.commit()
    return result
