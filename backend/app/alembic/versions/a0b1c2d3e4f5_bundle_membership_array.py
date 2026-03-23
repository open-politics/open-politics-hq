"""Bundle membership: bundle_id FK → bundle_ids integer array.

Migrates asset-bundle relationship from single FK to multi-membership array.
Adds GIN index, CHECK constraint, and cleanup trigger on bundle DELETE.

Revision ID: a0b1c2d3e4f5
Revises: z1u2v3w4x5y6
Create Date: 2026-03-17

"""
from alembic import op
import sqlalchemy as sa

revision = "a0b1c2d3e4f5"
down_revision = "r3s4t5u6v7w8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add bundle_ids column (integer array, nullable = unorganized)
    op.add_column(
        "asset",
        sa.Column(
            "bundle_ids",
            sa.ARRAY(sa.Integer),
            nullable=True,
            server_default=None,
        ),
    )

    # 2. Migrate data: copy bundle_id into bundle_ids array
    op.execute(
        "UPDATE asset SET bundle_ids = ARRAY[bundle_id] WHERE bundle_id IS NOT NULL"
    )

    # 3. GIN index for containment (@>) and overlap (&&) queries
    op.create_index(
        "ix_asset_bundle_ids",
        "asset",
        ["bundle_ids"],
        postgresql_using="gin",
    )

    # 4. CHECK constraint: no empty arrays (use NULL for unorganized)
    op.execute(
        "ALTER TABLE asset ADD CONSTRAINT ck_asset_bundle_ids_no_empty "
        "CHECK (bundle_ids IS NULL OR array_length(bundle_ids, 1) > 0)"
    )

    # 5. Cleanup trigger: when a bundle is deleted, remove its ID from all asset arrays
    op.execute("""
        CREATE OR REPLACE FUNCTION cleanup_bundle_ids() RETURNS trigger AS $$
        BEGIN
            UPDATE asset
            SET bundle_ids = CASE
                WHEN array_length(array_remove(bundle_ids, OLD.id), 1) IS NULL THEN NULL
                ELSE array_remove(bundle_ids, OLD.id)
            END
            WHERE bundle_ids @> ARRAY[OLD.id];
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_bundle_delete_cleanup
            BEFORE DELETE ON bundle FOR EACH ROW
            EXECUTE FUNCTION cleanup_bundle_ids();
    """)

    # 6. Drop old FK constraint and column
    # First drop the index on bundle_id
    op.drop_index("ix_asset_bundle_id", table_name="asset", if_exists=True)
    # Drop the composite index if it exists
    op.execute(
        "DROP INDEX IF EXISTS ix_asset_bundle_logical_path"
    )
    op.drop_constraint("asset_bundle_id_fkey", "asset", type_="foreignkey")
    op.drop_column("asset", "bundle_id")


def downgrade() -> None:
    # Re-add bundle_id column
    op.add_column(
        "asset",
        sa.Column("bundle_id", sa.Integer, sa.ForeignKey("bundle.id"), nullable=True),
    )

    # Migrate back: take first element of bundle_ids
    op.execute(
        "UPDATE asset SET bundle_id = bundle_ids[1] WHERE bundle_ids IS NOT NULL"
    )

    op.create_index("ix_asset_bundle_id", "asset", ["bundle_id"])

    # Drop new infrastructure
    op.execute("DROP TRIGGER IF EXISTS trg_bundle_delete_cleanup ON bundle")
    op.execute("DROP FUNCTION IF EXISTS cleanup_bundle_ids()")
    op.execute("ALTER TABLE asset DROP CONSTRAINT IF EXISTS ck_asset_bundle_ids_no_empty")
    op.drop_index("ix_asset_bundle_ids", table_name="asset")
    op.drop_column("asset", "bundle_ids")
