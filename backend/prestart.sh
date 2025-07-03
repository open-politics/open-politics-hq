#! /usr/bin/env bash

# alembic stamp head
# alembic revision --autogenerate -m "Add partial unique index to annotation schemas"
# alembic upgrade head

# Let the DB start
python /app/app/backend_pre_start.py

# # Run migrations
alembic upgrade head

# # # # # Create initial data in DB
python /app/app/initial_data.py



