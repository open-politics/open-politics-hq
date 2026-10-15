"""entity_decision: the live resolver's log of merge and type decisions.

Hand-written. One row per pair of graph entities per run — what the logic model
(or a person) decided about them, and every earlier state of that decision in
``trail``. CASCADE from the run: these are the run's working decisions; the ones
worth keeping leave through promote (or were written into the canon directly,
``scope = 'canon'``), and outlive it there.

Revision ID: d1_entity_decision
Revises: c2_safe_timestamptz_parallel
Create Date: 2026-10-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "d1_entity_decision"
down_revision = "c2_safe_timestamptz_parallel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "entity_decision",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("infospace_id", sa.Integer(), sa.ForeignKey("infospace.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("annotationrun.id", ondelete="CASCADE"), nullable=False),
        sa.Column("a_name", sa.String(), nullable=False),
        sa.Column("a_type", sa.String(), nullable=False),
        sa.Column("b_name", sa.String(), nullable=False),
        sa.Column("b_type", sa.String(), nullable=False),
        sa.Column("pair_key", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("priority", sa.Float(), nullable=False, server_default="0"),
        sa.Column("state", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("keep", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=True),
        sa.Column("p_same", sa.Float(), nullable=True),
        sa.Column("p_type", JSONB(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("wire", sa.String(), nullable=True),
        sa.Column("scope", sa.String(), nullable=False, server_default="run"),
        sa.Column("canon_effect", JSONB(), nullable=True),
        sa.Column("decided_by", sa.Integer(), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trail", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("run_id", "pair_key", name="uq_entity_decision_pair"),
    )
    op.create_index("ix_entity_decision_infospace_id", "entity_decision", ["infospace_id"])
    op.create_index("ix_entity_decision_run_id", "entity_decision", ["run_id"])
    op.create_index("ix_entity_decision_run_status", "entity_decision", ["run_id", "status"])
    op.create_index("ix_entity_decision_run_priority", "entity_decision", ["run_id", "priority"])


def downgrade() -> None:
    op.drop_table("entity_decision")
