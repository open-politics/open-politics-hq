#! /usr/bin/env bash

# Let the DB start
# python /app/app/backend_pre_start.py

# # # Create initial data in DB
# python /app/app/initial_data.py

alembic stamp head
alembic revision --autogenerate -m "initial migration"

# # Run migrations
alembic upgrade head


