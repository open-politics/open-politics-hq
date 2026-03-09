"""Add provider_defaults to user and embedding_selection to infospace.

Revision ID: k1l2m3n4o5p6
Revises: j1k2l3m4n5o6
Create Date: 2026-03-03

Adds typed JSON columns for the unified provider selection system:
- user.provider_defaults: ProviderDefaults (per-capability provider preferences)
- infospace.embedding_selection: ProviderSelection (typed embedding provider+model)
"""
from alembic import op
import sqlalchemy as sa

revision = "k1l2m3n4o5p6"
down_revision = "j1k2l3m4n5o6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS for robustness (column may have been added manually)
    op.execute("""
        ALTER TABLE "user"
        ADD COLUMN IF NOT EXISTS provider_defaults JSON
    """)
    op.execute("""
        ALTER TABLE infospace
        ADD COLUMN IF NOT EXISTS embedding_selection JSON
    """)


def downgrade() -> None:
    op.drop_column("infospace", "embedding_selection")
    op.drop_column("user", "provider_defaults")
