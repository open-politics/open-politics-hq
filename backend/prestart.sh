#! /usr/bin/env bash

# Let the DB start
python /app/app/backend_pre_start.py

# # Create initial data in DB
python /app/app/initial_data.py

# alembic stamp head
# alembic revision --autogenerate -m "add delete_recurring_task"

# # Run migrations
alembic upgrade head