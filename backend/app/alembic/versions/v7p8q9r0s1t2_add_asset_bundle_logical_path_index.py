"""Add composite index (bundle_id, logical_path) on Asset for virtual folder and path_filter queries.

Revision ID: v7p8q9r0s1t2
Revises: u6o7p8q9r0s1
Create Date: 2026-02-21

Required for virtual folder queries (logical_path LIKE 'prefix%') and annotation
path_filter at scale. Without it, queries do full bundle scans.
"""
from alembic import op

revision = "v7p8q9r0s1t2"
down_revision = "u6o7p8q9r0s1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_asset_bundle_logical_path",
        "asset",
        ["bundle_id", "logical_path"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_asset_bundle_logical_path", table_name="asset")
