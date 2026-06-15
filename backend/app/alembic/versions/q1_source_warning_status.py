"""add WARNING to sourcestatus enum (+ reconcile drifted values)

The initial migration created the ``sourcestatus`` PG enum with only
PENDING/PROCESSING/COMPLETE/FAILED, but the Python ``SourceStatus`` enum has long
carried ACTIVE/PAUSED/IDLE/ERROR too (added only via create_all bootstraps, never
a migration). This adds the new WARNING label — set when a source's output bundle
is deleted (polling paused, needs rewiring) — and idempotently reconciles the
other drifted values so the DB enum matches the model regardless of how it was
bootstrapped.

Labels are the enum member NAMES (uppercase), matching SQLAlchemy's default
persistence and the initial migration.

Revision ID: q1_source_warning_status
Revises: p8_run_is_favorite
Create Date: 2026-06-03
"""
from alembic import op

revision = "q1_source_warning_status"
down_revision = "p8_run_is_favorite"
branch_labels = None
depends_on = None


# Every label the Python SourceStatus enum expects. ADD VALUE is idempotent via
# the duplicate_object guard, so already-present labels are no-ops.
_LABELS = ["PENDING", "ACTIVE", "PAUSED", "IDLE", "PROCESSING", "COMPLETE", "FAILED", "ERROR", "WARNING"]


def upgrade() -> None:
    for label in _LABELS:
        op.execute(
            f"""
            DO $$ BEGIN
                ALTER TYPE sourcestatus ADD VALUE '{label}';
            EXCEPTION WHEN duplicate_object THEN null;
            END $$;
            """
        )


def downgrade() -> None:
    # PostgreSQL does not support removing enum values.
    pass
