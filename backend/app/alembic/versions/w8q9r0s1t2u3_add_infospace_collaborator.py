"""Add InfospaceCollaborator model for multi-user infospace access.

Revision ID: w8q9r0s1t2u3
Revises: v7p8q9r0s1t2
Create Date: 2026-02-21

"""
from alembic import op
import sqlalchemy as sa


revision = "w8q9r0s1t2u3"
down_revision = "v7p8q9r0s1t2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "infospacecollaborator",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("infospace_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False, server_default="viewer"),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["infospace_id"], ["infospace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("infospace_id", "user_id", name="uq_infospace_collaborator"),
    )
    op.create_index("ix_infospacecollaborator_infospace_id", "infospacecollaborator", ["infospace_id"])
    op.create_index("ix_infospacecollaborator_user_id", "infospacecollaborator", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_infospacecollaborator_user_id", table_name="infospacecollaborator")
    op.drop_index("ix_infospacecollaborator_infospace_id", table_name="infospacecollaborator")
    op.drop_table("infospacecollaborator")
