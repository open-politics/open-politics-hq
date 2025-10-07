# Processors

Content processors transform assets into structured data and child assets.

## Architecture

Each processor is responsible for one content type:
- **CSVProcessor**: Parses CSV files → creates row assets
- **ExcelProcessor**: Parses XLSX files → creates sheet → row hierarchy
- **PDFProcessor**: Extracts PDF text → creates page assets
- **WebProcessor**: Scrapes web pages → creates image assets

## How It Works

1. **Registration**: Processors auto-register on import via `registry.py`
2. **Lookup**: System finds processor by file extension or asset kind
3. **Processing**: Processor transforms asset and creates children
4. **Strategy**: `ProcessingStrategy` decides immediate vs background

## Adding a New Processor

### 1. Create Processor File

```python
# my_processor.py
from .base import BaseProcessor, ProcessingContext
from app.models import Asset, AssetKind
from app.schemas import AssetCreate
from typing import List

class MyProcessor(BaseProcessor):
    """Process MY_TYPE assets."""
    
    def can_process(self, asset: Asset) -> bool:
        """Check if this processor can handle the asset."""
        return asset.kind == AssetKind.MY_TYPE
    
    async def process(self, asset: Asset) -> List[AssetCreate]:
        """
        Process asset and return child assets.
        
        Args:
            asset: Parent asset to process
            
        Returns:
            List of AssetCreate for child assets
        """
        # 1. Read content from storage
        file_stream = await self.context.storage_provider.get_file(asset.blob_path)
        content = await file_stream.read()
        
        # 2. Parse content
        parsed_data = self._parse(content)
        
        # 3. Create child assets
        children = []
        for i, item in enumerate(parsed_data):
            child = AssetCreate(
                title=f"Item {i+1}",
                kind=AssetKind.MY_CHILD_TYPE,
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                parent_asset_id=asset.id,
                part_index=i,
                text_content=item['text'],
                source_metadata={'extracted_from': asset.title}
            )
            children.append(child)
        
        # 4. Update parent asset
        asset.text_content = f"Processed {len(children)} items"
        asset.source_metadata['items_processed'] = len(children)
        
        return children
    
    def _parse(self, content: bytes) -> List[dict]:
        """Your custom parsing logic."""
        # TODO: Implement parsing
        pass
```

### 2. Register Processor

```python
# In registry.py, add to register_processors():
from .my_processor import MyProcessor

_registry.register_by_kind(AssetKind.MY_TYPE, MyProcessor)
# or
_registry.register_by_extension('.myext', MyProcessor)
```

### 3. Done!

System will automatically:
- Detect your content type
- Route to your processor
- Create child assets
- Handle errors
- Log activity

## Testing Your Processor

```python
import pytest
from app.api.processors import ProcessingContext
from .my_processor import MyProcessor

@pytest.mark.asyncio
async def test_my_processor():
    # Setup
    context = ProcessingContext(
        storage_provider=mock_storage,
        options={'max_items': 100}
    )
    
    processor = MyProcessor(context)
    
    # Create test asset
    asset = create_test_asset(kind=AssetKind.MY_TYPE)
    
    # Process
    children = await processor.process(asset)
    
    # Assert
    assert len(children) > 0
    assert asset.text_content is not None
```

## Available Context

Processors receive `ProcessingContext` with:

```python
@dataclass
class ProcessingContext:
    storage_provider: StorageProvider  # Read/write files
    scraping_provider: ScrapingProvider  # Scrape web content
    options: Dict[str, Any]  # User-provided options
    max_rows: int  # Row limit for CSV/Excel
    max_pages: int  # Page limit for PDF
    max_images: int  # Image limit for web
    timeout: int  # Timeout for web requests
```

Access via `self.context` in your processor.

## Best Practices

1. **Single Responsibility**: One processor per content type
2. **Fail Fast**: Raise `ProcessingError` for unrecoverable errors
3. **Progress Feedback**: Log progress for long operations
4. **Memory Efficient**: Stream large files, don't load entirely
5. **Testable**: Keep parsing logic separate from asset creation

## Error Handling

```python
from .base import ProcessingError

async def process(self, asset: Asset):
    if not asset.blob_path:
        raise ProcessingError("Asset has no file content")
    
    try:
        # Processing logic
        ...
    except ValueError as e:
        raise ProcessingError(f"Invalid content format: {e}")
```

## Logging

```python
import logging
logger = logging.getLogger(__name__)

async def process(self, asset: Asset):
    logger.info(f"Processing {asset.kind} asset {asset.id}")
    # ...
    logger.info(f"Created {len(children)} child assets")
```

## Examples

See existing processors for patterns:
- `csv_processor.py` - Row-based parsing
- `excel_processor.py` - Multi-level hierarchy
- `pdf_processor.py` - Page-by-page extraction
- `web_processor.py` - Content scraping with images


