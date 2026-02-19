"""
Content Handlers
================

Handlers are lightweight adapters that transform different input types
into AssetBuilder calls. They handle the "ingestion" layer.

Architecture:
- Each handler knows how to prepare one input type
- All handlers use AssetBuilder for actual asset creation
- Handlers are composable and testable in isolation
- All handlers inherit BaseHandler and accept IngestionContext

Available Handlers:
- FileHandler: Uploaded files
- WebHandler: URLs and web scraping (handle, handle_bulk)
- SearchHandler: Search results
- RSSHandler: RSS feeds (handle, preview_rss_feed, discover_rss_feeds_from_awesome_repo,
  ingest_from_awesome_repo)
- TextHandler: Direct text content
- ArchiveHandler: ZIP/TAR extraction and directory mirroring
- DirectoryImportHandler: Local directory import
"""

from .base import BaseHandler, IngestionContext, IngestionError
from .resolve import resolve_handler, ResolvedHandler
from .file_handler import FileHandler
from .web_handler import WebHandler
from .search_handler import SearchHandler
from .rss_handler import RSSHandler
from .text_handler import TextHandler
from .archive_handler import ArchiveHandler
from .directory_import_handler import DirectoryImportHandler

__all__ = [
    "BaseHandler",
    "resolve_handler",
    "ResolvedHandler",
    "IngestionContext",
    "IngestionError",
    "FileHandler",
    "WebHandler",
    "SearchHandler",
    "RSSHandler",
    "TextHandler",
    "ArchiveHandler",
    "DirectoryImportHandler",
]

