"""Source groups: a nullable ``group`` label on ``source``.

A group is just a shared, infospace-level label for organising sources in the
rail. It exists iff some source carries it — no group table, no empty groups.

Revision ID: a4_source_group
Revises: a3_composition_cascade_delete
"""
from alembic import op
import sqlalchemy as sa

revision = "a4_source_group"
down_revision = "a3_composition_cascade_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("source", sa.Column("group", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("source", "group")
