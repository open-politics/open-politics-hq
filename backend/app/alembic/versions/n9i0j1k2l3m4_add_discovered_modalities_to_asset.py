"""Add discovered_modalities column to asset.

First-class JSON column for modalities discovered during processing (e.g. text, image).
Enables queryable OCR and multimodal routing without scanning source_metadata.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "n9i0j1k2l3m4"
down_revision = "m8h9i0j1k2l3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset",
        sa.Column("discovered_modalities", JSONB, nullable=True),
    )
    op.create_index(
        "ix_asset_discovered_modalities",
        "asset",
        ["discovered_modalities"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_asset_discovered_modalities",
        table_name="asset",
        postgresql_using="gin",
    )
    op.drop_column("asset", "discovered_modalities")
