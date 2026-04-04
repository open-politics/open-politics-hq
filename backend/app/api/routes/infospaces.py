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
    InvitationCreate,
    InvitationOut,
    CollaboratorOut,
)
from app.api.dependency_injection import (
    CurrentUser,
    SessionDep,
    get_infospace_service,
    PackageServiceDep,
)
from app.api.modules.identity_infospace_user.services import InfospaceService
from app.api.modules.identity_infospace_user.services import invitation_service
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)
from app.api.modules.identity_infospace_user.models import CollaboratorRole

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
    Retrieve Infospaces for the current user (owned + collaborated, with role context).
    """
    try:
        rows, total_count = infospace_service.list_infospaces(
            user_id=current_user.id,
            skip=skip,
            limit=limit
        )

        result_infospaces = []
        for infospace, role, is_owner in rows:
            item = InfospaceRead.model_validate(infospace)
            item.current_user_role = role
            item.is_owner = is_owner
            result_infospaces.append(item)

        return InfospacesOut(data=result_infospaces, count=total_count)
    except Exception as e:
        logger.exception(f"Route: Error listing infospaces: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{infospace_id}", response_model=InfospaceRead)
def get_infospace(
    *,
    access: Access = Requires(scope=None),
) -> Any:
    """
    Retrieve a specific Infospace by its ID (with role context for the current user).
    """
    item = InfospaceRead.model_validate(access.infospace)
    item.current_user_role = access.role.value if access.role else None
    item.is_owner = access.is_owner
    return item

@router.patch("/{infospace_id}", response_model=InfospaceRead)
def update_infospace(
    *,
    infospace_in: InfospaceUpdate,
    infospace_service: InfospaceService = Depends(get_infospace_service),
    access: Access = Requires(Capability.SETUP, scope=None),
) -> Any:
    """
    Update an Infospace.
    """
    logger.info(f"Route: Updating Infospace {access.infospace_id}")
    try:
        infospace = infospace_service.update_infospace(
            infospace_id=access.infospace_id,
            user_id=access.user_id,
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
        logger.exception(f"Route: Error updating infospace {access.infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{infospace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_infospace(
    *,
    infospace_service: InfospaceService = Depends(get_infospace_service),
    access: Access = Requires(Capability.SETUP, scope=None),
) -> None:
    """
    Delete an Infospace.
    """
    logger.info(f"Route: Attempting to delete Infospace {access.infospace_id}")
    try:
        success = infospace_service.delete_infospace(
            infospace_id=access.infospace_id,
            user_id=access.user_id
        )
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Infospace not found"
            )
        logger.info(f"Route: Infospace {access.infospace_id} successfully deleted")
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error deleting infospace {access.infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

# ============================================================================
# INVITATIONS
# ============================================================================

@router.post("/{infospace_id}/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def send_invitation(
    *,
    body: InvitationCreate,
    session: SessionDep,
    access: Access = Requires(Capability.SETUP, scope=None),
) -> Any:
    """Invite a user by handle or email to collaborate on this infospace."""
    try:
        inv = invitation_service.create_invitation(
            session=session,
            infospace_id=access.infospace_id,
            inviter_id=access.user_id,
            identifier=body.identifier,
            role=body.role,
        )
        return InvitationOut.from_db(inv, session)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/{infospace_id}/invitations", response_model=list[InvitationOut])
def list_invitations(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.SETUP, scope=None),
) -> Any:
    """List all invitations for this infospace (owner/setup view)."""
    invitations = invitation_service.list_infospace_invitations(session, access.infospace_id)
    return [InvitationOut.from_db(inv, session) for inv in invitations]


@router.delete("/{infospace_id}/invitations/{invitation_id}")
def revoke_invitation_route(
    *,
    invitation_id: int,
    session: SessionDep,
    access: Access = Requires(Capability.SETUP, scope=None),
) -> Any:
    """Revoke a pending invitation."""
    try:
        invitation_service.revoke_invitation(session, invitation_id, access.infospace_id)
        return {"message": "Invitation revoked"}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ============================================================================
# COLLABORATORS
# ============================================================================

@router.get("/{infospace_id}/collaborators", response_model=list[CollaboratorOut])
def list_collaborators(
    *,
    infospace_service: InfospaceService = Depends(get_infospace_service),
    access: Access = Requires(scope=None),
) -> Any:
    """List collaborators for an infospace."""
    collabs = infospace_service.list_collaborators(
        infospace_id=access.infospace_id,
        user_id=access.user_id,
    )
    return [
        CollaboratorOut(
            user_id=u.id,
            handle=u.handle,
            full_name=u.full_name,
            profile_picture_url=u.profile_picture_url,
            role=role,
            is_owner=(role == "owner"),
        )
        for c, u, role in collabs
    ]


@router.patch("/{infospace_id}/collaborators/{user_id}/role")
def change_collaborator_role(
    *,
    user_id: int,
    role: CollaboratorRole = Query(..., description="New role"),
    infospace_service: InfospaceService = Depends(get_infospace_service),
    access: Access = Requires(Capability.SETUP, scope=None),
) -> Any:
    """Change a collaborator's role. Only owner/setup can do this."""
    if role == CollaboratorRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot assign owner role via this endpoint")
    try:
        infospace_service.change_collaborator_role(
            infospace_id=access.infospace_id,
            changer_user_id=access.user_id,
            target_user_id=user_id,
            new_role=role,
        )
        return {"message": "Role updated"}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/{infospace_id}/collaborators/me")
def leave_infospace(
    *,
    infospace_service: InfospaceService = Depends(get_infospace_service),
    access: Access = Requires(scope=None),
) -> Any:
    """Leave an infospace (self-removal). Owner cannot leave."""
    try:
        infospace_service.leave_infospace(
            infospace_id=access.infospace_id,
            user_id=access.user_id,
        )
        return {"message": "Left infospace"}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/{infospace_id}/collaborators/{user_id}")
def remove_collaborator(
    *,
    user_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service),
    access: Access = Requires(Capability.SETUP, scope=None),
) -> Any:
    """Remove a collaborator from an infospace."""
    try:
        infospace_service.remove_collaborator(
            infospace_id=access.infospace_id,
            remover_user_id=access.user_id,
            collaborator_user_id=user_id,
        )
        return {"message": "Collaborator removed"}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))



@router.get("/{infospace_id}/stats", response_model=dict)
def get_infospace_stats(
    *,
    infospace_service: InfospaceService = Depends(get_infospace_service),
    access: Access = Requires(scope=None),
) -> Any:
    """
    Get statistics about an Infospace.
    """
    try:
        stats = infospace_service.get_infospace_stats(
            infospace_id=access.infospace_id,
            user_id=access.user_id
        )
        return stats
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.exception(f"Route: Error getting stats for infospace {access.infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.post("/{infospace_id}/export", response_class=FileResponse, status_code=200)
async def export_infospace(
    *,
    include_sources: bool = Query(True, description="Include sources and their assets"),
    access: Access = Requires(scope=None),
    include_schemas: bool = Query(True, description="Include annotation schemas"),
    include_runs: bool = Query(True, description="Include annotation runs"),
    include_datasets: bool = Query(True, description="Include datasets"),
    include_chunks: bool = Query(False, description="Include asset chunks (text segments)"),
    include_embeddings: bool = Query(False, description="Include vector embeddings (can be large)"),
    infospace_service: InfospaceService = Depends(get_infospace_service),
    package_service: PackageServiceDep,
) -> Any:
    """
    Export an infospace as a self-contained ZIP package.
    
    This creates an immediate download of the infospace with all its contents.
    For scheduled/async backups, use the /backups endpoints instead.
    """
    infospace_id = access.infospace_id
    logger.info(f"Route: Exporting infospace {infospace_id} for user {access.user_id}")

    try:
        infospace = access.infospace

        package = await package_service.export_infospace(
            infospace=infospace,
            user_id=access.user_id,
            include_sources=include_sources,
            include_schemas=include_schemas,
            include_runs=include_runs,
            include_datasets=include_datasets,
            include_assets_for_sources=include_sources,
            include_annotations_for_runs=include_runs,
            include_chunks=include_chunks,
            include_embeddings=include_embeddings,
        )
        
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
    infospace_service: InfospaceService = Depends(get_infospace_service),
    package_service: PackageServiceDep,
) -> Any:
    """
    Import an Infospace from a ZIP package file.
    
    This will create a new infospace with all the contents from the package.
    """
    logger.info(f"Route: Importing infospace for user {current_user.id} from file {file.filename}")
    
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as temp_file:
        temp_path = temp_file.name
        content = await file.read()
        temp_file.write(content)
    
    try:
        infospace = await package_service.import_infospace(
            user_id=current_user.id,
            filepath=temp_path,
            infospace_service=infospace_service,
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