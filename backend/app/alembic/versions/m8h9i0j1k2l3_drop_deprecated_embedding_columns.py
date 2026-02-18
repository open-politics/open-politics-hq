"""Drop deprecated embedding_json and embedding_legacy columns from AssetChunk.

Dimension-class columns (embedding_384, embedding_512, etc.) are the canonical storage.
Data migration from embedding_json into dimension columns is handled by k6f7g8h9i0j1.
"""

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision = "m8h9i0j1k2l3"
down_revision = "l7g8h9i0j1k2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop HNSW index on embedding_legacy first
    op.drop_index(
        "ix_assetchunk_embedding_legacy",
        table_name="assetchunk",
        postgresql_using="hnsw",
    )
    # Drop deprecated columns
    op.drop_column("assetchunk", "embedding_json")
    op.drop_column("assetchunk", "embedding_legacy")


def downgrade() -> None:
    op.add_column(
        "assetchunk",
        sa.Column("embedding_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "assetchunk",
        sa.Column("embedding_legacy", Vector(1024), nullable=True),
    )
    op.create_index(
        "ix_assetchunk_embedding_legacy",
        "assetchunk",
        ["embedding_legacy"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
    )
