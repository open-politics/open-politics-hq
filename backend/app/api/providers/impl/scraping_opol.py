import logging
from typing import Any, Dict, Optional, List
from datetime import datetime, timezone

from fastapi import HTTPException # For raising HTTP-like errors if needed from service layer

import asyncio
from app.core.opol_config import opol, settings # Relies on global opol instance
from app.api.providers.base import ScrapingProvider # Protocol


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class OpolScrapingProvider(ScrapingProvider):
    """
    OPOL implementation of the ScrapingProvider interface.
    """
    
    def __init__(self, opol_mode: Optional[str] = None, opol_api_key: Optional[str] = None):
        """
        Initialize the OPOL scraping provider.
        Note: This provider currently relies on the globally initialized 'opol' instance from opol_config.py,
        which uses settings.OPOL_MODE and settings.OPOL_API_KEY.
        The parameters here are for future-proofing or if OPOL interaction needs to be more dynamic per instance.
        """
        self._check_opol_available()
        self.opol_mode = opol_mode # Stored for context, but global opol instance is primary
        self.opol_api_key = opol_api_key # Stored for context
        logger.info(f"OpolScrapingProvider initialized. (Uses global OPOL instance with mode: {settings.OPOL_MODE if hasattr(settings, 'OPOL_MODE') else 'N/A'})")
    
    def _check_opol_available(self):
        """Check if the global OPOL instance is available."""
        if opol is None:
            logger.error("Global OPOL instance is not available for scraping.")
            # This should ideally prevent service startup if OPOL is mandatory.
            # Raising ConnectionError aligns with Minio provider.
            raise ConnectionError("Scraping service (OPOL library) is not available or not initialized.")
    
    async def scrape_url(self, url: str, timeout: int = 30, retry_attempts: int = 1) -> Dict[str, Any]:
        """
        Scrape content from a URL using the global OPOL instance.
        
        Args:
            url: The URL to scrape.
            timeout: Request timeout in seconds.
            retry_attempts: Number of retry attempts on failure.
            
        Returns:
            Dictionary containing the scraped content and metadata.
        Raises:
            ValueError: If scraping fails after retries or returns no data.
            ConnectionError: If OPOL instance is not available.
        """
        self._check_opol_available() # Ensure global opol is there
        
        current_attempt = 0
        last_exception = None
        
        while current_attempt <= retry_attempts:
            try:
                logger.debug(f"Attempt {current_attempt + 1}/{retry_attempts + 1} to scrape URL: {url} with timeout {timeout}s")
                
                # Assuming opol.scraping.url is synchronous, run in thread pool
                # If opol.scraping.url becomes async, can be awaited directly.
                # Note: OPOL scraping.url doesn't support timeout parameter
                article_data = await asyncio.to_thread(opol.scraping.url, url)
                
                if not article_data:
                    logger.warning(f"Scraping attempt {current_attempt + 1} returned no data for URL: {url}")
                    # Consider this a failure for retry purposes if empty data is not acceptable
                    if current_attempt == retry_attempts: # Last attempt and no data
                        raise ValueError("Scraping yielded no data after all attempts.")
                    # else, will be caught by general exception and retried if that's how OPOL signals empty.
                    # If OPOL returns None on *successful* scrape with no content, this needs different handling.
                    # For now, assume None/empty means a retryable issue or final failure.
                    last_exception = ValueError("Scraping yielded no data")
                    current_attempt += 1
                    await asyncio.sleep(1 * current_attempt) # Simple backoff
                    continue

                # Standardize output structure (as in scraping_utils.py)
                
                title = getattr(article_data, 'title', article_data.get('title', '') if isinstance(article_data, dict) else '')
                
                # Try multiple possible field names for text content
                text_content = ''
                text_fields_to_try = ['text_content', 'text', 'content', 'article_text', 'body', 'fulltext', 'main_text']
                for field in text_fields_to_try:
                    if hasattr(article_data, field):
                        text_content = getattr(article_data, field, '')
                        if text_content:
                            break
                    elif isinstance(article_data, dict) and field in article_data:
                        text_content = article_data.get(field, '')
                        if text_content:
                            break
                
                if not text_content:
                    logger.warning(f"No text content found for URL: {url}")
                
                publication_date_raw = getattr(article_data, 'publish_date', getattr(article_data, 'publication_date', article_data.get('publication_date', None) if isinstance(article_data, dict) else None))
                publication_date = str(publication_date_raw) if publication_date_raw else None
                top_image = getattr(article_data, 'top_image', article_data.get('top_image', None) if isinstance(article_data, dict) else None)
                images = getattr(article_data, 'images', article_data.get('images', []) if isinstance(article_data, dict) else [])
                summary = getattr(article_data, 'summary', article_data.get('summary', '') if isinstance(article_data, dict) else '')
                # Add other fields if OPOL provides them and they are useful
                # e.g., authors, keywords, meta_description, meta_lang, etc.

                logger.info(f"Successfully scraped URL: {url}, Title: '{title[:50]}...', Content: {len(text_content)} chars, Images: {len(images) if isinstance(images, list) else 0}")
                return {
                    "url": url,
                    "title": title,
                    "text_content": text_content,
                    "publication_date": publication_date,
                    "top_image": top_image,
                    "images": images if isinstance(images, list) else [], # Ensure images is a list
                    "summary": summary,
                    "raw_scraped_data": article_data # Include original data for flexibility
                }
            
            except Exception as e:
                last_exception = e
                logger.warning(f"Attempt {current_attempt + 1} failed for URL {url}: {e}")
                if current_attempt == retry_attempts:
                    logger.error(f"All {retry_attempts + 1} scraping attempts failed for URL {url}. Last error: {last_exception}", exc_info=True)
                    raise ValueError(f"Failed to scrape URL {url} after {retry_attempts + 1} attempts: {last_exception}") from last_exception
                current_attempt += 1
                await asyncio.sleep(1 * current_attempt) # Simple exponential backoff for retries
        
        # Should not be reached if loop logic is correct, but as a fallback:
        raise ValueError(f"Scraping failed for {url} due to an unexpected loop exit. Last error: {last_exception or 'Unknown'}")
    
    async def scrape_urls_bulk(self, urls: List[str], max_threads: int = 4) -> List[Dict[str, Any]]:
        """
        Bulk URL scraping - fallback implementation using sequential scraping.
        Note: OPOL doesn't have native bulk scraping, so we implement it sequentially.
        """
        logger.info(f"OPOL bulk scraping {len(urls)} URLs (sequential fallback)")
        results = []
        
        for i, url in enumerate(urls):
            try:
                result = await self.scrape_url(url)
                results.append(result)
                
                # Simple rate limiting
                if i < len(urls) - 1:  # Don't sleep after the last URL
                    await asyncio.sleep(0.5)
                    
            except Exception as e:
                logger.error(f"Failed to scrape URL {url} in bulk operation: {e}")
                results.append({
                    "url": url,
                    "title": "",
                    "text_content": "",
                    "publication_date": None,
                    "top_image": None,
                    "images": [],
                    "summary": "",
                    "scraping_error": str(e),
                    "raw_scraped_data": None
                })
        
        return results
    
    async def analyze_source(self, base_url: str) -> Dict[str, Any]:
        """
        Source analysis - limited implementation for OPOL.
        Note: OPOL doesn't have native source analysis capabilities.
        """
        logger.warning(f"OPOL provider has limited source analysis capabilities for {base_url}")
        
        return {
            "base_url": base_url,
            "brand": "",
            "description": "",
            "rss_feeds": [],
            "feed_urls": [],
            "categories": [],
            "category_urls": [],
            "recent_articles": [],
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "analysis_method": "opol_limited",
            "note": "OPOL provider has limited source analysis capabilities. Consider using newspaper4k provider for full source analysis."
        }
    
    async def discover_rss_feeds(self, base_url: str) -> List[str]:
        """
        RSS feed discovery - not supported by OPOL.
        """
        logger.warning(f"RSS feed discovery not supported by OPOL provider for {base_url}")
        return []

# Remove the old factory function from here, it's in factory.py now
# def get_scraping_provider() -> ScrapingProvider:
#     return OpolScrapingProvider() 