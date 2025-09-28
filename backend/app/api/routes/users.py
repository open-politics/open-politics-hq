from typing import Any, List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlmodel import col, delete, func, select
import uuid
import mimetypes

from app import crud
from app.api.deps import (
    CurrentUser,
    SessionDep,
    get_current_active_superuser,
    StorageProviderDep,
)
from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.models import (
    User,
    Infospace,
    Asset,
    Annotation,
)
from app.schemas import Message, UserCreate, UserOut, UserUpdate, UserUpdateMe, UserCreateOpen, UsersOut, UpdatePassword, UserPublicProfile, UserProfileUpdate, UserProfileStats
from app.utils import (
    generate_new_account_email, 
    send_email, 
    generate_email_verification_token, 
    generate_email_verification_email,
    verify_email_verification_token
)

router = APIRouter()


@router.get("", dependencies=[Depends(get_current_active_superuser)], response_model=UsersOut)
@router.get("/", dependencies=[Depends(get_current_active_superuser)], response_model=UsersOut)
def read_users(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    """
    Retrieve users.
    """

    statment = select(func.count()).select_from(User)
    count = session.exec(statment).one()

    statement = select(User).offset(skip).limit(limit)
    users = session.exec(statement).all()

    return UsersOut(data=users, count=count)


@router.post("", dependencies=[Depends(get_current_active_superuser)], response_model=UserOut)
@router.post("/", dependencies=[Depends(get_current_active_superuser)], response_model=UserOut)
def create_user(*, session: SessionDep, user_in: UserCreate) -> Any:
    """
    Create new user.
    """
    user = crud.get_user_by_email(session=session, email=user_in.email)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system.",
        )

    user = crud.create_user(session=session, user_create=user_in)


    
    # Admin-created users should be immediately verified and active
    user.email_verified = True
    user.is_active = True
    session.add(user)
    session.commit()
    session.refresh(user)
    
    # Optionally send welcome email (defaults to true on schema). Useful to suppress for CSV/admin bulk.
    if settings.emails_enabled and user_in.email and getattr(user_in, "send_welcome_email", True):
        email_data = generate_new_account_email(
            email_to=user_in.email, username=user_in.email, password=user_in.password
        )
        send_email(
            email_to=user_in.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    return user


@router.patch("/me", response_model=UserOut)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
) -> Any:
    """
    Update own user profile.
    """
    if user_in.email:
        existing_user = crud.get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != current_user.id:
            raise HTTPException(
                status_code=409, detail="User with this email already exists"
            )
    
    # Validate profile field lengths if provided
    if user_in.bio and len(user_in.bio) > 500:
        raise HTTPException(
            status_code=400, 
            detail="Bio must be 500 characters or less"
        )
    
    if user_in.description and len(user_in.description) > 2000:
        raise HTTPException(
            status_code=400, 
            detail="Description must be 2000 characters or less"
        )
    
    user_data = user_in.model_dump(exclude_unset=True)
    current_user.sqlmodel_update(user_data)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.patch("/me/password", response_model=Message)
def update_password_me(
    *, session: SessionDep, body: UpdatePassword, current_user: CurrentUser
) -> Any:
    """
    Update own password.
    """
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password")
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400, detail="New password cannot be the same as the current one"
        )
    hashed_password = get_password_hash(body.new_password)
    current_user.hashed_password = hashed_password
    session.add(current_user)
    session.commit()
    return Message(message="Password updated successfully")


@router.get("/me", response_model=UserOut)
def read_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Get current user.
    """
    return current_user


@router.post("/me/upload-profile-picture", response_model=UserOut)
async def upload_profile_picture(
    session: SessionDep,
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
    file: UploadFile = File(...)
) -> Any:
    """
    Upload a profile picture for the current user.
    """
    # Validate file type
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(
            status_code=400,
            detail="Only image files are allowed"
        )
    
    # Validate file size (5MB limit)
    max_size = 5 * 1024 * 1024  # 5MB
    file.file.seek(0, 2)  # Seek to end to get size
    file_size = file.file.tell()
    file.file.seek(0)  # Reset to beginning
    
    if file_size > max_size:
        raise HTTPException(
            status_code=400,
            detail="File size too large. Maximum size is 5MB"
        )
    
    # Generate unique object name for storage
    file_extension = file.filename.split('.')[-1] if file.filename and '.' in file.filename else 'jpg'
    object_name = f"profile-pictures/{current_user.id}/{uuid.uuid4().hex}.{file_extension}"
    
    try:
        # Delete old profile picture if exists
        if current_user.profile_picture_url:
            try:
                # Extract object name from existing URL
                # URL format: /api/v1/users/profile-picture/{user_id}/{filename}
                url_parts = current_user.profile_picture_url.split('/')
                if len(url_parts) >= 2:
                    filename = url_parts[-1]
                    old_object_name = f"profile-pictures/{current_user.id}/{filename}"
                    await storage_provider.delete_file(old_object_name)
            except Exception as e:
                # Log but don't fail if old file deletion fails
                print(f"Warning: Could not delete old profile picture: {e}")
        
        # Upload new file to storage
        await storage_provider.upload_file(file, object_name)
        
        # Generate public URL for the uploaded file
        profile_picture_url = f"/api/v1/users/profile-picture/{current_user.id}/{object_name.split('/')[-1]}"
        current_user.profile_picture_url = profile_picture_url
        
        session.add(current_user)
        session.commit()
        session.refresh(current_user)
        
        return current_user
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload profile picture: {str(e)}"
        )


@router.get("/profile/{user_id}", response_model=UserPublicProfile)
def get_user_public_profile(user_id: int, session: SessionDep) -> Any:
    """
    Get a user's public profile (no authentication required).
    Returns only non-sensitive profile information.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserPublicProfile(
        id=user.id,
        full_name=user.full_name,
        profile_picture_url=user.profile_picture_url,
        bio=user.bio,
        description=user.description,
        created_at=user.created_at
            )


@router.get("/profile-picture/{user_id}/{filename}")
async def get_profile_picture(user_id: int, filename: str, session: SessionDep) -> StreamingResponse:
    """
    Serve profile pictures publicly (no authentication required).
    """
    # Verify the user exists and is active
    user = session.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Construct the object name in storage
    object_name = f"profile-pictures/{user_id}/{filename}"
    
    try:
        # Get storage provider (we'll need to create this dependency)
        from app.api.providers.factory import create_storage_provider
        storage_provider = create_storage_provider(settings)
        
        # Get file stream from storage
        file_stream = await storage_provider.get_file(object_name)
        
        # Determine content type
        content_type, _ = mimetypes.guess_type(filename)
        if not content_type or not content_type.startswith('image/'):
            content_type = "image/jpeg"  # Default for profile pictures
        
        # Create async generator for streaming
        async def generate():
            try:
                chunk_size = 8192  # 8KB chunks
                while True:
                    chunk = file_stream.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
            finally:
                if hasattr(file_stream, 'close'):
                    file_stream.close()
        
        return StreamingResponse(
            generate(),
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400",  # Cache for 24 hours
                "Content-Disposition": f"inline; filename={filename}"
            }
        )
        
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Profile picture not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving profile picture: {str(e)}")


@router.get("/profiles", response_model=List[UserPublicProfile])
def list_user_profiles(
    session: SessionDep,
    skip: int = 0,
    limit: int = 20,
    search: str = None
) -> Any:
    """
    List user profiles with optional search.
    Search looks in full_name and bio fields.
    """
    if limit > 100:
        limit = 100
    
    query = select(User).where(User.is_active == True)
    
    if search:
        search_term = f"%{search}%"
        query = query.where(
            (User.full_name.ilike(search_term)) |
            (User.bio.ilike(search_term))
        )
    
    query = query.offset(skip).limit(limit)
    users = session.exec(query).all()
    
    return [
        UserPublicProfile(
            id=user.id,
            full_name=user.full_name,
            profile_picture_url=user.profile_picture_url,
            bio=user.bio,
            description=user.description,
            created_at=user.created_at
        )
        for user in users
    ]


@router.get("/profile/{user_id}/stats", response_model=UserProfileStats)
def get_user_profile_stats(user_id: int, session: SessionDep) -> Any:
    """
    Get user profile statistics.
    """
    user = session.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Count user's infospaces
    infospaces_count = session.exec(
        select(func.count(Infospace.id)).where(Infospace.owner_id == user_id)
    ).one()
    
    # Count user's assets
    assets_count = session.exec(
        select(func.count(Asset.id)).where(Asset.user_id == user_id)
    ).one()
    
    # Count user's annotations
    annotations_count = session.exec(
        select(func.count(Annotation.id)).where(Annotation.user_id == user_id)
    ).one()
    
    return UserProfileStats(
        user_id=user.id,
        infospaces_count=infospaces_count,
        assets_count=assets_count,
        annotations_count=annotations_count,
        member_since=user.created_at
    )


@router.patch("/me/profile", response_model=UserOut)
def update_user_profile(
    *, session: SessionDep, profile_in: UserProfileUpdate, current_user: CurrentUser
) -> Any:
    """
    Update user profile information only (no email or password changes).
    """
    # Validate description length if provided
    if profile_in.description and len(profile_in.description) > 2000:
        raise HTTPException(
            status_code=400, 
            detail="Description must be 2000 characters or less"
        )
    
    # Validate bio length if provided
    if profile_in.bio and len(profile_in.bio) > 500:
        raise HTTPException(
            status_code=400, 
            detail="Bio must be 500 characters or less"
        )
    
    profile_data = profile_in.model_dump(exclude_unset=True)
    current_user.sqlmodel_update(profile_data)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.post("/open", response_model=UserOut)
def create_user_open(session: SessionDep, user_in: UserCreateOpen) -> Any:
    """
    Create new user without the need to be logged in.
    Sends email verification if REQUIRE_EMAIL_VERIFICATION is enabled.
    """
    if not settings.USERS_OPEN_REGISTRATION:
        raise HTTPException(
            status_code=403,
            detail="Open user registration is forbidden on this server",
        )
    
    # Check if user already exists
    existing_user = crud.get_user_by_email(session=session, email=user_in.email)
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system",
        )
    
    # Validate profile fields
    if user_in.bio and len(user_in.bio) > 500:
        raise HTTPException(
            status_code=400,
            detail="Bio must be 500 characters or less"
        )
    
    if user_in.description and len(user_in.description) > 2000:
        raise HTTPException(
            status_code=400,
            detail="Description must be 2000 characters or less"
        )
    
    # Create user with verification fields (converting from UserCreateOpen to UserCreate)
    user_create = UserCreate(
        email=user_in.email,
        password=user_in.password,
        full_name=user_in.full_name,
        profile_picture_url=user_in.profile_picture_url,
        bio=user_in.bio,
        description=user_in.description,
        is_superuser=False,
        is_active=True
    )
    
    # If email verification is required, create user as inactive
    if settings.REQUIRE_EMAIL_VERIFICATION:
        user_create.is_active = False
    
    user = crud.create_user(session=session, user_create=user_create)
    
    # Handle email verification
    print(f"🔧 EMAIL DEBUG:")
    print(f"  - REQUIRE_EMAIL_VERIFICATION: {settings.REQUIRE_EMAIL_VERIFICATION}")
    print(f"  - emails_enabled: {settings.emails_enabled}")
    print(f"  - SMTP_HOST: {settings.SMTP_HOST}")
    print(f"  - EMAILS_FROM_EMAIL: {settings.EMAILS_FROM_EMAIL}")
    
    if settings.REQUIRE_EMAIL_VERIFICATION and settings.emails_enabled:
        print("✅ Email verification enabled and emails configured - sending verification email")
        # Generate verification token
        verification_token = generate_email_verification_token(user.email)
        verification_expires = datetime.now(timezone.utc) + timedelta(hours=24)
        
        # Update user with verification token
        user.email_verification_token = verification_token
        user.email_verification_sent_at = datetime.now(timezone.utc)
        user.email_verification_expires_at = verification_expires
        
        session.add(user)
        session.commit()
        session.refresh(user)
        
        # Send verification email
        try:
            email_data = generate_email_verification_email(
                email_to=user.email,
                username=user.full_name or user.email,
                token=verification_token
            )
            send_email(
                email_to=user.email,
                subject=email_data.subject,
                html_content=email_data.html_content,
            )
            print(f"📧 Verification email sent to {user.email}")
        except Exception as e:
            # Log email error but don't fail registration
            print(f"❌ Failed to send verification email: {e}")
    elif settings.REQUIRE_EMAIL_VERIFICATION and not settings.emails_enabled:
        print("⚠️  Email verification required but emails not configured!")
        print("   For testing, you can:")
        print("   1. Set email environment variables, OR")
        print("   2. Set REQUIRE_EMAIL_VERIFICATION=false in .env")
        print("   3. User created but will need manual activation")
        
        # Still set verification fields for completeness
        verification_token = generate_email_verification_token(user.email)
        verification_expires = datetime.now(timezone.utc) + timedelta(hours=24)
        
        user.email_verification_token = verification_token
        user.email_verification_sent_at = datetime.now(timezone.utc)
        user.email_verification_expires_at = verification_expires
        
        session.add(user)
        session.commit()
        session.refresh(user)
        
        print(f"🔐 Verification token for {user.email}: {verification_token}")
        print(f"   You can manually verify by calling: /api/v1/users/verify-email?token={verification_token}")
    else:
        print("🟢 Email verification disabled - user created as active")
    
    return user


@router.get("/{user_id}", response_model=UserOut)
def read_user_by_id(
    user_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    """
    Get a specific user by id.
    """
    user = session.get(User, user_id)
    if user == current_user:
        return user
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="The user doesn't have enough privileges",
        )
    return user


@router.patch(
    "/{user_id}",
    dependencies=[Depends(get_current_active_superuser)],
    response_model=UserOut,
)
def update_user(
    *,
    session: SessionDep,
    user_id: int,
    user_in: UserUpdate,
) -> Any:
    """
    Update a user.
    """

    db_user = session.get(User, user_id)
    if not db_user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )
    if user_in.email:
        existing_user = crud.get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != user_id:
            raise HTTPException(
                status_code=409, detail="User with this email already exists"
            )

    db_user = crud.update_user(session=session, db_user=db_user, user_in=user_in)
    return db_user


@router.post("/verify-email")
def verify_email(token: str, session: SessionDep) -> Message:
    """
    Verify user email address using verification token.
    """
    # Verify the token
    email = verify_email_verification_token(token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")
    
    # Find user by email
    user = crud.get_user_by_email(session=session, email=email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if already verified
    if user.email_verified:
        raise HTTPException(status_code=400, detail="Email is already verified")
    
    # Check if token matches and hasn't expired
    if user.email_verification_token != token:
        raise HTTPException(status_code=400, detail="Invalid verification token")
    
    if user.email_verification_expires_at:
        # Ensure timezone-aware comparison - treat DB datetime as UTC if naive
        expires_at = user.email_verification_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Verification token has expired")
    
    # Verify the email and activate the account
    user.email_verified = True
    user.is_active = True
    user.email_verification_token = None
    user.email_verification_sent_at = None
    user.email_verification_expires_at = None
    
    session.add(user)
    session.commit()
    
    return Message(message="Email verified successfully! Your account is now active.")


@router.post("/resend-verification")
def resend_verification(email: str, session: SessionDep) -> Message:
    """
    Resend email verification for a user.
    """
    # Find user by email
    user = crud.get_user_by_email(session=session, email=email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if already verified
    if user.email_verified:
        raise HTTPException(status_code=400, detail="Email is already verified")
    
    # Check if we can send email
    if not settings.emails_enabled:
        raise HTTPException(status_code=503, detail="Email service is not configured")
    
    # Rate limiting: don't allow resending if last email was sent less than 1 minute ago
    if user.email_verification_sent_at:
        # Ensure timezone-aware comparison - treat DB datetime as UTC if naive
        sent_at = user.email_verification_sent_at
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        
        if sent_at > datetime.now(timezone.utc) - timedelta(minutes=1):
            raise HTTPException(
                status_code=429, 
                detail="Please wait at least 1 minute before requesting another verification email"
            )
    
    # Generate new verification token
    verification_token = generate_email_verification_token(user.email)
    verification_expires = datetime.now(timezone.utc) + timedelta(hours=24)
    
    # Update user with new verification token
    user.email_verification_token = verification_token
    user.email_verification_sent_at = datetime.now(timezone.utc)
    user.email_verification_expires_at = verification_expires
    
    session.add(user)
    session.commit()
    
    # Send verification email
    try:
        email_data = generate_email_verification_email(
            email_to=user.email,
            username=user.full_name or user.email,
            token=verification_token
        )
        send_email(
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
        
        return Message(message="Verification email sent successfully")
        
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to send verification email: {str(e)}"
        )


@router.delete("/{user_id}")
def delete_user(
    session: SessionDep, current_user: CurrentUser, user_id: int
) -> Message:
    """
    Delete a user.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    elif user != current_user and not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    elif user == current_user and current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        )

    statement = delete(User).where(col(User.id) == user_id)
    session.exec(statement)  # type: ignore
    session.delete(user)
    session.commit()
    return Message(message="User deleted successfully")


