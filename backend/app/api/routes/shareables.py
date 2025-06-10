import logging
import os
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, status, Form, Body, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from sqlmodel import Session

from app.api import deps
from app.api.deps import CurrentUser, ShareableServiceDep, OptionalUser, SessionDep, get_shareable_service
from app.models import (
    ShareableLink,
    ResourceType,
    PermissionLevel,
    Infospace,
)
from app.schemas import (
    ShareableLinkCreate,
    ShareableLinkUpdate,
    ShareableLinkRead,
    ShareableLinkStats,
    Message,
    DatasetPackageSummary,
    Paginated
)

from app.api.services.shareable_service import ShareableService
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shareables", tags=["shareables"])


# --- Request Model for Batch Export ---
class ExportBatchRequest(BaseModel):
    resource_type: ResourceType
    resource_ids: List[int]
# --- End Request Model ---


@router.post("/{infospace_id}/links", response_model=ShareableLinkRead)
def create_shareable_link(
    infospace_id: int,
    link_in: ShareableLinkCreate,
    service: ShareableServiceDep,
    current_user: CurrentUser
) -> ShareableLink:
    """Create a new shareable link for a resource within an infospace."""
    try:
        link = service.create_link(
            user_id=current_user.id,
            link_data=link_in,
            infospace_id=infospace_id
        )
        return link
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error creating shareable link via service: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not create shareable link.")


@router.get("/{infospace_id}/links", response_model=Paginated)
def get_shareable_links(
    infospace_id: int,
    current_user: CurrentUser,
    service: ShareableServiceDep,
    resource_type: Optional[ResourceType] = Query(None),
    resource_id: Optional[int] = Query(None)
) -> Paginated:
    """Get shareable links for the current user, optionally filtered by resource and infospace."""
    links = service.get_links(
        user_id=current_user.id,
        resource_type=resource_type,
        resource_id=resource_id,
        infospace_id=infospace_id
    )
    return Paginated(data=[ShareableLinkRead.model_validate(link) for link in links], count=len(links))


@router.get("/links/{token}", response_model=ShareableLinkRead)
def get_shareable_link_by_token(
    token: str,
    service: ShareableServiceDep
) -> ShareableLink:
    """Get a shareable link by token."""
    link = service.get_link_by_token(token)
    if not link:
        raise HTTPException(status_code=404, detail="Shareable link not found")
    return link


@router.put("/links/{link_id}", response_model=ShareableLinkRead)
def update_shareable_link(
    link_id: int,
    link_in: ShareableLinkUpdate,
    current_user: CurrentUser,
    service: ShareableServiceDep
) -> ShareableLink:
    """Update a shareable link by its ID (owner only)."""
    try:
        updated_link = service.update_link(
            link_id=link_id,
            user_id=current_user.id,
            update_data=link_in
        )
        if not updated_link:
            raise HTTPException(status_code=404, detail="Shareable link not found or not owned by user.")
        return updated_link
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shareable_link(
    link_id: int,
    current_user: CurrentUser,
    service: ShareableServiceDep
):
    """Delete a shareable link by its ID (owner only)."""
    success = service.delete_link(link_id=link_id, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Shareable link not found or not owned by user.")
    return None


@router.get("/access/{token}", response_model=Dict[str, Any])
def access_shared_resource(
    token: str,
    service: ShareableServiceDep,
    requesting_user: OptionalUser
) -> Dict[str, Any]:
    """Access the resource associated with a shareable link token."""
    try:
        user_id_if_any = requesting_user.id if requesting_user else None
        resource_data = service.access_shared_resource(
            token=token,
            requesting_user_id=user_id_if_any
        )
        return resource_data
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error accessing resource for token {token[:6]}...: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not access shared resource.")


@router.get("/{infospace_id}/stats", response_model=ShareableLinkStats)
def get_sharing_stats(
    infospace_id: int,
    current_user: CurrentUser,
    service: ShareableServiceDep,
):
    """Get sharing statistics for the current user within a specific infospace."""
    stats = service.get_link_stats(user_id=current_user.id, infospace_id=infospace_id)
    return stats


@router.post("/{infospace_id}/export", response_class=FileResponse)
async def export_resource(
    infospace_id: int,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
    service: ShareableServiceDep,
    resource_type: ResourceType = Form(...),
    resource_id: int = Form(...),
):
    """
    Export a resource from a specific infospace to a file.
    Returns a file download.
    """
    try:
        filepath, filename = await service.export_resource(
            user_id=current_user.id,
            resource_type=resource_type,
            resource_id=resource_id,
            infospace_id=infospace_id
        )
        background_tasks.add_task(service._cleanup_temp_file, filepath)
        media_type = "application/zip" if filepath.endswith(".zip") else "application/json"
        return FileResponse(
            path=filepath,
            filename=filename,
            media_type=media_type,
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception(f"Error exporting resource {resource_type.value} ID {resource_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error exporting resource")


@router.post("/import/{target_infospace_id}")
async def import_resource(
    target_infospace_id: int,
    current_user: CurrentUser,
    service: ShareableServiceDep,
    file: UploadFile = File(...)
):
    """
    Import a resource from a file into a specific infospace.
    """
    if not file.filename or not (file.filename.lower().endswith(".json") or file.filename.lower().endswith(".zip")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type. Only JSON or ZIP files are supported for this endpoint.")

    try:
        result = await service.import_resource(
            user_id=current_user.id,
            target_infospace_id=target_infospace_id,
            file=file
        )
        return result
    except ValueError as ve:
        logger.error(f"Route: Error importing resource: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception(f"Route: Unexpected error importing resource: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error importing resource")


# --- New Batch Export Route ---
@router.post(
    "/{infospace_id}/export-batch",
    response_class=FileResponse,
    responses={
        200: {
            "description": "Successful batch export, returns a ZIP archive.",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        },
        400: {"description": "Bad Request (e.g., no resource IDs)"},
        403: {"description": "Forbidden (e.g., permission denied for one or more resources)"},
        422: {"description": "Validation Error"},
        500: {"description": "Internal Server Error"},
    },
)
async def export_resources_batch(
    infospace_id: int,
    request_data: ExportBatchRequest,
    current_user: CurrentUser,
    service: ShareableServiceDep,
    background_tasks: BackgroundTasks,
):
    """Export multiple resources of the same type to a ZIP archive."""
    try:
        temp_zip_path, zip_filename = await service.export_resources_batch(
            user_id=current_user.id,
            rt=request_data.resource_type,
            r_ids=request_data.resource_ids,
            inf_id=infospace_id
        )
        background_tasks.add_task(service._cleanup_temp_file, temp_zip_path)
        return FileResponse(
            path=temp_zip_path,
            filename=zip_filename,
            media_type='application/zip',
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Batch export failed for {request_data.resource_type}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to export resources batch: {str(e)}")
# --- End New Route ---

# --- NEW ENDPOINT: View Dataset Package Summary ---
@router.get("/view_dataset_package_summary/{token}", response_model=DatasetPackageSummary)
async def view_dataset_package_summary(
    token: str,
    service: ShareableServiceDep,
    current_user: OptionalUser # Allow anonymous access if link permits
):
    """
    Get a summary of a shared dataset package using its token.
    Does not trigger a full download or import of the package data.
    """
    user_id = current_user.id if current_user else None
    logger.info(f"Route: User '{user_id if user_id else 'Anonymous'}' requesting summary for dataset package token: {token[:6]}...")
    try:
        summary = await service.get_dataset_package_summary_from_token(
            requesting_user_id=user_id,
            token=token
        )
        return summary
    except ValueError as ve:
        logger.warning(f"Route: Validation error getting dataset package summary for token {token[:6]}...: {ve}")
        # ValueError from service could mean token invalid, wrong type, or issue fetching/processing package data
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except RuntimeError as re:
        logger.error(f"Route: Runtime error getting dataset package summary for token {token[:6]}...: {re}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(re))
    except HTTPException as he:
        # Re-raise other known HTTP exceptions (e.g., from access_shared_resource if token is 404/403)
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error getting dataset package summary for token {token[:6]}...: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error while generating package summary.")
# --- END NEW ENDPOINT ---