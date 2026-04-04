"""Flow execution state, WAITING status, RETRY/BACKFILL run types.

Revision ID: z1u2v3w4x5y6
Revises: y0t1u2v3w4x5
Create Date: 2026-02-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "z1u2v3w4x5y6"
down_revision = "y0t1u2v3w4x5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add current_step_index and execution_state to flowexecution
    op.add_column(
        "flowexecution",
        sa.Column("current_step_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "flowexecution",
        sa.Column(
            "execution_state",
            JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default="{}",
        ),
    )

    # Add WAITING to runstatus enum (use DO block for older PostgreSQL)
    # NOTE: Must be uppercase to match existing enum values (PENDING, RUNNING, etc.)
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE runstatus ADD VALUE 'WAITING';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """)

    # Add RETRY and BACKFILL to runtype enum
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE runtype ADD VALUE 'retry';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE runtype ADD VALUE 'backfill';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """)


def downgrade() -> None:
    op.drop_column("flowexecution", "execution_state")
    op.drop_column("flowexecution", "current_step_index")

    # PostgreSQL does not support removing enum values; new values remain.
    # Document that downgrade does not remove 'waiting', 'retry', 'backfill'.
    pass
