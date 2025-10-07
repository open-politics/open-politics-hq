#!/bin/bash
set -e

# Configure local kubectl to talk to the cluster running on the master node

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$PROJECT_DIR"

MASTER_IP=$(terraform output -raw master_ip 2>/dev/null || true)
if [ -z "$MASTER_IP" ]; then
  echo "❌ Could not determine master IP from Terraform outputs. Run ./deploy.sh first."
  exit 1
fi

# Auto-detect a working SSH key for the master (robust version from deploy.sh)
pick_ssh_key() {
    local host_ip="$1"
    # Candidate keys (common names first)
    local candidates=(
        "$HOME/.ssh/id_rsa"
        "$HOME/.ssh/id_ed25519"
        "$HOME/.ssh/open_politics_admin"
        "$HOME/.ssh/open_politics_prod"
    )
    # Also try any private key in ~/.ssh (excluding .pub)
    for f in "$HOME"/.ssh/*; do
        if [ -f "$f" ] && [[ "$f" != *.pub ]]; then
            candidates+=("$f")
        fi
    done
    for key in "${candidates[@]}"; do
        if [ -r "$key" ]; then
            # Use a longer timeout here to account for new server startup
            if ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -i "$key" root@"$host_ip" "echo ok" >/dev/null 2>&1; then
                echo "$key"
                return 0
            fi
        fi
    done
    echo ""
    return 1
}

echo "Trying to connect to master at $MASTER_IP..."
SSH_KEY_FILE=""
# Retry finding a key for a minute, as the server might still be booting
for i in {1..6}; do
    SSH_KEY_FILE=$(pick_ssh_key "$MASTER_IP")
    if [ -n "$SSH_KEY_FILE" ]; then
        break
    fi
    echo "   SSH not ready yet, retrying in 10 seconds..."
    sleep 10
done

SSH_OPTS="-o StrictHostKeyChecking=no"
if [ -n "$SSH_KEY_FILE" ]; then
    SSH_OPTS="-i $SSH_KEY_FILE $SSH_OPTS"
    echo "✅ Using SSH key: $SSH_KEY_FILE"
else
    # Try ssh-agent keys as a fallback
    if ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no root@"$MASTER_IP" echo ok >/dev/null 2>&1; then
        echo "✅ Using ssh-agent keys"
    else
        echo "❌ No working SSH auth found for root@$MASTER_IP after several retries."
        echo "   Add your key to agent: ssh-add ~/.ssh/<your_key>"
        echo "   Or ensure the private key for Hetzner ssh_key_name is present locally"
        exit 1
    fi
fi

# Clean up old SSH host key to prevent "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"
ssh-keygen -R "$MASTER_IP" >/dev/null 2>&1 || true

echo "🔧 Waiting for K3s to be ready on master $MASTER_IP..."

# Wait for K3s to be fully installed and running
echo "   ⏳ Checking if K3s is installed and running..."
timeout=300  # 5 minutes timeout
counter=0
while [ $counter -lt $timeout ]; do
    if ssh $SSH_OPTS root@"$MASTER_IP" "systemctl is-active k3s >/dev/null 2>&1 && test -r /etc/rancher/k3s/k3s.yaml" >/dev/null 2>&1; then
        echo "   ✅ K3s is running and kubeconfig is available!"
        break
    fi
    
    if [ $((counter % 30)) -eq 0 ]; then
        echo "   ⏳ Still waiting for K3s to be ready... (${counter}s / ${timeout}s)"
    fi
    
    sleep 5
    counter=$((counter + 5))
done

if [ $counter -ge $timeout ]; then
    echo "❌ Timeout: K3s did not become ready after ${timeout} seconds"
    echo "   Try connecting manually later with: ssh $SSH_OPTS root@$MASTER_IP"
    echo "   Then check: systemctl status k3s"
    exit 1
fi

echo "🔧 Fetching kubeconfig from master $MASTER_IP..."
mkdir -p ~/.kube

# Double-check the file exists before copying
if ! ssh $SSH_OPTS root@"$MASTER_IP" test -r /etc/rancher/k3s/k3s.yaml; then
    echo "❌ Error: /etc/rancher/k3s/k3s.yaml is not readable on the master node"
    echo "   K3s may not be properly installed. Check master node logs."
    exit 1
fi

scp $SSH_OPTS root@"$MASTER_IP":/etc/rancher/k3s/k3s.yaml ~/.kube/config
sed -i.bak "s/127.0.0.1:6443/$MASTER_IP:6443/g" ~/.kube/config
chmod 600 ~/.kube/config

echo "✅ kubectl configured. Testing connection..."
if kubectl cluster-info >/dev/null 2>&1; then
    echo "✅ Connection successful! Current nodes:"
    kubectl get nodes
else
    echo "❌ kubectl configuration failed. Connection test unsuccessful."
    echo "   Check if port 6443 is accessible from your machine."
    exit 1
fi


