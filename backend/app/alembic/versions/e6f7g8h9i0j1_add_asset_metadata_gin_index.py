"""Add GIN index on asset.metadata (facets) for JSONB queries.

Revision ID: e6f7g8h9i0j1
Revises: d5e6f7g8h9i0
Create Date: 2026-02-26

Enables efficient metadata @> and metadata->>'key' queries used by watchers
and AssetQuery.facets().
"""
from alembic import op

revision = "e6f7g8h9i0j1"
down_revision = "d5e6f7g8h9i0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_metadata
        ON asset USING gin (metadata jsonb_path_ops);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_asset_metadata;")
