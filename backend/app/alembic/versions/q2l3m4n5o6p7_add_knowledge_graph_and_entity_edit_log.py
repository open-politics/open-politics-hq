"""Add KnowledgeGraph, EntityEditLog; add graph_id and provenance_type to EntityCanonical.

Revision ID: q2l3m4n5o6p7
Revises: p1k2l3m4n5o6
Create Date: 2025-02-19

"""
from alembic import op
import sqlalchemy as sa


revision = 'q2l3m4n5o6p7'
down_revision = 'p1k2l3m4n5o6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create knowledgegraph table
    op.create_table(
        'knowledgegraph',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('uuid', sa.String(), nullable=False),
        sa.Column('infospace_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('source_config', sa.JSON(), nullable=True),
        sa.Column('edit_policy', sa.String(), nullable=False, server_default='method_only'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['infospace_id'], ['infospace.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_knowledge_graph_infospace', 'knowledgegraph', ['infospace_id'], unique=False)
    op.create_index(op.f('ix_knowledgegraph_uuid'), 'knowledgegraph', ['uuid'], unique=True)

    # Create entityeditlog table
    op.create_table(
        'entityeditlog',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('entity_canonical_id', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('performed_by', sa.String(), nullable=False),
        sa.Column('previous_state', sa.JSON(), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['entity_canonical_id'], ['entitycanonical.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_entityeditlog_entity_canonical_id'), 'entityeditlog', ['entity_canonical_id'], unique=False)

    # Add graph_id and provenance_type to entitycanonical
    op.add_column('entitycanonical', sa.Column('graph_id', sa.Integer(), nullable=True))
    op.add_column('entitycanonical', sa.Column('provenance_type', sa.String(), nullable=False, server_default='method'))
    op.create_foreign_key('fk_entitycanonical_graph_id', 'entitycanonical', 'knowledgegraph', ['graph_id'], ['id'])
    op.create_index('ix_entity_canonical_graph', 'entitycanonical', ['graph_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_entity_canonical_graph', table_name='entitycanonical')
    op.drop_constraint('fk_entitycanonical_graph_id', 'entitycanonical', type_='foreignkey')
    op.drop_column('entitycanonical', 'provenance_type')
    op.drop_column('entitycanonical', 'graph_id')

    op.drop_index(op.f('ix_entityeditlog_entity_canonical_id'), table_name='entityeditlog')
    op.drop_table('entityeditlog')

    op.drop_index(op.f('ix_knowledgegraph_uuid'), table_name='knowledgegraph')
    op.drop_index('ix_knowledge_graph_infospace', table_name='knowledgegraph')
    op.drop_table('knowledgegraph')
