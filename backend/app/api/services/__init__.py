"""
Services package.

This package contains the services that encapsulate the application's business logic.
Services abstract implementation details from the API layer and provide a clean interface
for performing business operations.

🎯 **Unified Content Discovery Architecture**
============================================

Core Services:
- ContentIngestionService: Unified content ingestion engine (Locator → Discovery → Retrieval → Assets)
- SourceService: Source model management with unified discovery integration

The ContentIngestionService provides a single interface for all content patterns:
- Search queries → scraped assets
- RSS feeds → article assets  
- Direct file URLs → document assets
- URL lists → batch scraped assets
- Site discovery → crawled assets

Legacy Support:
- All existing Source-based workflows are preserved
- SourceService bridges legacy and modern patterns
- Existing tasks and providers are fully reused

Note: DO NOT import service factories from this module to avoid circular dependencies.
Instead, import factories directly from app.api.deps.
"""

# This file is intentionally minimal to avoid circular dependencies.
# All service factories should be imported from app.api.deps module.