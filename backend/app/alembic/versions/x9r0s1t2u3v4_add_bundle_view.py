"""Add BundleView model for lightweight named subsets.

Revision ID: x9r0s1t2u3v4
Revises: w8q9r0s1t2u3
Create Date: 2026-02-21

"""
from alembic import op
import sqlalchemy as sa


revision = "x9r0s1t2u3v4"
down_revision = "w8q9r0s1t2u3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bundleview",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("source_bundle_id", sa.Integer(), nullable=False),
        sa.Column("path_prefix", sa.String(), nullable=False, server_default=""),
        sa.Column("infospace_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["infospace_id"], ["infospace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_bundle_id"], ["bundle.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bundleview_uuid", "bundleview", ["uuid"], unique=True)
    op.create_index("ix_bundleview_source_bundle_id", "bundleview", ["source_bundle_id"])
    op.create_index("ix_bundleview_infospace_id", "bundleview", ["infospace_id"])
    op.create_index("ix_bundleview_user_id", "bundleview", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_bundleview_user_id", table_name="bundleview")
    op.drop_index("ix_bundleview_infospace_id", table_name="bundleview")
    op.drop_index("ix_bundleview_source_bundle_id", table_name="bundleview")
    op.drop_index("ix_bundleview_uuid", table_name="bundleview")
    op.drop_table("bundleview")
