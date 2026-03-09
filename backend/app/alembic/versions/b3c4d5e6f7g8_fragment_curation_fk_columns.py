"""Replace resolved_refs JSONB with proper FK columns on FragmentCuration.

Revision ID: b3c4d5e6f7g8
Revises: a2b3c4d5e6f7
Create Date: 2026-02-25

"""
from alembic import op
import sqlalchemy as sa

revision = "b3c4d5e6f7g8"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fragmentcuration",
        sa.Column("subject_entity_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "fragmentcuration",
        sa.Column("object_entity_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "fragmentcuration",
        sa.Column("entity_canonical_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "fragmentcuration",
        sa.Column("source_asset_superseded", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "fragmentcuration",
        sa.Column("source_run_id", sa.Integer(), nullable=True),
    )

    # Backfill from resolved_refs (cast to jsonb: original column is json, ? operator requires jsonb)
    op.execute("""
        UPDATE fragmentcuration
        SET
            subject_entity_id = CASE
                WHEN resolved_refs::jsonb ? 'subject_id' AND (resolved_refs->>'subject_id') ~ '^[0-9]+$'
                THEN (resolved_refs->>'subject_id')::int ELSE NULL END,
            object_entity_id = CASE
                WHEN resolved_refs::jsonb ? 'object_id' AND (resolved_refs->>'object_id') ~ '^[0-9]+$'
                THEN (resolved_refs->>'object_id')::int ELSE NULL END,
            entity_canonical_id = CASE
                WHEN resolved_refs::jsonb ? 'entity_canonical_id' AND (resolved_refs->>'entity_canonical_id') ~ '^[0-9]+$'
                THEN (resolved_refs->>'entity_canonical_id')::int ELSE NULL END,
            source_asset_superseded = COALESCE(
                (resolved_refs->>'source_asset_superseded')::boolean, false),
            source_run_id = CASE
                WHEN resolved_refs::jsonb ? 'source_run_id' AND (resolved_refs->>'source_run_id') ~ '^[0-9]+$'
                THEN (resolved_refs->>'source_run_id')::int ELSE NULL END
        WHERE resolved_refs IS NOT NULL
    """)

    op.drop_column("fragmentcuration", "resolved_refs")

    op.create_foreign_key(
        "fk_fragmentcuration_subject_entity",
        "fragmentcuration", "entitycanonical",
        ["subject_entity_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_fragmentcuration_object_entity",
        "fragmentcuration", "entitycanonical",
        ["object_entity_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_fragmentcuration_entity_canonical",
        "fragmentcuration", "entitycanonical",
        ["entity_canonical_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_fragmentcuration_source_run",
        "fragmentcuration", "flowexecution",
        ["source_run_id"], ["id"],
    )
    op.create_index(
        "ix_fragmentcuration_subject_entity_id",
        "fragmentcuration", ["subject_entity_id"], unique=False,
    )
    op.create_index(
        "ix_fragmentcuration_object_entity_id",
        "fragmentcuration", ["object_entity_id"], unique=False,
    )
    op.create_index(
        "ix_fragmentcuration_entity_canonical_id",
        "fragmentcuration", ["entity_canonical_id"], unique=False,
    )
    op.create_index(
        "ix_fragmentcuration_source_run_id",
        "fragmentcuration", ["source_run_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_fragmentcuration_source_run_id", table_name="fragmentcuration")
    op.drop_index("ix_fragmentcuration_entity_canonical_id", table_name="fragmentcuration")
    op.drop_index("ix_fragmentcuration_object_entity_id", table_name="fragmentcuration")
    op.drop_index("ix_fragmentcuration_subject_entity_id", table_name="fragmentcuration")
    op.drop_constraint("fk_fragmentcuration_source_run", "fragmentcuration", type_="foreignkey")
    op.drop_constraint("fk_fragmentcuration_entity_canonical", "fragmentcuration", type_="foreignkey")
    op.drop_constraint("fk_fragmentcuration_object_entity", "fragmentcuration", type_="foreignkey")
    op.drop_constraint("fk_fragmentcuration_subject_entity", "fragmentcuration", type_="foreignkey")

    op.add_column(
        "fragmentcuration",
        sa.Column("resolved_refs", sa.JSON(), nullable=True),
    )
    op.execute("""
        UPDATE fragmentcuration SET resolved_refs = jsonb_build_object(
            'subject_id', subject_entity_id,
            'object_id', object_entity_id,
            'entity_canonical_id', entity_canonical_id,
            'source_asset_superseded', source_asset_superseded,
            'source_run_id', source_run_id
        )
        WHERE subject_entity_id IS NOT NULL OR object_entity_id IS NOT NULL
           OR entity_canonical_id IS NOT NULL OR source_run_id IS NOT NULL OR source_asset_superseded
    """)
    op.drop_column("fragmentcuration", "source_run_id")
    op.drop_column("fragmentcuration", "source_asset_superseded")
    op.drop_column("fragmentcuration", "entity_canonical_id")
    op.drop_column("fragmentcuration", "object_entity_id")
    op.drop_column("fragmentcuration", "subject_entity_id")
