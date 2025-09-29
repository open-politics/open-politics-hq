import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SearchProviderDep
from app.api.providers.base import SearchProvider
from app.schemas import SearchResultsOut
from app.schemas import SearchRequest

logger = logging.getLogger(__name__)

router = APIRouter()





@router.get("", response_model=SearchResultsOut)
@router.get("/", response_model=SearchResultsOut)
async def search_content(
    search_request: SearchRequest,
    search_provider: SearchProvider = Depends(SearchProviderDep),
) -> SearchResultsOut:
    """
    Performs a search using the configured search provider (e.g., Tavily)
    and returns a standardized list of search results.
    """
    query = search_request.query
    limit_str = search_request.limit

    if not query:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing required query parameter: 'query'",
        )
    
    try:
        limit = int(limit_str)
        if not (1 <= limit <= 100):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'limit' parameter must be an integer between 1 and 100.",
        )

    # Pass all other query params to the search provider
    provider_kwargs = {k: v for k, v in search_request.dict().items() if k not in ["query", "limit"]}

    logger.info(f"Route: Performing search for query: '{query}' with limit: {limit} and extra params: {provider_kwargs}")
    try:
        provider_results = await search_provider.search(query=query, limit=limit, **provider_kwargs)

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
