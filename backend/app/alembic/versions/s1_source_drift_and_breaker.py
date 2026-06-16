"""Add on_drift and max_poll_failures to Source.

on_drift: user-configurable dedup policy for polls (skip|supersede|update).
    NULL = use runtime default ("update"). Injected into job config by
    run_source_ingestion(); _run_ingestion_job reads config.on_drift.

max_poll_failures: per-source circuit breaker override.
    NULL = use global POLL_CIRCUIT_BREAKER_THRESHOLD (5).

Revision ID: s1_source_drift_and_breaker
Revises: r1_content_cutover_finalize
"""

from alembic import op
import sqlalchemy as sa

revision = "s1_source_drift_and_breaker"
down_revision = "r1_content_cutover_finalize"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("source", sa.Column("on_drift", sa.String(), nullable=True))
    op.add_column("source", sa.Column("max_poll_failures", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("source", "max_poll_failures")
    op.drop_column("source", "on_drift")
