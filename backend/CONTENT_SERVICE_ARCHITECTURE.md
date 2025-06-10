# Content Service Architecture

## Overview

The Content Service architecture provides a **clean, comprehensive, and elegantly designed** solution for all content ingestion and processing needs. This replaces the previous scattered and poorly named services with a single, well-designed interface.

## Key Improvements

### ✅ What We Fixed

1. **Eliminated Complex Service Chains**: No more confusing bouncing between `IngestionService` → `StreamlinedIngestionService` → `AssetService` → various task files
2. **Clean Naming**: Replaced confusing names like "StreamlinedIngestionService" with the descriptive "ContentService"
3. **Unified Processing**: All content types (files, URLs, text) go through the same clean pipeline
4. **Integrated Tasks**: Background processing is cleanly integrated rather than scattered across multiple task files
5. **Consistent API**: Every ingestion method follows the same pattern and conventions

### 🗑️ Files Replaced/Removed

This new architecture **replaces** all of the following scattered files:
- ❌ `ingestion_service.py` (legacy, complex)
- ❌ `streamlined_ingestion.py` (poorly named, temporary)
- ❌ `asset_processing.py` (scattered processing logic)
- ❌ `processing_core.py` (disconnected helper functions)
- ❌ `streamlined_tasks.py` (duplicate task functionality)

### ✅ New Clean Architecture

```
services/
  content_service.py        # 🎯 Single comprehensive service
  asset_service.py          # Basic CRUD only
  
tasks/
  content_tasks.py          # 🎯 Clean background processing
  
# Keep for legacy compatibility (can be deprecated later):
  ingest.py                 # Source-based legacy tasks
  ingest_recurringly.py     # Scheduled tasks
```

## ContentService API

### Core Ingestion Methods

```python
class ContentService:
    # File ingestion
    async def ingest_file(
        file: UploadFile, 
        infospace_id: int, 
        user_id: int,
        title: Optional[str] = None,
        process_immediately: bool = True,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset
    
    # URL ingestion  
    async def ingest_url(
        url: str,
        infospace_id: int,
        user_id: int, 
        title: Optional[str] = None,
        scrape_immediately: bool = True,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset
    
    # Text ingestion
    def ingest_text(
        text_content: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        event_timestamp: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Asset
    
    # Bulk operations
    async def ingest_bulk_urls(
        urls: List[str],
        infospace_id: int,
        user_id: int,
        base_title: Optional[str] = None,
        scrape_immediately: bool = True,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]
```

### Processing Methods

```python
    # Process content (CSV→rows, PDF→pages, Web→images)
    async def process_content(
        asset: Asset,
        options: Optional[Dict[str, Any]] = None
    ) -> None
    
    # Reprocess with new options
    async def reprocess_content(
        asset: Asset, 
        options: Optional[Dict[str, Any]] = None
    ) -> None
```

## Content Processing Pipeline

### 1. File Upload → Asset Creation → Processing

```
User uploads file.csv
     ↓
ContentService.ingest_file()
     ↓
- Detect content type (.csv → AssetKind.CSV)
- Upload to storage  
- Create Asset record
- Optionally process immediately
     ↓
ContentService._process_csv()
     ↓  
- Auto-detect delimiter
- Parse headers and rows
- Create child CSV_ROW assets
- Update parent with metadata
```

### 2. URL Scraping → Article + Images

```
User submits URL
     ↓
ContentService.ingest_url()
     ↓
- Create Asset(kind=WEB)
- Optionally scrape immediately
     ↓
ContentService._process_web_content()
     ↓
- Scrape article content
- Extract featured image  
- Extract content images
- Create child IMAGE assets
- Update parent with article text
```

### 3. Text Content → Ready Asset

```
User submits text
     ↓ 
ContentService.ingest_text()
     ↓
- Create Asset(kind=TEXT) 
- Set status=READY
- No processing needed
```

## Background Tasks

### Clean Task Architecture

```python
# content_tasks.py

@celery.task(name="process_content")
def process_content(asset_id: int, options: Dict[str, Any] = None)
    # Process any content type

@celery.task(name="reprocess_content") 
def reprocess_content(asset_id: int, options: Dict[str, Any] = None)
    # Reprocess with new options

@celery.task(name="ingest_bulk_urls")
def ingest_bulk_urls(urls: List[str], infospace_id: int, user_id: int, ...)
    # Handle large URL batches in background

@celery.task(name="retry_failed_content_processing")
def retry_failed_content_processing(infospace_id: int, max_retries: int = 3)
    # Automatically retry failed processing

@celery.task(name="clean_orphaned_child_assets") 
def clean_orphaned_child_assets(infospace_id: int)
    # Cleanup maintenance
```

## Route Examples

### Clean, Consistent Routes

```python
# File upload
POST /api/v1/infospaces/{id}/assets/upload
    - file: UploadFile
    - title?: string
    - process_immediately?: bool = true

# URL ingestion  
POST /api/v1/infospaces/{id}/assets/ingest-url
    - url: string
    - title?: string
    - scrape_immediately?: bool = true

# Text ingestion
POST /api/v1/infospaces/{id}/assets/ingest-text  
    - text_content: string
    - title?: string
    - event_timestamp?: datetime

# Bulk URLs (background for >100 URLs)
POST /api/v1/infospaces/{id}/assets/bulk-ingest-urls
    - urls: string[]
    - base_title?: string
    - scrape_immediately?: bool = true

# Reprocess with options
POST /api/v1/infospaces/{id}/assets/{asset_id}/reprocess
    - delimiter?: string
    - encoding?: string = "utf-8"
    - skip_rows?: int = 0
    - timeout?: int = 30
```

## Processing Options

### CSV Processing Options

```python
{
    "delimiter": ";",           # Auto-detected if not provided
    "encoding": "utf-8",        # Default utf-8, fallback to latin1/cp1252
    "skip_rows": 2,             # Skip N rows before header
    "max_rows": 10000          # Limit for large files
}
```

### PDF Processing Options

```python  
{
    "max_pages": 500           # Limit for large PDFs
}
```

### Web Scraping Options

```python
{
    "timeout": 30,             # Request timeout
    "max_images": 8           # Limit content images extracted
}
```

## Asset Relationships

### Hierarchical Asset Structure

```
CSV Asset (parent)
├── CSV Row 1 (child, part_index=0)
├── CSV Row 2 (child, part_index=1)  
└── CSV Row N (child, part_index=N-1)

PDF Asset (parent)
├── Page 1 (child, part_index=0)
├── Page 2 (child, part_index=1)
└── Page N (child, part_index=N-1)

Web Asset (parent)
├── Featured Image (child, part_index=0, role="featured")
├── Content Image 1 (child, part_index=1, role="content")
└── Content Image N (child, part_index=N, role="content")
```

## Error Handling

### Graceful Failure Management

1. **Processing Failures**: Assets marked as `ProcessingStatus.FAILED` with error details
2. **Partial Success**: In bulk operations, successful items are preserved
3. **Retry Mechanism**: Automatic retry for transient failures
4. **Validation**: Input validation with clear error messages
5. **Rollback**: Database transactions ensure consistency

## Migration from Old Services

### For Existing Code

1. **Replace StreamlinedIngestionService** → `ContentService`
2. **Update task names**: 
   - `process_asset_children` → `process_content`
   - `reprocess_asset` → `reprocess_content`  
   - `scrape_asset_url` → `process_content` (same task handles all types)
3. **Update dependency injection**: `ContentServiceDep` instead of `StreamlinedIngestionServiceDep`

### Files Safe to Remove

After verifying the new system works:
- ❌ `backend/app/api/services/ingestion_service.py`
- ❌ `backend/app/api/services/streamlined_ingestion.py`  
- ❌ `backend/app/api/tasks/asset_processing.py`
- ❌ `backend/app/api/tasks/processing_core.py`
- ❌ `backend/app/api/tasks/streamlined_tasks.py`

## Benefits of New Architecture

### 🎯 Developer Experience
- **Single service** for all content needs
- **Consistent API** across all content types
- **Clear naming** - no more "streamlined" confusion
- **Integrated processing** - no scattered task files

### 🚀 Performance  
- **Efficient processing** with asyncio
- **Memory management** for large files
- **Background tasks** for heavy operations
- **Smart batching** for bulk operations

### 🛡️ Reliability
- **Comprehensive error handling**
- **Automatic retry mechanisms** 
- **Transaction safety**
- **Graceful degradation**

### 🔧 Maintainability
- **Single source of truth** for content processing
- **Easy to extend** for new content types
- **Clean separation** of concerns
- **Comprehensive testing** surface

This architecture provides a **production-ready, scalable, and maintainable** foundation for all content ingestion needs while eliminating the complexity and confusion of the previous scattered approach. 