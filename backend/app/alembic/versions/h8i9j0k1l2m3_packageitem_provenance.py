"""Add provenance fields to PackageItem for tree construction.

derived_from_item_id: self-FK pointing to the parent PackageItem (ON DELETE CASCADE).
derivation_type: how this item was derived ("bundle_subtree", "run_schema", "graph_run").

Both NULL = top-level (explicit) item. Both non-NULL = derived item.

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-03-30

"""
from alembic import op
import sqlalchemy as sa

revision = "h8i9j0k1l2m3"
down_revision = "g7h8i9j0k1l2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("packageitem", sa.Column("derived_from_item_id", sa.Integer(), nullable=True))
    op.add_column("packageitem", sa.Column("derivation_type", sa.String(32), nullable=True))
    op.create_foreign_key(
        "fk_packageitem_derived_from",
        "packageitem",
        "packageitem",
        ["derived_from_item_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_packageitem_derived_from",
        "packageitem",
        ["derived_from_item_id"],
        postgresql_where=sa.text("derived_from_item_id IS NOT NULL"),
    )
    op.create_check_constraint(
        "ck_packageitem_derivation_consistency",
        "packageitem",
        "(derived_from_item_id IS NULL AND derivation_type IS NULL) OR "
        "(derived_from_item_id IS NOT NULL AND derivation_type IS NOT NULL)",
    )


def downgrade() -> None:
    # Remove all derived items first (they only exist because of this feature)
    op.execute("DELETE FROM packageitem WHERE derived_from_item_id IS NOT NULL")
    op.drop_constraint("ck_packageitem_derivation_consistency", "packageitem", type_="check")
    op.drop_index("ix_packageitem_derived_from", table_name="packageitem")
    op.drop_constraint("fk_packageitem_derived_from", "packageitem", type_="foreignkey")
    op.drop_column("packageitem", "derivation_type")
    op.drop_column("packageitem", "derived_from_item_id")
