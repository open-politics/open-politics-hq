"""Schema revisions, and a change clock on annotations.

Hand-written. A schema's contract used to be rewritten in place, so the
annotations made under an older one claimed a contract they were not made
under, and nothing could tell a field the schema did not have yet from one the
model left empty.

- ``annotationschema.revision``: the head's number. 1 for every schema today.
- ``annotation_schema_revision``: contracts a schema has been revised away
  from. Empty to begin with: every annotation so far was made under its
  schema's current contract, as far as anything can now say.
- ``annotation.schema_rev``: the revision a value was extracted under. 1.
- ``runschemalink.rev``: NULL follows the head, a number pins the run.
- ``annotation.seq``: a run's change clock. Backfilled from ``id``, with the
  sequence started above it, so watermarks already stored as ``max(id)`` (the
  resolver's ``seeded_watermark``) compare unchanged. A trigger takes a new
  value whenever ``value`` changes, so a fill in place moves it too.

Revision ID: e1_schema_revisions
Revises: d2_entity_decision_group
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = "e1_schema_revisions"
down_revision = "d2_entity_decision_group"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("annotationschema", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.create_table(
        "annotation_schema_revision",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("schema_id", sa.Integer(), sa.ForeignKey("annotationschema.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rev", sa.Integer(), nullable=False),
        sa.Column("output_contract", sa.JSON(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("schema_id", "rev", name="uq_annotation_schema_revision"),
    )

    op.add_column("runschemalink", sa.Column("rev", sa.Integer(), nullable=True))
    op.add_column("annotation", sa.Column("schema_rev", sa.Integer(), nullable=False, server_default="1"))

    op.execute("CREATE SEQUENCE annotation_seq AS bigint")
    op.add_column("annotation", sa.Column("seq", sa.BigInteger(), nullable=True))
    op.execute("UPDATE annotation SET seq = id")
    op.execute("SELECT setval('annotation_seq', GREATEST((SELECT max(id) FROM annotation), 1))")
    op.execute("ALTER TABLE annotation ALTER COLUMN seq SET DEFAULT nextval('annotation_seq')")
    op.execute("ALTER TABLE annotation ALTER COLUMN seq SET NOT NULL")
    op.execute("ALTER SEQUENCE annotation_seq OWNED BY annotation.seq")
    op.create_index("ix_annotation_run_seq", "annotation", ["run_id", "seq"])
    op.execute("""
        CREATE FUNCTION annotation_touch_seq() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.seq := nextval('annotation_seq');
            RETURN NEW;
        END $$
    """)
    op.execute("""
        CREATE TRIGGER annotation_touch_seq
        BEFORE UPDATE OF value ON annotation
        FOR EACH ROW WHEN (OLD.value IS DISTINCT FROM NEW.value)
        EXECUTE FUNCTION annotation_touch_seq()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER annotation_touch_seq ON annotation")
    op.execute("DROP FUNCTION annotation_touch_seq()")
    op.drop_index("ix_annotation_run_seq", table_name="annotation")
    op.drop_column("annotation", "seq")  # drops the sequence it owns
    op.drop_column("annotation", "schema_rev")
    op.drop_column("runschemalink", "rev")
    op.drop_table("annotation_schema_revision")
    op.drop_column("annotationschema", "revision")
