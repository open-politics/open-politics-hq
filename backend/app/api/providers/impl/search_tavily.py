import logging
from typing import Any, Dict, List, Optional
import asyncio

try:
    from tavily import TavilyClient
except ImportError:
    TavilyClient = None

from app.api.providers.base import SearchProvider

logger = logging.getLogger(__name__)

class TavilySearchProvider(SearchProvider):
    """
    Tavily implementation of the SearchProvider interface.
    """

    def __init__(self, api_key: str):
        if TavilyClient is None:
            raise ImportError("Tavily client not installed. Please run 'pip install tavily-python'.")
        if not api_key:
            raise ValueError("Tavily API key is required.")
        self.client = TavilyClient(api_key=api_key)
        logger.info("TavilySearchProvider initialized.")

    async def search(self, query: str, skip: int = 0, limit: int = 10, **kwargs) -> List[Dict[str, Any]]:
        """
        Search for content using Tavily.
        Note: Tavily does not support 'skip' for pagination. It will be ignored.
        """
        if skip > 0:
            logger.warning("Tavily search provider does not support 'skip' for pagination. It will be ignored.")
        
        try:
            # The Tavily client's search method is synchronous.
            # We run it in a thread pool to avoid blocking the async event loop.
            loop = asyncio.get_event_loop()
            search_results = await loop.run_in_executor(
                None, 
                self.client.search, 
                query, 
                "advanced", # search_depth
                None, # topic
                limit, # max_results
                None, # include_images
                None, # include_answer
                None, # include_raw_content
                None, # search_filter
            )
            
            standardized_results = []
            if search_results and "results" in search_results:
                for res in search_results["results"]:
                    standardized_results.append({
                        "title": res.get("title", ""),
                        "url": res.get("url", ""),
                        "content": res.get("content", ""),
                        "score": res.get("score", None),
                        "raw": res
                    })
            logger.info(f"Tavily search for '{query}' returned {len(standardized_results)} results.")
            return standardized_results
            
        except Exception as e:
            logger.error(f"Error during Tavily search for query '{query}': {e}", exc_info=True)
            raise IOError(f"Tavily search failed: {e}") from e

    async def search_by_entity(self, entity: str, date: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Search by entity is treated as a standard search by Tavily.
        """
        logger.info(f"Tavily search by entity '{entity}' is treated as a standard search.")
        # Tavily does not support date ranges directly in the query string.
        if date:
            logger.warning(f"Tavily provider does not support the 'date' filter. It will be ignored.")
        
        return await self.search(query=f'"{entity}"', limit=limit) 