"""Consolidate embedding config: drop legacy Infospace columns, EmbeddingProvider enum → varchar, simplify EmbeddingModel.

Merges all current heads and:
- Populates embedding_selection from embedding_model + default type_key 'ollama' where missing
- Drops Infospace columns: embedding_model, embedding_dim, vector_backend
- Converts EmbeddingModel.provider from embeddingprovider enum to varchar
- Drops unused EmbeddingModel columns: description, config, max_sequence_length, embedding_time_ms, updated_at
- Drops the embeddingprovider enum type

Revision ID: m1n2o3p4q5r6
Revises: b3c4d5e6f7g8, c4d5e6f7g8h9, i4d5e6f7g8h9, k1l2m3n4o5p6, n9i0j1k2l3m4
Create Date: 2026-03-04
"""
from alembic import op
import sqlalchemy as sa

revision = "m1n2o3p4q5r6"
down_revision = ("b3c4d5e6f7g8", "c4d5e6f7g8h9", "i4d5e6f7g8h9", "k1l2m3n4o5p6", "n9i0j1k2l3m4")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Data migration: populate embedding_selection from embedding_model where missing
    op.execute("""
        UPDATE infospace
        SET embedding_selection = json_build_object(
            'type_key', 'ollama',
            'model_name', embedding_model
        )
        WHERE embedding_model IS NOT NULL
          AND (embedding_selection IS NULL
               OR embedding_selection::text = 'null'
               OR (embedding_selection->>'model_name') IS NULL)
    """)

    # 2. Drop legacy Infospace columns
    op.drop_column("infospace", "embedding_model")
    op.drop_column("infospace", "embedding_dim")
    op.drop_column("infospace", "vector_backend")

    # 3. Convert EmbeddingModel.provider from enum to varchar
    op.alter_column(
        "embeddingmodel",
        "provider",
        type_=sa.String(),
        existing_type=sa.Enum("ollama", "jina", "openai", "huggingface", name="embeddingprovider"),
        postgresql_using="provider::text",
    )

    # 4. Drop unused EmbeddingModel columns
    op.drop_column("embeddingmodel", "description")
    op.drop_column("embeddingmodel", "config")
    op.drop_column("embeddingmodel", "max_sequence_length")
    op.drop_column("embeddingmodel", "embedding_time_ms")
    op.drop_column("embeddingmodel", "updated_at")

    # 5. Drop the enum type
    op.execute("DROP TYPE IF EXISTS embeddingprovider")


def downgrade() -> None:
    # Re-create enum
    embeddingprovider = sa.Enum("ollama", "jina", "openai", "huggingface", name="embeddingprovider")
    embeddingprovider.create(op.get_bind(), checkfirst=True)

    # Restore EmbeddingModel columns
    op.add_column("embeddingmodel", sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.add_column("embeddingmodel", sa.Column("embedding_time_ms", sa.Float(), nullable=True))
    op.add_column("embeddingmodel", sa.Column("max_sequence_length", sa.Integer(), nullable=True))
    op.add_column("embeddingmodel", sa.Column("config", sa.JSON(), nullable=True))
    op.add_column("embeddingmodel", sa.Column("description", sa.String(), nullable=True))

    # Revert provider column to enum
    op.alter_column(
        "embeddingmodel",
        "provider",
        type_=embeddingprovider,
        existing_type=sa.String(),
        postgresql_using="provider::embeddingprovider",
    )

    # Restore Infospace columns
    op.add_column("infospace", sa.Column("vector_backend", sa.String(), nullable=True, server_default="pgvector"))
    op.add_column("infospace", sa.Column("embedding_dim", sa.Integer(), nullable=True))
    op.add_column("infospace", sa.Column("embedding_model", sa.String(), nullable=True))

    # Backfill embedding_model from embedding_selection
    op.execute("""
        UPDATE infospace
        SET embedding_model = embedding_selection->>'model_name'
        WHERE embedding_selection IS NOT NULL
          AND (embedding_selection->>'model_name') IS NOT NULL
    """)
