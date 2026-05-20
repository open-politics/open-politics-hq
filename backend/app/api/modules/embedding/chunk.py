"""
Flat chunking primitives.

Pure text-slicing with DB persistence. No provider resolution here — chunking
is deterministic and offline. Provider work lives in `embed.py` and `similarity.py`.

Callers take (session, ...) explicitly and own the transaction boundary.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.models import Asset, AssetChunk, AssetKind

logger = logging.getLogger(__name__)


def _chunk_text_token(
    text: str,
    *,
    chunk_size: int = 512,
    chunk_overlap: int = 50,
    metadata: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Slice text by approximate token count, honoring sentence/paragraph boundaries."""
    if not text or not text.strip():
        return []

    chars_per_chunk = chunk_size * 4
    chars_overlap = chunk_overlap * 4

    chunks: List[Dict[str, Any]] = []
    start = 0
    chunk_index = 0

    while start < len(text):
        end = start + chars_per_chunk

        if end < len(text):
            search_start = max(start + chars_per_chunk - 200, start)
            search_text = text[search_start : end + 200]
            sentence_endings = [m.end() for m in re.finditer(r"[.!?]\s+", search_text)]
            if sentence_endings:
                end = search_start + sentence_endings[-1]
            else:
                para_breaks = [m.start() for m in re.finditer(r"\n\s*\n", search_text)]
                if para_breaks:
                    end = search_start + para_breaks[-1]
                else:
                    words = re.finditer(r"\s+", text[end - 100 : end + 100])
                    word_positions = [m.start() + end - 100 for m in words]
                    if word_positions:
                        end = word_positions[len(word_positions) // 2]

        chunk_text_str = text[start:end].strip()
        if chunk_text_str:
            chunk_metadata: Dict[str, Any] = {
                "chunk_index": chunk_index,
                "start_char": start,
                "end_char": end,
                "char_count": len(chunk_text_str),
                "estimated_tokens": len(chunk_text_str) // 4,
                "chunking_strategy": "token",
            }
            if metadata:
                chunk_metadata.update(metadata)
            chunks.append(
                {"text_content": chunk_text_str, "metadata": chunk_metadata}
            )
            chunk_index += 1

        start = max(end - chars_overlap, start + 1)
        if start >= end:
            break

    return chunks


_STRATEGIES = {
    "token": _chunk_text_token,
}


def chunk_text(
    text: str,
    *,
    strategy: str = "token",
    chunk_size: int = 512,
    chunk_overlap: int = 50,
    metadata: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Chunk raw text into dicts. Strategy-agnostic entrypoint."""
    fn = _STRATEGIES.get(strategy)
    if fn is None:
        raise ValueError(f"Unknown chunking strategy: {strategy}")
    return fn(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap, metadata=metadata)


def chunk_asset(
    session: Session,
    asset: Asset,
    *,
    strategy: str = "token",
    chunk_size: int = 512,
    chunk_overlap: int = 50,
    overwrite_existing: bool = False,
) -> List[AssetChunk]:
    """Create AssetChunk rows for an asset. Commits.

    Skip-if-exists unless `overwrite_existing=True`.
    """
    if not asset.text_content:
        logger.warning("Asset %s has no text content to chunk", asset.id)
        return []

    existing = session.exec(
        select(AssetChunk).where(AssetChunk.asset_id == asset.id)
    ).all()

    if existing and not overwrite_existing:
        logger.info("Asset %s already has %d chunks", asset.id, len(existing))
        return list(existing)

    if existing and overwrite_existing:
        for chunk in existing:
            session.delete(chunk)
        session.commit()
        logger.info("Deleted %d existing chunks for asset %s", len(existing), asset.id)

    strategy_params = {"chunk_size": chunk_size, "chunk_overlap": chunk_overlap}
    base_metadata = {
        "asset_id": asset.id,
        "asset_title": asset.title,
        "asset_kind": asset.kind.value if asset.kind else None,
        "strategy_params": strategy_params,
    }

    pieces = chunk_text(
        asset.text_content,
        strategy=strategy,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        metadata=base_metadata,
    )

    if not pieces:
        logger.warning("No chunks generated for asset %s", asset.id)
        return []

    # Race-guard: chunking can fire before the asset row is committed.
    if session.get(Asset, asset.id) is None:
        logger.warning("Asset %s not in DB during chunking, skipping", asset.id)
        return []

    rows: List[AssetChunk] = []
    for info in pieces:
        chunk = AssetChunk(
            asset_id=asset.id,
            chunk_index=info["metadata"]["chunk_index"],
            text_content=info["text_content"],
            chunk_metadata=info["metadata"],
        )
        session.add(chunk)
        rows.append(chunk)

    session.commit()
    logger.info("Created %d chunks for asset %s", len(rows), asset.id)
    return rows


def chunk_assets_by_filter(
    session: Session,
    *,
    asset_ids: Optional[List[int]] = None,
    asset_kinds: Optional[List[AssetKind]] = None,
    infospace_id: Optional[int] = None,
    strategy: str = "token",
    chunk_size: int = 512,
    chunk_overlap: int = 50,
    overwrite_existing: bool = False,
) -> Dict[int, List[AssetChunk]]:
    """Chunk many assets by filter. Returns {asset_id: [chunks]}."""
    query = select(Asset).where(Asset.text_content.isnot(None))
    if asset_ids:
        query = query.where(Asset.id.in_(asset_ids))
    if asset_kinds:
        query = query.where(Asset.kind.in_(asset_kinds))
    if infospace_id:
        query = query.where(Asset.infospace_id == infospace_id)

    assets = session.exec(query).all()
    if not assets:
        logger.warning("No assets found matching the criteria")
        return {}

    logger.info("Chunking %d assets", len(assets))

    results: Dict[int, List[AssetChunk]] = {}
    for asset in assets:
        try:
            rows = chunk_asset(
                session,
                asset,
                strategy=strategy,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                overwrite_existing=overwrite_existing,
            )
            results[asset.id] = rows
        except Exception as e:
            logger.error("Error chunking asset %s: %s", asset.id, e)
            results[asset.id] = []
    return results


def chunk_stats(
    session: Session,
    *,
    asset_id: Optional[int] = None,
    infospace_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Return counts + strategy breakdown for chunks in a scope."""
    query = select(AssetChunk)
    if asset_id:
        query = query.where(AssetChunk.asset_id == asset_id)
    elif infospace_id:
        query = query.join(Asset).where(Asset.infospace_id == infospace_id)

    chunks = session.exec(query).all()
    if not chunks:
        return {"total_chunks": 0}

    total_chunks = len(chunks)
    total_chars = sum(len(c.text_content or "") for c in chunks)

    strategies: Dict[str, int] = {}
    for c in chunks:
        if c.chunk_metadata:
            s = c.chunk_metadata.get("chunking_strategy", "unknown")
            strategies[s] = strategies.get(s, 0) + 1

    asset_ids_set = {c.asset_id for c in chunks}

    return {
        "total_chunks": total_chunks,
        "total_characters": total_chars,
        "average_chunk_size": total_chars / total_chunks if total_chunks > 0 else 0,
        "assets_with_chunks": len(asset_ids_set),
        "strategies_used": strategies,
    }


def remove_chunks(session: Session, asset_id: int) -> int:
    """Delete all chunks for an asset. Commits."""
    chunks = session.exec(
        select(AssetChunk).where(AssetChunk.asset_id == asset_id)
    ).all()
    count = len(chunks)
    for chunk in chunks:
        session.delete(chunk)
    session.commit()
    logger.info("Removed %d chunks for asset %d", count, asset_id)
    return count
