"""Add metadata and file_info columns for source_metadata decomposition.

Revision ID: c4d5e6f7g8h9
Revises: z1u2v3w4x5y6
Create Date: 2026-02-25

Adds metadata (enrichment-discovered facets) and file_info (intrinsic file properties).
Data migration copies from source_metadata. source_metadata retained for backward compat
until codebase rename is complete.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "c4d5e6f7g8h9"
down_revision = "z1u2v3w4x5y6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asset", sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("asset", sa.Column("file_info", JSONB(astext_type=sa.Text()), nullable=True))
    op.execute("""
        UPDATE asset
        SET metadata = source_metadata->'facets'
        WHERE source_metadata IS NOT NULL AND source_metadata->'facets' IS NOT NULL
    """)
    op.execute("""
        UPDATE asset
        SET file_info = source_metadata->'file'
        WHERE source_metadata IS NOT NULL AND source_metadata->'file' IS NOT NULL
    """)
    op.create_index(
        "ix_asset_metadata",
        "asset",
        ["metadata"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"metadata": "jsonb_path_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_asset_metadata", table_name="asset")
    op.drop_column("asset", "file_info")
    op.drop_column("asset", "metadata")
