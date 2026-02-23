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

# Lazy imports from content.types to avoid circular dependency:
#   types._register_builtin -> processors.csv -> processors/__init__ -> types


def get_registry():
    """Return the content type registry (lazy import to break cycle)."""
    from app.api.modules.content.types import get_content_type_registry
    return get_content_type_registry()


def get_processor(asset, context):
    """Get instantiated processor for an asset."""
    return get_registry().get_processor(asset, context)


def __getattr__(name):
    """Lazy load types exports when accessed."""
    from app.api.modules.content import types
    exports = (
        "ContentTypeRegistry",
        "get_content_type_registry",
        "detect_asset_kind_from_extension",
        "needs_processing",
        "is_rss_feed_url",
        "is_archive_url",
        "DEFAULT_MAX_ROWS",
        "DEFAULT_MAX_PAGES",
        "DEFAULT_MAX_IMAGES",
        "DEFAULT_TIMEOUT",
    )
    if name in exports:
        return getattr(types, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

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
    "ContentTypeRegistry",
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
    "DEFAULT_MAX_ROWS",
    "DEFAULT_MAX_PAGES",
    "DEFAULT_MAX_IMAGES",
    "DEFAULT_TIMEOUT",
]
