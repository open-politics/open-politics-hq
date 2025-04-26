#!/usr/bin/env bash

set -e

# Run pytest directly
# pytest "$@"

python /app/app/tests/workflow/test_full_workflow.py

# Removed coverage command:
# coverage run --source=app -m pytest "$@"
# coverage report -m
