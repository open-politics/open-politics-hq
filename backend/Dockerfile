FROM python:3.13-slim

# install curl
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app/

# Install uv
ENV UV_SYSTEM_PYTHON=1

# Allow installing dev dependencies to run tests
RUN pip install uv

COPY pyproject.toml /app/

RUN uv pip install --no-cache-dir -e ".[dev]"

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


