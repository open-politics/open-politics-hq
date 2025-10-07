"""
Content Processors
==================

Processors transform assets into structured data and child assets.
Each processor is responsible for one content type.

Architecture:
- BaseProcessor: Abstract interface
- Concrete processors: CSVProcessor, PDFProcessor, etc.
- ProcessorRegistry: Maps asset kinds/extensions to processors
- ProcessingStrategy: Decides immediate vs background processing

Centralized Configuration:
- detect_asset_kind_from_extension(): File extension → AssetKind
- needs_processing(): Check if kind needs processing
- FILE_EXTENSION_MAP, PROCESSABLE_KINDS: Content type rules
"""

from .base import BaseProcessor, ProcessingContext, ProcessingError
from .csv_processor import CSVProcessor
from .excel_processor import ExcelProcessor
from .pdf_processor import PDFProcessor
from .web_processor import WebProcessor
from .registry import (
    ProcessorRegistry, 
    get_processor, 
    get_registry,
    detect_asset_kind_from_extension,
    needs_processing,
    is_rss_feed_url,
    FILE_EXTENSION_MAP,
    PROCESSABLE_KINDS,
    DEFAULT_MAX_ROWS,
    DEFAULT_MAX_PAGES,
    DEFAULT_MAX_IMAGES,
    DEFAULT_TIMEOUT,
)
from .strategy import ProcessingStrategy, should_process_immediately, get_strategy

__all__ = [
    # Base classes
    "BaseProcessor",
    "ProcessingContext",
    "ProcessingError",
    
    # Concrete processors
    "CSVProcessor",
    "ExcelProcessor",
    "PDFProcessor",
    "WebProcessor",
    
    # Registry
    "ProcessorRegistry",
    "get_processor",
    "get_registry",
    
    # Strategy
    "ProcessingStrategy",
    "should_process_immediately",
    "get_strategy",
    
    # Centralized configuration (canonical source of truth)
    "detect_asset_kind_from_extension",
    "needs_processing",
    "is_rss_feed_url",
    "FILE_EXTENSION_MAP",
    "PROCESSABLE_KINDS",
    "DEFAULT_MAX_ROWS",
    "DEFAULT_MAX_PAGES",
    "DEFAULT_MAX_IMAGES",
    "DEFAULT_TIMEOUT",
]

