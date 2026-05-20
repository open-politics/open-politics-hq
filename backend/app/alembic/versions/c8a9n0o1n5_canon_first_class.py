"""Canon first-class: introduce Canon table, rename EntityCanonical → Entity,
GraphEdge subject/object → source/target, sparse EntityRelationship table,
PackageScope/PackageItem field renames, Infospace default canon pointers.

Revision ID: c8a9n0o1n5
Revises: p2j1k2l3m4n5
Create Date: 2026-05-05

This is the structural rework that promotes Canon to a first-class table
and reshapes the graph primitives to be methodologically sound:

- Per-triplet evidence (GraphEdge) uses graph-theory neutral source/target.
- Per-pair aggregate (EntityRelationship) is canonical-ordered, direction-agnostic.
- Entity belongs to a Canon (not nullably to a graph). Multi-canon-per-infospace
  is structurally enabled.

Downgrade is best-effort and one-way in practice — the multi-graph→single-canon
mapping introduced here is not invertible without ambiguity. Same pattern as
the inline_justifications migration.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB


revision = "c8a9n0o1n5"
down_revision = "p2j1k2l3m4n5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # ── 1. canon table ─────────────────────────────────────────────────────
    # Canon CASCADEs from infospace — when an infospace is deleted, its
    # canons (and via them, entities) are destroyed. Individual canon delete
    # goes through the /action/delete preview/confirm route which surfaces
    # any KnowledgeGraph references as blockers.
    op.create_table(
        "canon",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("uuid", sa.String(), nullable=False, unique=True),
        sa.Column("infospace_id", sa.Integer(),
                  sa.ForeignKey("infospace.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("role", sa.String(), nullable=False, server_default="general"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_canon_uuid", "canon", ["uuid"], unique=True)
    op.create_index("ix_canon_infospace_id", "canon", ["infospace_id"])
    op.create_index("ix_canon_infospace_role", "canon", ["infospace_id", "role"])

    # ── 2. infospace.default_canon_id, default_geo_canon_id (nullable) ─────
    op.add_column("infospace",
        sa.Column("default_canon_id", sa.Integer(), nullable=True))
    op.add_column("infospace",
        sa.Column("default_geo_canon_id", sa.Integer(), nullable=True))
    op.create_index("ix_infospace_default_canon_id", "infospace", ["default_canon_id"])
    op.create_index("ix_infospace_default_geo_canon_id", "infospace", ["default_geo_canon_id"])

    # ── 3. one "General" canon per infospace; wire default_canon_id ────────
    bind.execute(text("""
        INSERT INTO canon (uuid, infospace_id, name, description, role, created_at, updated_at)
        SELECT
            gen_random_uuid()::text,
            i.id,
            'General',
            'Default vocabulary for this infospace.',
            'general',
            NOW(),
            NOW()
        FROM infospace i
        WHERE NOT EXISTS (
            SELECT 1 FROM canon c
            WHERE c.infospace_id = i.id
              AND c.role = 'general'
              AND c.name = 'General'
        )
    """))
    bind.execute(text("""
        UPDATE infospace
        SET default_canon_id = (
            SELECT c.id FROM canon c
            WHERE c.infospace_id = infospace.id
              AND c.role = 'general'
              AND c.name = 'General'
            ORDER BY c.id ASC LIMIT 1
        )
        WHERE default_canon_id IS NULL
    """))
    op.create_foreign_key(
        "fk_infospace_default_canon", "infospace", "canon",
        ["default_canon_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_infospace_default_geo_canon", "infospace", "canon",
        ["default_geo_canon_id"], ["id"],
    )

    # ── 4. one canon per existing knowledgegraph; build temp map ───────────
    bind.execute(text("""
        INSERT INTO canon (uuid, infospace_id, name, description, role, created_at, updated_at)
        SELECT
            gen_random_uuid()::text,
            kg.infospace_id,
            kg.name,
            'Migrated canon for graph #' || kg.id,
            'general',
            COALESCE(kg.created_at, NOW()),
            NOW()
        FROM knowledgegraph kg
    """))
    bind.execute(text("""
        CREATE TEMP TABLE _graph_canon_map AS
        SELECT
            kg.id AS graph_id,
            (SELECT c.id FROM canon c
             WHERE c.infospace_id = kg.infospace_id
               AND c.description = 'Migrated canon for graph #' || kg.id
             LIMIT 1) AS canon_id
        FROM knowledgegraph kg
    """))

    # ── 5. knowledgegraph.canon_id (NOT NULL after backfill) ───────────────
    op.add_column("knowledgegraph",
        sa.Column("canon_id", sa.Integer(), nullable=True))
    bind.execute(text("""
        UPDATE knowledgegraph kg
        SET canon_id = m.canon_id
        FROM _graph_canon_map m
        WHERE kg.id = m.graph_id
    """))
    op.alter_column("knowledgegraph", "canon_id", nullable=False)
    op.create_foreign_key(
        "fk_knowledgegraph_canon", "knowledgegraph", "canon",
        ["canon_id"], ["id"],
    )
    op.create_index("ix_knowledge_graph_canon", "knowledgegraph", ["canon_id"])
    # Tighten knowledgegraph → infospace to CASCADE
    op.execute("ALTER TABLE knowledgegraph DROP CONSTRAINT IF EXISTS knowledgegraph_infospace_id_fkey")
    op.create_foreign_key(
        "knowledgegraph_infospace_id_fkey", "knowledgegraph", "infospace",
        ["infospace_id"], ["id"], ondelete="CASCADE",
    )

    # ── 6. entitycanonical: add uuid, canon_id, additional_types ───────────
    op.add_column("entitycanonical",
        sa.Column("uuid", sa.String(), nullable=True))
    bind.execute(text(
        "UPDATE entitycanonical SET uuid = gen_random_uuid()::text WHERE uuid IS NULL"
    ))
    op.alter_column("entitycanonical", "uuid", nullable=False)

    op.add_column("entitycanonical",
        sa.Column("canon_id", sa.Integer(), nullable=True))
    op.add_column("entitycanonical",
        sa.Column("additional_types", JSONB(), nullable=False, server_default="[]"))

    # Backfill canon_id: graph-scoped entities → graph's canon; NULL-graph
    # entities → infospace's General canon.
    bind.execute(text("""
        UPDATE entitycanonical e
        SET canon_id = m.canon_id
        FROM _graph_canon_map m
        WHERE e.graph_id = m.graph_id
    """))
    bind.execute(text("""
        UPDATE entitycanonical e
        SET canon_id = (
            SELECT i.default_canon_id FROM infospace i WHERE i.id = e.infospace_id
        )
        WHERE e.canon_id IS NULL
    """))
    op.alter_column("entitycanonical", "canon_id", nullable=False)

    # Drop graph_id (was nullable, now structurally replaced by canon_id).
    # FK was originally named ``fk_entitycanonical_graph_id`` (explicit SA name);
    # use IF EXISTS to tolerate either naming convention.
    op.execute("DROP INDEX IF EXISTS ix_entity_canonical_graph")
    op.execute("ALTER TABLE entitycanonical DROP CONSTRAINT IF EXISTS fk_entitycanonical_graph_id")
    op.execute("ALTER TABLE entitycanonical DROP CONSTRAINT IF EXISTS entitycanonical_graph_id_fkey")
    op.drop_column("entitycanonical", "graph_id")

    # ── 7. RENAME TABLE entitycanonical → entity ───────────────────────────
    op.rename_table("entitycanonical", "entity")

    # Rename composite + embedding indexes for consistency
    op.execute("ALTER INDEX IF EXISTS ix_entity_canonical_infospace_type RENAME TO ix_entity_infospace_type")
    op.execute("ALTER INDEX IF EXISTS ix_entitycanonical_embedding_384 RENAME TO ix_entity_embedding_384")
    op.execute("ALTER INDEX IF EXISTS ix_entitycanonical_embedding_512 RENAME TO ix_entity_embedding_512")
    op.execute("ALTER INDEX IF EXISTS ix_entitycanonical_embedding_768 RENAME TO ix_entity_embedding_768")
    op.execute("ALTER INDEX IF EXISTS ix_entitycanonical_embedding_1024 RENAME TO ix_entity_embedding_1024")
    op.execute("ALTER INDEX IF EXISTS ix_entitycanonical_embedding_1536 RENAME TO ix_entity_embedding_1536")
    # Existing single-column FK index on infospace_id (auto-created by SQLAlchemy index=True)
    op.execute("ALTER INDEX IF EXISTS ix_entitycanonical_infospace_id RENAME TO ix_entity_infospace_id")
    op.execute("ALTER INDEX IF EXISTS ix_entitycanonical_uuid RENAME TO ix_entity_uuid")

    # FK + index for canon_id. Entities CASCADE from canon (and transitively
    # from infospace via the canon CASCADE chain).
    op.create_foreign_key(
        "fk_entity_canon", "entity", "canon",
        ["canon_id"], ["id"], ondelete="CASCADE",
    )
    # Tighten infospace FK to CASCADE too — when an infospace dies, its
    # entities die with it (via canon CASCADE; the direct infospace FK
    # closes the gap if a backfill ever leaves orphans).
    op.execute("ALTER TABLE entity DROP CONSTRAINT IF EXISTS entitycanonical_infospace_id_fkey")
    op.execute("ALTER TABLE entity DROP CONSTRAINT IF EXISTS entity_infospace_id_fkey")
    op.create_foreign_key(
        "entity_infospace_id_fkey", "entity", "infospace",
        ["infospace_id"], ["id"], ondelete="CASCADE",
    )
    op.create_index("ix_entity_canon_id", "entity", ["canon_id"])
    op.create_index("ix_entity_canon_type", "entity", ["canon_id", "entity_type"])
    # uuid uniqueness
    op.create_unique_constraint("uq_entity_uuid", "entity", ["uuid"])
    # GIN index on additional_types
    op.execute(
        "CREATE INDEX ix_entity_additional_types ON entity USING gin (additional_types)"
    )

    # ── 8. GraphEdge: subject/object → source/target + index rebase ────────
    op.alter_column("graphedge", "subject_entity_id", new_column_name="source_entity_id")
    op.alter_column("graphedge", "object_entity_id", new_column_name="target_entity_id")
    # Drop the old infospace-scoped indexes; create the new graph-scoped ones.
    op.execute("DROP INDEX IF EXISTS ix_graph_edge_infospace_subject")
    op.execute("DROP INDEX IF EXISTS ix_graph_edge_infospace_object")
    # Rename the auto-created single-col FK indexes
    op.execute("ALTER INDEX IF EXISTS ix_graphedge_subject_entity_id RENAME TO ix_graphedge_source_entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_graphedge_object_entity_id RENAME TO ix_graphedge_target_entity_id")
    op.create_index("ix_graph_edge_graph_source", "graphedge", ["graph_id", "source_entity_id"])
    op.create_index("ix_graph_edge_graph_target", "graphedge", ["graph_id", "target_entity_id"])

    # ── 9. FragmentCuration: subject/object → source/target; entity_canonical_id → entity_id ──
    op.alter_column("fragmentcuration", "subject_entity_id", new_column_name="source_entity_id")
    op.alter_column("fragmentcuration", "object_entity_id", new_column_name="target_entity_id")
    op.alter_column("fragmentcuration", "entity_canonical_id", new_column_name="entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_subject_entity_id RENAME TO ix_fragmentcuration_source_entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_object_entity_id RENAME TO ix_fragmentcuration_target_entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_entity_canonical_id RENAME TO ix_fragmentcuration_entity_id")

    # ── 10. EntityEditLog: entity_canonical_id → entity_id ─────────────────
    op.alter_column("entityeditlog", "entity_canonical_id", new_column_name="entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_entityeditlog_entity_canonical_id RENAME TO ix_entityeditlog_entity_id")

    # ── 11. PackageItem: entity_canonical_id → entity_id + canon_id ────────
    op.drop_constraint("ck_packageitem_exactly_one_fk", "packageitem", type_="check")
    op.alter_column("packageitem", "entity_canonical_id", new_column_name="entity_id")
    op.add_column("packageitem",
        sa.Column("canon_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_packageitem_canon", "packageitem", "canon",
        ["canon_id"], ["id"], ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_packageitem_exactly_one_fk",
        "packageitem",
        "(bundle_id IS NOT NULL)::int + (run_id IS NOT NULL)::int + "
        "(graph_id IS NOT NULL)::int + (schema_id IS NOT NULL)::int + "
        "(asset_id IS NOT NULL)::int + (entity_id IS NOT NULL)::int + "
        "(canon_id IS NOT NULL)::int = 1",
    )

    # ── 12. entityrelationship table ───────────────────────────────────────
    op.create_table(
        "entityrelationship",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entity_a_id", sa.Integer(),
                  sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_b_id", sa.Integer(),
                  sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("graph_id", sa.Integer(),
                  sa.ForeignKey("knowledgegraph.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("tags", JSONB(), nullable=False, server_default="[]"),
        sa.Column("properties", JSONB(), nullable=False, server_default="{}"),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("graph_id", "entity_a_id", "entity_b_id", name="uq_entityrelationship_pair"),
        sa.CheckConstraint("entity_a_id < entity_b_id", name="ck_entityrelationship_canonical_order"),
    )
    op.create_index("ix_entityrelationship_entity_a_id", "entityrelationship", ["entity_a_id"])
    op.create_index("ix_entityrelationship_entity_b_id", "entityrelationship", ["entity_b_id"])
    op.create_index("ix_entityrelationship_graph_id", "entityrelationship", ["graph_id"])
    op.create_index("ix_entityrelationship_graph_a", "entityrelationship", ["graph_id", "entity_a_id"])
    op.create_index("ix_entityrelationship_graph_b", "entityrelationship", ["graph_id", "entity_b_id"])
    op.create_index("ix_entityrelationship_is_pinned", "entityrelationship", ["is_pinned"])
    op.execute(
        "CREATE INDEX ix_entityrelationship_tags ON entityrelationship USING gin (tags)"
    )

    # ── 13. infospace.default_canon_id stays nullable ──────────────────────
    # Chicken-and-egg: a fresh infospace insert can't reference a canon that
    # doesn't exist yet. Application code (``infospace_service.create_infospace``,
    # ``seed.py``) atomically creates the General canon and wires it post-flush.
    # Migration backfill ensures every existing row has a value. Tests assert
    # the invariant holds after creation. NOT NULL at DB level would force a
    # deferrable-constraint dance for marginal benefit; keep it nullable.

    # ── 14. Cleanup ────────────────────────────────────────────────────────
    op.execute("DROP TABLE IF EXISTS _graph_canon_map")


def downgrade() -> None:
    """Best-effort downgrade. One-way in practice — the multi-graph→single-canon
    mapping is not invertible. Documented as such; do not rely on this for
    production rollback."""

    # Drop entityrelationship
    op.drop_index("ix_entityrelationship_tags", table_name="entityrelationship")
    op.drop_index("ix_entityrelationship_is_pinned", table_name="entityrelationship")
    op.drop_index("ix_entityrelationship_graph_b", table_name="entityrelationship")
    op.drop_index("ix_entityrelationship_graph_a", table_name="entityrelationship")
    op.drop_index("ix_entityrelationship_graph_id", table_name="entityrelationship")
    op.drop_index("ix_entityrelationship_entity_b_id", table_name="entityrelationship")
    op.drop_index("ix_entityrelationship_entity_a_id", table_name="entityrelationship")
    op.drop_table("entityrelationship")

    # PackageItem: revert canon_id + entity_id rename
    op.drop_constraint("ck_packageitem_exactly_one_fk", "packageitem", type_="check")
    op.drop_constraint("fk_packageitem_canon", "packageitem", type_="foreignkey")
    op.drop_column("packageitem", "canon_id")
    op.alter_column("packageitem", "entity_id", new_column_name="entity_canonical_id")
    op.create_check_constraint(
        "ck_packageitem_exactly_one_fk",
        "packageitem",
        "(bundle_id IS NOT NULL)::int + (run_id IS NOT NULL)::int + "
        "(graph_id IS NOT NULL)::int + (schema_id IS NOT NULL)::int + "
        "(asset_id IS NOT NULL)::int + (entity_canonical_id IS NOT NULL)::int = 1",
    )

    # EntityEditLog
    op.alter_column("entityeditlog", "entity_id", new_column_name="entity_canonical_id")

    # FragmentCuration
    op.alter_column("fragmentcuration", "entity_id", new_column_name="entity_canonical_id")
    op.alter_column("fragmentcuration", "target_entity_id", new_column_name="object_entity_id")
    op.alter_column("fragmentcuration", "source_entity_id", new_column_name="subject_entity_id")

    # GraphEdge
    op.drop_index("ix_graph_edge_graph_target", table_name="graphedge")
    op.drop_index("ix_graph_edge_graph_source", table_name="graphedge")
    op.alter_column("graphedge", "target_entity_id", new_column_name="object_entity_id")
    op.alter_column("graphedge", "source_entity_id", new_column_name="subject_entity_id")
    op.create_index("ix_graph_edge_infospace_subject", "graphedge", ["infospace_id", "subject_entity_id"])
    op.create_index("ix_graph_edge_infospace_object", "graphedge", ["infospace_id", "object_entity_id"])

    # entity → entitycanonical
    op.drop_index("ix_entity_additional_types", table_name="entity")
    op.drop_index("ix_entity_canon_type", table_name="entity")
    op.drop_index("ix_entity_canon_id", table_name="entity")
    op.drop_constraint("uq_entity_uuid", "entity", type_="unique")
    op.drop_constraint("fk_entity_canon", "entity", type_="foreignkey")
    op.rename_table("entity", "entitycanonical")
    op.execute("ALTER INDEX IF EXISTS ix_entity_infospace_type RENAME TO ix_entity_canonical_infospace_type")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_384 RENAME TO ix_entitycanonical_embedding_384")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_512 RENAME TO ix_entitycanonical_embedding_512")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_768 RENAME TO ix_entitycanonical_embedding_768")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_1024 RENAME TO ix_entitycanonical_embedding_1024")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_1536 RENAME TO ix_entitycanonical_embedding_1536")
    op.execute("ALTER INDEX IF EXISTS ix_entity_infospace_id RENAME TO ix_entitycanonical_infospace_id")
    op.execute("ALTER INDEX IF EXISTS ix_entity_uuid RENAME TO ix_entitycanonical_uuid")

    # Restore graph_id on entitycanonical (best-effort: pick any one graph
    # whose canon matches; loses information when multiple graphs share a canon)
    op.add_column("entitycanonical",
        sa.Column("graph_id", sa.Integer(), nullable=True))
    op.execute("""
        UPDATE entitycanonical e
        SET graph_id = (
            SELECT kg.id FROM knowledgegraph kg
            WHERE kg.canon_id = e.canon_id
            ORDER BY kg.id ASC LIMIT 1
        )
    """)
    op.create_foreign_key(
        "entitycanonical_graph_id_fkey", "entitycanonical", "knowledgegraph",
        ["graph_id"], ["id"],
    )
    op.create_index("ix_entity_canonical_graph", "entitycanonical", ["graph_id"])

    op.drop_column("entitycanonical", "additional_types")
    op.drop_column("entitycanonical", "canon_id")
    op.drop_column("entitycanonical", "uuid")

    # Knowledgegraph
    op.drop_index("ix_knowledge_graph_canon", table_name="knowledgegraph")
    op.drop_constraint("fk_knowledgegraph_canon", "knowledgegraph", type_="foreignkey")
    op.drop_column("knowledgegraph", "canon_id")

    # Infospace
    op.drop_constraint("fk_infospace_default_geo_canon", "infospace", type_="foreignkey")
    op.drop_constraint("fk_infospace_default_canon", "infospace", type_="foreignkey")
    op.drop_index("ix_infospace_default_geo_canon_id", table_name="infospace")
    op.drop_index("ix_infospace_default_canon_id", table_name="infospace")
    op.drop_column("infospace", "default_geo_canon_id")
    op.drop_column("infospace", "default_canon_id")

    # Canon
    op.drop_index("ix_canon_infospace_role", table_name="canon")
    op.drop_index("ix_canon_infospace_id", table_name="canon")
    op.drop_index("ix_canon_uuid", table_name="canon")
    op.drop_table("canon")
