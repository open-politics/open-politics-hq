"""Text vectors: what embed_texts has embedded, kept per infospace and model.

Hand-written. ``embed_texts`` embedded every text on every call — a searched
phrase again on each search, a name again for each canon entry. Now it reads
``text_vector`` first and writes what it had to ask a provider for. Keyed by
the text's sha256; the text itself is not kept. Both foreign keys cascade:
deleting an infospace clears its vectors, as the schema does for everything an
infospace owns.

No vector index: rows are only ever read by digest.

Revision ID: e2_text_vector
Revises: e1_schema_revisions
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "e2_text_vector"
down_revision = "e1_schema_revisions"
branch_labels = None
depends_on = None

DIMS = (384, 512, 768, 1024, 1536, 2048)


def upgrade() -> None:
    op.create_table(
        "text_vector",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("infospace_id", sa.Integer(), sa.ForeignKey("infospace.id", ondelete="CASCADE"), nullable=False),
        sa.Column("embedding_model_id", sa.Integer(), sa.ForeignKey("embeddingmodel.id", ondelete="CASCADE"), nullable=False),
        sa.Column("digest", sa.String(), nullable=False),
        *[sa.Column(f"embedding_{d}", Vector(d), nullable=True) for d in DIMS],
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("infospace_id", "embedding_model_id", "digest"),
    )


def downgrade() -> None:
    op.drop_table("text_vector")
