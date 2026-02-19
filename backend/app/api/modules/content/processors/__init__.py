"""
Content Processors
==================

Processors transform assets into structured data and child assets.
Each processor is responsible for one content type.

Architecture:
- BaseProcessor: Abstract interface
- Concrete processors: CSVProcessor, PDFProcessor, etc.
- ContentTypeRegistry (content/types): Maps asset kinds/extensions to processors
- ProcessingStrategy: Decides immediate vs background processing
"""

from .base import BaseProcessor, ProcessingContext, ProcessingError
from .csv_processor import CSVProcessor
from .excel_processor import ExcelProcessor
from .pdf_processor import PDFProcessor
from .web_processor import WebProcessor
from .strategy import ProcessingStrategy, should_process_immediately, get_strategy
from app.api.modules.content.types import (
    ContentTypeRegistry,
    get_content_type_registry,
    detect_asset_kind_from_extension,
    needs_processing,
    is_rss_feed_url,
    is_archive_url,
    FILE_EXTENSION_MAP,
    PROCESSABLE_KINDS,
    DEFAULT_MAX_ROWS,
    DEFAULT_MAX_PAGES,
    DEFAULT_MAX_IMAGES,
    DEFAULT_TIMEOUT,
)

# Backward compat: ProcessorRegistry and get_registry point to content type registry
ProcessorRegistry = ContentTypeRegistry
get_registry = get_content_type_registry


def get_processor(asset, context):
    """Get instantiated processor for an asset."""
    return get_content_type_registry().get_processor(asset, context)

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
    "is_archive_url",
    "FILE_EXTENSION_MAP",
    "PROCESSABLE_KINDS",
    "DEFAULT_MAX_ROWS",
    "DEFAULT_MAX_PAGES",
    "DEFAULT_MAX_IMAGES",
    "DEFAULT_TIMEOUT",
]
