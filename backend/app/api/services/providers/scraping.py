"""
Concrete implementations of scraping providers.
"""
import logging
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.core.opol_config import opol
from app.api.services.providers.base import ScrapingProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class OpolScrapingProvider(ScrapingProvider):
    """
    OPOL implementation of the ScrapingProvider interface.
    """
    
    def __init__(self):
        """
        Initialize the OPOL scraping provider.
        """
        self._check_opol_available()
        logger.info("OPOL scraping provider initialized")
    
    def _check_opol_available(self):
        """Check if OPOL is available."""
        if not opol:
            logger.error("OPOL instance is not available for scraping")
            raise ConnectionError("Scraping service (OPOL) is not available")
    
    async def scrape_url(self, url: str) -> Dict[str, Any]:
        """
        Scrape content from a URL using OPOL.
        
        Args:
            url: The URL to scrape
            
        Returns:
            Dictionary containing the scraped content and metadata
        """
        self._check_opol_available()
        
        try:
            logger.debug(f"Attempting to scrape URL: {url}")
            
            # Call the opol.scraping.url method
            # Note: This should be made async if the OPOL library supports it
            article_data = opol.scraping.url(url)
            
            if not article_data:
                logger.warning(f"Scraping returned no data for URL: {url}")
                raise ValueError("Scraping yielded no data")
            
            # Extract data from the response, with fallbacks
            title = getattr(article_data, 'title', None) or article_data.get('title', '')
            text_content = getattr(article_data, 'text', None) or article_data.get('text', '')
            publication_date = getattr(article_data, 'publication_date', None) or article_data.get('publication_date', None)
            
            # Convert publication_date to string if present
            if publication_date:
                publication_date = str(publication_date)
            
            logger.debug(f"Successfully scraped URL: {url}, Title: '{title[:50]}...'")
            
            # Return standardized structure
            return {
                "title": title,
                "text_content": text_content,
                "publication_date": publication_date,
                "original_data": article_data  # Include raw data for downstream processing
            }
            
        except HTTPException as http_exc:
            # Re-raise HTTP exceptions
            logger.error(f"HTTP error scraping URL {url}: {http_exc.detail}")
            raise http_exc
        except Exception as e:
            logger.error(f"Error scraping URL {url}: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to scrape URL {url}: {str(e)}")


# Factory function moved here
def get_scraping_provider() -> ScrapingProvider:
    """
    Factory function to create and return a configured ScrapingProvider instance.
    This allows for dependency injection in FastAPI routes.
    
    Returns:
        A configured ScrapingProvider instance
    """
    return OpolScrapingProvider() 