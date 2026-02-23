"""Add embedding_768 pgvector column to EntityCanonical for SQL-level similarity search.

Revision ID: r3l4m5n6o7p8
Revises: q2l3m4n5o6p7
Create Date: 2025-02-19

Migrates existing embedding (JSON) data into embedding_768 when array length is 768.
"""
from alembic import op
from sqlalchemy import text

revision = "r3l4m5n6o7p8"
down_revision = "q2l3m4n5o6p7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    op.execute(
        "ALTER TABLE entitycanonical ADD COLUMN IF NOT EXISTS embedding_768 vector(768);"
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_entitycanonical_embedding_768
        ON entitycanonical USING hnsw (embedding_768 vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE embedding_768 IS NOT NULL;
        """
    )

    # Migrate JSON embedding to vector when dimension is 768
    conn = op.get_bind()
    conn.execute(
        text("""
            UPDATE entitycanonical
            SET embedding_768 = (embedding::text)::vector(768)
            WHERE embedding IS NOT NULL
              AND json_typeof(embedding) = 'array'
              AND json_array_length(embedding) = 768
        """)
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_entitycanonical_embedding_768;")
    op.execute("ALTER TABLE entitycanonical DROP COLUMN IF EXISTS embedding_768;")
