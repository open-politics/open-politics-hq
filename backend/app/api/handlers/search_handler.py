"""
Search Handler
==============

Handles search result ingestion.
"""

import logging
from typing import List, Dict, Any, Optional
from sqlmodel import Session

from app.models import Asset
from app.api.services.asset_builder import AssetBuilder
from app.schemas import SearchResult

logger = logging.getLogger(__name__)


class SearchHandler:
    """
    Handle search result ingestion.
    
    Uses AssetBuilder's from_search_result() pattern.
    """
    
    def __init__(self, session: Session):
        self.session = session
    
    async def handle(
        self,
        result: SearchResult,
        query: str,
        infospace_id: int,
        user_id: int,
        rank: int = 0,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Handle single search result ingestion.
        
        Args:
            result: Search result to ingest
            query: Original search query
            infospace_id: Target infospace
            user_id: User performing search
            rank: Result rank/position
            options: Processing options
            
        Returns:
            Created asset
        """
        options = options or {}
        depth = options.get('depth', 0)
        
        asset = await (AssetBuilder(self.session, user_id, infospace_id)
            .from_search_result(result, query)
            .with_metadata(search_rank=rank + 1)
            .with_depth(depth)
            .build())
        
        return asset
    
    async def handle_bulk(
        self,
        results: List[SearchResult],
        query: str,
        infospace_id: int,
        user_id: int,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Handle bulk search result ingestion.
        
        Args:
            results: List of search results
            query: Original search query
            infospace_id: Target infospace
            user_id: User performing search
            options: Processing options
            
        Returns:
            List of created assets
        """
        assets = []
        for i, result in enumerate(results):
            try:
                asset = await self.handle(result, query, infospace_id, user_id, i, options)
                assets.append(asset)
            except Exception as e:
                logger.error(f"Failed to ingest search result '{result.title}': {e}")
                continue
        
        return assets

