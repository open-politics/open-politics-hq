"""Search routes — web-search + asset-search under ``/search``.

Three web-search endpoints (compose on ``modules/search/web``) + one
asset-search pair (JSON envelope + native SSE stream sibling) that composes
on ``modules/search/assets``. No ceremony — route handlers are thin wrappers.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel
from sqlmodel import Session

from app.api.dependency_injection import get_current_user, get_db, IngestionContextFactoryDep
from app.api.modules.content.schemas import AssetSearch, AssetSearchRequest
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, resolve_access,
)
from app.api.modules.search.assets import search_assets, stream_search_assets
from app.api.modules.search.web import (
    create_assets_from_results as compose_from_results,
    create_assets_from_urls as compose_from_urls,
    search_and_ingest as compose_search_and_ingest,
    search_web,
)
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Web search request / response shapes ─────────────────────────────────


class ExternalSearchRequest(BaseModel):
    query: str
    provider: str = "tavily"
    limit: int = 10
    infospace_id: int
    scrape_content: bool = True
    create_assets: bool = True
    bundle_id: Optional[int] = None
    api_key: Optional[str] = None
    provider_params: Optional[Dict[str, Any]] = None


class SelectiveAssetCreationRequest(BaseModel):
    """Request for creating assets from specific search result URLs."""

    urls: List[str]
    infospace_id: int
    bundle_id: Optional[int] = None
    scrape_content: bool = True
    search_metadata: Optional[Dict[str, Any]] = None


class DirectAssetCreationRequest(BaseModel):
    """Request for creating assets directly from search result data."""

    search_results: List[Dict[str, Any]]
    infospace_id: int
    bundle_id: Optional[int] = None
    search_metadata: Optional[Dict[str, Any]] = None


class SearchAndIngestResponse(BaseModel):
    query: str
    provider: str
    results_found: int
    results: Optional[List[dict]] = None
    assets_created: int = 0
    asset_ids: List[int] = []
    status: str
    message: str


# ─── Web search endpoints ─────────────────────────────────────────────────


@router.post("/web", response_model=SearchAndIngestResponse)
async def web_search_and_ingest(
    request: ExternalSearchRequest,
    make_ingestion_context: IngestionContextFactoryDep,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """Search via an external provider; optionally ingest results as assets."""

    resolve_access(db, request.infospace_id, current_user, Capability.INGEST)

    try:
        if request.create_assets:
            context = make_ingestion_context(
                current_user.id, request.infospace_id,
                {"limit": request.limit, "scrape_content": request.scrape_content},
            )
            raw_results, assets = await compose_search_and_ingest(
                context, request.query,
                provider=request.provider,
                limit=request.limit,
                runtime_key=request.api_key,
                provider_params=request.provider_params,
                bundle_id=request.bundle_id,
                scrape_content=request.scrape_content,
            )
            return SearchAndIngestResponse(
                query=request.query,
                provider=request.provider,
                results_found=len(raw_results),
                assets_created=len(assets),
                asset_ids=[a.id for a in assets],
                status="success",
                message=f"Created {len(assets)} assets from '{request.query}'",
            )

        raw_results = await search_web(
            db, request.infospace_id, request.query,
            provider=request.provider,
            limit=request.limit,
            runtime_key=request.api_key,
            provider_params=request.provider_params,
        )
        results_data = [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "score": r.get("score"),
                "raw": r.get("raw", r),
                **({"raw_content": r["raw_content"]} if "raw_content" in r else {}),
                **({"favicon": r["favicon"]} if "favicon" in r else {}),
                **({"published_date": r["published_date"]} if "published_date" in r else {}),
            }
            for r in raw_results
        ]
        return SearchAndIngestResponse(
            query=request.query,
            provider=request.provider,
            results_found=len(raw_results),
            results=results_data,
            assets_created=0,
            asset_ids=[],
            status="success",
            message=f"Found {len(raw_results)} search results for '{request.query}'",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Search and ingest failed for query '{request.query}'")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search and ingest failed: {e}",
        )


@router.post("/web/from-urls", response_model=SearchAndIngestResponse)
async def web_create_assets_from_urls(
    request: SelectiveAssetCreationRequest,
    make_ingestion_context: IngestionContextFactoryDep,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """Create assets from a specific URL list. Selective asset creation."""

    resolve_access(db, request.infospace_id, current_user, Capability.INGEST)

    try:
        context = make_ingestion_context(
            current_user.id, request.infospace_id,
            {"scrape_immediately": request.scrape_content,
             "search_metadata": request.search_metadata},
        )
        created_assets, failed_urls = await compose_from_urls(
            context, request.urls,
            bundle_id=request.bundle_id,
            scrape_content=request.scrape_content,
            search_metadata=request.search_metadata,
        )
        meta = request.search_metadata or {}
        message = f"Successfully created {len(created_assets)} assets"
        if failed_urls:
            message += f", {len(failed_urls)} URLs failed"
        return SearchAndIngestResponse(
            query=meta.get("query", "URL List"),
            provider=meta.get("provider", "direct"),
            results_found=len(request.urls),
            assets_created=len(created_assets),
            asset_ids=[a.id for a in created_assets],
            status="success" if not failed_urls else "partial_success",
            message=message,
        )
    except Exception as e:
        logger.exception("Bulk asset creation from URLs failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset creation failed: {e}",
        )


@router.post("/web/from-results", response_model=SearchAndIngestResponse)
async def web_create_assets_from_results(
    request: DirectAssetCreationRequest,
    make_ingestion_context: IngestionContextFactoryDep,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchAndIngestResponse:
    """Create assets directly from search-result dicts (no re-scrape)."""

    resolve_access(db, request.infospace_id, current_user, Capability.INGEST)

    try:
        context = make_ingestion_context(current_user.id, request.infospace_id, {})
        assets = await compose_from_results(
            context, request.search_results,
            bundle_id=request.bundle_id,
            search_metadata=request.search_metadata,
        )
        meta = request.search_metadata or {}
        failed_count = len(request.search_results) - len(assets)
        message = f"Successfully created {len(assets)} assets from search results"
        if failed_count > 0:
            message += f", {failed_count} results failed"
        return SearchAndIngestResponse(
            query=meta.get("query", "Search Results"),
            provider=meta.get("provider", "direct"),
            results_found=len(request.search_results),
            assets_created=len(assets),
            asset_ids=[a.id for a in assets],
            status="success" if not failed_count else "partial_success",
            message=message,
        )
    except Exception as e:
        logger.exception("Direct asset creation from results failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset creation failed: {e}",
        )


# ─── Asset search endpoints ───────────────────────────────────────────────
#
# One operation, two shapes — split into sibling paths so the SSE side uses
# FastAPI's native pipeline (``response_class=EventSourceResponse`` + async
# generator). The stream variant attaches 3 s keepalive pings via
# ``fastapi.sse._PING_INTERVAL`` (set in ``main.py``).


@router.post("/infospaces/{infospace_id}/assets", response_model=AssetSearch)
async def asset_search(
    *,
    infospace_id: int,
    body: AssetSearchRequest,
    access: Access = Requires(scope=None),
    db: Session = Depends(get_db),
):
    """Asset search — JSON envelope. Returns a full ``AssetSearch``.

    For a progressive ``StreamEvent`` feed, call
    ``POST /search/infospaces/{iid}/assets/stream`` with the same body.
    """
    return await search_assets(db, infospace_id, body, access=access)


@router.post(
    "/infospaces/{infospace_id}/assets/stream",
    response_class=EventSourceResponse,
)
async def asset_search_stream(
    *,
    infospace_id: int,
    body: AssetSearchRequest,
    access: Access = Requires(scope=None),
    db: Session = Depends(get_db),
):
    """Asset search — native SSE generator.

    Wire protocol: ``skeleton → section(role='primary') → count →
    section(role='grouped')* → done``. Each event name matches the discriminator
    in ``StreamEvent``.
    """
    async for ev in stream_search_assets(db, infospace_id, body, access=access):
        yield ServerSentEvent(data=ev, event=ev.name)
