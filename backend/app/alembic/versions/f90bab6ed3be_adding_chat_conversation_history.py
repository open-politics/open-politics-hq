"""adding chat conversation history

Revision ID: f90bab6ed3be
Revises: 6db950b63873
Create Date: 2025-10-02 16:13:33.739227

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
import pgvector
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision = 'f90bab6ed3be'
down_revision = '6db950b63873'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    # Add the 'stub' column as nullable first to avoid NOT NULL violation on existing rows
    op.add_column('asset', sa.Column('stub', sa.Boolean(), nullable=True))
    # Set all existing rows to False (default value)
    op.execute("UPDATE asset SET stub = FALSE WHERE stub IS NULL;")
    # Alter the column to set NOT NULL constraint
    op.alter_column('asset', 'stub', nullable=False)
    # Create the index
    op.create_index(op.f('ix_asset_stub'), 'asset', ['stub'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_asset_stub'), table_name='asset')
    op.drop_column('asset', 'stub')
