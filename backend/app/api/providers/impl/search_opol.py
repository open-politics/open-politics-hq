import logging
from typing import Any, Dict, List, Optional
import asyncio

from app.core.opol_config import opol # Relies on global opol instance
from app.core.config import settings # For accessing settings.OPOL_MODE if needed
from app.api.providers.base import SearchProvider # Protocol

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class OpolSearchProvider(SearchProvider):
    """
    OPOL implementation of the SearchProvider interface (e.g., using SearxNG through OPOL).
    """

    def __init__(self, opol_mode: Optional[str] = None, opol_api_key: Optional[str] = None):
        """
        Initialize the OPOL search provider.
        Relies on the globally initialized 'opol' instance from opol_config.py.
        """
        self._check_opol_available()
        # Parameters opol_mode and opol_api_key are noted but not directly used if relying on global opol instance
        logger.info(f"OpolSearchProvider initialized. (Uses global OPOL instance with mode: {settings.OPOL_MODE})")

    def _check_opol_available(self):
        if opol is None:
            logger.error("Global OPOL instance is not available for search.")
            raise ConnectionError("Search service (OPOL library) is not available or not initialized.")

    async def search(self, query: str, skip: int = 0, limit: int = 20, 
                     engines: Optional[List[str]] = None, 
                     categories: Optional[List[str]] = None,
                     time_range: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Search for content using OPOL (e.g., SearxNG via OPOL).
        
        Args:
            query: The search query string.
            skip: Number of results to skip (pagination).
            limit: Maximum number of results to return.
            engines: Optional list of specific search engines to use (if OPOL supports this).
            categories: Optional list of categories to search within (if OPOL supports this).
            time_range: Optional time range string (e.g., "day", "week", "month", "year", or specific format OPOL accepts).

        Returns:
            A list of search result dictionaries.
        """
        self._check_opol_available()
        logger.debug(f"OPOL Search: query='{query}', skip={skip}, limit={limit}, engines={engines}, categories={categories}, time_range={time_range}")

        try:
            search_params = {
                "query": query,
                "page_number": (skip // limit) + 1, 
                "count": limit, 
                "engines": ",".join(engines) if engines else None, 
                "categories": ",".join(categories) if categories else None, 
                "time_range": time_range,
            }
            search_params = {k: v for k, v in search_params.items() if v is not None}

            search_results = await asyncio.to_thread(opol.search.query, **search_params)
            
            if search_results is None:
                logger.warning(f"OPOL search for '{query}' returned None.")
                return []

            standardized_results = []
            if isinstance(search_results, list):
                for res in search_results:
                    if isinstance(res, dict):
                        standardized_results.append({
                            "title": res.get("title", ""),
                            "url": res.get("url", ""),
                            "content": res.get("content", res.get("snippet", "")),
                            "engine": res.get("engine", "unknown"),
                            "score": res.get("score", None), 
                            "publishedDate": res.get("publishedDate", res.get("timestamp", None)), 
                            "raw": res 
                        })
                    elif hasattr(res, 'title') and hasattr(res, 'url'): 
                         standardized_results.append({
                            "title": getattr(res, 'title', ""),
                            "url": getattr(res, 'url', ""),
                            "content": getattr(res, 'content', getattr(res, 'snippet', "")),
                            "engine": getattr(res, 'engine', "unknown"),
                            "score": getattr(res, 'score', None),
                            "publishedDate": getattr(res, 'publishedDate', getattr(res, 'timestamp', None)),
                            "raw": res
                        })
            
            logger.info(f"OPOL search for '{query}' returned {len(standardized_results)} results.")
            return standardized_results

        except Exception as e:
            logger.error(f"Error during OPOL search for query '{query}': {e}", exc_info=True)
            raise IOError(f"OPOL search failed: {e}") from e

    async def search_by_entity(self, entity: str, date: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Search for content related to a specific entity, potentially filtered by date.
        """
        logger.info(f"OPOL Search by entity: '{entity}', date: {date}")
        query = f'"{entity}"' # Corrected: query formatting for entity string
        if date:
            # Example: query += f" after:{date_start} before:{date_end}" 
            # Actual date filtering syntax depends on OPOL/SearxNG capabilities
            query += f" daterange:{date}" # Keeping placeholder, adjust to actual OPOL search syntax for dates
        
        return await self.search(query, limit=limit, time_range=date if date else None)

# Remove old factory 