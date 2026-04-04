"""Identity domain services."""

from .infospace_service import InfospaceService
from .user_service import (
    create_user,
    update_user,
    get_user_by_email,
    get_user_by_handle,
    authenticate,
    check_handle_available,
    set_handle,
    search_users,
)
from .invitation_service import (
    create_invitation,
    list_user_invitations,
    count_user_invitations,
    list_infospace_invitations,
    accept_invitation,
    decline_invitation,
    revoke_invitation,
    link_email_invitations,
)
from .email_service import (
    EmailData,
    send_email,
    render_email_template,
    generate_test_email,
    generate_reset_password_email,
    generate_new_account_email,
    generate_email_verification_email,
)

__all__ = [
    "InfospaceService",
    "create_user",
    "update_user",
    "get_user_by_email",
    "get_user_by_handle",
    "authenticate",
    "check_handle_available",
    "set_handle",
    "search_users",
    "create_invitation",
    "list_user_invitations",
    "count_user_invitations",
    "list_infospace_invitations",
    "accept_invitation",
    "decline_invitation",
    "revoke_invitation",
    "link_email_invitations",
    "EmailData",
    "send_email",
    "render_email_template",
    "generate_test_email",
    "generate_reset_password_email",
    "generate_new_account_email",
    "generate_email_verification_email",
]
