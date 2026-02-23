"""add source_id to ingestionjob

Revision ID: u6o7p8q9r0s1
Revises: t5n6o7p8q9r0
Create Date: 2026-02-20 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "u6o7p8q9r0s1"
down_revision = "t5n6o7p8q9r0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ingestionjob",
        sa.Column("source_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_ingestionjob_source_id",
        "ingestionjob",
        "source",
        ["source_id"],
        ["id"],
    )
    op.create_index("ix_ingestionjob_source", "ingestionjob", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_ingestionjob_source", table_name="ingestionjob")
    op.drop_constraint("fk_ingestionjob_source_id", "ingestionjob", type_="foreignkey")
    op.drop_column("ingestionjob", "source_id")
