"""
Processor Registry
==================

Central registry for mapping content types to processors.
Uses convention over configuration for easy extension.

This module also contains centralized content type configuration:
- Extension to AssetKind mapping
- Which kinds need processing
- Default processing limits
"""

import os
import logging
from typing import Type, Optional, Dict
from app.models import Asset, AssetKind
from .base import BaseProcessor, ProcessingContext

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# CENTRALIZED CONTENT TYPE CONFIGURATION
# ═══════════════════════════════════════════════════════════════

# File extension to AssetKind mapping (canonical source of truth)
FILE_EXTENSION_MAP = {
    # Documents
    '.pdf': AssetKind.PDF,
    '.txt': AssetKind.TEXT,
    '.md': AssetKind.TEXT,
    '.doc': AssetKind.FILE,
    '.docx': AssetKind.FILE,
    
    # Data files
    '.csv': AssetKind.CSV,
    '.xlsx': AssetKind.CSV,  # Excel treated as CSV kind
    '.xls': AssetKind.CSV,   # Old Excel treated as CSV kind
    '.json': AssetKind.FILE,
    
    # Images
    '.jpg': AssetKind.IMAGE,
    '.jpeg': AssetKind.IMAGE,
    '.png': AssetKind.IMAGE,
    '.gif': AssetKind.IMAGE,
    '.webp': AssetKind.IMAGE,
    '.bmp': AssetKind.IMAGE,
    '.svg': AssetKind.IMAGE,
    
    # Media
    '.mp4': AssetKind.VIDEO,
    '.avi': AssetKind.VIDEO,
    '.mov': AssetKind.VIDEO,
    '.webm': AssetKind.VIDEO,
    '.mp3': AssetKind.AUDIO,
    '.wav': AssetKind.AUDIO,
    '.ogg': AssetKind.AUDIO,
    
    # Email
    '.mbox': AssetKind.MBOX,
    '.eml': AssetKind.EMAIL,
    
    # Archives
    '.zip': AssetKind.FILE,
    '.tar': AssetKind.FILE,
    '.gz': AssetKind.FILE,
}

# AssetKinds that require content processing (have processors)
PROCESSABLE_KINDS = {
    AssetKind.CSV,      # CSVProcessor or ExcelProcessor
    AssetKind.PDF,      # PDFProcessor
    AssetKind.WEB,      # WebProcessor
    AssetKind.MBOX,     # MBOXProcessor (if implemented)
}

# Default processing limits
DEFAULT_MAX_ROWS = 50000      # CSV/Excel rows
DEFAULT_MAX_PAGES = 1000      # PDF pages
DEFAULT_MAX_IMAGES = 8        # Images per web page
DEFAULT_TIMEOUT = 30          # Scraping timeout in seconds


def detect_asset_kind_from_extension(file_ext: str) -> AssetKind:
    """
    Detect AssetKind from file extension.
    
    This is the canonical source of truth for extension mapping.
    All other modules should use this function.
    
    Args:
        file_ext: File extension (with or without leading dot)
        
    Returns:
        Corresponding AssetKind or AssetKind.FILE if unknown
    """
    if not file_ext:
        return AssetKind.FILE
    
    # Normalize extension
    ext = file_ext.lower()
    if not ext.startswith('.'):
        ext = f'.{ext}'
    
    return FILE_EXTENSION_MAP.get(ext, AssetKind.FILE)


def needs_processing(kind: AssetKind) -> bool:
    """
    Check if an AssetKind requires content processing.
    
    Args:
        kind: AssetKind to check
        
    Returns:
        True if this kind has a processor and needs processing
    """
    return kind in PROCESSABLE_KINDS


def is_rss_feed_url(url: str) -> bool:
    """
    Detect if a URL is an RSS/Atom feed.
    
    This is a lightweight detection based on URL patterns.
    For the new architecture, handlers should use this for routing decisions.
    
    Args:
        url: URL to check
        
    Returns:
        True if URL matches common RSS feed patterns
    """
    if not url:
        return False
    
    # Common RSS feed patterns
    rss_patterns = [
        '/rss', '/feed', '/atom', '.rss', '.xml',
        'rss.', 'feed.', 'feeds/', '/feed.xml', '/rss.xml'
    ]
    
    url_lower = url.lower()
    return any(pattern in url_lower for pattern in rss_patterns)


class ProcessorRegistry:
    """
    Registry for content processors.
    
    Maps asset kinds and file extensions to processor classes.
    Allows easy extension by adding new processors.
    """
    
    def __init__(self):
        self._kind_processors: Dict[AssetKind, Type[BaseProcessor]] = {}
        self._extension_processors: Dict[str, Type[BaseProcessor]] = {}
    
    def register_by_kind(self, kind: AssetKind, processor_class: Type[BaseProcessor]):
        """Register a processor for an asset kind."""
        self._kind_processors[kind] = processor_class
        logger.debug(f"Registered {processor_class.__name__} for kind {kind}")
    
    def register_by_extension(self, extension: str, processor_class: Type[BaseProcessor]):
        """Register a processor for a file extension."""
        ext = extension.lower() if not extension.startswith('.') else extension.lower()
        if not ext.startswith('.'):
            ext = f'.{ext}'
        self._extension_processors[ext] = processor_class
        logger.debug(f"Registered {processor_class.__name__} for extension {ext}")
    
    def get_processor_class(self, asset: Asset) -> Optional[Type[BaseProcessor]]:
        """
        Get the processor class for an asset.
        
        Priority:
        1. File extension (if asset has blob_path)
        2. Asset kind
        
        Args:
            asset: Asset to get processor for
            
        Returns:
            Processor class or None if no processor found
        """
        # Try extension first (more specific)
        if asset.blob_path:
            ext = os.path.splitext(asset.blob_path)[1].lower()
            if ext in self._extension_processors:
                return self._extension_processors[ext]
        
        # Fall back to asset kind
        return self._kind_processors.get(asset.kind)
    
    def get_processor(self, asset: Asset, context: ProcessingContext) -> Optional[BaseProcessor]:
        """
        Get an instantiated processor for an asset.
        
        Args:
            asset: Asset to process
            context: Processing context with dependencies
            
        Returns:
            Instantiated processor or None
        """
        processor_class = self.get_processor_class(asset)
        if processor_class:
            return processor_class(context)
        return None
    
    def list_processors(self) -> Dict[str, str]:
        """List all registered processors for debugging."""
        result = {
            "by_kind": {str(k): v.__name__ for k, v in self._kind_processors.items()},
            "by_extension": {k: v.__name__ for k, v in self._extension_processors.items()}
        }
        return result


# Global registry instance
_registry = ProcessorRegistry()


def get_registry() -> ProcessorRegistry:
    """Get the global processor registry."""
    return _registry


def get_processor(asset: Asset, context: ProcessingContext) -> Optional[BaseProcessor]:
    """
    Convenience function to get processor from global registry.
    
    Args:
        asset: Asset to process
        context: Processing context
        
    Returns:
        Instantiated processor or None
    """
    return _registry.get_processor(asset, context)


def register_processors():
    """
    Register all built-in processors.
    
    Called on module import to set up default processors.
    """
    # Import here to avoid circular dependencies
    from .csv_processor import CSVProcessor
    from .excel_processor import ExcelProcessor
    from .pdf_processor import PDFProcessor
    from .web_processor import WebProcessor
    
    # Register by kind
    _registry.register_by_kind(AssetKind.CSV, CSVProcessor)
    _registry.register_by_kind(AssetKind.PDF, PDFProcessor)
    _registry.register_by_kind(AssetKind.WEB, WebProcessor)
    
    # Register by extension (overrides for special cases)
    _registry.register_by_extension('.xlsx', ExcelProcessor)
    _registry.register_by_extension('.xls', ExcelProcessor)
    
    logger.info("Registered all built-in processors")


# Auto-register on import
register_processors()

