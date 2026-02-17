"""add_logical_path_to_asset

Revision ID: g2b3c4d5e6f7
Revises: e7f8a9b0c1d2
Create Date: 2026-02-11

Add logical_path column to Asset for organizational path (directory/archive imports).
Replaces import_type check on Bundle for virtual folder rendering.
Backfills logical_path for existing directory-imported assets.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = "g2b3c4d5e6f7"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("asset", sa.Column("logical_path", sa.String(), nullable=True))
    op.create_index("ix_asset_logical_path", "asset", ["logical_path"], unique=False)

    # Backfill: for assets in bundles with import_type=directory_import, derive logical_path from blob_path
    # Copy mode: blob_path = managed/imports/{bundle_name}/{path} -> logical_path = path
    conn = op.get_bind()
    conn.execute(text("""
        UPDATE asset
        SET logical_path = substring(
            blob_path from length('managed/imports/' || b.name || '/') + 1
        )
        FROM bundle b
        WHERE asset.bundle_id = b.id
          AND asset.blob_path IS NOT NULL
          AND asset.logical_path IS NULL
          AND asset.parent_asset_id IS NULL
          AND (b.bundle_metadata->>'import_type') = 'directory_import'
          AND asset.blob_path LIKE 'managed/imports/' || b.name || '/%'
    """))
    # Reference mode: blob_path = {dataset_name}/{path} -> logical_path = path
    conn.execute(text("""
        UPDATE asset
        SET logical_path = substring(
            blob_path from length(b.name || '/') + 1
        )
        FROM bundle b
        WHERE asset.bundle_id = b.id
          AND asset.blob_path IS NOT NULL
          AND asset.logical_path IS NULL
          AND asset.parent_asset_id IS NULL
          AND (b.bundle_metadata->>'import_type') = 'directory_import'
          AND asset.blob_path LIKE b.name || '/%'
          AND asset.blob_path NOT LIKE 'managed/imports/%'
    """))


def downgrade():
    op.drop_index("ix_asset_logical_path", table_name="asset")
    op.drop_column("asset", "logical_path")
