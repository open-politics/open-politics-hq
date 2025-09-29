import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import SearchProviderDep
from app.api.providers.base import SearchProvider

logger = logging.getLogger(__name__)

router = APIRouter()


class SearchResultOut(BaseModel):
    title: str
    url: str
    content: str
    score: Optional[float] = None
    raw: Optional[Dict[str, Any]] = None


class SearchResultsOut(BaseModel):
    provider: str
    results: List[SearchResultOut]


@router.get("", response_model=SearchResultsOut)
@router.get("/", response_model=SearchResultsOut)
async def search_content(
    *,
    query: str = Query(..., min_length=3, description="The search query."),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results to return."),
    search_provider: SearchProvider = Depends(SearchProviderDep),
) -> SearchResultsOut:
    """
    Performs a search using the configured search provider (e.g., Tavily)
    and returns a standardized list of search results.
    """
    logger.info(f"Route: Performing search for query: '{query}' with limit: {limit}")
    try:
        provider_results = await search_provider.search(query=query, limit=limit)

        provider_name = getattr(search_provider.__class__, "__name__", "unknown")

        return SearchResultsOut(provider=provider_name, results=provider_results)

    except IOError as e:
        logger.error(f"Route: Search provider error for query '{query}': {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Search service failed: {e}")
    except Exception as e:
        logger.exception(f"Route: Unexpected error during search for query '{query}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred during search."
        )
