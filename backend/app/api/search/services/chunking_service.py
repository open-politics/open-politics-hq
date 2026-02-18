import logging
import re
from typing import List, Dict, Any, Optional, Tuple
from sqlmodel import Session, select
from app.models import Asset, AssetChunk, AssetKind
import hashlib

logger = logging.getLogger(__name__)

class ChunkingStrategy:
    """Base class for different chunking strategies."""
    
    def chunk(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Chunk text into smaller pieces.
        
        Returns:
            List of chunks with metadata
        """
        raise NotImplementedError

class TokenChunkingStrategy(ChunkingStrategy):
    """Chunking strategy based on approximate token count."""
    
    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
    
    def chunk(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Chunk text by approximate token count."""
        if not text or not text.strip():
            return []
        
        # Simple approximation: 1 token ≈ 4 characters
        chars_per_chunk = self.chunk_size * 4
        chars_overlap = self.chunk_overlap * 4
        
        chunks = []
        start = 0
        chunk_index = 0
        
        while start < len(text):
            end = start + chars_per_chunk
            
            # Try to find a good breaking point (sentence, paragraph, etc.)
            if end < len(text):
                # Look for sentence endings within last 200 chars
                search_start = max(start + chars_per_chunk - 200, start)
                search_text = text[search_start:end + 200]
                
                # Find sentence boundaries
                sentence_endings = [m.end() for m in re.finditer(r'[.!?]\s+', search_text)]
                if sentence_endings:
                    # Use the last sentence ending
                    end = search_start + sentence_endings[-1]
                else:
                    # Look for paragraph breaks
                    para_breaks = [m.start() for m in re.finditer(r'\n\s*\n', search_text)]
                    if para_breaks:
                        end = search_start + para_breaks[-1]
                    else:
                        # Look for word boundaries
                        words = re.finditer(r'\s+', text[end-100:end+100])
                        word_positions = [m.start() + end - 100 for m in words]
                        if word_positions:
                            end = word_positions[len(word_positions)//2]
            
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunk_metadata = {
                    "chunk_index": chunk_index,
                    "start_char": start,
                    "end_char": end,
                    "char_count": len(chunk_text),
                    "estimated_tokens": len(chunk_text) // 4,
                    "chunking_strategy": "token"
                }
                
                if metadata:
                    chunk_metadata.update(metadata)
                
                chunks.append({
                    "text_content": chunk_text,
                    "metadata": chunk_metadata
                })
                chunk_index += 1
            
            # Move start position with overlap
            start = max(end - chars_overlap, start + 1)
            if start >= end:  # Prevent infinite loop
                break
        
        return chunks

class ChunkingService:
    """Service for managing text chunking operations."""
    
    def __init__(self, session: Session):
        self.session = session
        
        # Available chunking strategies
        self.strategies = {
            "token": TokenChunkingStrategy,
        }
    
    def get_chunking_strategy(self, strategy_name: str, **kwargs) -> ChunkingStrategy:
        """Get a chunking strategy instance."""
        if strategy_name not in self.strategies:
            raise ValueError(f"Unknown chunking strategy: {strategy_name}")
        
        return self.strategies[strategy_name](**kwargs)
    
    def chunk_asset(
        self,
        asset: Asset,
        strategy: str = "token",
        chunk_size: int = 512,
        chunk_overlap: int = 50,
        overwrite_existing: bool = False,
        **strategy_kwargs
    ) -> List[AssetChunk]:
        """
        Chunk a single asset into AssetChunk records.
        
        Args:
            asset: Asset to chunk
            strategy: Chunking strategy ("token")
            chunk_size: Size of chunks (strategy-dependent)
            chunk_overlap: Overlap between chunks (strategy-dependent)
            overwrite_existing: Whether to overwrite existing chunks
            **strategy_kwargs: Additional strategy-specific arguments
        
        Returns:
            List of created AssetChunk objects
        """
        if not asset.text_content:
            logger.warning(f"Asset {asset.id} has no text content to chunk")
            return []
        
        # Check if chunks already exist
        existing_chunks = self.session.exec(
            select(AssetChunk).where(AssetChunk.asset_id == asset.id)
        ).all()
        
        if existing_chunks and not overwrite_existing:
            logger.info(f"Asset {asset.id} already has {len(existing_chunks)} chunks")
            return existing_chunks
        
        if existing_chunks and overwrite_existing:
            # Delete existing chunks
            for chunk in existing_chunks:
                self.session.delete(chunk)
            self.session.commit()
            logger.info(f"Deleted {len(existing_chunks)} existing chunks for asset {asset.id}")
        
        # Get chunking strategy
        strategy_params = {"chunk_size": chunk_size, "chunk_overlap": chunk_overlap}
        strategy_params.update(strategy_kwargs)
        chunking_strategy = self.get_chunking_strategy(strategy, **strategy_params)
        
        # Prepare metadata
        base_metadata = {
            "asset_id": asset.id,
            "asset_title": asset.title,
            "asset_kind": asset.kind.value if asset.kind else None,
            "strategy_params": strategy_params
        }
        
        # Chunk the text
        chunk_data = chunking_strategy.chunk(asset.text_content, base_metadata)
        
        if not chunk_data:
            logger.warning(f"No chunks generated for asset {asset.id}")
            return []
        
        # Verify asset exists in database before creating chunks
        # This handles race conditions where chunking runs before asset is committed
        try:
            db_asset = self.session.get(Asset, asset.id)
            if not db_asset:
                logger.warning(f"Asset {asset.id} not found in database during chunking, skipping")
                return []
        except Exception as e:
            logger.warning(f"Error verifying asset {asset.id} in database: {e}, skipping chunking")
            return []

        # Create AssetChunk records
        asset_chunks = []
        for chunk_info in chunk_data:
            chunk = AssetChunk(
                asset_id=asset.id,
                chunk_index=chunk_info["metadata"]["chunk_index"],
                text_content=chunk_info["text_content"],
                chunk_metadata=chunk_info["metadata"]
            )
            asset_chunks.append(chunk)
            self.session.add(chunk)

        self.session.commit()
        logger.info(f"Created {len(asset_chunks)} chunks for asset {asset.id}")
        
        return asset_chunks
    
    def chunk_assets_by_filter(
        self,
        asset_ids: Optional[List[int]] = None,
        asset_kinds: Optional[List[AssetKind]] = None,
        infospace_id: Optional[int] = None,
        strategy: str = "token",
        chunk_size: int = 512,
        chunk_overlap: int = 50,
        overwrite_existing: bool = False,
        **strategy_kwargs
    ) -> Dict[int, List[AssetChunk]]:
        """
        Chunk multiple assets based on filters.
        
        Returns:
            Dictionary mapping asset_id to list of chunks
        """
        # Build query
        query = select(Asset)
        
        if asset_ids:
            query = query.where(Asset.id.in_(asset_ids))
        
        if asset_kinds:
            query = query.where(Asset.kind.in_(asset_kinds))
        
        if infospace_id:
            query = query.where(Asset.infospace_id == infospace_id)
        
        # Only chunk assets with text content
        query = query.where(Asset.text_content.isnot(None))
        
        assets = self.session.exec(query).all()
        
        if not assets:
            logger.warning("No assets found matching the criteria")
            return {}
        
        logger.info(f"Chunking {len(assets)} assets")
        
        # Chunk each asset
        results = {}
        for asset in assets:
            try:
                chunks = self.chunk_asset(
                    asset=asset,
                    strategy=strategy,
                    chunk_size=chunk_size,
                    chunk_overlap=chunk_overlap,
                    overwrite_existing=overwrite_existing,
                    **strategy_kwargs
                )
                results[asset.id] = chunks
            except Exception as e:
                logger.error(f"Error chunking asset {asset.id}: {e}")
                results[asset.id] = []
        
        return results
    
    def get_chunk_statistics(self, asset_id: Optional[int] = None, infospace_id: Optional[int] = None) -> Dict[str, Any]:
        """Get statistics about chunks."""
        query = select(AssetChunk)
        
        if asset_id:
            query = query.where(AssetChunk.asset_id == asset_id)
        elif infospace_id:
            query = query.join(Asset).where(Asset.infospace_id == infospace_id)
        
        chunks = self.session.exec(query).all()
        
        if not chunks:
            return {"total_chunks": 0}
        
        total_chunks = len(chunks)
        total_chars = sum(len(chunk.text_content or "") for chunk in chunks)
        
        # Strategy breakdown
        strategies = {}
        for chunk in chunks:
            if chunk.chunk_metadata:
                strategy = chunk.chunk_metadata.get("chunking_strategy", "unknown")
                strategies[strategy] = strategies.get(strategy, 0) + 1
        
        # Assets with chunks
        asset_ids = set(chunk.asset_id for chunk in chunks)
        
        return {
            "total_chunks": total_chunks,
            "total_characters": total_chars,
            "average_chunk_size": total_chars / total_chunks if total_chunks > 0 else 0,
            "assets_with_chunks": len(asset_ids),
            "strategies_used": strategies
        }
    
    def remove_chunks_for_asset(self, asset_id: int) -> int:
        """Remove all chunks for an asset."""
        chunks = self.session.exec(
            select(AssetChunk).where(AssetChunk.asset_id == asset_id)
        ).all()
        
        count = len(chunks)
        for chunk in chunks:
            self.session.delete(chunk)
        
        self.session.commit()
        logger.info(f"Removed {count} chunks for asset {asset_id}")
        
        return count 