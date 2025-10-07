"""
Base Processor Interface
========================

All processors must inherit from BaseProcessor and implement process().
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from app.models import Asset


@dataclass
class ProcessingContext:
    """
    Context passed to processors containing configuration and dependencies.
    
    This allows processors to access shared resources without tight coupling.
    Processors can create child assets directly using asset_service.
    """
    
    # Database and services (needed for creating child assets)
    session: Any  # Session
    asset_service: Any  # AssetService
    bundle_service: Any  # BundleService
    
    # Context information
    user_id: int
    infospace_id: int
    
    # Storage and providers
    storage_provider: Any  # StorageProvider
    scraping_provider: Optional[Any] = None  # ScrapingProvider
    
    # Processing options
    options: Dict[str, Any] = None
    
    # Limits and configuration
    max_rows: int = 50000
    max_pages: int = 1000
    max_images: int = 8
    timeout: int = 30
    
    def __post_init__(self):
        if self.options is None:
            self.options = {}
        
        # Allow options to override defaults
        self.max_rows = self.options.get('max_rows', self.max_rows)
        self.max_pages = self.options.get('max_pages', self.max_pages)
        self.max_images = self.options.get('max_images', self.max_images)
        self.timeout = self.options.get('timeout', self.timeout)


class BaseProcessor(ABC):
    """
    Abstract base class for content processors.
    
    A processor takes an asset and transforms it into structured data,
    potentially creating child assets in the process.
    
    Examples:
    - CSVProcessor: Parses CSV file → creates row assets
    - PDFProcessor: Extracts text from PDF → creates page assets
    - WebProcessor: Scrapes HTML → creates image assets
    """
    
    def __init__(self, context: ProcessingContext):
        """
        Initialize processor with context.
        
        Args:
            context: ProcessingContext with dependencies and config
        """
        self.context = context
    
    @abstractmethod
    async def process(self, asset: Asset) -> List[Asset]:
        """
        Process an asset and return child assets.
        
        This is the main entry point for all processors.
        
        Args:
            asset: The parent asset to process
            
        Returns:
            List of child assets created during processing.
            Empty list if no children were created.
            
        Raises:
            ValueError: If asset cannot be processed
            ProcessingError: If processing fails
        """
        pass
    
    @abstractmethod
    def can_process(self, asset: Asset) -> bool:
        """
        Check if this processor can handle the given asset.
        
        Args:
            asset: Asset to check
            
        Returns:
            True if processor can handle this asset
        """
        pass
    
    def get_name(self) -> str:
        """Get processor name for logging."""
        return self.__class__.__name__


class ProcessingError(Exception):
    """Raised when processing fails."""
    pass

