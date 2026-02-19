"""Identity domain services."""

from .infospace_service import InfospaceService
from .user_service import (
    create_user,
    update_user,
    get_user_by_email,
    authenticate,
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
    "authenticate",
    "EmailData",
    "send_email",
    "render_email_template",
    "generate_test_email",
    "generate_reset_password_email",
    "generate_new_account_email",
    "generate_email_verification_email",
]
