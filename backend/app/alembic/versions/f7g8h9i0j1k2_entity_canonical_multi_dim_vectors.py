"""Add multi-dimension pgvector columns to EntityCanonical; drop legacy JSON embedding.

Revision ID: f7g8h9i0j1k2
Revises: e6f7g8h9i0j1
Create Date: 2026-02-26

Adds embedding_384, embedding_512, embedding_1024, embedding_1536 (embedding_768 exists).
Backfills from legacy embedding JSON into matching dimension column.
Drops legacy embedding column.
"""
from alembic import op
from sqlalchemy import text

revision = "f7g8h9i0j1k2"
down_revision = "e6f7g8h9i0j1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Add new vector columns (embedding_768 already exists from r3l4m5n6o7p8)
    for dim in (384, 512, 1024, 1536):
        op.execute(f"ALTER TABLE entitycanonical ADD COLUMN IF NOT EXISTS embedding_{dim} vector({dim});")

    # Create HNSW indexes on new columns
    for dim in (384, 512, 1024, 1536):
        op.execute(f"""
            CREATE INDEX IF NOT EXISTS ix_entitycanonical_embedding_{dim}
            ON entitycanonical USING hnsw (embedding_{dim} vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
            WHERE embedding_{dim} IS NOT NULL;
        """)

    # Backfill from legacy embedding JSON to matching dimension column
    for dim in (384, 512, 768, 1024, 1536):
        conn.execute(
            text(f"""
                UPDATE entitycanonical
                SET embedding_{dim} = (embedding::text)::vector({dim})
                WHERE embedding IS NOT NULL
                  AND json_typeof(embedding) = 'array'
                  AND json_array_length(embedding) = {dim}
                  AND embedding_{dim} IS NULL;
            """)
        )

    # Drop legacy embedding column
    op.execute("ALTER TABLE entitycanonical DROP COLUMN IF EXISTS embedding;")


def downgrade() -> None:
    # Re-add embedding column as JSON
    op.execute("ALTER TABLE entitycanonical ADD COLUMN IF NOT EXISTS embedding jsonb;")

    # Copy from embedding_768 (best-effort; other dims lost)
    conn = op.get_bind()
    conn.execute(
        text("""
            UPDATE entitycanonical
            SET embedding = embedding_768::text::jsonb
            WHERE embedding_768 IS NOT NULL;
        """)
    )

    # Drop new columns and indexes
    for dim in (384, 512, 1024, 1536):
        op.execute(f"DROP INDEX IF EXISTS ix_entitycanonical_embedding_{dim};")
        op.execute(f"ALTER TABLE entitycanonical DROP COLUMN IF EXISTS embedding_{dim};")
