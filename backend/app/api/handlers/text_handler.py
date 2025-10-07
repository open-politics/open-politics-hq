"""
Text Handler
============

Handles direct text content ingestion.
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Session

from app.models import Asset
from app.api.services.asset_builder import AssetBuilder

logger = logging.getLogger(__name__)


class TextHandler:
    """
    Handle direct text content ingestion.
    
    Uses AssetBuilder's from_text() pattern.
    """
    
    def __init__(self, session: Session):
        self.session = session
    
    async def handle(
        self,
        text: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        event_timestamp: Optional[datetime] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Handle text content ingestion.
        
        Args:
            text: Text content
            infospace_id: Target infospace
            user_id: User creating the text
            title: Optional custom title
            event_timestamp: Optional event timestamp
            options: Processing options
            
        Returns:
            Created asset
        """
        options = options or {}
        
        builder = (AssetBuilder(self.session, user_id, infospace_id)
            .from_text(text, title))
        
        if event_timestamp:
            builder.with_timestamp(event_timestamp)
        
        if options.get('metadata'):
            builder.with_metadata(**options['metadata'])
        
        asset = await builder.build()
        
        return asset

