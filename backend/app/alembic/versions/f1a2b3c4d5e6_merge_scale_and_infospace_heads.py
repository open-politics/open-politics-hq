"""merge_scale_and_infospace_heads

Revision ID: f1a2b3c4d5e6
Revises: d8e9f0a1b2c3, 4464015613e4
Create Date: 2026-02-11

Merge the two branch heads (composite indexes + enable_related_assets).
"""
from alembic import op


revision = "f1a2b3c4d5e6"
down_revision = ("d8e9f0a1b2c3", "4464015613e4")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
