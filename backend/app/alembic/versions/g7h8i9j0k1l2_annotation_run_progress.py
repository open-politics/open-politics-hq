"""Add progress_total and progress_current to annotation runs.

Tracks how many assets have been processed vs total for live progress bars.

Revision ID: g7h8i9j0k1l2
Revises: f6g7h8i9j0k1
Create Date: 2026-03-25

"""
from alembic import op
import sqlalchemy as sa

revision = "g7h8i9j0k1l2"
down_revision = "f6g7h8i9j0k1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("annotationrun", sa.Column("progress_total", sa.Integer(), nullable=True))
    op.add_column("annotationrun", sa.Column("progress_current", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("annotationrun", "progress_current")
    op.drop_column("annotationrun", "progress_total")
