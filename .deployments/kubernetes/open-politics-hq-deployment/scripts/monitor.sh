#!/bin/bash

# Monitor Open Politics HQ with k9s
# This script provides easy access to cluster monitoring

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "🎯 Open Politics HQ - Cluster Monitor"
echo "===================================="

# Check kubectl connection
if ! kubectl get nodes &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster."
    echo "   Please run ./scripts/connect.sh first."
    exit 1
fi

# Check if k9s is installed
if ! command -v k9s &> /dev/null; then
    echo "❌ k9s is not installed."
    echo ""
    read -p "Would you like to install k9s now? (y/n): " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ./scripts/install-k9s.sh
    else
        echo "   Please install k9s manually or run: ./scripts/install-k9s.sh"
        exit 1
    fi
fi

# Function to show usage
show_usage() {
    echo "📖 Usage: $0 [namespace|resource]"
    echo ""
    echo "Options:"
    echo "   (no args)        - Launch k9s in open-politics namespace"
    echo "   all              - Launch k9s with all namespaces"
    echo "   open-politics    - Launch k9s in open-politics namespace"
    echo "   kube-system      - Launch k9s in kube-system namespace (Traefik)"
    echo ""
    echo "🔧 k9s Quick Reference:"
    echo "   :pods            - View pods"
    echo "   :svc             - View services"
    echo "   :deploy          - View deployments"
    echo "   :ing             - View ingresses"
    echo "   :pvc             - View persistent volume claims"
    echo "   :logs            - View logs"
    echo "   :describe        - Describe resource"
    echo "   :edit            - Edit resource"
    echo "   /                - Filter resources"
    echo "   Ctrl+A           - Show all namespaces"
    echo "   Ctrl+C           - Exit"
    echo ""
}

# Parse arguments
NAMESPACE="open-politics"
case "${1:-}" in
    ""|"open-politics")
        NAMESPACE="open-politics"
        ;;
    "all")
        NAMESPACE=""
        ;;
    "kube-system")
        NAMESPACE="$1"
        ;;
    "-h"|"--help")
        show_usage
        exit 0
        ;;
    *)
        echo "❌ Unknown option: $1"
        show_usage
        exit 1
        ;;
esac

echo "🚀 Starting k9s cluster monitor..."
echo "   Context: $(kubectl config current-context)"
if [ -n "$NAMESPACE" ]; then
    echo "   Namespace: $NAMESPACE"
    echo ""
    echo "💡 Tip: Press Ctrl+A in k9s to see all namespaces"
    k9s -n "$NAMESPACE"
else
    echo "   All namespaces"
    k9s
fi
