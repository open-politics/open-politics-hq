"""add_parent_asset_and_processing_status_indexes

Revision ID: e7f8a9b0c1d2
Revises: d8e9f0a1b2c3
Create Date: 2026-02-11

Add indexes on parent_asset_id and processing_status for scalable
child-asset queries and batch_process_pending.
"""
from alembic import op


revision = "e7f8a9b0c1d2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_asset_parent_asset_id",
        "asset",
        ["parent_asset_id"],
        unique=False,
    )
    op.create_index(
        "ix_asset_processing_status",
        "asset",
        ["processing_status"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_asset_processing_status", table_name="asset")
    op.drop_index("ix_asset_parent_asset_id", table_name="asset")
