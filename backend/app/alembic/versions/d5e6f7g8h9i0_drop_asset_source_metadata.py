"""Drop source_metadata column from asset.

Revision ID: d5e6f7g8h9i0
Revises: b3c4d5e6f7g8, c4d5e6f7g8h9
Create Date: 2026-02-26

Completes metadata decomposition: drops source_metadata after codebase
migration to facets (metadata column) and file_info.
"""
from alembic import op

revision = "d5e6f7g8h9i0"
down_revision = ("b3c4d5e6f7g8", "c4d5e6f7g8h9")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop GIN index if it exists (from h3c4d5e6f7g8 migration)
    op.execute("DROP INDEX IF EXISTS ix_asset_source_metadata")
    op.drop_column("asset", "source_metadata")


def downgrade() -> None:
    from sqlalchemy.dialects.postgresql import JSONB
    import sqlalchemy as sa

    op.add_column("asset", sa.Column("source_metadata", JSONB(astext_type=sa.Text()), nullable=True))
    # Reconstruct from metadata + file_info (best-effort)
    op.execute("""
        UPDATE asset
        SET source_metadata = jsonb_build_object(
            'facets', COALESCE(metadata, '{}'::jsonb),
            'file', COALESCE(file_info, '{}'::jsonb)
        )
        WHERE metadata IS NOT NULL OR file_info IS NOT NULL
    """)
    op.create_index(
        "ix_asset_source_metadata",
        "asset",
        ["source_metadata"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"source_metadata": "jsonb_path_ops"},
    )
