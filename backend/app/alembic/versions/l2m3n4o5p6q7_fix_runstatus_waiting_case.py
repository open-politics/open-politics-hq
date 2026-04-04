"""Fix runstatus enum: rename lowercase 'waiting' to uppercase 'WAITING'.

The z1u2v3w4x5y6 migration incorrectly added 'waiting' (lowercase) while
all other runstatus values are uppercase. SQLAlchemy sends 'WAITING' (the
enum name), which PostgreSQL rejects.

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-04-04

"""
from alembic import op

revision = "l2m3n4o5p6q7"
down_revision = "k1l2m3n4o5p7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename lowercase 'waiting' to uppercase 'WAITING' if it exists.
    # If it doesn't exist (fresh install already has uppercase), add it.
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE runstatus RENAME VALUE 'waiting' TO 'WAITING';
        EXCEPTION WHEN invalid_parameter_value THEN
            -- 'waiting' doesn't exist; ensure 'WAITING' is present
            BEGIN
                ALTER TYPE runstatus ADD VALUE 'WAITING';
            EXCEPTION WHEN duplicate_object THEN null;
            END;
        END $$;
    """)


def downgrade() -> None:
    # PostgreSQL does not support removing or renaming enum values back easily.
    pass
