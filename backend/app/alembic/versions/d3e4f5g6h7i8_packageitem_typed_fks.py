"""PackageItem: replace resource_type/resource_id with typed FK columns.

Migrates existing rows from (resource_type, resource_id) pairs to the
corresponding nullable FK column.  Adds CHECK constraint ensuring exactly
one FK is non-null per row.

Revision ID: d3e4f5g6h7i8
Revises: c2d3e4f5g6h7
Create Date: 2026-03-19
"""

revision = "d3e4f5g6h7i8"
down_revision = "c2d3e4f5g6h7"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    # 1. Add new typed FK columns (all nullable)
    op.add_column("packageitem", sa.Column("bundle_id", sa.Integer(), nullable=True))
    op.add_column("packageitem", sa.Column("run_id", sa.Integer(), nullable=True))
    op.add_column("packageitem", sa.Column("graph_id", sa.Integer(), nullable=True))
    op.add_column("packageitem", sa.Column("schema_id", sa.Integer(), nullable=True))
    op.add_column("packageitem", sa.Column("asset_id", sa.Integer(), nullable=True))
    op.add_column("packageitem", sa.Column("entity_canonical_id", sa.Integer(), nullable=True))

    # 2. Migrate existing data
    op.execute("""
        UPDATE packageitem SET bundle_id = resource_id WHERE resource_type = 'bundle';
        UPDATE packageitem SET run_id = resource_id WHERE resource_type = 'run';
        UPDATE packageitem SET graph_id = resource_id WHERE resource_type = 'graph';
        UPDATE packageitem SET schema_id = resource_id WHERE resource_type = 'schema';
        UPDATE packageitem SET asset_id = resource_id WHERE resource_type = 'asset';
        UPDATE packageitem SET entity_canonical_id = resource_id WHERE resource_type = 'entity';
    """)

    # 3. Add foreign keys
    op.create_foreign_key("fk_packageitem_bundle", "packageitem", "bundle", ["bundle_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_packageitem_run", "packageitem", "annotationrun", ["run_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_packageitem_graph", "packageitem", "knowledgegraph", ["graph_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_packageitem_schema", "packageitem", "annotationschema", ["schema_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_packageitem_asset", "packageitem", "asset", ["asset_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_packageitem_entity", "packageitem", "entitycanonical", ["entity_canonical_id"], ["id"], ondelete="CASCADE")

    # 4. Add CHECK constraint
    op.create_check_constraint(
        "ck_packageitem_exactly_one_fk",
        "packageitem",
        "(bundle_id IS NOT NULL)::int + (run_id IS NOT NULL)::int + "
        "(graph_id IS NOT NULL)::int + (schema_id IS NOT NULL)::int + "
        "(asset_id IS NOT NULL)::int + (entity_canonical_id IS NOT NULL)::int = 1",
    )

    # 5. Drop old columns and index
    op.drop_index("ix_packageitem_resource", table_name="packageitem", if_exists=True)
    op.drop_column("packageitem", "resource_type")
    op.drop_column("packageitem", "resource_id")


def downgrade() -> None:
    # Re-add old columns
    op.add_column("packageitem", sa.Column("resource_type", sa.String(), nullable=True))
    op.add_column("packageitem", sa.Column("resource_id", sa.Integer(), nullable=True))

    # Migrate data back
    op.execute("""
        UPDATE packageitem SET resource_type = 'bundle', resource_id = bundle_id WHERE bundle_id IS NOT NULL;
        UPDATE packageitem SET resource_type = 'run', resource_id = run_id WHERE run_id IS NOT NULL;
        UPDATE packageitem SET resource_type = 'graph', resource_id = graph_id WHERE graph_id IS NOT NULL;
        UPDATE packageitem SET resource_type = 'schema', resource_id = schema_id WHERE schema_id IS NOT NULL;
        UPDATE packageitem SET resource_type = 'asset', resource_id = asset_id WHERE asset_id IS NOT NULL;
        UPDATE packageitem SET resource_type = 'entity', resource_id = entity_canonical_id WHERE entity_canonical_id IS NOT NULL;
    """)

    # Drop CHECK, FKs, and new columns
    op.drop_constraint("ck_packageitem_exactly_one_fk", "packageitem")
    op.drop_constraint("fk_packageitem_bundle", "packageitem")
    op.drop_constraint("fk_packageitem_run", "packageitem")
    op.drop_constraint("fk_packageitem_graph", "packageitem")
    op.drop_constraint("fk_packageitem_schema", "packageitem")
    op.drop_constraint("fk_packageitem_asset", "packageitem")
    op.drop_constraint("fk_packageitem_entity", "packageitem")
    op.drop_column("packageitem", "bundle_id")
    op.drop_column("packageitem", "run_id")
    op.drop_column("packageitem", "graph_id")
    op.drop_column("packageitem", "schema_id")
    op.drop_column("packageitem", "asset_id")
    op.drop_column("packageitem", "entity_canonical_id")

    # Recreate old index
    op.create_index("ix_packageitem_resource", "packageitem", ["resource_type", "resource_id"])
