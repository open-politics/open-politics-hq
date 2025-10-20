#!/bin/bash
# Extract the Helm chart for standalone use
# Usage: ./extract-chart.sh [destination-directory]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_SOURCE="$SCRIPT_DIR/end-to-end-hetzner-k3s-terraform-helm/open-politics-hq-deployment/hq-cluster-chart"
DEST_DIR="${1:-.}"

# Validate source exists
if [ ! -d "$CHART_SOURCE" ]; then
    echo "❌ Error: Chart source not found at $CHART_SOURCE"
    exit 1
fi

# Create destination if it doesn't exist
mkdir -p "$DEST_DIR"

# Copy the chart
echo "📦 Extracting HQ Helm chart..."
echo "   Source: $CHART_SOURCE"
echo "   Destination: $DEST_DIR/hq-cluster-chart"

cp -r "$CHART_SOURCE" "$DEST_DIR/"

echo ""
echo "✅ Chart extracted successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. cd $DEST_DIR/hq-cluster-chart"
echo "   2. cp values.example.yaml values.yaml"
echo "   3. Edit values.yaml with your configuration"
echo "   4. helm install hq-stack . --namespace hq --create-namespace"
echo ""
echo "💡 The chart is cloud-agnostic and works on any Kubernetes cluster!"

