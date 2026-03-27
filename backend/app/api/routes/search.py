import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependency_injection import WebSearchProviderDep, get_current_user, get_db, IngestionContextFactoryDep, get_ingestion_context_factory
from app.api.modules.foundation_service_providers.base import WebSearchProvider
from app.api.modules.foundation_service_providers.registry import get_provider
from app.api.modules.content.ingest import ingest
from app.api.modules.identity_infospace_user.access import Capability, resolve_access
from app.models import User
from app.schemas import SearchResultsOut, SearchRequest
from app.core.config import settings
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

# Request models for the new search and ingest endpoint
class ExternalSearchRequest(BaseModel):
    query: str
    provider: str = "tavily"
    limit: int = 10
    infospace_id: int
    scrape_content: bool = True
    create_assets: bool = True  # Whether to create assets or just return search results
    bundle_id: Optional[int] = None
    api_key: Optional[str] = None  # Runtime API key for the search provider
    provider_params: Optional[Dict[str, Any]] = None  # Provider-specific (include_domains, search_depth, etc.)

class SelectiveAssetCreationRequest(BaseModel):
    """Request for creating assets from specific search result URLs"""
    urls: List[str]
    infospace_id: int
    bundle_id: Optional[int] = None
    scrape_content: bool = True
    search_metadata: Optional[Dict[str, Any]] = None  # Original search query, provider, etc.

class DirectAssetCreationRequest(BaseModel):
    """Request for creating assets directly from search result data"""
    search_results: List[Dict[str, Any]]  # Full search result objects with all data
    infospace_id: int
    bundle_id: Optional[int] = None
    search_metadata: Optional[Dict[str, Any]] = None  # Original search query, provider, etc.

class SearchAndIngestResponse(BaseModel):
    query: str
    provider: str
    results_found: int
    results: Optional[List[dict]] = None  # Raw search results when not creating assets
    assets_created: int = 0
    asset_ids: List[int] = []
    status: str
    message: str





@router.get("", response_model=SearchResultsOut)
@router.get("/", response_model=SearchResultsOut)
async def search_content(
    search_request: SearchRequest,
    web_search_provider: WebSearchProvider = Depends(WebSearchProviderDep),
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
        provider_results = await web_search_provider.search(query=query, limit=limit, **provider_kwargs)

        provider_name = getattr(web_search_provider.__class__, "__name__", "unknown")

        return SearchResultsOut(provider=provider_name, results=provider_results)

    except IOError as e:
        logger.error(f"Route: Search provider error for query '{query}': {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Search service failed: {e}")
    except Exception as e:
        logger.exception(f"Route: Unexpected error during search for query '{query}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred during search."
        )


@router.post("/external", response_model=SearchAndIngestResponse)
async def search_and_ingest(
    request: ExternalSearchRequest,
    make_ingestion_context: IngestionContextFactoryDep,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """
    Search using external providers (Tavily, etc.) and create assets from results.
    
    This endpoint combines web search with content ingestion to create searchable assets
    from web content. It supports multiple search providers and can automatically
    scrape full content from discovered URLs.
    """
    # Validate infospace access
    resolve_access(db, request.infospace_id, current_user, Capability.INGEST)

    logger.info(f"External search and ingest request: query='{request.query}', provider={request.provider}")

    try:
        # Create the requested search provider using the descriptor registry
        try:
            web_search_provider = get_provider(
                WebSearchProvider, request.provider, settings,
                api_key_override=request.api_key,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        provider_params = request.provider_params or {}
        search_options = {
            "limit": request.limit,
            "scrape_content": request.scrape_content,
        }

        if request.create_assets:
            # Use SearchHandler to create assets from search results
            from app.api.modules.content.handlers import SearchHandler
            from app.schemas import SearchResult
            
            raw_results = await web_search_provider.search(
                query=request.query,
                limit=request.limit,
                **provider_params
            )

            logger.info(f"Web search provider returned {len(raw_results)} results")
            
            # Convert dict results to SearchResult objects
            search_results = []
            for result_dict in raw_results:
                search_result = SearchResult(
                    title=result_dict.get("title", ""),
                    url=result_dict.get("url", ""),
                    content=result_dict.get("content", ""),
                    score=result_dict.get("score"),
                    provider=request.provider,
                    raw_data=result_dict.get("raw", result_dict)  # Use 'raw' if present, else entire dict
                )
                search_results.append(search_result)
            
            # Then create assets from the results
            context = make_ingestion_context(
                current_user.id, request.infospace_id, search_options
            )
            handler = SearchHandler(context)
            assets = await handler.handle_bulk(
                results=search_results,
                query=request.query,
                options=search_options
            )
            
            if request.bundle_id and assets:
                asset_ids = [asset.id for asset in assets if asset.parent_asset_id is None]
                if asset_ids:
                    from app.core.tree import copy as tree_copy
                    tree_copy(db, asset_ids=asset_ids, to=request.bundle_id)
                    db.commit()
                    logger.info(f"Added {len(asset_ids)} assets to bundle {request.bundle_id}")
            
            logger.info(f"Created {len(assets)} assets from search query '{request.query}'")
            
            return SearchAndIngestResponse(
                query=request.query,
                provider=request.provider,
                results_found=len(raw_results),
                assets_created=len(assets),
                asset_ids=[asset.id for asset in assets],
                status="success",
                message=f"Successfully created {len(assets)} assets from search query '{request.query}'"
            )
        else:
            raw_results = await web_search_provider.search(
                query=request.query,
                limit=request.limit,
                **provider_params
            )

            # Results are already dictionaries from the provider, just format them
            results_data = []
            for result in raw_results:
                result_dict = {
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "content": result.get("content", ""),
                    "score": result.get("score"),
                    "raw": result.get("raw", result)
                }
                
                # Extract additional fields if available
                if "raw_content" in result:
                    result_dict["raw_content"] = result["raw_content"]
                
                if "favicon" in result:
                    result_dict["favicon"] = result["favicon"]
                
                if "published_date" in result:
                    result_dict["published_date"] = result["published_date"]
                
                results_data.append(result_dict)
            
            logger.info(f"Found {len(raw_results)} search results for query '{request.query}'")
            
            return SearchAndIngestResponse(
                query=request.query,
                provider=request.provider,
                results_found=len(raw_results),
                results=results_data,
                assets_created=0,
                asset_ids=[],
                status="success",
                message=f"Found {len(raw_results)} search results for query '{request.query}'"
            )
        
    except Exception as e:
        logger.error(f"Search and ingest failed for query '{request.query}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search and ingest failed: {str(e)}"
        )


@router.post("/create-assets-from-urls", response_model=SearchAndIngestResponse)
async def create_assets_from_urls(
    request: SelectiveAssetCreationRequest,
    make_ingestion_context: IngestionContextFactoryDep,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """
    Create assets from specific URLs (typically from search results).
    
    This endpoint allows for selective asset creation from a list of URLs,
    providing more control over which search results become assets.
    """
    resolve_access(db, request.infospace_id, current_user, Capability.INGEST)
    logger.info(f"Creating assets from {len(request.urls)} URLs for user {current_user.id}")

    try:
        opts = {
            'scrape_immediately': request.scrape_content,
            'search_metadata': request.search_metadata,
        }
        context = make_ingestion_context(current_user.id, request.infospace_id, opts)

        created_assets = []
        failed_urls = []

        for url in request.urls:
            try:
                assets = await ingest(
                    context,
                    url,
                    bundle_id=request.bundle_id,
                    options=opts,
                )
                created_assets.extend(assets)
                
            except Exception as e:
                logger.error(f"Failed to create asset from URL {url}: {e}")
                failed_urls.append(url)
                continue
        
        success_count = len(created_assets)
        failed_count = len(failed_urls)
        
        message = f"Successfully created {success_count} assets"
        if failed_count > 0:
            message += f", {failed_count} URLs failed"
        
        logger.info(f"Asset creation completed: {success_count} success, {failed_count} failed")
        
        return SearchAndIngestResponse(
            query=request.search_metadata.get('query', 'URL List') if request.search_metadata else 'URL List',
            provider=request.search_metadata.get('provider', 'direct') if request.search_metadata else 'direct',
            results_found=len(request.urls),
            assets_created=success_count,
            asset_ids=[asset.id for asset in created_assets],
            status="success" if failed_count == 0 else "partial_success",
            message=message
        )
        
    except Exception as e:
        logger.error(f"Bulk asset creation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset creation failed: {str(e)}"
        )


@router.post("/create-assets-from-results", response_model=SearchAndIngestResponse)
async def create_assets_from_results(
    request: DirectAssetCreationRequest,
    make_ingestion_context: IngestionContextFactoryDep,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """
    Create assets directly from search result data without re-scraping.
    
    This endpoint creates assets using the rich data already available from search results,
    avoiding the need to re-scrape URLs and providing faster asset creation.
    """
    resolve_access(db, request.infospace_id, current_user, Capability.INGEST)
    logger.info(f"Creating assets from {len(request.search_results)} search results for user {current_user.id}")

    try:
        query = request.search_metadata.get('query', 'Search Results') if request.search_metadata else 'Search Results'

        from app.api.modules.content.handlers import SearchHandler
        from app.schemas import SearchResult

        context = make_ingestion_context(current_user.id, request.infospace_id, {})
        handler = SearchHandler(context)
        search_results = [
            SearchResult(
                title=result_data.get("title", ""),
                url=result_data.get("url", ""),
                content=result_data.get("content", ""),
                score=result_data.get("score"),
                provider=request.search_metadata.get('provider', 'unknown') if request.search_metadata else 'unknown',
                raw_data=result_data.get("raw", {})
            )
            for result_data in request.search_results
        ]
        created_assets = await handler.handle_bulk(
            results=search_results,
            query=query,
            options={}
        )
        if request.bundle_id and created_assets:
            asset_ids = [a.id for a in created_assets if a.parent_asset_id is None]
            if asset_ids:
                from app.core.tree import copy as tree_copy
                tree_copy(db, asset_ids=asset_ids, to=request.bundle_id)
        db.commit()
        failed_count = len(request.search_results) - len(created_assets)
        
        success_count = len(created_assets)
        message = f"Successfully created {success_count} assets from search results"
        if failed_count > 0:
            message += f", {failed_count} results failed"
        
        logger.info(f"Asset creation completed: {success_count} success, {failed_count} failed")
        
        return SearchAndIngestResponse(
            query=query,
            provider=request.search_metadata.get('provider', 'direct') if request.search_metadata else 'direct',
            results_found=len(request.search_results),
            assets_created=success_count,
            asset_ids=[asset.id for asset in created_assets],
            status="success" if failed_count == 0 else "partial_success",
            message=message
        )
        
    except Exception as e:
        logger.error(f"Direct asset creation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset creation failed: {str(e)}"
        )
