import logging
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session
from sqlmodel import create_engine

from app.core.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(
    str(settings.SQLALCHEMY_DATABASE_URI),
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=settings.DB_POOL_PRE_PING,
    pool_reset_on_return="rollback",
)


@contextmanager
def tolerated(session: Session, what: str) -> Iterator[None]:
    """A block that may fail without costing the caller — a probe, a census,
    a lookup with a fallback. Inside a savepoint: in Postgres a failed
    statement aborts the whole transaction, so catching the exception alone
    leaves every later statement failing with ``InFailedSqlTransaction``, and
    the error surfaces far from its cause. The savepoint rolls back only this
    block; the failure is logged and swallowed."""
    try:
        with session.begin_nested():
            yield
    except Exception:  # noqa: BLE001 — tolerating is the point
        logger.warning("%s failed", what, exc_info=True)
