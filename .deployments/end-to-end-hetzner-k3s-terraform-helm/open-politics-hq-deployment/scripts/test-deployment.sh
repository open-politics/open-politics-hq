#!/usr/bin/env bash

set -euo pipefail

# Test DNS, HTTP/HTTPS, and TLS for your domain
# Usage:
#   bash ./scripts/test-deployment.sh
# Notes:
#   - Works even if your login shell is zsh.
#   - If connected to the cluster, it will also detect the Traefik LB IP.

SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DOMAINS=("your-domain.com" "www.your-domain.com")
RESOLVERS=(1.1.1.1 8.8.8.8 9.9.9.9)

section() {
    echo ""
    echo "=============================================================="
    echo "$1"
    echo "=============================================================="
}

dns_check() {
    local name="$1" resolver="$2"
    local cname a
    cname=$(dig +short "$name" CNAME @"$resolver" | tr '\n' ' ')
    a=$(dig +short "$name" A @"$resolver" | tr '\n' ' ')
    if [ -n "$a" ]; then
        if [ -n "$cname" ]; then
            echo "✅ DNS A ($resolver): $name → ${cname}${a}"
        else
            echo "✅ DNS A ($resolver): $name → $a"
        fi
    else
        echo "❌ DNS A ($resolver): $name has no records"
    fi
}

detect_lb_ip() {
    kubectl get svc traefik -n kube-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true
}

curl_code() {
    # Prints HTTP status code or empty on failure
    curl -sS -k --max-time 8 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || true
}

http_checks() {
    local domain="$1" lb_ip="$2"
    local code_direct code_via_ip
    code_direct=$(curl_code "http://$domain")
    if [ -n "$code_direct" ]; then
        echo "   HTTP $domain → $code_direct"
    else
        echo "   HTTP $domain → failed"
    fi
    if [ -n "$lb_ip" ]; then
        code_via_ip=$(curl -sS --max-time 8 -o /dev/null -w "%{http_code}" -H "Host: $domain" "http://$lb_ip" 2>/dev/null || true)
        if [ -n "$code_via_ip" ]; then
            echo "   HTTP $lb_ip (Host: $domain) → $code_via_ip"
        else
            echo "   HTTP $lb_ip (Host: $domain) → failed"
        fi
    fi
}

https_checks() {
    local domain="$1" lb_ip="$2"
    local code_direct code_via_ip
    code_direct=$(curl_code "https://$domain")
    if [ -n "$code_direct" ]; then
        echo "   HTTPS $domain → $code_direct"
    else
        echo "   HTTPS $domain → failed"
    fi
    if [ -n "$lb_ip" ]; then
        code_via_ip=$(curl -sS -k --max-time 8 -o /dev/null -w "%{http_code}" -H "Host: $domain" "https://$lb_ip" 2>/dev/null || true)
        if [ -n "$code_via_ip" ]; then
            echo "   HTTPS $lb_ip (Host: $domain) → $code_via_ip"
        else
            echo "   HTTPS $lb_ip (Host: $domain) → failed"
        fi
    fi
}

tls_details() {
    local host="$1"
    local info
    info=$(echo | timeout 10 openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null | openssl x509 -noout -issuer -subject -enddate || true)
    if [ -z "$info" ]; then
        echo "   ❌ TLS: could not fetch certificate for $host"
        return
    fi
    echo "$info" | sed 's/^/   /'
    if echo "$info" | grep -qi "Let's Encrypt"; then
        echo "   ✅ TLS issuer: Let's Encrypt"
    else
        echo "   ⚠️  TLS issuer is not Let's Encrypt"
    fi
}

section "1) DNS checks"
for d in "${DOMAINS[@]}"; do
  for r in "${RESOLVERS[@]}"; do
    dns_check "$d" "$r"
  done
done

section "2) Detect Traefik LoadBalancer IP (if connected)"
LB_IP="$(detect_lb_ip)"
if [ -n "$LB_IP" ]; then
    echo "Traefik LoadBalancer IP: $LB_IP"
else
    echo "(Not connected or no LoadBalancer IP available)"
fi

section "3) HTTP checks"
for d in "${DOMAINS[@]}"; do
  http_checks "$d" "$LB_IP"
done

section "4) HTTPS checks"
for d in "${DOMAINS[@]}"; do
  https_checks "$d" "$LB_IP"
done

section "5) TLS certificate details"
for d in "${DOMAINS[@]}"; do
  tls_details "$d"
done

echo ""
echo "✅ Tests complete"


