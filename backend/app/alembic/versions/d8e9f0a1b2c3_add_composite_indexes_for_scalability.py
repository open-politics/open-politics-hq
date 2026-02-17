"""add_composite_indexes_for_scalability

Revision ID: d8e9f0a1b2c3
Revises: cc6cd17c5c9b
Create Date: 2026-02-10

Add composite indexes on asset table for scalable list/tree/search queries
at large scale (millions of assets).
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'd8e9f0a1b2c3'
down_revision = 'cc6cd17c5c9b'
branch_labels = None
depends_on = None


def upgrade():
    # Composite indexes for common query patterns (list assets, tree, search, path filtering)
    op.create_index(
        'ix_asset_infospace_user',
        'asset',
        ['infospace_id', 'user_id'],
        unique=False
    )
    op.create_index(
        'ix_asset_infospace_bundle',
        'asset',
        ['infospace_id', 'bundle_id'],
        unique=False
    )
    op.create_index(
        'ix_asset_infospace_processing_status',
        'asset',
        ['infospace_id', 'processing_status'],
        unique=False
    )
    op.create_index(
        'ix_asset_bundle_blob_path',
        'asset',
        ['bundle_id', 'blob_path'],
        unique=False
    )


def downgrade():
    op.drop_index('ix_asset_bundle_blob_path', table_name='asset')
    op.drop_index('ix_asset_infospace_processing_status', table_name='asset')
    op.drop_index('ix_asset_infospace_bundle', table_name='asset')
    op.drop_index('ix_asset_infospace_user', table_name='asset')
