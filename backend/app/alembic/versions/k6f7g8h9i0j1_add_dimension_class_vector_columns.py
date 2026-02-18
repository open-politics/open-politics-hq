"""Add dimension-class vector columns for multi-model embedding support.

Revision ID: k6f7g8h9i0j1
Revises: j5e6f7g8h9i0
Create Date: 2025-02-18

Adds embedding_384, embedding_512, embedding_768, embedding_1024, embedding_1536
as nullable pgvector columns with HNSW indexes for indexed semantic search.
Migrates existing embedding_json data into the appropriate dimension column.
"""
from alembic import op
from sqlalchemy import text

revision = "k6f7g8h9i0j1"
down_revision = "j5e6f7g8h9i0"
branch_labels = None
depends_on = None

SUPPORTED_DIMS = (384, 512, 768, 1024, 1536)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    # Add dimension-class vector columns
    for dim in SUPPORTED_DIMS:
        op.execute(
            f"ALTER TABLE assetchunk ADD COLUMN IF NOT EXISTS embedding_{dim} vector({dim});"
        )

    # Create HNSW partial indexes (only index non-null rows)
    for dim in SUPPORTED_DIMS:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS ix_assetchunk_embedding_{dim} ON assetchunk "
            f"USING hnsw (embedding_{dim} vector_cosine_ops) "
            f"WITH (m = 16, ef_construction = 64) "
            f"WHERE embedding_{dim} IS NOT NULL;"
        )

    # Migrate existing embedding_json data to the appropriate vector column
    # Cast: embedding_json (JSON) -> text -> vector(dim)
    # CASE ensures json_array_length is only called when json_typeof='array' (short-circuit)
    # to avoid "cannot get array length of a scalar" for malformed/object/scalar rows
    conn = op.get_bind()
    for dim in SUPPORTED_DIMS:
        conn.execute(
            text(f"""
                UPDATE assetchunk c
                SET embedding_{dim} = (c.embedding_json::text)::vector({dim})
                FROM embeddingmodel em
                WHERE c.embedding_model_id = em.id
                  AND em.dimension = :dim
                  AND c.embedding_json IS NOT NULL
                  AND CASE WHEN json_typeof(c.embedding_json) = 'array'
                           THEN json_array_length(c.embedding_json) = :dim
                           ELSE false
                      END
            """),
            {"dim": dim},
        )


def downgrade() -> None:
    for dim in SUPPORTED_DIMS:
        op.execute(f"DROP INDEX IF EXISTS ix_assetchunk_embedding_{dim};")
    for dim in SUPPORTED_DIMS:
        op.execute(f"ALTER TABLE assetchunk DROP COLUMN IF EXISTS embedding_{dim};")
