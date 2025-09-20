from typing import Any, Dict
from urllib.parse import urlencode, quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Form
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from app import crud
from app.api.deps import CurrentUser, SessionDep, OptionalUser
from app.core.config import settings
from app.core.sso import (
    generate_discourse_login_url,
    generate_sso_response,
    validate_sso_request,
)
from app.models import User
from app.schemas import Message

router = APIRouter(prefix="/sso", tags=["SSO"])


@router.get("/discourse/login")
def initiate_discourse_login() -> RedirectResponse:
    """
    Convenience endpoint to redirect users to Discourse login.
    When they click "Log In" on Discourse, Discourse will automatically
    redirect back to our /callback endpoint to handle SSO.
    """
    if not settings.DISCOURSE_CONNECT_ENABLED:
        raise HTTPException(status_code=404, detail="Discourse Connect is not enabled")
    
    # Simply redirect to Discourse login page
    # Discourse will handle the SSO flow and redirect to our callback
    discourse_login_url = generate_discourse_login_url()
    
    return RedirectResponse(url=discourse_login_url)


@router.get("/discourse/callback")
def handle_discourse_sso(
    request: Request,
    session: SessionDep,
    sso: str = Query(..., description="SSO payload from Discourse"),
    sig: str = Query(None, description="Signature from Discourse"),
) -> RedirectResponse:
    """
    Handle SSO callback from Discourse.
    Since this is a server-to-server redirect, we can't rely on JWT tokens.
    Instead, redirect to a frontend page that can handle the authentication.
    """
    if not settings.DISCOURSE_CONNECT_ENABLED:
        raise HTTPException(status_code=404, detail="Discourse Connect is not enabled")
    
    if not sig:
        raise HTTPException(status_code=400, detail="Missing signature parameter")
    
    try:
        # Validate the SSO request (this ensures it's a legitimate request from Discourse)
        sso_data = validate_sso_request(sso, sig)
        nonce = sso_data.get('nonce')
        
        if not nonce:
            raise HTTPException(status_code=400, detail="Missing nonce in SSO request")
        
        # Redirect to frontend page that can handle authentication and SSO completion
        # Pass the original SSO parameters so frontend can complete the flow
        sso_complete_url = f"/accounts/login/sso-complete?sso={sso}&sig={sig}"
        return RedirectResponse(url=sso_complete_url, status_code=302)
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"SSO validation failed: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SSO processing failed: {str(e)}")


@router.get("/discourse/logout")
def handle_discourse_logout(
    session: SessionDep,
    current_user: CurrentUser
) -> Message:
    """
    Handle logout from Discourse.
    This is called when a user logs out from Discourse to also log them out of your app.
    """
    if not settings.DISCOURSE_CONNECT_ENABLED:
        raise HTTPException(status_code=404, detail="Discourse Connect is not enabled")
    
    # In a more complete implementation, you might:
    # 1. Invalidate the user's session
    # 2. Add the token to a blacklist
    # 3. Log the logout event
    
    return Message(message="User logged out successfully")


@router.get("/discourse/info")
def get_discourse_sso_info() -> Any:
    """
    Get information about Discourse SSO configuration.
    Useful for debugging and setup verification.
    """
    if not settings.DISCOURSE_CONNECT_ENABLED:
        return {"enabled": False, "message": "Discourse Connect is not enabled"}
    
    return {
        "enabled": True,
        "discourse_url": settings.DISCOURSE_CONNECT_URL,
        "has_secret": bool(settings.DISCOURSE_CONNECT_SECRET),
        "login_url": "/api/v1/sso/discourse/login",
        "callback_url": "/api/v1/sso/discourse/callback",
    }


@router.post("/discourse/user-sync")
def sync_user_to_discourse(
    session: SessionDep,
    current_user: CurrentUser,
    user_id: int = None
) -> Message:
    """
    Manually sync a user to Discourse.
    This can be useful for testing or forcing a user sync.
    """
    if not settings.DISCOURSE_CONNECT_ENABLED:
        raise HTTPException(status_code=404, detail="Discourse Connect is not enabled")
    
    # If user_id is provided and current user is superuser, sync that user
    # Otherwise, sync current user
    target_user = current_user
    if user_id and current_user.is_superuser:
        target_user = session.get(User, user_id)
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
    elif user_id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Insufficient privileges")
    
    # In a more complete implementation, you might:
    # 1. Make an API call to Discourse to sync user data
    # 2. Update user information in Discourse
    # 3. Handle any sync errors
    
    return Message(message=f"User {target_user.email} sync initiated") 


@router.post("/discourse/complete")
def complete_discourse_sso(
    request: Request,
    session: SessionDep,
    current_user: CurrentUser,
    sso: str = Form(...),
    sig: str = Form(...),
) -> Dict[str, str]:
    """
    Complete the SSO process with an authenticated user.
    Returns the redirect URL as JSON to avoid CORS issues with manual redirects.
    """
    if not settings.DISCOURSE_CONNECT_ENABLED:
        raise HTTPException(status_code=404, detail="Discourse Connect is not enabled")
    
    try:
        # Validate and decode the SSO request
        sso_data = validate_sso_request(sso, sig)
        nonce = sso_data.get('nonce')
        return_sso_url = sso_data.get('return_sso_url')
        
        if not nonce:
            raise HTTPException(status_code=400, detail="Missing nonce in SSO request")
        
        # Generate SSO response for Discourse
        sso_response = generate_sso_response(
            nonce=nonce,
            external_id=str(current_user.id),
            email=current_user.email,
            username=current_user.email.split('@')[0],
            name=current_user.full_name,
            admin=current_user.is_superuser,
            moderator=False,
        )
        
        # Build the redirect URL back to Discourse
        if return_sso_url:
            redirect_url = f"{return_sso_url}?{urlencode(sso_response)}"
        else:
            discourse_url = settings.DISCOURSE_CONNECT_URL.rstrip('/')
            redirect_url = f"{discourse_url}/session/sso_login?{urlencode(sso_response)}"
        
        return {"redirect_url": redirect_url}
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"SSO validation failed: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SSO processing failed: {str(e)}") 