# backend/app/core/scraping_utils.py
import logging
from typing import Dict, Any, Optional
from app.core.opol_config import opol # Import the centralized OPOL instance
from fastapi import HTTPException # Import HTTPException for consistency

logger = logging.getLogger(__name__)

async def get_article_content(url: str) -> Dict[str, Any]:
    """
    Core logic to scrape article content from a URL using OPOL.
    Returns a standardized dictionary or raises HTTPException on failure.
    """
    if not opol:
        logger.error("OPOL instance is not available for scraping.")
        raise HTTPException(
            status_code=501,
            detail="Scraping service (OPOL) is not available."
        )

    try:
        logger.debug(f"Attempting to scrape URL: {url}")
        # Assuming opol.scraping.url might be blocking or async.
        # If it's blocking, consider running it in a thread pool executor from async contexts.
        # If it's already async, we can await it directly.
        # For now, assume it can be called directly. Adapt if needed.
        article_data = opol.scraping.url(url) # Direct call

        # Adapt based on actual opol library's return type/structure
        if not article_data:
             logger.warning(f"Scraping returned no data for URL: {url}")
             raise HTTPException(status_code=404, detail="Scraping yielded no data.")

        # Extract data safely, providing defaults
        title = getattr(article_data, 'title', article_data.get('title', ''))
        text_content = getattr(article_data, 'text', article_data.get('text', ''))
        # Handle publication_date parsing carefully if opol returns various formats
        publication_date_raw = getattr(article_data, 'publication_date', article_data.get('publication_date', None))
        # Attempt basic parsing/validation if needed, or return raw string
        publication_date = str(publication_date_raw) if publication_date_raw else None

        logger.debug(f"Successfully scraped URL: {url}, Title: '{title[:50]}...'")
        # Return a standardized structure consistent with previous uses
        return {
            "title": title,
            "text_content": text_content,
            "publication_date": publication_date, # Return as string or parsed datetime? String is safer.
            "original_data": article_data # Include raw data if needed downstream
        }

    except HTTPException as http_exc:
        # Re-raise known HTTP exceptions
        raise http_exc
    except Exception as e:
        logger.error(f"Scraping failed for URL {url}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to scrape article from {url}: {str(e)}"
        ) 