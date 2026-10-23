"""Schema drafts and trial runs: revising a schema inside a run.

Hand-written. A run's schema is edited as a draft before anything it made is
touched (``annotation/drafts.py``):

- ``annotationschema.draft_of``: the schema a draft would revise.
  ``draft_in``: the run it is drafted in. One draft per (run, schema); a draft
  goes with either. The active-name uniqueness skips drafts — a draft carries
  its schema's name and version until it is adopted or discarded.
- ``annotationrun.trial_of``: the run a trial run tries drafts for. One per
  run, gone with it.

Revision ID: e3_schema_drafts
Revises: e2_text_vector
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = "e3_schema_drafts"
down_revision = "e2_text_vector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("annotationschema", sa.Column(
        "draft_of", sa.Integer(), sa.ForeignKey("annotationschema.id", ondelete="CASCADE"), nullable=True))
    op.add_column("annotationschema", sa.Column(
        "draft_in", sa.Integer(), sa.ForeignKey("annotationrun.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_annotationschema_draft_of", "annotationschema", ["draft_of"])
    op.create_index("uq_annotationschema_draft", "annotationschema", ["draft_in", "draft_of"],
                    unique=True, postgresql_where=sa.text("draft_of IS NOT NULL"))
    op.drop_index("ix_unique_active_schema_name_version", table_name="annotationschema")
    op.create_index("ix_unique_active_schema_name_version", "annotationschema",
                    ["infospace_id", "name", "version"], unique=True,
                    postgresql_where=sa.text("is_active = true AND draft_of IS NULL"))

    op.add_column("annotationrun", sa.Column(
        "trial_of", sa.Integer(), sa.ForeignKey("annotationrun.id", ondelete="CASCADE"), nullable=True))
    op.create_unique_constraint("uq_annotationrun_trial_of", "annotationrun", ["trial_of"])


def downgrade() -> None:
    op.execute("DELETE FROM annotationrun WHERE trial_of IS NOT NULL")
    op.execute("DELETE FROM annotationschema WHERE draft_of IS NOT NULL")
    op.drop_constraint("uq_annotationrun_trial_of", "annotationrun", type_="unique")
    op.drop_column("annotationrun", "trial_of")
    op.drop_index("ix_unique_active_schema_name_version", table_name="annotationschema")
    op.create_index("ix_unique_active_schema_name_version", "annotationschema",
                    ["infospace_id", "name", "version"], unique=True,
                    postgresql_where=sa.text("is_active = true"))
    op.drop_index("uq_annotationschema_draft", table_name="annotationschema")
    op.drop_index("ix_annotationschema_draft_of", table_name="annotationschema")
    op.drop_column("annotationschema", "draft_in")
    op.drop_column("annotationschema", "draft_of")
