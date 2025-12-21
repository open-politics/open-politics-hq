import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import SearchProviderDep, get_current_user, get_db
from app.api.providers.base import SearchProvider
from app.api.providers.impl.search_tavily import TavilySearchProvider
from app.api.providers.impl.search_opol import OpolSearchProvider
from app.api.providers.search_registry import SearchProviderRegistryService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.models import User
from app.schemas import SearchResultsOut, SearchRequest
from app.core.config import settings
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

def create_search_provider_by_name(provider_name: str) -> SearchProvider:
    """Create a search provider instance based on the provider name."""
    provider_name = provider_name.lower()
    
    if provider_name == "tavily":
        if not settings.TAVILY_API_KEY:
            raise ValueError("TAVILY_API_KEY is required for the Tavily search provider.")
        return TavilySearchProvider(api_key=settings.TAVILY_API_KEY)
    elif provider_name in ["opol_searxng", "opol", "searxng"]:
        return OpolSearchProvider(opol_mode=settings.OPOL_MODE, opol_api_key=settings.OPOL_API_KEY)
    else:
        raise ValueError(f"Unsupported search provider: {provider_name}")

# Request models for the new search and ingest endpoint
class ExternalSearchRequest(BaseModel):
    query: str
    provider: str = "tavily"
    limit: int = 10
    infospace_id: int
    scrape_content: bool = True
    create_assets: bool = True  # Whether to create assets or just return search results
    bundle_id: Optional[int] = None
    include_domains: Optional[List[str]] = None
    exclude_domains: Optional[List[str]] = None
    api_key: Optional[str] = None  # Runtime API key for the search provider
    # Tavily-specific parameters
    search_depth: Optional[str] = "basic"
    include_images: Optional[bool] = True
    include_answer: Optional[bool] = True
    topic: Optional[str] = "general"
    chunks_per_source: Optional[int] = 3
    days: Optional[int] = 7
    time_range: Optional[str] = None
    country: Optional[str] = None

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


@router.post("/external", response_model=SearchAndIngestResponse)
async def search_and_ingest(
    request: ExternalSearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """
    Search using external providers (Tavily, etc.) and create assets from results.
    
    This endpoint combines web search with content ingestion to create searchable assets
    from web content. It supports multiple search providers and can automatically
    scrape full content from discovered URLs.
    """
    logger.info(f"External search and ingest request: query='{request.query}', provider={request.provider}")
    
    try:
        # Create the requested search provider using the registry
        try:
            search_registry = SearchProviderRegistryService()
            search_provider = search_registry.create_provider(request.provider, request.api_key)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # Configure search options
        search_options = {
            'limit': request.limit,
            'scrape_content': request.scrape_content,
            'provider_params': {}
        }
        
        # Add domain filtering
        if request.include_domains:
            search_options['provider_params']['include_domains'] = request.include_domains
        if request.exclude_domains:
            search_options['provider_params']['exclude_domains'] = request.exclude_domains
            
        # Add Tavily-specific parameters
        if request.provider == 'tavily':
            if request.search_depth:
                search_options['provider_params']['search_depth'] = request.search_depth
            if request.include_images is not None:
                search_options['provider_params']['include_images'] = request.include_images
            if request.include_answer is not None:
                search_options['provider_params']['include_answer'] = request.include_answer
            if request.topic:
                search_options['provider_params']['topic'] = request.topic
            if request.chunks_per_source:
                search_options['provider_params']['chunks_per_source'] = request.chunks_per_source
            if request.days:
                search_options['provider_params']['days'] = request.days
            if request.time_range:
                search_options['provider_params']['time_range'] = request.time_range
            if request.country:
                search_options['provider_params']['country'] = request.country
        
        if request.create_assets:
            # Use SearchHandler to create assets from search results
            from app.api.handlers import SearchHandler
            from app.schemas import SearchResult
            
            # First, perform the search using the provider directly
            provider_params = search_options.get('provider_params', {})
            raw_results = await search_provider.search(
                query=request.query,
                limit=request.limit,
                **provider_params
            )
            
            logger.info(f"Search provider returned {len(raw_results)} results")
            
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
            handler = SearchHandler(db)
            assets = await handler.handle_bulk(
                results=search_results,
                query=request.query,
                infospace_id=request.infospace_id,
                user_id=current_user.id,
                options=search_options
            )
            
            # Add to bundle if specified
            if request.bundle_id and assets:
                # Only add top-level assets (not children)
                asset_ids = [asset.id for asset in assets if asset.parent_asset_id is None]
                
                if asset_ids:
                    from app.models import Bundle, Asset
                    bundle = db.get(Bundle, request.bundle_id)
                    if bundle:
                        for asset_id in asset_ids:
                            asset = db.get(Asset, asset_id)
                            if asset:
                                asset.bundle_id = request.bundle_id
                                db.add(asset)
                        
                        bundle.asset_count = (bundle.asset_count or 0) + len(asset_ids)
                        db.add(bundle)
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
            # Just search without creating assets - use the provider directly
            provider_params = search_options.get('provider_params', {})
            raw_results = await search_provider.search(
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """
    Create assets from specific URLs (typically from search results).
    
    This endpoint allows for selective asset creation from a list of URLs,
    providing more control over which search results become assets.
    """
    logger.info(f"Creating assets from {len(request.urls)} URLs for user {current_user.id}")
    
    try:
        # Initialize content ingestion service
        content_ingestion_service = ContentIngestionService(session=db)
        
        created_assets = []
        failed_urls = []
        
        # Process each URL individually
        for url in request.urls:
            try:
                # Create asset from URL
                assets = await content_ingestion_service.ingest_content(
                    locator=url,
                    infospace_id=request.infospace_id,
                    user_id=current_user.id,
                    bundle_id=request.bundle_id,
                    options={
                        'scrape_immediately': request.scrape_content,
                        'search_metadata': request.search_metadata
                    }
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """
    Create assets directly from search result data without re-scraping.
    
    This endpoint creates assets using the rich data already available from search results,
    avoiding the need to re-scrape URLs and providing faster asset creation.
    """
    logger.info(f"Creating assets from {len(request.search_results)} search results for user {current_user.id}")
    
    try:
        # Initialize content ingestion service
        content_ingestion_service = ContentIngestionService(session=db)
        
        created_assets = []
        failed_results = []
        
        query = request.search_metadata.get('query', 'Search Results') if request.search_metadata else 'Search Results'
        
        # Use SearchHandler to create assets from search results
        from app.api.handlers import SearchHandler
        handler = SearchHandler(db)
        
        # Process each search result
        for i, result_data in enumerate(request.search_results):
            try:
                # Convert dict back to SearchResult object
                from app.schemas import SearchResult
                search_result = SearchResult(
                    title=result_data.get("title", ""),
                    url=result_data.get("url", ""),
                    content=result_data.get("content", ""),
                    score=result_data.get("score"),
                    provider=request.search_metadata.get('provider', 'unknown') if request.search_metadata else 'unknown',
                    raw_data=result_data.get("raw", {})
                )
                
                # Create asset using SearchHandler
                asset = await handler.handle(
                    result=search_result,
                    query=query,
                    infospace_id=request.infospace_id,
                    user_id=current_user.id,
                    rank=i,
                    options={}
                )
                created_assets.append(asset)
                
            except Exception as e:
                logger.error(f"Failed to create asset from search result {result_data.get('url', 'unknown')}: {e}")
                failed_results.append(result_data.get('url', 'unknown'))
                continue
        
        # Commit all assets
        db.commit()
        
        success_count = len(created_assets)
        failed_count = len(failed_results)
        
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
