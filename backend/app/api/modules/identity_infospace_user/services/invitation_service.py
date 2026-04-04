"""Invitation lifecycle: create, accept, decline, revoke, link."""

import re
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Session, select

from app.api.modules.identity_infospace_user.models import (
    CollaboratorRole,
    Infospace,
    InfospaceCollaborator,
    Invitation,
    InvitationStatus,
    User,
)


def _looks_like_email(s: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", s))


def _pending_filter():
    """Common filter for non-expired pending invitations."""
    now = datetime.now(timezone.utc)
    return (
        Invitation.status == InvitationStatus.PENDING,
        (Invitation.expires_at == None) | (Invitation.expires_at > now),  # noqa: E711
    )


def create_invitation(
    session: Session,
    infospace_id: int,
    inviter_id: int,
    identifier: str,
    role: CollaboratorRole,
) -> Invitation:
    """
    Create or update a pending invitation.

    Resolves identifier as handle first, then email lookup, then raw email
    for future users. Raises ValueError on bad input or invalid targets.
    """
    identifier = identifier.strip()
    if not identifier:
        raise ValueError("Identifier cannot be empty")

    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise ValueError("Infospace not found")

    # Don't allow inviting as OWNER — ownership is not transferable via invite
    if role == CollaboratorRole.OWNER:
        raise ValueError("Cannot invite as owner")

    # Resolve identifier → user
    invitee: Optional[User] = None
    invitee_email: Optional[str] = None

    # Try handle lookup first
    user_by_handle = session.exec(
        select(User).where(User.handle == identifier.lower())
    ).first()
    if user_by_handle:
        invitee = user_by_handle
    else:
        # Try email lookup
        user_by_email = session.exec(
            select(User).where(User.email == identifier.lower())
        ).first()
        if user_by_email:
            invitee = user_by_email
        elif _looks_like_email(identifier):
            # Email for future user
            invitee_email = identifier.lower()
        else:
            raise ValueError(f"No user found with handle or email '{identifier}'")

    # Validate target
    if invitee:
        if invitee.id == infospace.owner_id:
            raise ValueError("Cannot invite the infospace owner")
        # Check if already a collaborator
        existing_collab = session.exec(
            select(InfospaceCollaborator).where(
                InfospaceCollaborator.infospace_id == infospace_id,
                InfospaceCollaborator.user_id == invitee.id,
            )
        ).first()
        if existing_collab:
            raise ValueError("User is already a collaborator")

    # Check for existing pending invitation — update role if found
    if invitee:
        existing = session.exec(
            select(Invitation).where(
                Invitation.infospace_id == infospace_id,
                Invitation.invitee_user_id == invitee.id,
                *_pending_filter(),
            )
        ).first()
    else:
        existing = session.exec(
            select(Invitation).where(
                Invitation.infospace_id == infospace_id,
                Invitation.invitee_email == invitee_email,
                *_pending_filter(),
            )
        ).first()

    if existing:
        existing.role = role
        existing.inviter_id = inviter_id
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    # Create new invitation
    invitation = Invitation(
        infospace_id=infospace_id,
        inviter_id=inviter_id,
        role=role,
        invitee_user_id=invitee.id if invitee else None,
        invitee_email=invitee_email,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    return invitation


def list_user_invitations(session: Session, user_id: int) -> list[Invitation]:
    """Pending invitations for a user (inbox)."""
    return list(session.exec(
        select(Invitation).where(
            Invitation.invitee_user_id == user_id,
            *_pending_filter(),
        ).order_by(Invitation.created_at.desc())
    ).all())


def count_user_invitations(session: Session, user_id: int) -> int:
    """Count of pending invitations for badge display."""
    from sqlalchemy import func
    result = session.exec(
        select(func.count(Invitation.id)).where(
            Invitation.invitee_user_id == user_id,
            *_pending_filter(),
        )
    ).one()
    return result or 0


def list_infospace_invitations(session: Session, infospace_id: int) -> list[Invitation]:
    """All invitations for an infospace (owner view). Includes resolved."""
    return list(session.exec(
        select(Invitation).where(
            Invitation.infospace_id == infospace_id,
        ).order_by(Invitation.created_at.desc())
    ).all())


def accept_invitation(
    session: Session, invitation_id: int, user_id: int
) -> InfospaceCollaborator:
    """Accept a pending invitation. Creates an InfospaceCollaborator."""
    invitation = session.get(Invitation, invitation_id)
    if not invitation:
        raise ValueError("Invitation not found")
    if invitation.invitee_user_id != user_id:
        raise ValueError("This invitation is not for you")
    if invitation.status != InvitationStatus.PENDING:
        raise ValueError(f"Invitation is already {invitation.status.value}")

    # Check expiration
    now = datetime.now(timezone.utc)
    if invitation.expires_at and invitation.expires_at < now:
        raise ValueError("Invitation has expired")

    # Create collaborator
    collab = InfospaceCollaborator(
        infospace_id=invitation.infospace_id,
        user_id=user_id,
        role=invitation.role,
    )
    session.add(collab)

    # Update invitation status
    invitation.status = InvitationStatus.ACCEPTED
    invitation.resolved_at = now
    session.add(invitation)

    session.commit()
    session.refresh(collab)
    return collab


def decline_invitation(
    session: Session, invitation_id: int, user_id: int
) -> Invitation:
    """Decline a pending invitation."""
    invitation = session.get(Invitation, invitation_id)
    if not invitation:
        raise ValueError("Invitation not found")
    if invitation.invitee_user_id != user_id:
        raise ValueError("This invitation is not for you")
    if invitation.status != InvitationStatus.PENDING:
        raise ValueError(f"Invitation is already {invitation.status.value}")

    invitation.status = InvitationStatus.DECLINED
    invitation.resolved_at = datetime.now(timezone.utc)
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    return invitation


def revoke_invitation(
    session: Session, invitation_id: int, infospace_id: int
) -> Invitation:
    """Revoke a pending invitation (owner action)."""
    invitation = session.get(Invitation, invitation_id)
    if not invitation:
        raise ValueError("Invitation not found")
    if invitation.infospace_id != infospace_id:
        raise ValueError("Invitation does not belong to this infospace")
    if invitation.status != InvitationStatus.PENDING:
        raise ValueError(f"Invitation is already {invitation.status.value}")

    invitation.status = InvitationStatus.REVOKED
    invitation.resolved_at = datetime.now(timezone.utc)
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    return invitation


def link_email_invitations(session: Session, user: User) -> int:
    """
    Called on registration: link pending email-keyed invitations to the new user.
    Returns count of linked invitations.
    """
    invitations = list(session.exec(
        select(Invitation).where(
            Invitation.invitee_email == user.email.lower(),
            *_pending_filter(),
        )
    ).all())

    for inv in invitations:
        inv.invitee_user_id = user.id
        inv.invitee_email = None  # clear email now that user_id is set
        session.add(inv)

    if invitations:
        session.commit()
    return len(invitations)
