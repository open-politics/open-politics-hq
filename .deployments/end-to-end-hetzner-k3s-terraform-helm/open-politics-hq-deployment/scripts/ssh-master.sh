#!/bin/bash
set -e

# SSH into the master node using the same key-detection logic as scripts/connect.sh

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$PROJECT_DIR"

MASTER_IP=$(terraform output -raw master_ip 2>/dev/null || true)
if [ -z "$MASTER_IP" ]; then
  echo "❌ Could not determine master IP from Terraform outputs. Run ./deploy.sh first."
  exit 1
fi

pick_ssh_key() {
    local host_ip="$1"
    local candidates=(
        "$HOME/.ssh/id_rsa"
        "$HOME/.ssh/id_ed25519"
        "$HOME/.ssh/open_politics_admin"
        "$HOME/.ssh/open_politics_prod"
    )
    for f in "$HOME"/.ssh/*; do
        if [ -f "$f" ] && [[ "$f" != *.pub ]]; then
            candidates+=("$f")
        fi
    done
    for key in "${candidates[@]}"; do
        if [ -r "$key" ]; then
            if ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -i "$key" root@"$host_ip" "echo ok" >/dev/null 2>&1; then
                echo "$key"
                return 0
            fi
        fi
    done
    echo ""
    return 1
}

SSH_KEY_FILE=""
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
    if ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no root@"$MASTER_IP" echo ok >/dev/null 2>&1; then
        echo "✅ Using ssh-agent keys"
    else
        echo "❌ No working SSH auth found for root@$MASTER_IP after several retries."
        echo "   Add your key to agent: ssh-add ~/.ssh/<your_key>"
        echo "   Or ensure the private key for Hetzner ssh_key_name is present locally"
        exit 1
    fi
fi

# Avoid host key mismatch issues
ssh-keygen -R "$MASTER_IP" >/dev/null 2>&1 || true

echo "🔌 Opening SSH session to root@$MASTER_IP..."
exec ssh -tt $SSH_OPTS root@"$MASTER_IP"


