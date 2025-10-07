"""
Web Handler
===========

Handles URL scraping and web content ingestion.
"""

import logging
from typing import Optional, Dict, Any, List
from sqlmodel import Session

from app.models import Asset, AssetKind
from app.api.services.asset_builder import AssetBuilder

logger = logging.getLogger(__name__)


class WebHandler:
    """
    Handle web URL ingestion.
    
    Responsibilities:
    - Route URL to AssetBuilder
    - Use existing from_url() pattern
    """
    
    def __init__(self, session: Session):
        self.session = session
    
    async def handle(
        self,
        url: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Handle URL ingestion.
        
        Args:
            url: URL to scrape
            infospace_id: Target infospace
            user_id: User ingesting the URL
            title: Optional custom title
            options: Scraping options
            
        Returns:
            Created asset
        """
        options = options or {}
        scrape_immediately = options.get('scrape_immediately', True)
        
        # Use AssetBuilder's from_url pattern
        if scrape_immediately:
            asset = await (AssetBuilder(self.session, user_id, infospace_id)
                .from_url(url, title)
                .build())
        else:
            asset = await (AssetBuilder(self.session, user_id, infospace_id)
                .from_url_stub(url, title)
                .build())
        
        return asset
    
    async def handle_bulk(
        self,
        urls: List[str],
        infospace_id: int,
        user_id: int,
        base_title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Handle bulk URL ingestion.
        
        Args:
            urls: List of URLs to scrape
            infospace_id: Target infospace
            user_id: User ingesting URLs
            base_title: Base title for assets
            options: Scraping options
            
        Returns:
            List of created assets
        """
        assets = []
        for i, url in enumerate(urls):
            try:
                url_title = f"{base_title} #{i+1}" if base_title else None
                asset = await self.handle(url, infospace_id, user_id, url_title, options)
                assets.append(asset)
            except Exception as e:
                logger.error(f"Failed to ingest URL {url}: {e}")
                continue
        
        return assets


