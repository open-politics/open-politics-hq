"""Adding files to documents

Revision ID: 7bfa717409e6
Revises: 39ee63f147de
Create Date: 2025-02-12 22:40:51.240119

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '7bfa717409e6'
down_revision = '39ee63f147de'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('classificationresult',
    sa.Column('document_id', sa.Integer(), nullable=False),
    sa.Column('scheme_id', sa.Integer(), nullable=False),
    sa.Column('score', sa.Float(), nullable=False),
    sa.Column('timestamp', sa.DateTime(), nullable=False),
    sa.Column('run_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('run_description', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['document.id'], ),
    sa.ForeignKeyConstraint(['scheme_id'], ['classificationscheme.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.drop_table('classification_results')
    op.add_column('classificationscheme', sa.Column('int_type', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('classificationscheme', sa.Column('scale_min', sa.Integer(), nullable=True))
    op.add_column('classificationscheme', sa.Column('scale_max', sa.Integer(), nullable=True))
    op.add_column('classificationscheme', sa.Column('is_set_of_labels', sa.Boolean(), nullable=True))
    op.add_column('classificationscheme', sa.Column('labels', sa.ARRAY(sa.Text()), nullable=True))
    op.add_column('classificationscheme', sa.Column('dict_keys', sa.JSON(), nullable=True))
    op.add_column('classificationscheme', sa.Column('model_instructions', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('classificationscheme', sa.Column('validation_rules', sa.JSON(), nullable=True))
    op.add_column('classificationscheme', sa.Column('user_id', sa.Integer(), nullable=True))
    op.alter_column('classificationscheme', 'description',
               existing_type=sa.VARCHAR(),
               nullable=False)
    op.execute("""
        UPDATE classificationscheme 
        SET user_id = (SELECT id FROM "user" LIMIT 1)
    """)
    op.alter_column('classificationscheme', 'user_id',
                    existing_type=sa.Integer(),
                    nullable=False)
    op.create_foreign_key(
        "fk_classificationscheme_user_id",
        "classificationscheme",
        "user",
        ["user_id"],
        ["id"]
    )
    op.drop_column('classificationscheme', 'prompt')
    op.drop_column('classificationscheme', 'field_annotations')
    op.drop_column('classificationscheme', 'model_annotations')
    op.drop_column('classificationscheme', 'expected_datatype')
    op.drop_column('classificationscheme', 'input_text')
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column('classificationscheme', sa.Column('input_text', sa.VARCHAR(), autoincrement=False, nullable=True))
    op.add_column('classificationscheme', sa.Column('expected_datatype', sa.VARCHAR(), autoincrement=False, nullable=False))
    op.add_column('classificationscheme', sa.Column('model_annotations', sa.VARCHAR(), autoincrement=False, nullable=True))
    op.add_column('classificationscheme', sa.Column('field_annotations', postgresql.JSON(astext_type=sa.Text()), autoincrement=False, nullable=True))
    op.add_column('classificationscheme', sa.Column('prompt', sa.VARCHAR(), autoincrement=False, nullable=True))
    op.drop_constraint(None, 'classificationscheme', type_='foreignkey')
    op.alter_column('classificationscheme', 'description',
               existing_type=sa.VARCHAR(),
               nullable=True)
    op.drop_column('classificationscheme', 'validation_rules')
    op.drop_column('classificationscheme', 'model_instructions')
    op.drop_column('classificationscheme', 'dict_keys')
    op.drop_column('classificationscheme', 'labels')
    op.drop_column('classificationscheme', 'is_set_of_labels')
    op.drop_column('classificationscheme', 'scale_max')
    op.drop_column('classificationscheme', 'scale_min')
    op.drop_column('classificationscheme', 'int_type')
    op.drop_column('classificationscheme', 'user_id')
    op.create_table('classification_results',
    sa.Column('document_id', sa.INTEGER(), autoincrement=False, nullable=False),
    sa.Column('scheme_id', sa.INTEGER(), autoincrement=False, nullable=False),
    sa.Column('score', sa.DOUBLE_PRECISION(precision=53), autoincrement=False, nullable=False),
    sa.Column('timestamp', postgresql.TIMESTAMP(), autoincrement=False, nullable=False),
    sa.Column('id', sa.INTEGER(), autoincrement=True, nullable=False),
    sa.Column('run_name', sa.VARCHAR(), autoincrement=False, nullable=True),
    sa.Column('run_description', sa.VARCHAR(), autoincrement=False, nullable=True),
    sa.ForeignKeyConstraint(['document_id'], ['document.id'], name='classification_results_document_id_fkey'),
    sa.ForeignKeyConstraint(['scheme_id'], ['classificationscheme.id'], name='classification_results_scheme_id_fkey'),
    sa.PrimaryKeyConstraint('id', name='classification_results_pkey')
    )
    op.drop_table('classificationresult')
    # ### end Alembic commands ### 