"""add safe_to_timestamptz() — exception-trapping text→timestamptz cast

Revision ID: c3d4e5f6a7b8
Revises: p2_modalities_source_token
Create Date: 2026-06-02

Time-bucketed Formula/aggregate queries ``date_trunc`` a JSONB text field cast
to timestamptz. A plain ``::timestamptz`` raises on the first non-date value
(an LLM-extracted date field is free text — a stray category string, or a
calendar-impossible value like ``2026-02-30``), and that 500s the whole panel.

A regex pre-filter can reject obvious non-dates cheaply but *cannot* validate
calendar/leap-year rules, so it can't be both crash-proof and complete. This
function closes that gap: it returns NULL instead of raising on any unparseable
input. The query layer (``_safe_timestamptz_sql``) gates it behind a cheap
date-shaped regex so categorical columns never pay the per-row subtransaction
cost — only genuinely date-shaped values reach the function.

IMMUTABLE + PARALLEL SAFE so the planner can fold/parallelize it; STRICT so a
SQL NULL short-circuits to NULL without entering the block.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'c3d4e5f6a7b8'
down_revision = 'p2_modalities_source_token'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE OR REPLACE FUNCTION safe_to_timestamptz(value text)
        RETURNS timestamptz
        LANGUAGE plpgsql
        IMMUTABLE
        PARALLEL SAFE
        STRICT
        AS $$
        BEGIN
            RETURN value::timestamptz;
        EXCEPTION WHEN others THEN
            RETURN NULL;
        END;
        $$;
        """
    )


def downgrade():
    op.execute("DROP FUNCTION IF EXISTS safe_to_timestamptz(text)")
