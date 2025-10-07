"""
Base Handler and Context
========================

Provides the foundation for all content ingestion handlers.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from sqlmodel import Session

from app.models import Asset
from app.api.providers.base import StorageProvider, ScrapingProvider, SearchProvider
from app.api.services.asset_service import AssetService
from app.api.services.bundle_service import BundleService
from app.core.config import AppSettings

logger = logging.getLogger(__name__)


class IngestionError(Exception):
    """Custom exception for ingestion-specific errors."""
    pass


@dataclass
class IngestionContext:
    """
    Contextual information passed to all handlers.
    
    This provides handlers with everything they need to process input
    and create assets without requiring them to manage dependencies.
    """
    session: Session
    storage_provider: StorageProvider
    scraping_provider: ScrapingProvider
    search_provider: Optional[SearchProvider]
    asset_service: AssetService
    bundle_service: BundleService
    user_id: int
    infospace_id: int
    settings: AppSettings
    options: Dict[str, Any] = field(default_factory=dict)
    
    def to_processor_context(self, additional_options: Optional[Dict[str, Any]] = None):
        """
        Convert IngestionContext to ProcessorContext for processor execution.
        
        Args:
            additional_options: Additional options to merge with existing options
            
        Returns:
            ProcessingContext instance
        """
        from app.api.processors.base import ProcessingContext
        
        options = {**self.options}
        if additional_options:
            options.update(additional_options)
        
        return ProcessingContext(
            session=self.session,
            storage_provider=self.storage_provider,
            scraping_provider=self.scraping_provider,
            asset_service=self.asset_service,
            bundle_service=self.bundle_service,
            user_id=self.user_id,
            infospace_id=self.infospace_id,
            options=options
        )


class BaseHandler:
    """
    Abstract base class for all ingestion handlers.
    
    Handlers are responsible for adapting external input (files, URLs, text, etc.)
    into a format suitable for AssetBuilder and processors.
    
    Each handler:
    1. Accepts a specific input type
    2. Performs any necessary preparation (upload, fetch, etc.)
    3. Creates the parent asset via AssetBuilder
    4. Determines if processing is needed
    5. Triggers processors (immediate or background)
    6. Returns created assets
    """
    
    def __init__(self, context: IngestionContext):
        self.context = context
        self.session = context.session
        self.storage_provider = context.storage_provider
        self.scraping_provider = context.scraping_provider
        self.search_provider = context.search_provider
        self.asset_service = context.asset_service
        self.bundle_service = context.bundle_service
        self.user_id = context.user_id
        self.infospace_id = context.infospace_id
        self.settings = context.settings
        self.options = context.options
    
    async def handle(self, locator: Any, title: Optional[str] = None, options: Optional[Dict[str, Any]] = None) -> list[Asset]:
        """
        Handle ingestion of content.
        
        Args:
            locator: The input (file, URL, text, etc.)
            title: Optional custom title
            options: Processing and ingestion options
            
        Returns:
            List of created assets (parent + children if processed immediately)
        """
        raise NotImplementedError("Subclasses must implement handle()")

