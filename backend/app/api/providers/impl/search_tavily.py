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
            
            # Prepare search parameters according to Tavily API documentation
            search_params = {
                "query": query,
                "auto_parameters": False,  # We'll set parameters explicitly
                "topic": "general",
                "search_depth": "basic",  # Default to basic, can be overridden
                "chunks_per_source": 3,
                "max_results": limit,
                "time_range": None,
                "days": 7,
                "include_answer": True,
                "include_raw_content": True,  # Include raw content for better article extraction
                "include_images": True,      # Enable images by default
                "include_image_descriptions": True,  # Include AI-generated image descriptions
                "include_favicon": True,     # Include favicons for better UX
                "include_domains": [],
                "exclude_domains": [],
                "country": None
            }
            
            # Add optional parameters from kwargs if provided
            if "include_domains" in kwargs and kwargs["include_domains"]:
                search_params["include_domains"] = kwargs["include_domains"]
            if "exclude_domains" in kwargs and kwargs["exclude_domains"]:
                search_params["exclude_domains"] = kwargs["exclude_domains"]
            
            # Allow overriding default settings via kwargs
            if "include_images" in kwargs:
                search_params["include_images"] = kwargs["include_images"]
            if "include_raw_content" in kwargs:
                search_params["include_raw_content"] = kwargs["include_raw_content"]
            if "include_answer" in kwargs:
                search_params["include_answer"] = kwargs["include_answer"]
            if "search_depth" in kwargs:
                search_params["search_depth"] = kwargs["search_depth"]
            if "topic" in kwargs:
                search_params["topic"] = kwargs["topic"]
            if "chunks_per_source" in kwargs:
                search_params["chunks_per_source"] = kwargs["chunks_per_source"]
            if "days" in kwargs:
                search_params["days"] = kwargs["days"]
            if "time_range" in kwargs:
                search_params["time_range"] = kwargs["time_range"]
            if "country" in kwargs:
                search_params["country"] = kwargs["country"]
            
            search_results = await loop.run_in_executor(
                None, 
                lambda: self.client.search(**search_params)
            )
            
            standardized_results = []
            if search_results and "results" in search_results:
                for res in search_results["results"]:
                    # Enhanced result with rich content based on new API format
                    result = {
                        "title": res.get("title", ""),
                        "url": res.get("url", ""),
                        "content": res.get("content", ""),
                        "score": res.get("score", None),
                        "raw": res
                    }
                    
                    # Add raw content if available (full article text)
                    if "raw_content" in res and res["raw_content"]:
                        result["raw_content"] = res["raw_content"]
                    
                    # Add published date if available
                    if "published_date" in res:
                        result["published_date"] = res["published_date"]
                    
                    
                    # Add favicon if available
                    if "favicon" in res:
                        result["favicon"] = res["favicon"]
                    
                    standardized_results.append(result)
            
            # Include global metadata in the raw data of the first result if available
            if standardized_results and search_results:
                # Add global metadata to the first result's raw data for easy access
                if "images" in search_results and search_results["images"]:
                    standardized_results[0]["raw"]["tavily_images"] = search_results["images"]

                if "auto_parameters" in search_results:
                    standardized_results[0]["raw"]["tavily_auto_parameters"] = search_results["auto_parameters"]
                if "response_time" in search_results:
                    standardized_results[0]["raw"]["tavily_response_time"] = search_results["response_time"]
                if "request_id" in search_results:
                    standardized_results[0]["raw"]["tavily_request_id"] = search_results["request_id"]

                if "answer" in search_results:
                    standardized_results[0]["raw"]["summary_answer"] = search_results["answer"]
            
            images_count = len(search_results.get("images", [])) if search_results else 0
            logger.info(f"Tavily search for '{query}' returned {len(standardized_results)} results and {images_count} images.")
            
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