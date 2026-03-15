"""Add embedding_2048 vector columns to assetchunk and entitycanonical.

Revision ID: q2r3s4t5u6v7
Revises: p1q2r3s4t5u6
Create Date: 2026-03-12

Adds embedding_2048 as a nullable pgvector column.
No HNSW index — pgvector caps HNSW at 2000 dimensions.
Sequential scan on the sparse IS NOT NULL filter is acceptable;
users needing fast search at this scale should use Matryoshka
truncation to 1536 or lower.
"""
from alembic import op

revision = "q2r3s4t5u6v7"
down_revision = "p1q2r3s4t5u6"
branch_labels = None
depends_on = None

DIM = 2048


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE assetchunk ADD COLUMN IF NOT EXISTS embedding_{DIM} vector({DIM});"
    )
    op.execute(
        f"ALTER TABLE entitycanonical ADD COLUMN IF NOT EXISTS embedding_{DIM} vector({DIM});"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE assetchunk DROP COLUMN IF EXISTS embedding_{DIM};")
    op.execute(f"ALTER TABLE entitycanonical DROP COLUMN IF EXISTS embedding_{DIM};")
