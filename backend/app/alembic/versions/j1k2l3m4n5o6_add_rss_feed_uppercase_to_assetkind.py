"""Add RSS_FEED (uppercase) to assetkind enum.

Revision ID: j1k2l3m4n5o6
Revises: i0j1k2l3m4n5
Create Date: 2026-02-27

SQLAlchemy sends the enum member name (RSS_FEED) when binding AssetKind in
NOT IN clauses, not the value. The DB must have 'RSS_FEED' to match.
"""
from alembic import op

revision = "j1k2l3m4n5o6"
down_revision = "i0j1k2l3m4n5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE assetkind ADD VALUE 'RSS_FEED';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """)


def downgrade() -> None:
    # PostgreSQL does not support removing enum values.
    pass
