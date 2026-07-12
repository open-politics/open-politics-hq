"""Canon evolution (phase 2): generalize Entity → CanonEntry, full physical rename.

Revision ID: v1_canon_entry_rename
Revises: u1_infospace_cascade_delete
Create Date: 2026-06-29

The canon model grows up into a standalone, portable primitive. This migration
is the foundation: it renames the unit and generalizes its shape. No promote
seam, no embedding sidecar (the 6 pgvector columns + HNSW indexes are kept
verbatim), no nullable type (rename only — the `nullable=True` drop rides with
the deferred promote pass, where untyped value-fold entries first appear).

Structural changes
------------------
- ``entity`` table → ``canon_entry``; ``canonical_name`` → ``canonical``;
  ``entity_type`` → ``type`` (still NOT NULL). New: ``external_id`` (deterministic
  import-merge + soft cross-canon refs), ``tags`` (organizational, GIN), ``parents``
  (same-canon DAG of portable refs — strings, not FKs).
- ``canon``: drop ``role`` (+ its index) — geo is entries carrying geo properties,
  and the geocode hook already keys off ``infospace.default_geo_canon_id``. New:
  ``external_id``, ``tags`` (GIN).
- Consumer FK columns renamed to ``*_entry_id``: ``graphedge`` (source/target),
  ``entityrelationship`` (a/b — its CHECK + unique constraint expressions follow
  the rename automatically), ``fragmentcuration`` (source/target/entity_id),
  ``entityeditlog`` (entity_id). Index names follow for autogenerate cleanliness.
- ``packageitem.entity_id`` is intentionally NOT renamed: it is a wire-format key
  in the package/sharing layer and its FK auto-follows the table rename.

Indexes are renamed with ``ALTER INDEX IF EXISTS`` (safe no-op if absent).
Constraint renames use the exact names present in the DB.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "v1_canon_entry_rename"
down_revision = "u1_infospace_cascade_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. canon: drop role, add external_id + tags ────────────────────────
    op.drop_index("ix_canon_infospace_role", table_name="canon")
    op.drop_column("canon", "role")
    op.add_column("canon", sa.Column("external_id", sa.String(), nullable=True))
    op.add_column("canon", sa.Column("tags", JSONB(), nullable=False, server_default="[]"))
    op.create_index("ix_canon_external_id", "canon", ["external_id"])
    op.execute("CREATE INDEX ix_canon_tags ON canon USING gin (tags)")

    # ── 2. entity → canon_entry: rename table + columns ────────────────────
    op.rename_table("entity", "canon_entry")
    op.alter_column("canon_entry", "canonical_name", new_column_name="canonical")
    op.alter_column("canon_entry", "entity_type", new_column_name="type")

    # New columns. tags/parents mirror the additional_types convention
    # (server_default '[]', app supplies default_factory=list on insert).
    op.add_column("canon_entry", sa.Column("external_id", sa.String(), nullable=True))
    op.add_column("canon_entry", sa.Column("tags", JSONB(), nullable=False, server_default="[]"))
    op.add_column("canon_entry", sa.Column("parents", JSONB(), nullable=False, server_default="[]"))
    op.create_index("ix_canon_entry_external_id", "canon_entry", ["external_id"])
    op.execute("CREATE INDEX ix_canon_entry_tags ON canon_entry USING gin (tags)")

    # Rename indexes + constraints to the canon_entry namespace.
    op.execute("ALTER INDEX IF EXISTS ix_entity_infospace_type RENAME TO ix_canon_entry_infospace_type")
    op.execute("ALTER INDEX IF EXISTS ix_entity_canon_type RENAME TO ix_canon_entry_canon_type")
    op.execute("ALTER INDEX IF EXISTS ix_entity_canon_id RENAME TO ix_canon_entry_canon_id")
    op.execute("ALTER INDEX IF EXISTS ix_entity_infospace_id RENAME TO ix_canon_entry_infospace_id")
    op.execute("ALTER INDEX IF EXISTS ix_entity_additional_types RENAME TO ix_canon_entry_additional_types")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_384 RENAME TO ix_canon_entry_embedding_384")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_512 RENAME TO ix_canon_entry_embedding_512")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_768 RENAME TO ix_canon_entry_embedding_768")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_1024 RENAME TO ix_canon_entry_embedding_1024")
    op.execute("ALTER INDEX IF EXISTS ix_entity_embedding_1536 RENAME TO ix_canon_entry_embedding_1536")
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT entitycanonical_pkey TO canon_entry_pkey")
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT uq_entity_uuid TO uq_canon_entry_uuid")
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT fk_entity_canon TO fk_canon_entry_canon")
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT entity_infospace_id_fkey TO canon_entry_infospace_id_fkey")

    # ── 3. graphedge: source/target_entity_id → *_entry_id ─────────────────
    op.alter_column("graphedge", "source_entity_id", new_column_name="source_entry_id")
    op.alter_column("graphedge", "target_entity_id", new_column_name="target_entry_id")
    op.execute("ALTER INDEX IF EXISTS ix_graphedge_source_entity_id RENAME TO ix_graphedge_source_entry_id")
    op.execute("ALTER INDEX IF EXISTS ix_graphedge_target_entity_id RENAME TO ix_graphedge_target_entry_id")

    # ── 4. entityrelationship: entity_a/b_id → entry_a/b_id ────────────────
    # The CHECK (entry_a_id < entry_b_id) and unique (graph_id, entry_a_id,
    # entry_b_id) expressions follow the column rename automatically.
    op.alter_column("entityrelationship", "entity_a_id", new_column_name="entry_a_id")
    op.alter_column("entityrelationship", "entity_b_id", new_column_name="entry_b_id")
    op.execute("ALTER INDEX IF EXISTS ix_entityrelationship_entity_a_id RENAME TO ix_entityrelationship_entry_a_id")
    op.execute("ALTER INDEX IF EXISTS ix_entityrelationship_entity_b_id RENAME TO ix_entityrelationship_entry_b_id")

    # ── 5. fragmentcuration: source/target/entity_id → *_entry_id ──────────
    op.alter_column("fragmentcuration", "source_entity_id", new_column_name="source_entry_id")
    op.alter_column("fragmentcuration", "target_entity_id", new_column_name="target_entry_id")
    op.alter_column("fragmentcuration", "entity_id", new_column_name="entry_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_source_entity_id RENAME TO ix_fragmentcuration_source_entry_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_target_entity_id RENAME TO ix_fragmentcuration_target_entry_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_entity_id RENAME TO ix_fragmentcuration_entry_id")

    # ── 6. entityeditlog: entity_id → entry_id ─────────────────────────────
    op.alter_column("entityeditlog", "entity_id", new_column_name="entry_id")
    op.execute("ALTER INDEX IF EXISTS ix_entityeditlog_entity_id RENAME TO ix_entityeditlog_entry_id")


def downgrade() -> None:
    # ── 6. entityeditlog ───────────────────────────────────────────────────
    op.execute("ALTER INDEX IF EXISTS ix_entityeditlog_entry_id RENAME TO ix_entityeditlog_entity_id")
    op.alter_column("entityeditlog", "entry_id", new_column_name="entity_id")

    # ── 5. fragmentcuration ────────────────────────────────────────────────
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_entry_id RENAME TO ix_fragmentcuration_entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_target_entry_id RENAME TO ix_fragmentcuration_target_entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_fragmentcuration_source_entry_id RENAME TO ix_fragmentcuration_source_entity_id")
    op.alter_column("fragmentcuration", "entry_id", new_column_name="entity_id")
    op.alter_column("fragmentcuration", "target_entry_id", new_column_name="target_entity_id")
    op.alter_column("fragmentcuration", "source_entry_id", new_column_name="source_entity_id")

    # ── 4. entityrelationship ──────────────────────────────────────────────
    op.execute("ALTER INDEX IF EXISTS ix_entityrelationship_entry_b_id RENAME TO ix_entityrelationship_entity_b_id")
    op.execute("ALTER INDEX IF EXISTS ix_entityrelationship_entry_a_id RENAME TO ix_entityrelationship_entity_a_id")
    op.alter_column("entityrelationship", "entry_b_id", new_column_name="entity_b_id")
    op.alter_column("entityrelationship", "entry_a_id", new_column_name="entity_a_id")

    # ── 3. graphedge ───────────────────────────────────────────────────────
    op.execute("ALTER INDEX IF EXISTS ix_graphedge_target_entry_id RENAME TO ix_graphedge_target_entity_id")
    op.execute("ALTER INDEX IF EXISTS ix_graphedge_source_entry_id RENAME TO ix_graphedge_source_entity_id")
    op.alter_column("graphedge", "target_entry_id", new_column_name="target_entity_id")
    op.alter_column("graphedge", "source_entry_id", new_column_name="source_entity_id")

    # ── 2. canon_entry → entity ────────────────────────────────────────────
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT canon_entry_infospace_id_fkey TO entity_infospace_id_fkey")
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT fk_canon_entry_canon TO fk_entity_canon")
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT uq_canon_entry_uuid TO uq_entity_uuid")
    op.execute("ALTER TABLE canon_entry RENAME CONSTRAINT canon_entry_pkey TO entitycanonical_pkey")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_embedding_1536 RENAME TO ix_entity_embedding_1536")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_embedding_1024 RENAME TO ix_entity_embedding_1024")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_embedding_768 RENAME TO ix_entity_embedding_768")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_embedding_512 RENAME TO ix_entity_embedding_512")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_embedding_384 RENAME TO ix_entity_embedding_384")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_additional_types RENAME TO ix_entity_additional_types")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_infospace_id RENAME TO ix_entity_infospace_id")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_canon_id RENAME TO ix_entity_canon_id")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_canon_type RENAME TO ix_entity_canon_type")
    op.execute("ALTER INDEX IF EXISTS ix_canon_entry_infospace_type RENAME TO ix_entity_infospace_type")
    op.drop_index("ix_canon_entry_tags", table_name="canon_entry")
    op.drop_index("ix_canon_entry_external_id", table_name="canon_entry")
    op.drop_column("canon_entry", "parents")
    op.drop_column("canon_entry", "tags")
    op.drop_column("canon_entry", "external_id")
    op.alter_column("canon_entry", "type", new_column_name="entity_type")
    op.alter_column("canon_entry", "canonical", new_column_name="canonical_name")
    op.rename_table("canon_entry", "entity")

    # ── 1. canon ───────────────────────────────────────────────────────────
    op.drop_index("ix_canon_tags", table_name="canon")
    op.drop_index("ix_canon_external_id", table_name="canon")
    op.drop_column("canon", "tags")
    op.drop_column("canon", "external_id")
    op.add_column("canon", sa.Column("role", sa.String(), nullable=False, server_default="general"))
    op.create_index("ix_canon_infospace_role", "canon", ["infospace_id", "role"])
