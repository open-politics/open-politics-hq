"""drop analysisadapter table

Revision ID: b0a5c2e7eb6a
Revises: l2m3n4o5p6q7
Create Date: 2026-04-16 09:19:25.955516

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b0a5c2e7eb6a'
down_revision = 'l2m3n4o5p6q7'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the analysisadapter table — replaced by the composable /view
    # endpoint and AnnotationQuery builder in annotation/query.py.
    op.drop_index(op.f('ix_analysisadapter_is_active'), table_name='analysisadapter')
    op.drop_index(op.f('ix_analysisadapter_name'), table_name='analysisadapter')
    op.drop_table('analysisadapter')


def downgrade():
    op.create_table(
        'analysisadapter',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('input_schema_definition', postgresql.JSONB(), nullable=True),
        sa.Column('output_schema_definition', postgresql.JSONB(), nullable=True),
        sa.Column('version', sa.String(), nullable=False, server_default='1.0'),
        sa.Column('module_path', sa.String(), nullable=True),
        sa.Column('adapter_type', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('creator_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['creator_user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_analysisadapter_name'), 'analysisadapter', ['name'], unique=False)
    op.create_index(op.f('ix_analysisadapter_is_active'), 'analysisadapter', ['is_active'], unique=False)
