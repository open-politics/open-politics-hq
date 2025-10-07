"""
Processing Strategy
===================

Decides whether to process content immediately or in background.
Uses smart heuristics based on content type, file size, and user preference.
"""

import logging
from typing import Optional
from app.models import Asset, AssetKind

logger = logging.getLogger(__name__)

# Size thresholds (in bytes)
SMALL_FILE_THRESHOLD = 5 * 1024 * 1024  # 5 MB
LARGE_FILE_THRESHOLD = 10 * 1024 * 1024  # 10 MB


class ProcessingStrategy:
    """
    Strategy for deciding immediate vs background processing.
    
    Multi-level decision making:
    1. User explicit preference (if provided)
    2. Content-based heuristics (file size, type)
    3. System default (from settings)
    """
    
    def __init__(self, default_immediate: bool = True):
        """
        Initialize strategy.
        
        Args:
            default_immediate: System-wide default when no other rules apply
        """
        self.default_immediate = default_immediate
    
    def should_process_immediately(
        self,
        asset: Asset,
        user_preference: Optional[bool] = None,
        file_size: Optional[int] = None
    ) -> bool:
        """
        Decide if asset should be processed immediately.
        
        Decision logic:
        1. User says "immediate" → immediate
        2. User says "background" → background
        3. Large file (>10MB) → always background
        4. Medium file (5-10MB) + heavy processing → background
        5. Small file (<5MB) → immediate
        6. Web scraping → immediate (usually fast)
        7. System default
        
        Args:
            asset: Asset to process
            user_preference: Explicit user choice (True=immediate, False=background)
            file_size: File size in bytes (if known)
            
        Returns:
            True if should process immediately, False for background
        """
        
        # Level 1: User explicit preference
        if user_preference is not None:
            logger.debug(f"Asset {asset.id}: User preference = {user_preference}")
            return user_preference
        
        # Level 2: Content-based heuristics
        
        # Large files always go to background
        if file_size and file_size > LARGE_FILE_THRESHOLD:
            logger.debug(f"Asset {asset.id}: Large file ({file_size} bytes) → background")
            return False
        
        # Medium files with heavy processing → background
        if file_size and file_size > SMALL_FILE_THRESHOLD:
            if asset.kind in [AssetKind.CSV, AssetKind.PDF]:
                logger.debug(
                    f"Asset {asset.id}: Medium file ({file_size} bytes) "
                    f"with heavy processing ({asset.kind}) → background"
                )
                return False
        
        # Small files → immediate
        if file_size and file_size < SMALL_FILE_THRESHOLD:
            logger.debug(f"Asset {asset.id}: Small file ({file_size} bytes) → immediate")
            return True
        
        # Web scraping typically fast → immediate
        if asset.kind == AssetKind.WEB:
            logger.debug(f"Asset {asset.id}: Web scraping → immediate")
            return True
        
        # CSV/PDF without size info → use conservative approach
        if asset.kind in [AssetKind.CSV, AssetKind.PDF]:
            logger.debug(
                f"Asset {asset.id}: Heavy processing type ({asset.kind}), "
                f"no size info → background (conservative)"
            )
            return False
        
        # Level 3: System default
        logger.debug(f"Asset {asset.id}: Using system default = {self.default_immediate}")
        return self.default_immediate
    
    def estimate_processing_time(self, asset: Asset, file_size: Optional[int] = None) -> str:
        """
        Estimate human-readable processing time.
        
        Useful for UI feedback.
        
        Args:
            asset: Asset to estimate for
            file_size: File size in bytes
            
        Returns:
            Estimate like "< 1 second", "~30 seconds", "several minutes"
        """
        
        if file_size and file_size > LARGE_FILE_THRESHOLD:
            return "several minutes"
        
        if asset.kind == AssetKind.PDF:
            if file_size and file_size > SMALL_FILE_THRESHOLD:
                return "~1-2 minutes"
            return "~30 seconds"
        
        if asset.kind == AssetKind.CSV:
            if file_size and file_size > SMALL_FILE_THRESHOLD:
                return "~2-5 minutes"
            return "~10-30 seconds"
        
        if asset.kind == AssetKind.WEB:
            return "< 5 seconds"
        
        return "< 1 minute"


# Global strategy instance
_strategy = ProcessingStrategy()


def get_strategy() -> ProcessingStrategy:
    """Get the global processing strategy."""
    return _strategy


def should_process_immediately(
    asset: Asset,
    user_preference: Optional[bool] = None,
    file_size: Optional[int] = None
) -> bool:
    """
    Convenience function to check if asset should be processed immediately.
    
    Uses global strategy instance.
    """
    return _strategy.should_process_immediately(asset, user_preference, file_size)


