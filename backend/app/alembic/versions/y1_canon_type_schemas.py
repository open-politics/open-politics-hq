"""Canon.type_schemas: per-type property-shape declarations (portable, guidance not gate).

Revision ID: y1_canon_type_schemas
Revises: x1_resolve_into_canon
Create Date: 2026-06-30

A canon can now declare, per entity type, an ordered list of typed property
slots (``{type_name: [{name, type, description, required}]}``). It travels in
the portable export and only drives the workbench's typed editor — entries keep
a free-form ``properties`` bag, so this is guidance, never a validation gate.
JSONB to match the other canon JSON columns (e.g. ``tags``).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "y1_canon_type_schemas"
down_revision = "x1_resolve_into_canon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "canon",
        sa.Column("type_schemas", JSONB(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("canon", "type_schemas")
