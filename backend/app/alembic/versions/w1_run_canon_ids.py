"""Run-declares-canon: add canon_ids to annotationrun.

Revision ID: w1_run_canon_ids
Revises: v1_canon_entry_rename
Create Date: 2026-06-29

A run explicitly declares its coordinate frame — the canon(s) curation resolves
into — instead of falling back to the implicit infospace default. JSON list
(set-like, small, infospace-scoped, validated at write) mirrors the existing
``tags`` column; no join table. Existing runs get ``[]`` and keep the
default-canon fallback behavior unchanged.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "w1_run_canon_ids"
down_revision = "v1_canon_entry_rename"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotationrun",
        sa.Column("canon_ids", JSONB(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("annotationrun", "canon_ids")
