from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get('/readiness')
def readyz():
    """Verify DB and Redis connectivity. Returns 503 if dependencies are unhealthy."""
    errors = []
    # DB check
    try:
        from app.core.db import engine
        from sqlalchemy import text

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        errors.append(f"db: {e}")
    # Redis check
    try:
        import redis as _redis

        from app.core.config import settings

        r = _redis.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
    except Exception as e:
        errors.append(f"redis: {e}")
    if errors:
        return JSONResponse(
            {"status": "unhealthy", "errors": errors},
            status_code=503,
        )
    return {"status": "ok"}


@router.get('/liveness')
def liveness():
    """Process is alive. No dependency checks."""
    return {"status": "ok"}


@router.get('/healthz')
def healthz():
    """Legacy health endpoint. Same as readiness."""
    return readyz()