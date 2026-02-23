"""Add is_superseded column to asset for change detection and versioning.

Revision ID: o0j1k2l3m4n5
Revises: n9i0j1k2l3m4
Create Date: 2025-02-19

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'o0j1k2l3m4n5'
down_revision = 'n9i0j1k2l3m4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('asset', sa.Column('is_superseded', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.create_index('ix_asset_is_superseded', 'asset', ['is_superseded'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_asset_is_superseded', table_name='asset')
    op.drop_column('asset', 'is_superseded')
