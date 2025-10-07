"""add_cascade_delete_to_asset_children

Revision ID: 9ec1d6820421
Revises: f9c5be9e1625
Create Date: 2025-10-04 18:01:41.567033

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
import pgvector
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision = '9ec1d6820421'
down_revision = 'f9c5be9e1625'
branch_labels = None
depends_on = None


def upgrade():
    """Add CASCADE DELETE to asset parent_asset_id foreign key."""
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    
    # Drop existing foreign key constraint
    op.drop_constraint('asset_parent_asset_id_fkey', 'asset', type_='foreignkey')
    
    # Add it back with ON DELETE CASCADE
    op.create_foreign_key(
        'asset_parent_asset_id_fkey',
        'asset',
        'asset',
        ['parent_asset_id'],
        ['id'],
        ondelete='CASCADE'
    )


def downgrade():
    """Remove CASCADE DELETE from asset parent_asset_id foreign key."""
    
    # Drop the CASCADE constraint
    op.drop_constraint('asset_parent_asset_id_fkey', 'asset', type_='foreignkey')
    
    # Add it back without CASCADE (original state)
    op.create_foreign_key(
        'asset_parent_asset_id_fkey',
        'asset',
        'asset',
        ['parent_asset_id'],
        ['id']
    )
