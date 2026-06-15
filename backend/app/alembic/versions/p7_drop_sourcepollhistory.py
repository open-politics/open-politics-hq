"""phase7: drop sourcepollhistory — a poll is now an IngestionJob (source_id set)

The poll path mints IngestionJobs (`execute_poll`) and the poll-history / stats
readers query `IngestionJob WHERE source_id`, so SourcePollHistory has no writers
and no readers. Drop the table. Downgrade recreates the (empty) table so the
migration stays reversible.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision = "p7_drop_sourcepollhistory"
down_revision = "p6_logical_path_prefix_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS sourcepollhistory")


def downgrade() -> None:
    op.create_table(
        "sourcepollhistory",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source_id", sa.Integer, sa.ForeignKey("source.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("items_found", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items_ingested", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("cursor_before", JSON, nullable=True),
        sa.Column("cursor_after", JSON, nullable=True),
    )
