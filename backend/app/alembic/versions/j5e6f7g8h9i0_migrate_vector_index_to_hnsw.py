"""Migrate vector index from IVFFlat to HNSW for better recall at scale.

Revision ID: j5e6f7g8h9i0
Revises: i4d5e6f7g8h9
Create Date: 2025-02-18

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'j5e6f7g8h9i0'
down_revision = 'i4d5e6f7g8h9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    op.drop_index(
        'ix_assetchunk_embedding_legacy',
        table_name='assetchunk',
        postgresql_using='ivfflat',
        postgresql_with={'lists': 100},
    )
    op.execute(
        "CREATE INDEX ix_assetchunk_embedding_legacy ON assetchunk "
        "USING hnsw (embedding_legacy vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64);"
    )


def downgrade() -> None:
    op.drop_index('ix_assetchunk_embedding_legacy', table_name='assetchunk', postgresql_using='hnsw')
    op.create_index(
        'ix_assetchunk_embedding_legacy',
        'assetchunk',
        ['embedding_legacy'],
        unique=False,
        postgresql_using='ivfflat',
        postgresql_with={'lists': 100},
    )
