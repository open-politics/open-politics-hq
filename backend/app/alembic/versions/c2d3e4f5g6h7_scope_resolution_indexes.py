"""Add indexes for scope resolution performance.

annotation.run_id and annotation.asset_id are critical for the scope
visibility predicate (run-derived asset visibility) and annotation
detail views.

Revision ID: c2d3e4f5g6h7
Revises: b1c2d3e4f5g6
Create Date: 2026-03-19
"""

revision = "c2d3e4f5g6h7"
down_revision = "b1c2d3e4f5g6"
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.create_index(
        "ix_annotation_run_id",
        "annotation",
        ["run_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_annotation_asset_id",
        "annotation",
        ["asset_id"],
        if_not_exists=True,
    )
    # Verify parent indexes exist (created by earlier migrations, but belt-and-suspenders)
    op.create_index(
        "ix_asset_parent_id",
        "asset",
        ["parent_asset_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_annotation_run_id", table_name="annotation", if_exists=True)
    op.drop_index("ix_annotation_asset_id", table_name="annotation", if_exists=True)
    op.drop_index("ix_asset_parent_id", table_name="asset", if_exists=True)
