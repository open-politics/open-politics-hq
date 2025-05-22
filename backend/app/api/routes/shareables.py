import logging
import os
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, status, Form, Body, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse

from app.api.deps import CurrentUser, ShareableServiceDep, OptionalUser, SessionDep, get_shareable_service
from app.models import (
    ShareableLink,
    ShareableLinkCreate,
    ShareableLinkUpdate,
    ShareableLinkRead,
    ShareableLinkStats,
    ResourceType,
    PermissionLevel,
    Message,
    DatasetPackageSummary
)
from app.api.services.shareable import ShareableService
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shareables", tags=["shareables"])


# --- Request Model for Batch Export ---
class ExportBatchRequest(BaseModel):
    resource_type: ResourceType
    resource_ids: List[int]
# --- End Request Model ---


@router.post("/", response_model=ShareableLinkRead, status_code=status.HTTP_201_CREATED)
def create_shareable_link(
    link_data: ShareableLinkCreate,
    current_user: CurrentUser,
    service: ShareableServiceDep,
):
    """
    Create a new shareable link for a resource.
    Transaction managed by SessionDep within the service dependency.
    """
    try:
        link = service.create_link(
            user_id=current_user.id,
            link_data=link_data,
        )
        return ShareableLinkRead.model_validate(link)
    except ValueError as ve:
        logger.error(f"Route: Error creating shareable link: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating shareable link: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("/", response_model=List[ShareableLinkRead])
def get_shareable_links(
    current_user: CurrentUser,
    service: ShareableServiceDep,
    resource_type: Optional[ResourceType] = Query(None, description="Filter by resource type"),
    resource_id: Optional[int] = Query(None, description="Filter by resource ID")
):
    """
    Get all shareable links for the current user.
    Can be filtered by resource_type and resource_id.
    """
    links = service.get_links(
        user_id=current_user.id,
        resource_type=resource_type,
        resource_id=resource_id
    )
    return [ShareableLinkRead.model_validate(link) for link in links]


@router.get("/stats", response_model=ShareableLinkStats)
def get_shareable_link_stats(
    current_user: CurrentUser,
    service: ShareableServiceDep,
):
    """
    Get statistics about shareable links for the current user.
    """
    stats = service.get_link_stats(user_id=current_user.id)
    return stats


@router.get("/{link_id}", response_model=ShareableLinkRead)
def get_shareable_link(
    link_id: int,
    current_user: CurrentUser,
    service: ShareableServiceDep,
):
    """
    Get a specific shareable link by ID.
    """
    link = service.get_link_by_id(link_id=link_id, user_id=current_user.id)

    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shareable link not found or not accessible")

    return ShareableLinkRead.model_validate(link)


@router.put("/{link_id}", response_model=ShareableLinkRead)
def update_shareable_link(
    current_user: CurrentUser,
    service: ShareableServiceDep,
    link_id: int,
    update_data: ShareableLinkUpdate
):
    """
    Update a shareable link by ID.
    Transaction managed by SessionDep.
    """
    update_dict = update_data.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No update data provided.")

    try:
        updated_link = service.update_link(
            link_id=link_id,
            user_id=current_user.id,
            update_data=update_data,
        )

        if not updated_link:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shareable link not found or update failed")

        return ShareableLinkRead.model_validate(updated_link)
    except ValueError as ve:
        logger.error(f"Route: Error updating shareable link {link_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.exception(f"Route: Unexpected error updating shareable link {link_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.delete("/{link_id}", response_model=Message, status_code=status.HTTP_200_OK)
def delete_shareable_link(
    link_id: int,
    current_user: CurrentUser,
    service: ShareableServiceDep,
):
    """
    Delete a shareable link by ID.
    Transaction managed by SessionDep.
    """
    try:
        success = service.delete_link(
            link_id=link_id,
            user_id=current_user.id,
        )

        if not success:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shareable link not found or cannot be deleted")

        return Message(message="Shareable link deleted successfully")
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error deleting shareable link {link_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("/access/{token}")
def access_shared_resource(
    token: str,
    service: ShareableServiceDep,
    current_user: OptionalUser
):
    """
    Access a shared resource using its token.
    Can be accessed with or without authentication depending on the link settings.
    Authentication errors are suppressed to allow access to public resources.
    """
    user_id = current_user.id if current_user else None

    try:
        resource_data = service.access_shared_resource(
            token=token,
            requesting_user_id=user_id
        )
        return resource_data
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception(f"Error accessing shared resource via token {token[:6]}...: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error accessing shared resource")


@router.post("/export", response_class=FileResponse)
async def export_resource(
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
    service: ShareableServiceDep,
    resource_type: ResourceType = Form(...),
    resource_id: int = Form(...),
):
    """
    Export a resource to a file.
    Returns a file download.
    """
    try:
        filepath, filename = await service.export_resource(
            user_id=current_user.id,
            resource_type=resource_type,
            resource_id=resource_id
        )
        background_tasks.add_task(service._cleanup_temp_file, filepath)
        return FileResponse(
            path=filepath,
            filename=filename,
            media_type="application/json",
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception(f"Error exporting resource {resource_type.value} ID {resource_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error exporting resource")


@router.post("/import/{workspace_id}")
async def import_resource(
    workspace_id: int,
    current_user: CurrentUser,
    service: ShareableServiceDep,
    file: UploadFile = File(...)
):
    """
    Import a resource from a file into a specific workspace.
    Transaction managed by SessionDep within the service dependency.
    """
    if not file.filename or not (file.filename.lower().endswith(".json") or file.filename.lower().endswith(".zip")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type. Only JSON or ZIP files are supported for this endpoint.")

    try:
        result = await service.import_resource(
            user_id=current_user.id,
            workspace_id=workspace_id,
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
    "/export-batch",
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
    request_data: ExportBatchRequest,
    current_user: CurrentUser,
    service: ShareableServiceDep,
    background_tasks: BackgroundTasks,
):
    """Export multiple resources of the same type to a ZIP archive."""
    try:
        temp_zip_path, zip_filename = await service.export_resources_batch(
            user_id=current_user.id,
            resource_type=request_data.resource_type,
            resource_ids=request_data.resource_ids
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