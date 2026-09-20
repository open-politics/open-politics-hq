# syntax=docker/dockerfile:1.7

# ── base ─────────────────────────────────────────────────────────────────────
# Interpreter, uv, and the env vars that shape every uv call below.
FROM python:3.13-slim AS base

# curl is here for container healthchecks (probing /readiness), not for the app.
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y --no-install-recommends curl

WORKDIR /app/

ENV PYTHONPATH=/app \
    # Unbuffered because boot *looked* stalled: prestart's output sat in a pipe
    # buffer, so 15s of import showed as 15s of silence.
    PYTHONUNBUFFERED=1 \
    # Install into the system prefix rather than a .venv, so uvicorn / celery /
    # alembic stay on PATH and no entrypoint script needs to know about uv.
    UV_PROJECT_ENVIRONMENT=/usr/local \
    # THE boot-time fix. Without this, site-packages ships ~no .pyc and every
    # container compiles ~1900 modules at start (beartype 344, sqlalchemy 150,
    # fastmcp 127, mcp 114...) into a writable layer that is then discarded on
    # recreate — paid independently by all four backend containers, every boot.
    # Setting it moves that work into one shared read-only layer.
    UV_COMPILE_BYTECODE=1 \
    # The uv cache mount and the target prefix are different filesystems, so
    # hardlinking (the default) fails over to copying with a warning anyway.
    UV_LINK_MODE=copy

# ── deps ─────────────────────────────────────────────────────────────────────
# Split from the source copy so editing app/ never re-resolves or re-installs.
FROM base AS deps

# A pinned static binary instead of `pip install uv`: that layer cost 61MB and
# floated to whatever uv released that day. It lives only in this stage — the
# runtime stage branches off `base`, so uv never reaches a pushed image.
COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /uvx /bin/

# Derived from `stack.environment` in my-hq.yml by setup.sh (local -> true).
# Defaults to false so anything that builds without passing a build arg — the
# registry push script, a plain `docker build` — gets the lean image.
ARG INSTALL_DEV=false

COPY pyproject.toml uv.lock ./

# --frozen installs exactly what uv.lock pins and never re-resolves against the
# index. uv.lock carries a sha256 for every third-party wheel, so this is the
# supply-chain gate: a tampered or substituted artifact fails the hash check.
# --no-install-project skips the editable self-install: PYTHONPATH=/app already
# makes `app` importable and the project declares no entry points or metadata
# readers, so it was pure redundancy that also broke deps-before-source caching.
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ "$INSTALL_DEV" = "true" ]; then \
        uv sync --frozen --no-install-project --extra dev; \
    else \
        uv sync --frozen --no-install-project; \
    fi

# ── runtime ──────────────────────────────────────────────────────────────────
# Last stage = the default build target, so a bare `docker build` produces the
# deployable image rather than a dev one.
FROM base AS runtime

# Only the populated prefix comes forward. uv, its cache and pip's cache stay
# behind in `deps`.
COPY --from=deps /usr/local /usr/local

COPY ./app /app/app
# Preserved as a directory: tests-start.sh runs `bash ./scripts/test.sh`, which
# the old flattening COPY (`./scripts/ /app/`) put at /app/test.sh instead — so
# it only ever resolved in dev, via the source bind mount.
COPY ./scripts /app/scripts
COPY ./alembic.ini ./prestart.sh ./start-reload.sh ./tests-start.sh /app/

# One layer instead of three. The old `chown -R` on the versions dir duplicated
# 1.22MB for nothing: in dev the bind mount's host ownership wins, and in prod
# nothing writes migrations.
RUN chmod +x /app/prestart.sh /app/start-reload.sh /app/tests-start.sh \
    && mkdir -p /app/app/alembic/versions

# Compose overrides this for every service; it exists so the image is runnable
# on its own, and so a bare `docker run` is not a silent no-op.
CMD ["sh", "-c", "bash /app/prestart.sh && exec uvicorn app.main:app --host 0.0.0.0 --port ${BACKEND_PORT:-8022}"]
