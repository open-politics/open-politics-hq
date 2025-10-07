"""
Content Handlers
================

Handlers are lightweight adapters that transform different input types
into AssetBuilder calls. They handle the "ingestion" layer.

Architecture:
- Each handler knows how to prepare one input type
- All handlers use AssetBuilder for actual asset creation
- Handlers are composable and testable in isolation

Available Handlers:
- FileHandler: Uploaded files
- WebHandler: URLs and web scraping
- SearchHandler: Search results
- RSSHandler: RSS feeds
- TextHandler: Direct text content
"""

from .base import BaseHandler, IngestionContext, IngestionError
from .file_handler import FileHandler
from .web_handler import WebHandler
from .search_handler import SearchHandler
from .rss_handler import RSSHandler
from .text_handler import TextHandler

__all__ = [
    "BaseHandler",
    "IngestionContext",
    "IngestionError",
    "FileHandler",
    "WebHandler",
    "SearchHandler",
    "RSSHandler",
    "TextHandler",
]

