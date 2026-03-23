"""Drop legacy Package columns (manifest, asset_ids, schema_ids, run_ids).

These JSON columns were superseded by the PackageItem typed FK system.

Revision ID: e5f6g7h8i9j0
Revises: d3e4f5g6h7i8
Create Date: 2026-03-19 12:00:00.000000
"""
from alembic import op

revision = "e5f6g7h8i9j0"
down_revision = "d3e4f5g6h7i8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("package", "manifest")
    op.drop_column("package", "asset_ids")
    op.drop_column("package", "schema_ids")
    op.drop_column("package", "run_ids")


def downgrade() -> None:
    import sqlalchemy as sa
    op.add_column("package", sa.Column("manifest", sa.JSON(), nullable=True, server_default="{}"))
    op.add_column("package", sa.Column("asset_ids", sa.JSON(), nullable=True))
    op.add_column("package", sa.Column("schema_ids", sa.JSON(), nullable=True))
    op.add_column("package", sa.Column("run_ids", sa.JSON(), nullable=True))
