#! /usr/bin/env bash

# # Let the DB start
python /app/app/backend_pre_start.py

# # # # # Create initial data in DB
python /app/app/initial_data.py

# alembic stamp head
# alembic revision --autogenerate -m "changed status enum to string"

# # Run migrations
alembic upgrade head


