"""User CRUD operations for identity domain."""

from typing import Any, Optional

from sqlalchemy import or_
from sqlmodel import Session, select

from app.core.security import get_password_hash, verify_password
from app.models import User
from app.schemas import UserCreate, UserUpdate
from app.api.modules.identity_infospace_user.handle_gen import (
    generate_handle,
    validate_handle,
)


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    if not db_obj.handle:
        db_obj.handle = generate_handle(session, full_name=db_obj.full_name)
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


def get_user_by_handle(*, session: Session, handle: str) -> User | None:
    statement = select(User).where(User.handle == handle.lower())
    return session.exec(statement).first()


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        return None
    if not verify_password(password, db_user.hashed_password):
        return None
    return db_user


# ─── Handle operations ───


def check_handle_available(
    session: Session, handle: str, exclude_user_id: Optional[int] = None
) -> bool:
    """Check if a handle is available (not taken by another user)."""
    try:
        handle = validate_handle(handle)
    except ValueError:
        return False
    stmt = select(User.id).where(User.handle == handle)
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return session.exec(stmt).first() is None


def set_handle(session: Session, user: User, handle: str) -> User:
    """Set a user's handle after validation and uniqueness check."""
    handle = validate_handle(handle)
    if not check_handle_available(session, handle, exclude_user_id=user.id):
        raise ValueError(f"Handle '{handle}' is already taken")
    user.handle = handle
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def search_users(session: Session, query: str, limit: int = 10) -> list[User]:
    """Prefix search on handle and full_name for invite autocomplete."""
    q = query.strip().lower()
    if not q:
        return []
    pattern = f"{q}%"
    stmt = (
        select(User)
        .where(
            User.is_active == True,  # noqa: E712
            or_(
                User.handle.ilike(pattern),
                User.full_name.ilike(f"%{q}%"),
            ),
        )
        .limit(limit)
    )
    return list(session.exec(stmt).all())
