#! /usr/bin/env bash
set -e

# alembic stamp head
# alembic revision --autogenerate -m "adding 'views_config' to annotation run"
# alembic upgrade head

# Let the DB start
python /app/app/backend_pre_start.py

# # Run migrations
alembic upgrade head

# # # # # Create initial data in DB
python /app/app/initial_data.py



