"""entity_decision: the group a pair was asked in, and the label it chose.

Hand-written. The resolver now asks the model about a head and every label that
might be it in one request; ``group_key`` ties those rows together and ``name``
carries the label the group chose. Both are nullable: rows decided as lone pairs
keep their meaning, and a waiting pair is regrouped on the next seed.

Revision ID: d2_entity_decision_group
Revises: d1_entity_decision
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa

revision = "d2_entity_decision_group"
down_revision = "d1_entity_decision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("entity_decision", sa.Column("group_key", sa.String(), nullable=True))
    op.add_column("entity_decision", sa.Column("name", sa.String(), nullable=True))
    op.create_index("ix_entity_decision_run_group", "entity_decision", ["run_id", "group_key"])


def downgrade() -> None:
    op.drop_index("ix_entity_decision_run_group", table_name="entity_decision")
    op.drop_column("entity_decision", "name")
    op.drop_column("entity_decision", "group_key")
