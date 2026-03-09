"""Add parent_is_superseded to asset for O(1) superseded filter.

Revision ID: g8h9i0j1k2l3
Revises: f7g8h9i0j1k2
Create Date: 2026-02-26

Denormalizes the "child of superseded parent" check to avoid correlated
EXISTS subquery in non_superseded_filter. Enables indexed filter for scale.
"""
from alembic import op

revision = "g8h9i0j1k2l3"
down_revision = "f7g8h9i0j1k2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE asset ADD COLUMN IF NOT EXISTS parent_is_superseded BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        """
        UPDATE asset SET parent_is_superseded = TRUE
        WHERE parent_asset_id IN (SELECT id FROM asset WHERE is_superseded = TRUE)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_superseded_filter
        ON asset (is_superseded, parent_is_superseded)
        WHERE is_superseded = FALSE AND parent_is_superseded = FALSE
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_parent_is_superseded ON asset (parent_is_superseded)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_asset_superseded_filter")
    op.execute("DROP INDEX IF EXISTS ix_asset_parent_is_superseded")
    op.execute("ALTER TABLE asset DROP COLUMN IF EXISTS parent_is_superseded")
