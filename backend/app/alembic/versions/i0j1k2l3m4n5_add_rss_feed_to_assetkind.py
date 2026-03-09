"""Add RSS_FEED to assetkind enum.

Revision ID: i0j1k2l3m4n5
Revises: h9i0j1k2l3m4
Create Date: 2026-02-26

Aligns PostgreSQL assetkind enum with Python AssetKind.RSS_FEED.
Required for _ReadyToEmbedWatcher which excludes container kinds (including RSS_FEED)
from embedding. Without this value, NOT IN (..., 'rss_feed') fails with
invalid input value for enum assetkind.
"""
from alembic import op

revision = "i0j1k2l3m4n5"
down_revision = "h9i0j1k2l3m4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE assetkind ADD VALUE 'rss_feed';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """)


def downgrade() -> None:
    # PostgreSQL does not support removing enum values.
    pass
