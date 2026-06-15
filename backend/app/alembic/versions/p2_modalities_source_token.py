"""phase2: rename asset.discovered_modalities -> modalities; add asset.source_token

Revision ID: p2_modalities_source_token
Revises: ab5cb90d3f70
Create Date: 2026-05-29

Hand-written (autogenerate sweeps in unrelated reflection drift). Scoped to:
- discovered_modalities -> modalities: pure column + GIN-index rename, data
  preserved. The descriptor keeps the ordered ``supported_modalities`` tuple
  (the possible set); the asset's ``modalities`` is the discovered actual subset.
- source_token: new nullable indexed column — the cheap drift change-token,
  written only on root assets. NULL = "unknown, will fetch" (conservative).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'p2_modalities_source_token'
down_revision = 'ab5cb90d3f70'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('asset', 'discovered_modalities', new_column_name='modalities')
    op.execute('ALTER INDEX IF EXISTS ix_asset_discovered_modalities RENAME TO ix_asset_modalities')
    op.add_column('asset', sa.Column('source_token', sa.String(), nullable=True))
    op.create_index('ix_asset_source_token', 'asset', ['source_token'])


def downgrade():
    op.drop_index('ix_asset_source_token', table_name='asset')
    op.drop_column('asset', 'source_token')
    op.execute('ALTER INDEX IF EXISTS ix_asset_modalities RENAME TO ix_asset_discovered_modalities')
    op.alter_column('asset', 'modalities', new_column_name='discovered_modalities')
