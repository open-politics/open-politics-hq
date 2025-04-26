import logging
from typing import List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, status
from fastapi.responses import JSONResponse, FileResponse

from app.api.deps import CurrentUser, ShareableServiceDep, OptionalUser, SessionDep 
from app.models import (
    ShareableLink,
    ShareableLinkCreate,
    ShareableLinkUpdate,
    ShareableLinkRead,
    ShareableLinkStats,
    ResourceType,
    PermissionLevel,
    Message
)
from app.api.services.shareable import ShareableService
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shareables", tags=["shareables"])


@router.post("/", response_model=ShareableLinkRead, status_code=status.HTTP_201_CREATED)
def create_shareable_link(
    link_data: ShareableLinkCreate,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Create a new shareable link for a resource.
    Transaction managed by SessionDep.
    """
    try:
        service = ShareableService(session=session)
        link = service.create_link(
            user_id=current_user.id,
            link_data=link_data,
        )
        return link
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
    session: SessionDep,
    resource_type: Optional[ResourceType] = Query(None, description="Filter by resource type"),
    resource_id: Optional[int] = Query(None, description="Filter by resource ID")
):
    """
    Get all shareable links for the current user.
    Can be filtered by resource_type and resource_id.
    """
    service = ShareableService(session=session)
    links = service.get_links(
        user_id=current_user.id,
        resource_type=resource_type,
        resource_id=resource_id
    )
    return links


@router.get("/stats", response_model=ShareableLinkStats)
def get_shareable_link_stats(
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Get statistics about shareable links for the current user.
    """
    service = ShareableService(session=session)
    stats = service.get_link_stats(user_id=current_user.id)
    return stats


@router.get("/{link_id}", response_model=ShareableLinkRead)
def get_shareable_link(
    link_id: int,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Get a specific shareable link by ID.
    """
    service = ShareableService(session=session)
    link = service.get_link_by_id(link_id=link_id, user_id=current_user.id)

    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shareable link not found or not accessible")

    return link


@router.put("/{link_id}", response_model=ShareableLinkRead)
def update_shareable_link(
    link_id: int,
    update_data: ShareableLinkUpdate,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Update a shareable link by ID.
    Transaction managed by SessionDep.
    """
    update_dict = update_data.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No update data provided.")

    try:
        service = ShareableService(session=session)
        updated_link = service.update_link(
            link_id=link_id,
            user_id=current_user.id,
            update_data=update_data,
        )

        if not updated_link:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shareable link not found or update failed")

        return updated_link
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
    session: SessionDep,
):
    """
    Delete a shareable link by ID.
    Transaction managed by SessionDep.
    """
    try:
        service = ShareableService(session=session)
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
    session: SessionDep,
    current_user: OptionalUser
):
    """
    Access a shared resource using its token.
    Can be accessed with or without authentication depending on the link settings.
    Authentication errors are suppressed to allow access to public resources.
    """
    user_id = current_user.id if current_user else None

    try:
        service = ShareableService(session=session)
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


@router.post("/export")
async def export_resource(
    resource_type: ResourceType,
    resource_id: int,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Export a resource to a file.
    Returns a file download.
    """
    try:
        service = ShareableService(session=session)
        filepath, filename = await service.export_resource(
            user_id=current_user.id,
            resource_type=resource_type,
            resource_id=resource_id
        )
        return FileResponse(
            path=filepath,
            filename=filename,
            media_type="application/json",
            background=lambda: service._cleanup_temp_file(filepath)
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
    session: SessionDep,
    file: UploadFile = File(...)
):
    """
    Import a resource from a file into a specific workspace.
    Transaction managed by SessionDep.
    """
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type. Only JSON files are supported")

    try:
        service = ShareableService(session=session)
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