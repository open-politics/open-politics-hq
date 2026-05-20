# syntax=docker/dockerfile:1.7
FROM python:3.13-slim

RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y --no-install-recommends curl

WORKDIR /app/

ENV UV_SYSTEM_PYTHON=1

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install uv

COPY pyproject.toml /app/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install -e ".[dev]"

ENV PYTHONPATH=/app

COPY ./app /app/app

COPY ./scripts/ /app/

COPY ./alembic.ini /app/

COPY ./prestart.sh /app/

COPY ./start-reload.sh /app/

COPY ./start.sh /app/

COPY ./tests-start.sh /app/

RUN mkdir -p /app/app/alembic/versions && \
    chown -R ${UID:-1000}:${GID:-1000} /app/app/alembic/versions

RUN chmod +x /app/start-reload.sh /app/start.sh /app/tests-start.sh


