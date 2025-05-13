#! /usr/bin/env bash

# # Let the DB start
python /app/app/backend_pre_start.py

# # Run migrations
alembic upgrade head

# # # # # Create initial data in DB
python /app/app/initial_data.py

# alembic stamp head
# alembic revision --autogenerate -m "initial migration, 12.05.2025"


