#!/bin/bash

# View logs from Open Politics HQ application
# This script provides easy access to application logs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check kubectl connection
if ! kubectl get nodes &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster."
    echo "   Please run ./scripts/connect.sh first."
    exit 1
fi

# Function to show available pods
show_pods() {
    echo "📋 Available pods in open-politics namespace:"
    kubectl get pods -n open-politics
    echo ""
}

# Function to show usage
show_usage() {
    echo "📖 Usage: $0 [component] [options]"
    echo ""
    echo "Components:"
    echo "   backend      - Backend API logs"
    echo "   frontend     - Frontend application logs"
    echo "   celery       - Celery worker logs"
    echo "   postgres     - PostgreSQL database logs"
    echo "   redis        - Redis cache logs"
    echo "   all          - All application logs"
    echo ""
    echo "Options:"
    echo "   -f, --follow    Follow log output (like tail -f)"
    echo "   -n, --lines N   Show last N lines (default: 100)"
    echo "   --since TIME    Show logs since TIME (e.g., 1h, 30m, 2023-01-01T10:00:00Z)"
    echo ""
    echo "Examples:"
    echo "   $0 backend -f                    # Follow backend logs"
    echo "   $0 postgres --lines 50           # Show last 50 lines of postgres logs"
    echo "   $0 all --since 1h                # Show all logs from last hour"
    echo ""
}

# Parse arguments
COMPONENT=""
FOLLOW=""
LINES="100"
SINCE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        backend|frontend|celery|postgres|redis|all)
            COMPONENT="$1"
            shift
            ;;
        -f|--follow)
            FOLLOW="-f"
            shift
            ;;
        -n|--lines)
            LINES="$2"
            shift 2
            ;;
        --since)
            SINCE="--since=$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "❌ Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# If no component specified, show usage and available pods
if [ -z "$COMPONENT" ]; then
    show_usage
    show_pods
    exit 1
fi

echo "📋 Viewing logs for: $COMPONENT"
echo ""

# Build kubectl logs command
KUBECTL_CMD="kubectl logs -n open-politics --tail=$LINES $SINCE $FOLLOW"

case $COMPONENT in
    backend)
        echo "🔍 Backend API logs:"
        $KUBECTL_CMD deployment/backend
        ;;
    frontend)
        echo "🔍 Frontend application logs:"
        $KUBECTL_CMD deployment/frontend
        ;;
    celery)
        echo "🔍 Celery worker logs:"
        $KUBECTL_CMD deployment/celery-worker
        ;;
    postgres)
        echo "🔍 PostgreSQL database logs:"
        $KUBECTL_CMD deployment/postgres
        ;;
    redis)
        echo "🔍 Redis cache logs:"
        $KUBECTL_CMD deployment/redis
        ;;
    all)
        echo "🔍 All application logs:"
        echo ""
        
        echo "--- BACKEND ---"
        $KUBECTL_CMD deployment/backend --tail=20
        echo ""
        
        echo "--- FRONTEND ---"
        $KUBECTL_CMD deployment/frontend --tail=20
        echo ""
        
        echo "--- CELERY WORKER ---"
        $KUBECTL_CMD deployment/celery-worker --tail=20
        echo ""
        
        echo "--- POSTGRES ---"
        $KUBECTL_CMD deployment/postgres --tail=20
        echo ""
        
        echo "--- REDIS ---"
        $KUBECTL_CMD deployment/redis --tail=20
        echo ""
        
        if [ -n "$FOLLOW" ]; then
            echo "Following all logs (press Ctrl+C to stop)..."
            kubectl logs -f -n open-politics --selector=app=backend,app=frontend,app=celery-worker --tail=10
        fi
        ;;
    *)
        echo "❌ Unknown component: $COMPONENT"
        show_usage
        exit 1
        ;;
esac
