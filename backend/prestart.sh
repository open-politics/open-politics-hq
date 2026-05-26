#! /usr/bin/env bash
set -e

# Wait for the DB to accept connections before doing anything else.
python /app/app/backend_pre_start.py

# Apply schema migrations.
alembic upgrade head

# Seed the superuser (FIRST_SUPERUSER / FIRST_SUPERUSER_PASSWORD from .env)
# plus initial infospaces, schemas, etc. Idempotent — safe to re-run.
# Skipping this is how every fresh setup hit "incorrect password" on login.
python /app/app/initial_data.py
