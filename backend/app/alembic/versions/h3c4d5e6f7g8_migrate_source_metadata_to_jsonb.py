"""migrate_source_metadata_to_jsonb

Revision ID: h3c4d5e6f7g8
Revises: g2b3c4d5e6f7
Create Date: 2026-02-11

Migrate Asset.source_metadata from JSON to JSONB and add GIN index.
Enables efficient facet queries via source_metadata.facets.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "h3c4d5e6f7g8"
down_revision = "g2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade():
    # Alter column type from JSON to JSONB (PostgreSQL preserves data)
    op.execute("""
        ALTER TABLE asset
        ALTER COLUMN source_metadata TYPE JSONB
        USING source_metadata::jsonb
    """)
    op.create_index(
        "ix_asset_source_metadata",
        "asset",
        ["source_metadata"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"source_metadata": "jsonb_path_ops"},
    )


def downgrade():
    op.drop_index("ix_asset_source_metadata", table_name="asset")
    op.execute("""
        ALTER TABLE asset
        ALTER COLUMN source_metadata TYPE JSON
        USING source_metadata::json
    """)

