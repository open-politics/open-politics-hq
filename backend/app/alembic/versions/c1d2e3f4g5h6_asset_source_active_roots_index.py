"""composite index for AssetBuilder.find_match scans

Revision ID: c1d2e3f4g5h6
Revises: b0a5c2e7eb6a
Create Date: 2026-04-21 23:00:00.000000

Composite B-tree on asset(source_id, is_superseded, parent_asset_id) to back
AssetBuilder.find_match — the identity lookup used when an incoming asset has
a source_identifier or content_hash and we need to locate any prior matching
row for supersede/skip/update resolution.

Covers three common access patterns:
  1. source_id = X AND is_superseded = FALSE (find active version)
  2. source_id = X AND is_superseded = FALSE AND parent_asset_id IS NULL (active roots)
  3. source_id = X (any version, historical lookup)

See docs/plans/hq-v2/PRIMITIVES.md §1 for the full AssetBuilder contract.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "c1d2e3f4g5h6"
down_revision = "b0a5c2e7eb6a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_asset_source_active_roots",
        "asset",
        ["source_id", "is_superseded", "parent_asset_id"],
    )


def downgrade():
    op.drop_index("ix_asset_source_active_roots", table_name="asset")
