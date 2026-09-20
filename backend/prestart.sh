#! /usr/bin/env bash
set -e

# Wait for the DB, apply migrations, seed. All three in one interpreter — see
# app/prestart.py for why that matters (it was ~51s as three processes).
python -m app.prestart
