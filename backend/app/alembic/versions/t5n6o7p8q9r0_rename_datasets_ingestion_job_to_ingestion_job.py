"""Rename datasetingestionjob table to ingestionjob

Revision ID: t5n6o7p8q9r0
Revises: s4m5n6o7p8q9
Create Date: 2026-02-20

"""
from alembic import op

revision = "t5n6o7p8q9r0"
down_revision = "s4m5n6o7p8q9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("datasetingestionjob", "ingestionjob")
    # Rename indexes to match new table name
    op.execute("ALTER INDEX ix_datasetingestionjob_uuid RENAME TO ix_ingestionjob_uuid")
    op.execute("ALTER INDEX ix_datasetingestionjob_status RENAME TO ix_ingestionjob_status")
    op.execute("ALTER INDEX ix_datasetingestionjob_task_id RENAME TO ix_ingestionjob_task_id")
    op.execute("ALTER INDEX ix_datasetingestionjob_source_locator RENAME TO ix_ingestionjob_source_locator")
    op.execute("ALTER INDEX ix_datasetingestionjob_status_infospace RENAME TO ix_ingestionjob_status_infospace")
    op.execute("ALTER INDEX ix_datasetingestionjob_user_status RENAME TO ix_ingestionjob_user_status")


def downgrade() -> None:
    op.execute("ALTER INDEX ix_ingestionjob_user_status RENAME TO ix_datasetingestionjob_user_status")
    op.execute("ALTER INDEX ix_ingestionjob_status_infospace RENAME TO ix_datasetingestionjob_status_infospace")
    op.execute("ALTER INDEX ix_ingestionjob_source_locator RENAME TO ix_datasetingestionjob_source_locator")
    op.execute("ALTER INDEX ix_ingestionjob_task_id RENAME TO ix_datasetingestionjob_task_id")
    op.execute("ALTER INDEX ix_ingestionjob_status RENAME TO ix_datasetingestionjob_status")
    op.execute("ALTER INDEX ix_ingestionjob_uuid RENAME TO ix_datasetingestionjob_uuid")
    op.rename_table("ingestionjob", "datasetingestionjob")
