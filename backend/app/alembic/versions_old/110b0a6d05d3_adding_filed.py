"""Adding Filed

Revision ID: 110b0a6d05d3
Revises: 6fb284720df8
Create Date: 2025-02-07 02:07:15.853334

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '110b0a6d05d3'
down_revision = '6fb284720df8'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column('document', sa.Column('files', sa.JSON(), nullable=True))
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column('document', 'files')
    # ### end Alembic commands ###
