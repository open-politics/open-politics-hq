#!/bin/bash
set -euo pipefail

# This script is called by the main `deploy.sh` menu.
# It assumes that Terraform has already run.
# Its sole responsibility is to deploy the necessary Kubernetes components and the application stack.

# --- Configuration & Preamble ---
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$PROJECT_DIR"

# --- Helper Functions ---

function print_header() {
    echo "--------------------------------------------------"
    echo "  $1"
    echo "--------------------------------------------------"
}

# --- Main Deployment Logic ---

print_header "Deploying Cluster Components & Application"

# Start by ensuring our local kubectl is configured correctly for the CURRENT cluster.
# This prevents errors from stale kubeconfig files after an infra rebuild.
print_header "Connecting to Cluster"
./scripts/connect.sh
echo "✅ Kubectl is connected."

# Get necessary values from Terraform and config files
echo "Gathering configuration..."
NETWORK_ID=$(terraform output -raw network_id 2>/dev/null || echo "")
HETZNER_API_TOKEN=$(grep "hcloud_token" .tfvars | cut -d'"' -f2)
DOMAIN=$(grep "^  host:" hq-cluster-chart/values.yaml | cut -d' ' -f4)
EMAIL=$(grep '^email:' hq-cluster-chart/values.yaml | cut -d' ' -f2 | tr -d '"')
WORKER_COUNT=$(grep "worker_count" .tfvars | cut -d'=' -f2 | tr -d ' ' || echo "2")

if [ -z "$NETWORK_ID" ] || [ -z "$HETZNER_API_TOKEN" ] || [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "❌ Error: Could not read necessary configuration from Terraform outputs or config files."
    exit 1
fi
echo "✅ Configuration gathered (expecting $((WORKER_COUNT + 1)) nodes total)."

# 1. Wait for all nodes to be ready before proceeding
print_header "Waiting for all nodes to be Ready"
echo "   Checking initial node status..."
kubectl get nodes

# Wait for all nodes to join the cluster first
echo "   Waiting for worker nodes to join..."
timeout=300
counter=0
expected_nodes=$((WORKER_COUNT + 1))  # workers + 1 master
while [ $counter -lt $timeout ]; do
    current_nodes=$(kubectl get nodes --no-headers | wc -l)
    if [ "$current_nodes" -ge "$expected_nodes" ]; then
        echo "   All $expected_nodes nodes have joined the cluster!"
        break
    fi
    echo "   Found $current_nodes/$expected_nodes nodes, waiting... (${counter}s / ${timeout}s)"
    sleep 10
    counter=$((counter + 10))
done

# Now wait for all nodes to be ready
echo "   Waiting for all nodes to become Ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=10m
echo "✅ All nodes are Ready."
kubectl get nodes

# 2. Configure Traefik Ingress Controller FIRST (so Service has annotations before CCM)
print_header "Configuring Traefik Ingress Controller"
cp config/traefik-helmchartconfig.yaml /tmp/traefik-helmchartconfig.yaml
sed -i.bak "s/email: .*/email: $EMAIL/g" /tmp/traefik-helmchartconfig.yaml
# Inject Hetzner network ID into Traefik LB annotations when using private IPs
sed -i.bak "s/load-balancer\.hetzner\.cloud\/network: \".*\"/load-balancer.hetzner.cloud\/network: \"$NETWORK_ID\"/g" /tmp/traefik-helmchartconfig.yaml || true
echo "   Cleaning up any previous Traefik installation attempts..."
kubectl delete job helm-install-traefik -n kube-system --ignore-not-found=true || true
kubectl delete helmchartconfig traefik -n kube-system --ignore-not-found=true || true
sleep 5
echo "   Applying Traefik configuration via HelmChartConfig..."
kubectl apply -f /tmp/traefik-helmchartconfig.yaml
print_header "Waiting for Traefik to be Ready"
echo "   Waiting for Traefik deployment to be created by K3s..."
kubectl wait --for=condition=available deployment/traefik -n kube-system --timeout=180s || true
echo "   Waiting for Traefik pods to roll out..."
kubectl -n kube-system rollout status deploy/traefik --timeout=300s || true
echo "✅ Traefik is configured and ready."

# 3. Install Hetzner Cloud Controller Manager (CCM)
print_header "Installing Hetzner Cloud Controller Manager"
# Use a CCM manifest compatible with newer Kubernetes versions
# Pinning to 'latest' keeps CCM aligned when the cluster is upgraded.
kubectl apply -f https://github.com/hetznercloud/hcloud-cloud-controller-manager/releases/latest/download/ccm-networks.yaml
kubectl -n kube-system create secret generic hcloud \
    --from-literal=token="$HETZNER_API_TOKEN" \
    --from-literal=network="$NETWORK_ID" \
    --dry-run=client -o yaml | kubectl apply -f -

echo "   Waiting for CCM deployment to become Ready..."
kubectl -n kube-system rollout status deploy/hcloud-cloud-controller-manager --timeout=300s || true
echo "✅ CCM installed and configured."

# 4. Install Hetzner CSI Driver for persistent storage
print_header "Installing Hetzner CSI Driver"
kubectl apply -f https://raw.githubusercontent.com/hetznercloud/csi-driver/v2.17.0/deploy/kubernetes/hcloud-csi.yml
kubectl -n kube-system create secret generic hcloud-csi \
    --from-literal=token="$HETZNER_API_TOKEN" \
    --dry-run=client -o yaml | kubectl apply -f -
kubectl wait --for=condition=available deployment/hcloud-csi-controller -n kube-system --timeout=300s || true
kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}' 2>/dev/null || true
echo "✅ CSI Driver installed."


# 6. Deploy the HQ Application via Helm
print_header "Deploying HQ Application"
helm upgrade --install hq-stack ./hq-cluster-chart \
    --namespace hq \
    --create-namespace \
    --timeout=15m
echo "✅ Application Helm chart deployed."

# 7. Wait for Load Balancer to get its public IP
print_header "Waiting for Hetzner Load Balancer IP"
timeout=300
counter=0
LB_IP=""
while [ $counter -lt $timeout ]; do
    LB_IP=$(kubectl get svc traefik -n kube-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    if [ -n "$LB_IP" ]; then
        echo "✅ Load Balancer IP assigned: $LB_IP"
        break
    fi
    echo "   Still waiting... (${counter}s / ${timeout}s)"
    sleep 10
    counter=$((counter + 10))
done

if [ -z "$LB_IP" ]; then
    echo "⚠️  Warning: Load Balancer IP not assigned after ${timeout}s. You may need to check the CCM logs."
fi

# 7.5 Validate DNS A record matches the Load Balancer IP (helps ACME succeed first try)
if [ -n "$LB_IP" ]; then
    print_header "Validating DNS points to Load Balancer"
    DNS_TIMEOUT=300
    DNS_COUNTER=0
    DNS_IP=""
    while [ $DNS_COUNTER -lt $DNS_TIMEOUT ]; do
        DNS_IP=$(dig +short A "$DOMAIN" | tail -n1 || true)
        if [ -z "$DNS_IP" ]; then
            echo "   No A record found for $DOMAIN yet... (${DNS_COUNTER}s / ${DNS_TIMEOUT}s)"
        elif [ "$DNS_IP" != "$LB_IP" ]; then
            echo "   DNS A for $DOMAIN is $DNS_IP but LB IP is $LB_IP... waiting (${DNS_COUNTER}s / ${DNS_TIMEOUT}s)"
        else
            echo "✅ DNS for $DOMAIN points to $LB_IP"
            break
        fi
        sleep 10
        DNS_COUNTER=$((DNS_COUNTER + 10))
    done
    if [ "$DNS_IP" != "$LB_IP" ]; then
        echo "⚠️  Proceeding even though DNS for $DOMAIN is not $LB_IP yet. ACME may complete after propagation."
    fi
fi

# 7.6 Validate AAAA (IPv6) DNS record points to LB IPv6 or is absent
print_header "Validating IPv6 (AAAA) DNS record"
LB_IPV6=$(kubectl get svc traefik -n kube-system -o jsonpath='{range .status.loadBalancer.ingress[*]}{.ip}{"\n"}{end}' 2>/dev/null | grep ':' | head -n1 || true)
AAAA_IP=$(dig +short AAAA "$DOMAIN" | tail -n1 || true)
if [ -n "$AAAA_IP" ]; then
    if [ -n "$LB_IPV6" ] && [ "$AAAA_IP" = "$LB_IPV6" ]; then
        echo "✅ AAAA for $DOMAIN points to LB IPv6 $LB_IPV6"
    else
        echo "⚠️  AAAA for $DOMAIN is $AAAA_IP but LB IPv6 is ${LB_IPV6:-<none>}"
        echo "   Tip: Either update AAAA to $LB_IPV6 or remove AAAA until IPv6 is configured."
    fi
else
    echo "ℹ️  No AAAA record found for $DOMAIN (IPv6). This is acceptable."
fi

# 8. Proactively trigger ACME once LB is ready (avoids default cert lingering)
print_header "Ensuring TLS Certificate Issuance (ACME)"
if [ -n "$LB_IP" ]; then
    if [ "${ACME_FORCE_RESET:-false}" = "true" ]; then
        echo "   ACME_FORCE_RESET=true → backing up and clearing Traefik ACME storage..."
        kubectl -n kube-system exec deploy/traefik -- sh -c 'cp /data/acme.json /data/acme.json.bak-$(date +%s) 2>/dev/null || true; : > /data/acme.json' || true
    fi
    echo "   Restarting Traefik to trigger a fresh ACME attempt (with PVC-safe rollout)..."
    echo "   Scaling Traefik down to release the ACME PVC..."
    kubectl -n kube-system scale deploy/traefik --replicas=0 || true
    echo "   Waiting for Traefik pods to terminate..."
    kubectl -n kube-system wait --for=delete pod -l app.kubernetes.io/name=traefik --timeout=180s || true
    echo "   Scaling Traefik back up..."
    kubectl -n kube-system scale deploy/traefik --replicas=1 || true
    kubectl -n kube-system rollout status deploy/traefik --timeout=300s || true
    echo "   Checking ACME storage size in traefik (should grow after issuance)..."
    kubectl -n kube-system exec deploy/traefik -- sh -c 'test -f /data/acme.json && wc -c /data/acme.json || echo "0 /data/acme.json"' 2>/dev/null || true
    echo "   Verifying presented certificate for $DOMAIN..."
    CERT_TIMEOUT=300
    CERT_COUNTER=0
    while [ $CERT_COUNTER -lt $CERT_TIMEOUT ]; do
        if command -v openssl >/dev/null 2>&1; then
            ISSUER=$(openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" -showcerts </dev/null 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null || true)
            if echo "$ISSUER" | grep -qi "Let's Encrypt"; then
                echo "✅ Valid TLS certificate detected (issuer: $(echo "$ISSUER" | sed 's/issuer=//'))"
                break
            fi
        else
            echo "   openssl not found; skipping remote cert verification."
            break
        fi
        echo "   Waiting for certificate issuance... (${CERT_COUNTER}s / ${CERT_TIMEOUT}s)"
        sleep 10
        CERT_COUNTER=$((CERT_COUNTER + 10))
    done
    if [ $CERT_COUNTER -ge $CERT_TIMEOUT ]; then
        echo "⚠️  Certificate not detected yet. It should issue once DNS and routing are stable."
    fi
    echo "   Note: If DNS for $DOMAIN is not pointing to $LB_IP yet, issuance will occur once DNS propagates."
else
    echo "   Skipping ACME trigger because Load Balancer IP is not yet available."
fi

echo ""
echo "🎉 Application Deployment Phase Complete!"