"""Enrichment system schema: enrichment_resolved, enrichment_errors on Asset;
enrichment_config on Infospace; migrate embedding_selection into enrichment_config.

Revision ID: p1q2r3s4t5u6
Revises: m1n2o3p4q5r6
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision = "p1q2r3s4t5u6"
down_revision = "m1n2o3p4q5r6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Asset: enrichment tracking columns
    # enrichment_resolved is a native PG text[] array (used with array_append,
    # array_remove, @> containment operator in enricher code)
    op.add_column(
        "asset",
        sa.Column(
            "enrichment_resolved",
            ARRAY(sa.Text),
            server_default=sa.text("'{}'::text[]"),
            nullable=True,
        ),
    )
    op.add_column(
        "asset",
        sa.Column("enrichment_errors", JSONB, nullable=True),
    )
    # GIN index on enrichment_resolved for containment queries
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_enrichment_resolved "
        "ON asset USING gin (enrichment_resolved)"
    )

    # Infospace: enrichment_config column
    op.add_column(
        "infospace",
        sa.Column("enrichment_config", sa.JSON, nullable=True),
    )

    # Migrate legacy embedding_selection into enrichment_config.embedding
    # embedding_selection was a JSON column: {"provider_key": "...", "model_name": "..."}
    # (or with legacy "type_key" instead of "provider_key")
    op.execute("""
        UPDATE infospace
        SET enrichment_config = jsonb_build_object(
            'embedding',
            CASE
                WHEN embedding_selection::jsonb ? 'provider_key'
                THEN embedding_selection::jsonb
                WHEN embedding_selection::jsonb ? 'type_key'
                THEN jsonb_build_object(
                    'provider_key', embedding_selection->>'type_key',
                    'model_name', embedding_selection->>'model_name'
                )
                ELSE embedding_selection::jsonb
            END
        )
        WHERE embedding_selection IS NOT NULL
          AND enrichment_config IS NULL
    """)

    # Drop legacy column
    op.drop_column("infospace", "embedding_selection")


def downgrade() -> None:
    # Restore embedding_selection from enrichment_config
    op.add_column(
        "infospace",
        sa.Column("embedding_selection", sa.JSON, nullable=True),
    )
    op.execute("""
        UPDATE infospace
        SET embedding_selection = enrichment_config->'embedding'
        WHERE enrichment_config IS NOT NULL
          AND enrichment_config->'embedding' IS NOT NULL
    """)

    op.drop_column("infospace", "enrichment_config")
    op.drop_index("ix_asset_enrichment_resolved", table_name="asset")
    op.drop_column("asset", "enrichment_errors")
    op.drop_column("asset", "enrichment_resolved")
