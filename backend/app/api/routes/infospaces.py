"""Routes for infospaces."""
import logging
import tempfile
import os
from typing import Any, List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status, File, UploadFile, BackgroundTasks
from fastapi.responses import FileResponse

from app.models import (
    Infospace,
    User,
)
from app.schemas import (
    InfospaceRead,
    InfospaceCreate,
    InfospaceUpdate,
    InfospacesOut,
)
from app.api.deps import (
    CurrentUser,
    get_infospace_service
)
from app.api.services.infospace_service import InfospaceService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["Infospaces"]
)

@router.post("", response_model=InfospaceRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=InfospaceRead, status_code=status.HTTP_201_CREATED)
def create_infospace(
    *,
    current_user: CurrentUser,
    infospace_in: InfospaceCreate,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> InfospaceRead:
    """
    Create a new Infospace.
    """
    logger.info(f"Route: Creating infospace for user {current_user.id}")
    try:
        infospace = infospace_service.create_infospace(
            user_id=current_user.id,
            infospace_in=infospace_in
        )
        return InfospaceRead.model_validate(infospace)
    except Exception as e:
        logger.exception(f"Route: Error creating infospace: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("", response_model=InfospacesOut)
@router.get("/", response_model=InfospacesOut)
def list_infospaces(
    *,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Retrieve Infospaces for the current user.
    """
    try:
        infospaces, total_count = infospace_service.list_infospaces(
            user_id=current_user.id,
            skip=skip,
            limit=limit
        )
        
        result_infospaces = [
            InfospaceRead.model_validate(infospace)
            for infospace in infospaces
        ]
        
        return InfospacesOut(data=result_infospaces, count=total_count)
    except Exception as e:
        logger.exception(f"Route: Error listing infospaces: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{infospace_id}", response_model=InfospaceRead)
def get_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Retrieve a specific Infospace by its ID.
    """
    try:
        infospace = infospace_service.get_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        if not infospace:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Infospace not found"
            )
        return InfospaceRead.model_validate(infospace)
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{infospace_id}", response_model=InfospaceRead)
def update_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_in: InfospaceUpdate,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Update an Infospace.
    """
    logger.info(f"Route: Updating Infospace {infospace_id}")
    try:
        infospace = infospace_service.update_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id,
            infospace_in=infospace_in
        )
        if not infospace:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Infospace not found"
            )
        return InfospaceRead.model_validate(infospace)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error updating infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{infospace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> None:
    """
    Delete an Infospace.
    """
    logger.info(f"Route: Attempting to delete Infospace {infospace_id}")
    try:
        success = infospace_service.delete_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Infospace not found"
            )
        logger.info(f"Route: Infospace {infospace_id} successfully deleted")
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error deleting infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

@router.get("/{infospace_id}/stats", response_model=dict)
def get_infospace_stats(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Get statistics about an Infospace.
    """
    try:
        stats = infospace_service.get_infospace_stats(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        return stats
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.exception(f"Route: Error getting stats for infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.post("/{infospace_id}/export", response_class=FileResponse)
async def export_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    include_sources: bool = Query(True, description="Include sources and their assets"),
    include_schemas: bool = Query(True, description="Include annotation schemas"),
    include_runs: bool = Query(True, description="Include annotation runs"),
    include_datasets: bool = Query(True, description="Include datasets"),
    include_chunks: bool = Query(False, description="Include asset chunks (text segments)"),
    include_embeddings: bool = Query(False, description="Include vector embeddings (can be large)"),
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Export an infospace as a self-contained ZIP package.
    
    This creates an immediate download of the infospace with all its contents.
    For scheduled/async backups, use the /backups endpoints instead.
    """
    logger.info(f"Route: Exporting infospace {infospace_id} for user {current_user.id}")
    
    try:
        # Export the infospace to a package
        package = await infospace_service.export_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id,
            include_sources=include_sources,
            include_schemas=include_schemas,
            include_runs=include_runs,
            include_datasets=include_datasets,
            include_assets_for_sources=include_sources,
            include_annotations_for_runs=include_runs,
            include_chunks=include_chunks,
            include_embeddings=include_embeddings
        )
        
        # Get infospace name for filename
        infospace = infospace_service.get_infospace(infospace_id, current_user.id)
        safe_name = "".join(c for c in infospace.name if c.isalnum() or c in (' ', '-', '_')).rstrip()
        safe_name = safe_name.replace(' ', '_')
        
        # Create a temporary file for the ZIP
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as temp_file:
            temp_path = temp_file.name
        
        try:
            # Write the package to the ZIP file
            package.to_zip(temp_path)
            
            # Return the file for download
            filename = f"infospace_{safe_name}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
            
            logger.info(f"Route: Successfully created export package for infospace {infospace_id}, size: {os.path.getsize(temp_path)} bytes")
            
            # Create background task for cleanup
            from starlette.background import BackgroundTask
            
            def cleanup_temp_file():
                try:
                    if os.path.exists(temp_path):
                        os.unlink(temp_path)
                        logger.debug(f"Cleaned up temp file: {temp_path}")
                except Exception as e:
                    logger.error(f"Error cleaning up temp file {temp_path}: {e}")
            
            return FileResponse(
                path=temp_path,
                filename=filename,
                media_type="application/zip",
                background=BackgroundTask(cleanup_temp_file)
            )
        
        except Exception as e:
            # Clean up temp file on error
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
    
    except ValueError as e:
        logger.error(f"Route: Validation error exporting infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Route: Error exporting infospace {infospace_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export infospace: {str(e)}"
        )


@router.post("/import", response_model=InfospaceRead)
async def import_infospace(
    *,
    current_user: CurrentUser,
    file: UploadFile = File(..., description="Infospace package file (.zip)"),
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Import an Infospace from a ZIP package file.
    
    This will create a new infospace with all the contents from the package.
    """
    logger.info(f"Route: Importing infospace for user {current_user.id} from file {file.filename}")
    
    # Create a temporary file to store the upload
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as temp_file:
        temp_path = temp_file.name
        content = await file.read()
        temp_file.write(content)
    
    try:
        # Import the infospace
        infospace = await infospace_service.import_infospace(
            user_id=current_user.id,
            filepath=temp_path
        )
        
        logger.info(f"Route: Successfully imported infospace {infospace.id} for user {current_user.id}")
        return InfospaceRead.model_validate(infospace)
    
    except ValueError as e:
        logger.error(f"Route: Validation error importing infospace: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Error importing infospace: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import infospace: {str(e)}"
        )
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            os.unlink(temp_path)  