from sqlmodel import create_engine

from app.core.config import settings

engine = create_engine(
    str(settings.SQLALCHEMY_DATABASE_URI),
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=settings.DB_POOL_PRE_PING,
    pool_reset_on_return="rollback",
)

