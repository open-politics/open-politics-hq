#!/bin/bash
set -e

# This script checks the status of the Let's Encrypt SSL certificate
# managed by the Traefik Ingress Controller.

# --- Preamble ---
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$PROJECT_DIR"

# --- Helper Functions ---

function print_header() {
    echo "--------------------------------------------------"
    echo "  $1"
    echo "--------------------------------------------------"
}

# --- Main Logic ---

print_header "Checking Traefik SSL Certificate Status"

# 1. Ensure we're connected to the cluster
./scripts/connect.sh > /dev/null # Suppress output for a cleaner check

# 2. Get the domain name from the values file
DOMAIN=$(grep "^  host:" helm-chart/values.yaml | cut -d' ' -f4)
if [ -z "$DOMAIN" ]; then
    echo "❌ Error: Could not determine domain from helm-chart/values.yaml"
    exit 1
fi
echo "🔍 Checking certificate for domain: $DOMAIN"
echo ""

# 3. Check Traefik logs for recent ACME errors
print_header "Checking Traefik Logs for ACME Errors"
ACME_ERRORS=$(kubectl logs -n kube-system deployment/traefik --tail=200 | grep -i "error.*acme" || true)

if [ -n "$ACME_ERRORS" ]; then
    echo "⚠️  Found recent ACME errors in Traefik logs:"
    echo "$ACME_ERRORS"
else
    echo "✅ No recent ACME errors found in logs."
fi
echo ""

# 4. Check the live certificate being served to the public
print_header "Checking Live Certificate from openssl"
# Use timeout to prevent script from hanging
CERT_INFO=$(echo | timeout 10 openssl s_client -connect "$DOMAIN":443 -servername "$DOMAIN" 2>/dev/null)

if [ -z "$CERT_INFO" ]; then
    echo "❌ Error: Could not connect to $DOMAIN:443 via openssl."
    echo "   This could be a firewall issue or the Ingress might not be ready."
    exit 1
fi

ISSUER=$(echo "$CERT_INFO" | openssl x509 -noout -issuer)
EXPIRY_DATE=$(echo "$CERT_INFO" | openssl x509 -noout -enddate)

echo "   Certificate Issuer: $ISSUER"
echo "   $EXPIRY_DATE"
echo ""

if echo "$ISSUER" | grep -q "Let's Encrypt"; then
    echo "✅ Success: The live certificate is a valid Let's Encrypt certificate."
else
    echo "❌ Failure: The live certificate is NOT from Let's Encrypt. It is likely the default self-signed cert."
fi
