"""Add composite indexes for tree and task queries.

Revision ID: l7g8h9i0j1k2
Revises: k6f7g8h9i0j1
Create Date: 2025-02-18

Adds (infospace_id, parent_asset_id) on Asset for tree queries,
(infospace_id, user_id, status) on Task for task listing.
(infospace_id, processing_status) on Asset already exists from d8e9f0a1b2c3.
"""
from alembic import op

revision = "l7g8h9i0j1k2"
down_revision = "k6f7g8h9i0j1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_asset_infospace_parent_asset",
        "asset",
        ["infospace_id", "parent_asset_id"],
        unique=False,
    )
    op.create_index(
        "ix_task_infospace_user_status",
        "task",
        ["infospace_id", "user_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_task_infospace_user_status", table_name="task")
    op.drop_index("ix_asset_infospace_parent_asset", table_name="asset")
