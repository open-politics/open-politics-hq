# Handlers

Handlers are lightweight adapters that transform different input types into AssetBuilder calls.

## Purpose

Handlers sit between routes and AssetBuilder, handling:
- Input validation
- Format detection
- Dependency coordination
- Processing strategy decisions

## Available Handlers

- **FileHandler**: Uploaded files → AssetBuilder
- **WebHandler**: URLs → AssetBuilder  
- **SearchHandler**: Search results → AssetBuilder
- **RSSHandler**: RSS feeds → AssetBuilder
- **TextHandler**: Direct text → AssetBuilder

## How They Work

```
Route receives input
      ↓
Handler adapts input
      ↓
AssetBuilder creates asset
      ↓
Processor transforms content (if needed)
      ↓
Result returned to route
```

## Usage Examples

### File Upload

```python
from app.api.handlers import FileHandler

handler = FileHandler(session, storage_provider, scraping_provider)

asset = await handler.handle(
    file=uploaded_file,
    infospace_id=1,
    user_id=1,
    title="My Document",
    options={'process_immediately': True}
)
```

### Web Scraping

```python
from app.api.handlers import WebHandler

handler = WebHandler(session)

asset = await handler.handle(
    url="https://example.com/article",
    infospace_id=1,
    user_id=1,
    options={'scrape_immediately': True}
)
```

### Search Results

```python
from app.api.handlers import SearchHandler

handler = SearchHandler(session)

assets = await handler.handle_bulk(
    results=search_results,  # List[SearchResult]
    query="climate change",
    infospace_id=1,
    user_id=1,
    options={'depth': 0}
)
```

### RSS Feed

```python
from app.api.handlers import RSSHandler

handler = RSSHandler(session)

articles = await handler.handle(
    feed_url="https://example.com/feed.xml",
    infospace_id=1,
    user_id=1,
    options={'max_items': 50}
)
```

### Direct Text

```python
from app.api.handlers import TextHandler

handler = TextHandler(session)

asset = await handler.handle(
    text="My content here",
    infospace_id=1,
    user_id=1,
    title="My Note",
    event_timestamp=datetime.now()
)
```

## Creating a Custom Handler

### When to Create a Handler

Create a handler when:
- You have a new input format
- Input needs special preparation
- Multiple inputs share common logic

### Example: Email Handler

```python
# email_handler.py
from typing import Dict, Any, Optional
from sqlmodel import Session
from app.models import Asset
from app.api.services.asset_builder import AssetBuilder

class EmailHandler:
    """Handle email (.eml) file ingestion."""
    
    def __init__(self, session: Session):
        self.session = session
    
    async def handle(
        self,
        email_data: bytes,
        infospace_id: int,
        user_id: int,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Parse email and create asset.
        
        Args:
            email_data: Raw email bytes
            infospace_id: Target infospace
            user_id: User uploading email
            options: Processing options
            
        Returns:
            Created asset
        """
        options = options or {}
        
        # Parse email
        import email
        msg = email.message_from_bytes(email_data)
        
        subject = msg.get('Subject', 'No Subject')
        from_addr = msg.get('From', 'Unknown')
        date = msg.get('Date')
        body = self._extract_body(msg)
        
        # Build asset
        asset = await (AssetBuilder(self.session, user_id, infospace_id)
            .from_text(body, title=subject)
            .with_metadata(
                email_from=from_addr,
                email_date=date,
                email_subject=subject
            )
            .build())
        
        # Extract attachments if requested
        if options.get('extract_attachments', False):
            await self._extract_attachments(msg, asset)
        
        return asset
    
    def _extract_body(self, msg) -> str:
        """Extract text body from email."""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    return part.get_payload(decode=True).decode()
        else:
            return msg.get_payload(decode=True).decode()
        return ""
    
    async def _extract_attachments(self, msg, parent_asset):
        """Create child assets for attachments."""
        # TODO: Implement attachment extraction
        pass
```

### Registering Custom Handler

```python
# In __init__.py:
from .email_handler import EmailHandler

__all__ = [
    # ... existing handlers ...
    "EmailHandler",
]
```

### Using Custom Handler

```python
from app.api.handlers import EmailHandler

handler = EmailHandler(session)
asset = await handler.handle(email_bytes, infospace_id, user_id)
```

## Handler Responsibilities

### ✅ DO

- Validate input format
- Detect content type
- Prepare data for AssetBuilder
- Coordinate dependencies (storage, scrapers)
- Make processing decisions (immediate/background)
- Handle bulk operations

### ❌ DON'T

- Implement parsing logic (that's for processors)
- Directly create child assets (AssetBuilder/processors do that)
- Bypass AssetBuilder (always use it)
- Include heavy computation (keep handlers thin)

## Testing Handlers

```python
import pytest
from app.api.handlers import FileHandler

@pytest.mark.asyncio
async def test_file_handler():
    # Setup
    handler = FileHandler(session, storage, scraping)
    
    # Create mock file
    mock_file = create_mock_upload_file("test.csv", b"a,b,c\n1,2,3")
    
    # Handle
    asset = await handler.handle(
        file=mock_file,
        infospace_id=1,
        user_id=1,
        options={'process_immediately': False}
    )
    
    # Assert
    assert asset.kind == AssetKind.CSV
    assert asset.blob_path is not None
    assert asset.processing_status == ProcessingStatus.PENDING
```

## Best Practices

1. **Keep Thin**: Handlers should be <100 lines
2. **Delegate**: Let AssetBuilder and Processors do the work
3. **Fail Fast**: Validate input early
4. **Log Clearly**: Help debugging with good logs
5. **Test Independently**: Mock dependencies, test logic

## Common Patterns

### Pattern: Bulk Operations

```python
async def handle_bulk(self, items: List[Any], ...):
    """Handle multiple items."""
    assets = []
    for item in items:
        try:
            asset = await self.handle(item, ...)
            assets.append(asset)
        except Exception as e:
            logger.error(f"Failed to handle {item}: {e}")
            continue
    return assets
```

### Pattern: Conditional Processing

```python
async def handle(self, input, ...):
    """Handle with conditional processing."""
    # Create asset
    asset = await builder.build()
    
    # Decide processing
    if should_process_immediately(asset, user_pref, size):
        # Process now
        processor = get_processor(asset, context)
        await processor.process(asset)
    else:
        # Queue for background
        process_content.delay(asset.id)
    
    return asset
```

### Pattern: Error Recovery

```python
async def handle(self, input, ...):
    """Handle with error recovery."""
    try:
        return await self._do_handle(input, ...)
    except ValidationError as e:
        logger.error(f"Invalid input: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Internal error")
```

## Examples

See existing handlers for patterns:
- `file_handler.py` - Complex: file upload + processing strategy
- `web_handler.py` - Medium: URL handling + bulk support
- `search_handler.py` - Simple: direct delegation to AssetBuilder
- `rss_handler.py` - Medium: feed parsing + article creation
- `text_handler.py` - Simple: minimal adapter

## Integration with Routes

```python
# In routes/assets.py

@router.post("/upload")
async def upload_file(
    file: UploadFile,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int
):
    """Upload file endpoint."""
    from app.api.handlers import FileHandler
    from app.api.providers.factory import create_storage_provider
    
    # Create handler
    storage = create_storage_provider(settings)
    handler = FileHandler(session, storage)
    
    # Handle upload
    asset = await handler.handle(
        file=file,
        infospace_id=infospace_id,
        user_id=current_user.id,
        options=request.options
    )
    
    return AssetRead.model_validate(asset)
```


