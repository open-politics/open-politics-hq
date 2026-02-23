"""Add tsvector column for full-text search on Asset.text_content.

Revision ID: s4m5n6o7p8q9
Revises: r3l4m5n6o7p8
Create Date: 2025-02-19

"""
from alembic import op

revision = "s4m5n6o7p8q9"
down_revision = "r3l4m5n6o7p8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE asset ADD COLUMN IF NOT EXISTS text_search_vector tsvector
            GENERATED ALWAYS AS (to_tsvector('english', COALESCE(text_content, ''))) STORED;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_text_search ON asset
        USING GIN(text_search_vector);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_asset_text_search;")
    op.execute("ALTER TABLE asset DROP COLUMN IF EXISTS text_search_vector;")
