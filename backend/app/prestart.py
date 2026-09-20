"""Everything that has to happen between "the container exists" and "serve traffic".

This used to be three shell-invoked scripts — backend_pre_start.py, `alembic
upgrade head`, initial_data.py — run in series. Each was a cold interpreter that
re-imported SQLModel, SQLAlchemy, pydantic and the whole model tree from
scratch, so the same import cost was paid three times over:

    backend_pre_start.py    15.5s   for 0.13s of SELECT 1
    alembic upgrade head      29s   for a guaranteed no-op
    initial_data.py          6.5s   for 0.6s of idempotent SELECTs

One process pays it once. By the time `command.upgrade` runs alembic's env.py,
`app.models` is already in sys.modules and its `from app.models import *` is a
cache hit rather than a second 20-second import.

Idempotent and safe to re-run — that is what makes it correct to have on the
boot path at all.
"""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlmodel import Session, select
from tenacity import before_sleep_log, retry, stop_after_delay, wait_fixed

from app.core.db import engine
from app.core.seed import init_db

logger = logging.getLogger("app.prestart")

# /app — resolved from this file rather than the cwd, so prestart behaves the
# same however it is invoked.
BACKEND_ROOT = Path(__file__).resolve().parent.parent

DB_WAIT_SECONDS = 300


def wait_for_db() -> None:
    """Block until postgres accepts a query, or give up after DB_WAIT_SECONDS."""

    @retry(
        stop=stop_after_delay(DB_WAIT_SECONDS),
        wait=wait_fixed(1),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    def ping() -> None:
        with Session(engine) as session:
            session.exec(select(1))

    ping()
    logger.info("Database is accepting connections.")


def alembic_config() -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    # alembic.ini says `script_location = app/alembic`, which resolves against
    # the cwd. Pin it absolutely so this is not cwd-dependent.
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "app" / "alembic"))
    return cfg


def migrate() -> None:
    """Upgrade to head, but only when there is actually something to apply.

    `alembic upgrade head` costs ~29s here even as a no-op, because env.py
    imports the model tree and ScriptDirectory walks 105 revision files. Reading
    the current revision costs a single SELECT, so check before doing the work.
    """
    cfg = alembic_config()
    heads = set(ScriptDirectory.from_config(cfg).get_heads())

    with engine.connect() as conn:
        current = set(MigrationContext.configure(conn).get_current_heads())

    if current == heads:
        logger.info("Schema already at head (%s) — nothing to migrate.", ", ".join(sorted(heads)))
        return

    logger.info(
        "Migrating %s -> %s",
        ", ".join(sorted(current)) or "base",
        ", ".join(sorted(heads)),
    )
    command.upgrade(cfg, "head")
    logger.info("Migrations applied.")


def seed() -> None:
    """Seed the superuser, default infospace and initial schemas. Idempotent."""
    with Session(engine) as session:
        init_db(session)
    logger.info("Seed complete.")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-5.5s [%(name)s] %(message)s")
    wait_for_db()
    migrate()
    seed()


if __name__ == "__main__":
    main()
