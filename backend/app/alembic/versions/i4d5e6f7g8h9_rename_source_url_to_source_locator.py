"""rename_source_url_to_source_locator

Revision ID: i4d5e6f7g8h9
Revises: h3c4d5e6f7g8
Create Date: 2026-02-11

Rename DatasetIngestionJob.source_url to source_locator.
Supports directory imports (local path), archives (URL), and future S3.
"""
from alembic import op


revision = "i4d5e6f7g8h9"
down_revision = "h3c4d5e6f7g8"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "datasetingestionjob",
        "source_url",
        new_column_name="source_locator",
    )
    op.drop_index("ix_datasetingestionjob_source_url", table_name="datasetingestionjob")
    op.create_index("ix_datasetingestionjob_source_locator", "datasetingestionjob", ["source_locator"], unique=False)


def downgrade():
    op.drop_index("ix_datasetingestionjob_source_locator", table_name="datasetingestionjob")
    op.alter_column(
        "datasetingestionjob",
        "source_locator",
        new_column_name="source_url",
    )
    op.create_index("ix_datasetingestionjob_source_url", "datasetingestionjob", ["source_url"], unique=False)
