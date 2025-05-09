"""Add classification_schemes table

Revision ID: 0df46601c2c9
Revises: edf0e72eca58
Create Date: 2025-01-28 01:28:14.480611

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '0df46601c2c9'
down_revision = 'edf0e72eca58'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('classificationscheme',
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('expected_datatype', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('prompt', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('input_text', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('field_annotations', sa.JSON(), nullable=True),
    sa.Column('model_annotations', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('workspace_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspace.uid'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table('classificationscheme')
    # ### end Alembic commands ###
