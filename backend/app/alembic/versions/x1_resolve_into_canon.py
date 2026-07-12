"""Resolve-into-canon mode: annotationrun.resolve_into_canon + canon_proposal table.

Revision ID: x1_resolve_into_canon
Revises: w1_run_canon_ids
Create Date: 2026-06-30

The promote seam's "resolve into canon" mode. A run can be toggled into
settled-only curation: exact/alias matches auto-apply, unmatched mentions stage
as persistent, human-confirmed ``canon_proposal`` rows (never auto-created). A
new boolean on the run carries the mode; the new table holds the staged
proposals (deduped per canon+type+normalized-surface so live streaming bumps a
count rather than flooding).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "x1_resolve_into_canon"
down_revision = "w1_run_canon_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotationrun",
        sa.Column("resolve_into_canon", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_annotationrun_resolve_into_canon", "annotationrun", ["resolve_into_canon"])

    op.create_table(
        "canon_proposal",
        sa.Column("id", sa.Integer(), primary_key=True),
        # CASCADE from infospace and canon (a proposal can't outlive either); the run
        # is provenance only — keep the proposal if the run goes (SET NULL).
        sa.Column("infospace_id", sa.Integer(), sa.ForeignKey("infospace.id", ondelete="CASCADE"), nullable=False),
        sa.Column("canon_id", sa.Integer(), sa.ForeignKey("canon.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("annotationrun.id", ondelete="SET NULL"), nullable=True),
        sa.Column("surface", sa.String(), nullable=False),
        sa.Column("normalized_surface", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("suggested_entry_ids", JSONB(), nullable=False, server_default="[]"),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("example_annotation_ids", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("canon_id", "type", "normalized_surface", name="uq_canon_proposal_surface"),
    )
    op.create_index("ix_canon_proposal_infospace_id", "canon_proposal", ["infospace_id"])
    op.create_index("ix_canon_proposal_canon_id", "canon_proposal", ["canon_id"])
    op.create_index("ix_canon_proposal_run_id", "canon_proposal", ["run_id"])
    op.create_index("ix_canon_proposal_canon_status", "canon_proposal", ["canon_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_canon_proposal_canon_status", table_name="canon_proposal")
    op.drop_index("ix_canon_proposal_run_id", table_name="canon_proposal")
    op.drop_index("ix_canon_proposal_canon_id", table_name="canon_proposal")
    op.drop_index("ix_canon_proposal_infospace_id", table_name="canon_proposal")
    op.drop_table("canon_proposal")
    op.drop_index("ix_annotationrun_resolve_into_canon", table_name="annotationrun")
    op.drop_column("annotationrun", "resolve_into_canon")
