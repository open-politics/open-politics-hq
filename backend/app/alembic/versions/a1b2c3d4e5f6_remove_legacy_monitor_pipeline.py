"""Remove legacy Monitor and Pipeline models

Revision ID: a1b2c3d4e5f6
Revises: 33ee6f34d8ad
Create Date: 2025-12-15

This migration removes the deprecated Monitor and Pipeline models that have been
replaced by the unified Flow architecture.

Tables removed:
- monitoraggregate
- pipelineprocessedasset
- pipelineexecution
- pipelinestep
- intelligencepipeline
- monitor
- monitorbundlelink
- monitorschemalink

Columns removed from source:
- linked_pipeline_id
- auto_trigger_pipeline

Columns removed from sourcepollhistory:
- triggered_pipeline
- triggered_run_id

Columns removed from annotationrun:
- monitor_id
- pipeline_execution_id
- triggered_by_source_id
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '33ee6f34d8ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop columns from annotationrun
    op.drop_constraint('annotationrun_monitor_id_fkey', 'annotationrun', type_='foreignkey')
    op.drop_constraint('annotationrun_pipeline_execution_id_fkey', 'annotationrun', type_='foreignkey')
    op.drop_constraint('annotationrun_triggered_by_source_id_fkey', 'annotationrun', type_='foreignkey')
    op.drop_column('annotationrun', 'monitor_id')
    op.drop_column('annotationrun', 'pipeline_execution_id')
    op.drop_column('annotationrun', 'triggered_by_source_id')
    
    # Drop columns from sourcepollhistory
    op.drop_constraint('sourcepollhistory_triggered_run_id_fkey', 'sourcepollhistory', type_='foreignkey')
    op.drop_column('sourcepollhistory', 'triggered_pipeline')
    op.drop_column('sourcepollhistory', 'triggered_run_id')
    
    # Drop columns from source
    op.drop_constraint('source_linked_pipeline_id_fkey', 'source', type_='foreignkey')
    op.drop_column('source', 'linked_pipeline_id')
    op.drop_column('source', 'auto_trigger_pipeline')
    
    # Drop monitor aggregate table first (has foreign key to monitor)
    op.drop_table('monitoraggregate')
    
    # Drop pipeline tables (order matters due to foreign keys)
    op.drop_table('pipelineprocessedasset')
    op.drop_table('pipelineexecution')
    op.drop_table('pipelinestep')
    op.drop_table('intelligencepipeline')
    
    # Drop monitor link tables
    op.drop_table('monitorbundlelink')
    op.drop_table('monitorschemalink')
    
    # Drop monitor table (after dropping tables that reference it)
    op.drop_table('monitor')


def downgrade() -> None:
    # Recreate monitor table
    op.create_table('monitor',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('uuid', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('infospace_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('linked_task_id', sa.Integer(), nullable=False),
        sa.Column('run_config_override', sa.JSON(), nullable=True),
        sa.Column('views_config', sa.JSON(), nullable=True),
        sa.Column('aggregation_config', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['infospace_id'], ['infospace.id'], ),
        sa.ForeignKeyConstraint(['linked_task_id'], ['task.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('uuid')
    )
    
    # Recreate monitor link tables
    op.create_table('monitorbundlelink',
        sa.Column('monitor_id', sa.Integer(), nullable=False),
        sa.Column('bundle_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['bundle_id'], ['bundle.id'], ),
        sa.ForeignKeyConstraint(['monitor_id'], ['monitor.id'], ),
        sa.PrimaryKeyConstraint('monitor_id', 'bundle_id')
    )
    
    op.create_table('monitorschemalink',
        sa.Column('monitor_id', sa.Integer(), nullable=False),
        sa.Column('schema_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['monitor_id'], ['monitor.id'], ),
        sa.ForeignKeyConstraint(['schema_id'], ['annotationschema.id'], ),
        sa.PrimaryKeyConstraint('monitor_id', 'schema_id')
    )
    
    # Recreate pipeline tables
    op.create_table('intelligencepipeline',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('uuid', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('infospace_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('source_bundle_ids', sa.JSON(), nullable=True),
        sa.Column('source_stream_ids', sa.JSON(), nullable=True),
        sa.Column('linked_task_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['infospace_id'], ['infospace.id'], ),
        sa.ForeignKeyConstraint(['linked_task_id'], ['task.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('uuid')
    )
    
    op.create_table('pipelinestep',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('pipeline_id', sa.Integer(), nullable=False),
        sa.Column('step_order', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('step_type', sa.String(), nullable=False),
        sa.Column('configuration', sa.JSON(), nullable=True),
        sa.Column('input_source', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['pipeline_id'], ['intelligencepipeline.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_table('pipelineexecution',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('pipeline_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('trigger_type', sa.String(), nullable=False),
        sa.Column('triggering_asset_ids', sa.JSON(), nullable=True),
        sa.Column('step_outputs', sa.JSON(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['pipeline_id'], ['intelligencepipeline.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_table('pipelineprocessedasset',
        sa.Column('pipeline_id', sa.Integer(), nullable=False),
        sa.Column('input_bundle_id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['input_bundle_id'], ['bundle.id'], ),
        sa.ForeignKeyConstraint(['pipeline_id'], ['intelligencepipeline.id'], ),
        sa.PrimaryKeyConstraint('pipeline_id', 'input_bundle_id', 'asset_id')
    )
    
    # Recreate monitoraggregate
    op.create_table('monitoraggregate',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('monitor_id', sa.Integer(), nullable=False),
        sa.Column('field_path', sa.String(), nullable=False),
        sa.Column('value_kind', sa.String(), nullable=False),
        sa.Column('sketch_kind', sa.String(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['monitor_id'], ['monitor.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Recreate columns in source
    op.add_column('source', sa.Column('linked_pipeline_id', sa.Integer(), nullable=True))
    op.add_column('source', sa.Column('auto_trigger_pipeline', sa.Boolean(), nullable=True, server_default='false'))
    op.create_foreign_key('source_linked_pipeline_id_fkey', 'source', 'intelligencepipeline', ['linked_pipeline_id'], ['id'])
    
    # Recreate columns in sourcepollhistory
    op.add_column('sourcepollhistory', sa.Column('triggered_pipeline', sa.Boolean(), nullable=True, server_default='false'))
    op.add_column('sourcepollhistory', sa.Column('triggered_run_id', sa.Integer(), nullable=True))
    op.create_foreign_key('sourcepollhistory_triggered_run_id_fkey', 'sourcepollhistory', 'annotationrun', ['triggered_run_id'], ['id'])
    
    # Recreate columns in annotationrun
    op.add_column('annotationrun', sa.Column('monitor_id', sa.Integer(), nullable=True))
    op.add_column('annotationrun', sa.Column('pipeline_execution_id', sa.Integer(), nullable=True))
    op.add_column('annotationrun', sa.Column('triggered_by_source_id', sa.Integer(), nullable=True))
    op.create_foreign_key('annotationrun_monitor_id_fkey', 'annotationrun', 'monitor', ['monitor_id'], ['id'])
    op.create_foreign_key('annotationrun_pipeline_execution_id_fkey', 'annotationrun', 'pipelineexecution', ['pipeline_execution_id'], ['id'])
    op.create_foreign_key('annotationrun_triggered_by_source_id_fkey', 'annotationrun', 'source', ['triggered_by_source_id'], ['id'])
