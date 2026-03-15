"""Widen EmbeddingModel unique constraint to include dimension.

Revision ID: r3s4t5u6v7w8
Revises: q2r3s4t5u6v7
Create Date: 2026-03-12

Matryoshka models can be deployed at different dimensions — same model at
768d vs 1024d produces incompatible vector spaces and needs separate rows.
"""
from alembic import op

revision = "r3s4t5u6v7w8"
down_revision = "q2r3s4t5u6v7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("embeddingmodel_name_provider_key", "embeddingmodel", type_="unique")
    op.create_unique_constraint(
        "embeddingmodel_name_provider_dimension_key",
        "embeddingmodel",
        ["name", "provider", "dimension"],
    )


def downgrade() -> None:
    op.drop_constraint("embeddingmodel_name_provider_dimension_key", "embeddingmodel", type_="unique")
    op.create_unique_constraint(
        "embeddingmodel_name_provider_key",
        "embeddingmodel",
        ["name", "provider"],
    )
