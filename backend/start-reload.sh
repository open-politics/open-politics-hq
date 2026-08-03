#! /usr/bin/env sh
set -e

if [ -f /app/app/main.py ]; then
    DEFAULT_MODULE_NAME=app.main
elif [ -f /app/main.py ]; then
    DEFAULT_MODULE_NAME=main
fi
MODULE_NAME=${MODULE_NAME:-$DEFAULT_MODULE_NAME}
VARIABLE_NAME=${VARIABLE_NAME:-app}
export APP_MODULE=${APP_MODULE:-"$MODULE_NAME:$VARIABLE_NAME"}

HOST=${HOST:-0.0.0.0}
PORT=${PORT:-80}
LOG_LEVEL=${LOG_LEVEL:-info}

# If there's a prestart.sh script in the /app directory or other path specified, run it before starting
PRE_START_PATH=${PRE_START_PATH:-/app/prestart.sh}
echo "Checking for script in $PRE_START_PATH"
if [ -f $PRE_START_PATH ] ; then
    echo "Running script $PRE_START_PATH"
    . "$PRE_START_PATH"
else 
    echo "There is no script $PRE_START_PATH"
fi


# Start Uvicorn with live reload.
#
# --reload-dir /app/app     Watch app code only. The bind mount is the whole
#                           backend/ tree, so watching /app picks up .venv,
#                           scratch probe_*.py, scripts/ and docs/ — all of
#                           which trigger pointless restarts.
# --reload-exclude          Running the test suite shouldn't bounce the server.
# --timeout-graceful-shutdown
#                           Default is None = wait forever for connections to
#                           close. Our SSE endpoints (stream, chat, annotation
#                           runs) hold open with 3s keepalives for up to 30min,
#                           so a reload would hang on "Waiting for connections
#                           to close" as long as any browser tab is open.
#                           Force-close after 1s; the frontend reconnects.
exec uvicorn --reload \
    --reload-dir /app/app \
    --reload-exclude 'app/tests/*' \
    --timeout-graceful-shutdown 1 \
    --host $HOST --port $PORT --log-level $LOG_LEVEL "$APP_MODULE"


# bash tests-start.sh