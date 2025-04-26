"""
Concrete implementations of search providers.
"""
import logging
from typing import Any, Dict, List, Optional

from app.core.opol_config import opol
from app.api.services.providers.base import SearchProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class OpolSearchProvider(SearchProvider):
    """
    OPOL implementation of the SearchProvider interface.
    """
    
    def __init__(self):
        """
        Initialize the OPOL search provider.
        """
        self._check_opol_available()
        logger.info("OPOL search provider initialized")
    
    def _check_opol_available(self):
        """Check if OPOL is available."""
        if not opol:
            logger.error("OPOL instance is not available for search")
            raise ConnectionError("Search service (OPOL) is not available")
    
    async def search(self, query: str, skip: int = 0, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Search for content based on a query using OPOL.
        
        Args:
            query: The search query
            skip: Number of results to skip
            limit: Maximum number of results to return
            
        Returns:
            List of search results
        """
        self._check_opol_available()
        
        try:
            logger.debug(f"Searching with query: '{query}', skip: {skip}, limit: {limit}")
            
            # Note: Using OPOL articles search for now, this could be modified to use
            # a different method if OPOL provides a more generic search interface
            # Also, this should be made async if OPOL supports it
            results = opol.articles(query, skip, limit)
            
            # Validate results
            if not isinstance(results, list):
                logger.warning(f"Unexpected result type from OPOL search: {type(results)}")
                return []
            
            # Ensure all results are dictionaries
            validated_results = []
            for result in results:
                if isinstance(result, dict):
                    validated_results.append(result)
                else:
                    # Try to convert to dictionary if possible
                    try:
                        result_dict = dict(result)
                        validated_results.append(result_dict)
                    except (TypeError, ValueError):
                        logger.warning(f"Could not convert search result to dictionary: {result}")
            
            logger.debug(f"Search returned {len(validated_results)} results")
            return validated_results
            
        except Exception as e:
            logger.error(f"Error during search for query '{query}': {str(e)}", exc_info=True)
            raise ValueError(f"Search failed: {str(e)}")
    
    async def search_by_entity(self, entity: str, date: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Search for content related to a specific entity using OPOL.
        
        Args:
            entity: The entity to search for
            date: Optional date filter
            
        Returns:
            List of search results
        """
        self._check_opol_available()
        
        try:
            logger.debug(f"Searching for entity: '{entity}', date: {date}")
            
            # Call OPOL's by_entity method
            # This should be made async if OPOL supports it
            results = opol.articles.by_entity(entity, date)
            
            # Validate and process results
            if not isinstance(results, list):
                logger.warning(f"Unexpected result type from OPOL entity search: {type(results)}")
                return []
            
            validated_results = []
            for result in results:
                if isinstance(result, dict):
                    validated_results.append(result)
                else:
                    try:
                        result_dict = dict(result)
                        validated_results.append(result_dict)
                    except (TypeError, ValueError):
                        logger.warning(f"Could not convert entity search result to dictionary: {result}")
            
            logger.debug(f"Entity search returned {len(validated_results)} results")
            return validated_results
            
        except Exception as e:
            logger.error(f"Error during entity search for '{entity}': {str(e)}", exc_info=True)
            raise ValueError(f"Entity search failed: {str(e)}")


# Factory function moved here
def get_search_provider() -> SearchProvider:
    """
    Factory function to create and return a configured SearchProvider instance.
    This allows for dependency injection in FastAPI routes.
    
    Returns:
        A configured SearchProvider instance
    """
    return OpolSearchProvider() 