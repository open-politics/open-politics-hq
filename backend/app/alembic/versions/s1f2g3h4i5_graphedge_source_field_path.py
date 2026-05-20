"""GraphEdge.source_field_path: tag each curated edge with the schema field
path that produced it, so multi-graph-field schemas can split or unify
rendering at inspection time.

Revision ID: s1f2g3h4i5
Revises: c8a9n0o1n5
Create Date: 2026-05-06

Background: pre-migration, the curation pipeline only walked the literal
``"triplets"`` JSON property on each annotation's value. With Phase 2 of the
schema-native-entities rework, schemas can declare multiple graph-shaped
fields under arbitrary names, and curation walks the schema to find them all.
For inspection to distinguish edges from different fields, each edge needs
to know which field produced it.

Backfill: every existing GraphEdge row gets ``source_field_path = "triplets"``
because that is — by definition — the only field path the legacy curation
pipeline ever read from. Stored annotations and panel configs that reference
the literal ``"triplets"`` key continue to work unchanged.

This migration is one-way in practice: dropping the column on downgrade is
clean (column is nullable, no FK), but renaming graph fields back to a single
``"triplets"`` key after multi-field data has been written is not invertible
without conflict.
"""

from alembic import op
import sqlalchemy as sa


revision = "s1f2g3h4i5"
down_revision = "c8a9n0o1n5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # ── Add nullable column ─────────────────────────────────────────────────
    op.add_column(
        "graphedge",
        sa.Column("source_field_path", sa.String(), nullable=True),
    )

    # ── Backfill legacy rows ────────────────────────────────────────────────
    # Every pre-existing edge came out of the literal "triplets" key — that is
    # the only path the legacy curation pipeline ever read from.
    bind.execute(sa.text(
        "UPDATE graphedge SET source_field_path = 'triplets' "
        "WHERE source_field_path IS NULL"
    ))

    # ── Indexes ─────────────────────────────────────────────────────────────
    # Single-column for "filter by field path"; compound with graph_id for
    # the panel's "this graph's edges from this field" pattern.
    op.create_index(
        "ix_graphedge_source_field_path",
        "graphedge",
        ["source_field_path"],
    )
    op.create_index(
        "ix_graph_edge_graph_field",
        "graphedge",
        ["graph_id", "source_field_path"],
    )


def downgrade() -> None:
    op.drop_index("ix_graph_edge_graph_field", table_name="graphedge")
    op.drop_index("ix_graphedge_source_field_path", table_name="graphedge")
    op.drop_column("graphedge", "source_field_path")
