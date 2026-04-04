"""Clean up EDITOR legacy role — migrate to ANALYST.

All InfospaceCollaborator records with role='editor' become role='analyst'.
EDITOR was a legacy alias with identical capabilities.

Revision ID: k1l2m3n4o5p7
Revises: j0k1l2m3n4o5
Create Date: 2026-04-01

"""
from alembic import op

revision = "k1l2m3n4o5p7"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migrate editor → analyst in collaborator table
    op.execute("""
        UPDATE infospacecollaborator
        SET role = 'analyst'
        WHERE role = 'editor'
    """)
    # Also update any invitations that used editor
    op.execute("""
        UPDATE invitation
        SET role = 'analyst'
        WHERE role = 'editor'
    """)


def downgrade() -> None:
    # No-op: analyst is the correct value, no reason to revert
    pass
