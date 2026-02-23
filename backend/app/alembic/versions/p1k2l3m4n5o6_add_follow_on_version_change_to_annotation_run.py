"""Add follow_on_version_change and parent_run_id to annotationrun.

Revision ID: p1k2l3m4n5o6
Revises: o0j1k2l3m4n5
Create Date: 2025-02-19

"""
from alembic import op
import sqlalchemy as sa


revision = 'p1k2l3m4n5o6'
down_revision = 'o0j1k2l3m4n5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'annotationrun',
        sa.Column('follow_on_version_change', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.add_column(
        'annotationrun',
        sa.Column('parent_run_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_annotationrun_parent_run_id',
        'annotationrun', 'annotationrun',
        ['parent_run_id'], ['id'],
    )
    op.create_index('ix_annotationrun_follow_on_version_change', 'annotationrun', ['follow_on_version_change'], unique=False)
    op.create_index('ix_annotationrun_parent_run_id', 'annotationrun', ['parent_run_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_annotationrun_parent_run_id', table_name='annotationrun')
    op.drop_index('ix_annotationrun_follow_on_version_change', table_name='annotationrun')
    op.drop_constraint('fk_annotationrun_parent_run_id', 'annotationrun', type_='foreignkey')
    op.drop_column('annotationrun', 'parent_run_id')
    op.drop_column('annotationrun', 'follow_on_version_change')
