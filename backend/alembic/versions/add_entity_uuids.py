"""Add entity UUIDs for universal data transfer.

Revision ID: add_entity_uuids
Revises: previous_revision_id
Create Date: 2024-03-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects.postgresql import UUID
import uuid

# revision identifiers, used by Alembic.
revision: str = 'add_entity_uuids'
down_revision: Union[str, None] = 'previous_revision_id'  # Update this
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add entity_uuid and imported_from_uuid columns to key tables
    tables = [
        'datasource',
        'datarecord',
        'classificationscheme',
        'classificationjob',
        'dataset'
    ]

    for table in tables:
        # Add entity_uuid column
        op.add_column(
            table,
            sa.Column(
                'entity_uuid',
                UUID(as_uuid=True),
                nullable=True,  # Initially allow NULL for existing records
                unique=True,
                index=True
            )
        )
        # Add imported_from_uuid column
        op.add_column(
            table,
            sa.Column(
                'imported_from_uuid',
                UUID(as_uuid=True),
                nullable=True,
                index=True
            )
        )

        # Generate UUIDs for existing records
        op.execute(f"""
            UPDATE {table}
            SET entity_uuid = gen_random_uuid()
            WHERE entity_uuid IS NULL
        """)

        # Make entity_uuid non-nullable after populating
        op.alter_column(
            table,
            'entity_uuid',
            nullable=False
        )


def downgrade() -> None:
    # Remove UUID columns from all tables
    tables = [
        'datasource',
        'datarecord',
        'classificationscheme',
        'classificationjob',
        'dataset'
    ]

    for table in tables:
        op.drop_column(table, 'entity_uuid')
        op.drop_column(table, 'imported_from_uuid') 