"""safe_to_timestamptz: honest about parallelism

Hand-written. ``c3d4e5f6a7b8`` declared the function ``PARALLEL SAFE`` while
its body traps exceptions — which opens a subtransaction, and Postgres forbids
those during a parallel operation. Any query using it failed the moment the
planner chose a parallel plan ("cannot start subtransactions during a parallel
operation"), which happens by itself as tables grow.

On Postgres 16+, ``pg_input_is_valid`` answers "would this parse" without a
subtransaction, so the function becomes a plain SQL expression: genuinely
parallel safe, and inlinable into the caller's plan. Older servers keep the
trapping body, declared ``PARALLEL UNSAFE`` as it always should have been.

STABLE, not IMMUTABLE: a text→timestamptz cast reads the session time zone.

Revision ID: c2_safe_timestamptz_parallel
Revises: c1_place_lookup
Create Date: 2026-10-11
"""
from alembic import op

revision = "c2_safe_timestamptz_parallel"
down_revision = "c1_place_lookup"
branch_labels = None
depends_on = None


_V16 = """
    CREATE OR REPLACE FUNCTION safe_to_timestamptz(value text)
    RETURNS timestamptz
    LANGUAGE sql STABLE PARALLEL SAFE STRICT
    AS $$
        SELECT CASE WHEN pg_input_is_valid(value, 'timestamptz')
                    THEN value::timestamptz END
    $$;
"""

_TRAPPING = """
    CREATE OR REPLACE FUNCTION safe_to_timestamptz(value text)
    RETURNS timestamptz
    LANGUAGE plpgsql STABLE PARALLEL UNSAFE STRICT
    AS $$
    BEGIN
        RETURN value::timestamptz;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
    $$;
"""


def upgrade():
    version = op.get_bind().exec_driver_sql("SHOW server_version_num").scalar()
    op.execute(_V16 if int(version) >= 160000 else _TRAPPING)


def downgrade():
    op.execute(_TRAPPING)
