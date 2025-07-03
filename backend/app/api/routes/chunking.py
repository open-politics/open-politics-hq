import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session

from app.api.deps import SessionDep, CurrentUser
from app.api.services.chunking_service import ChunkingService
from app.models import Asset, AssetKind
from app.schemas import (
    ChunkAssetRequest,
    ChunkAssetsRequest,
    ChunkingStatsResponse,
    ChunkingResultResponse,
    AssetChunkRead
)

router = APIRouter()
logger = logging.getLogger(__name__)

def get_chunking_service(session: SessionDep) -> ChunkingService:
    """Dependency to get chunking service."""
    return ChunkingService(session)

@router.post("/assets/{asset_id}/chunk", response_model=ChunkingResultResponse)
async def chunk_single_asset(
    asset_id: int,
    request: ChunkAssetRequest,
    current_user: CurrentUser,
    session: SessionDep,
    chunking_service: ChunkingService = Depends(get_chunking_service)
):
    """Chunk a single asset into text chunks."""
    try:
        # Get the asset
        asset = session.get(Asset, asset_id)
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        # Chunk the asset
        chunks = chunking_service.chunk_asset(
            asset=asset,
            strategy=request.strategy,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
            overwrite_existing=request.overwrite_existing
        )
        
        return ChunkingResultResponse(
            message=f"Successfully chunked asset {asset_id}",
            asset_id=asset_id,
            chunks_created=len(chunks),
            strategy_used=request.strategy,
            strategy_params={
                "chunk_size": request.chunk_size,
                "chunk_overlap": request.chunk_overlap
            }
        )
        
    except Exception as e:
        logger.error(f"Error chunking asset {asset_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to chunk asset: {str(e)}"
        )

@router.post("/assets/chunk-batch", response_model=Dict[str, Any])
async def chunk_multiple_assets(
    request: ChunkAssetsRequest,
    current_user: CurrentUser,
    session: SessionDep,
    chunking_service: ChunkingService = Depends(get_chunking_service)
):
    """Chunk multiple assets based on filters."""
    try:
        # Convert string asset kinds to enum
        asset_kinds = None
        if request.asset_kinds:
            asset_kinds = [AssetKind(kind) for kind in request.asset_kinds]
        
        results = chunking_service.chunk_assets_by_filter(
            asset_ids=request.asset_ids,
            asset_kinds=asset_kinds,
            infospace_id=request.infospace_id,
            strategy=request.strategy,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
            overwrite_existing=request.overwrite_existing
        )
        
        # Summarize results
        total_chunks = sum(len(chunks) for chunks in results.values())
        successful_assets = len([asset_id for asset_id, chunks in results.items() if chunks])
        failed_assets = len([asset_id for asset_id, chunks in results.items() if not chunks])
        
        return {
            "message": f"Chunked {len(results)} assets",
            "total_chunks_created": total_chunks,
            "successful_assets": successful_assets,
            "failed_assets": failed_assets,
            "results": {str(asset_id): len(chunks) for asset_id, chunks in results.items()},
            "strategy_used": request.strategy
        }
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error chunking multiple assets: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to chunk assets: {str(e)}"
        )

@router.get("/assets/{asset_id}/chunks", response_model=List[AssetChunkRead])
async def get_asset_chunks(
    asset_id: int,
    current_user: CurrentUser,
    session: SessionDep
):
    """Get all chunks for a specific asset."""
    try:
        # Verify asset exists
        asset = session.get(Asset, asset_id)
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        from sqlmodel import select
        from app.models import AssetChunk
        
        chunks = session.exec(
            select(AssetChunk).where(AssetChunk.asset_id == asset_id).order_by(AssetChunk.chunk_index)
        ).all()
        
        return chunks
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting chunks for asset {asset_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve asset chunks"
        )

@router.get("/stats", response_model=ChunkingStatsResponse)
async def get_chunking_statistics(
    current_user: CurrentUser,
    asset_id: Optional[int] = Query(None, description="Filter by specific asset"),
    infospace_id: Optional[int] = Query(None, description="Filter by infospace"),
    chunking_service: ChunkingService = Depends(get_chunking_service)
):
    """Get chunking statistics."""
    try:
        stats = chunking_service.get_chunk_statistics(
            asset_id=asset_id,
            infospace_id=infospace_id
        )
        
        return ChunkingStatsResponse(**stats)
        
    except Exception as e:
        logger.error(f"Error getting chunking statistics: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get chunking statistics"
        )

@router.delete("/assets/{asset_id}/chunks")
async def remove_asset_chunks(
    asset_id: int,
    current_user: CurrentUser,
    session: SessionDep,
    chunking_service: ChunkingService = Depends(get_chunking_service)
):
    """Remove all chunks for an asset."""
    try:
        # Verify asset exists
        asset = session.get(Asset, asset_id)
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        count = chunking_service.remove_chunks_for_asset(asset_id)
        
        return {
            "message": f"Removed {count} chunks for asset {asset_id}",
            "asset_id": asset_id,
            "chunks_removed": count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing chunks for asset {asset_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove asset chunks"
        ) 