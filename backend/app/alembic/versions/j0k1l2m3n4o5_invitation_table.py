"""Create invitation table + unique constraint on infospace_collaborator.

Invitation: pending invitations to join an infospace.
Partial unique indexes prevent duplicate pending invitations.
Unique constraint on InfospaceCollaborator prevents race-condition duplicates.

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-04-01

"""
from alembic import op
import sqlalchemy as sa

revision = "j0k1l2m3n4o5"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── Invitation table ───
    op.create_table(
        "invitation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("infospace_id", sa.Integer(), nullable=False),
        sa.Column("inviter_id", sa.Integer(), nullable=False),
        sa.Column("invitee_user_id", sa.Integer(), nullable=True),
        sa.Column("invitee_email", sa.String(), nullable=True),
        sa.Column("role", sa.String(32), nullable=False, server_default="viewer"),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["infospace_id"], ["infospace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["inviter_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invitee_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_invitation_infospace_id", "invitation", ["infospace_id"])
    op.create_index("ix_invitation_invitee_user_id", "invitation", ["invitee_user_id"])
    op.create_index("ix_invitation_invitee_email", "invitation", ["invitee_email"])

    # Partial unique indexes: only one pending invitation per user/email per infospace
    op.execute("""
        CREATE UNIQUE INDEX uq_invitation_pending_user
        ON invitation (infospace_id, invitee_user_id)
        WHERE status = 'pending' AND invitee_user_id IS NOT NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_invitation_pending_email
        ON invitation (infospace_id, invitee_email)
        WHERE status = 'pending' AND invitee_email IS NOT NULL
    """)

    # ─── Unique constraint on InfospaceCollaborator ───
    # Prevents race-condition duplicate collaborator records
    op.create_unique_constraint(
        "uq_infospace_collaborator_user",
        "infospaceCollaborator" if _table_exists("infospaceCollaborator") else "infospacecollaborator",
        ["infospace_id", "user_id"],
    )


def downgrade() -> None:
    # Drop the unique constraint (try both possible table name casings)
    try:
        op.drop_constraint("uq_infospace_collaborator_user", "infospaceCollaborator", type_="unique")
    except Exception:
        try:
            op.drop_constraint("uq_infospace_collaborator_user", "infospacecollaborator", type_="unique")
        except Exception:
            pass

    op.execute("DROP INDEX IF EXISTS uq_invitation_pending_email")
    op.execute("DROP INDEX IF EXISTS uq_invitation_pending_user")
    op.drop_index("ix_invitation_invitee_email", table_name="invitation")
    op.drop_index("ix_invitation_invitee_user_id", table_name="invitation")
    op.drop_index("ix_invitation_infospace_id", table_name="invitation")
    op.drop_table("invitation")


def _table_exists(name: str) -> bool:
    """Check if a table exists (for case-sensitivity handling)."""
    from alembic import op
    bind = op.get_bind()
    from sqlalchemy import inspect
    return name in inspect(bind).get_table_names()
