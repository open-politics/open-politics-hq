"""Add graphedge table for O(1) graph traversal.

Revision ID: a2b3c4d5e6f7
Revises: z1u2v3w4x5y6
Create Date: 2026-02-25

"""
from alembic import op
import sqlalchemy as sa

revision = "a2b3c4d5e6f7"
down_revision = "z1u2v3w4x5y6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "graphedge",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("subject_entity_id", sa.Integer(), nullable=False),
        sa.Column("object_entity_id", sa.Integer(), nullable=False),
        sa.Column("predicate", sa.String(), nullable=True),
        sa.Column("annotation_id", sa.Integer(), nullable=False),
        sa.Column("infospace_id", sa.Integer(), nullable=False),
        sa.Column("graph_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["subject_entity_id"], ["entitycanonical.id"]),
        sa.ForeignKeyConstraint(["object_entity_id"], ["entitycanonical.id"]),
        sa.ForeignKeyConstraint(["annotation_id"], ["annotation.id"]),
        sa.ForeignKeyConstraint(["infospace_id"], ["infospace.id"]),
        sa.ForeignKeyConstraint(["graph_id"], ["knowledgegraph.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_graph_edge_infospace_subject",
        "graphedge",
        ["infospace_id", "subject_entity_id"],
        unique=False,
    )
    op.create_index(
        "ix_graph_edge_infospace_object",
        "graphedge",
        ["infospace_id", "object_entity_id"],
        unique=False,
    )
    op.create_index(op.f("ix_graphedge_subject_entity_id"), "graphedge", ["subject_entity_id"], unique=False)
    op.create_index(op.f("ix_graphedge_object_entity_id"), "graphedge", ["object_entity_id"], unique=False)
    op.create_index(op.f("ix_graphedge_annotation_id"), "graphedge", ["annotation_id"], unique=False)
    op.create_index(op.f("ix_graphedge_infospace_id"), "graphedge", ["infospace_id"], unique=False)
    op.create_index(op.f("ix_graphedge_graph_id"), "graphedge", ["graph_id"], unique=False)

    # Backfill from existing FragmentCuration records with resolved_refs (cast to jsonb: ? operator requires jsonb)
    op.execute("""
        INSERT INTO graphedge (subject_entity_id, object_entity_id, predicate, annotation_id, infospace_id, graph_id)
        SELECT
            (fc.resolved_refs->>'subject_id')::int,
            (fc.resolved_refs->>'object_id')::int,
            NULL,
            fc.annotation_id,
            (SELECT infospace_id FROM annotation a WHERE a.id = fc.annotation_id),
            (SELECT (run.graph_config->>'graph_id')::int FROM annotation a
             JOIN annotationrun run ON run.id = a.run_id
             WHERE a.id = fc.annotation_id
             AND run.graph_config IS NOT NULL
             LIMIT 1)
        FROM fragmentcuration fc
        WHERE fc.resolved_refs IS NOT NULL
        AND fc.resolved_refs::jsonb ? 'subject_id'
        AND fc.resolved_refs::jsonb ? 'object_id'
        AND (fc.resolved_refs->>'subject_id') ~ '^[0-9]+$'
        AND (fc.resolved_refs->>'object_id') ~ '^[0-9]+$'
    """)


def downgrade() -> None:
    op.drop_index(op.f("ix_graphedge_graph_id"), table_name="graphedge")
    op.drop_index(op.f("ix_graphedge_infospace_id"), table_name="graphedge")
    op.drop_index(op.f("ix_graphedge_annotation_id"), table_name="graphedge")
    op.drop_index(op.f("ix_graphedge_object_entity_id"), table_name="graphedge")
    op.drop_index(op.f("ix_graphedge_subject_entity_id"), table_name="graphedge")
    op.drop_index("ix_graph_edge_infospace_object", table_name="graphedge")
    op.drop_index("ix_graph_edge_infospace_subject", table_name="graphedge")
    op.drop_table("graphedge")
