#!/bin/bash
set -e

# Cleanup Orphaned Resources Script
# This script helps clean up Load Balancers and other resources that might prevent network deletion

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$PROJECT_DIR"

echo "🧹 Orphaned Resource Cleanup"
echo "============================"
echo

# Get API token
HETZNER_API_TOKEN=$(grep "hcloud_token" .tfvars | cut -d'"' -f2 2>/dev/null || echo "")
if [ -z "$HETZNER_API_TOKEN" ]; then
    echo "❌ Error: Could not find Hetzner API token in .tfvars"
    exit 1
fi

echo "🔍 Scanning for orphaned resources..."

# Check for Load Balancers with strict name prefix for this cluster slug or attached to this network
echo "📊 Load Balancers:"
CLUSTER_SLUG=$(terraform output -raw cluster_slug 2>/dev/null || echo "")
NETWORK_ID=$(terraform output -raw network_id 2>/dev/null || echo "")
LB_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    "https://api.hetzner.cloud/v1/load_balancers" | \
    jq -r --arg slug "$CLUSTER_SLUG" --arg net "$NETWORK_ID" '
      .load_balancers[]
      | select((.name | test("^hq-" + $slug + "-")) or (.private_net[]?.network == ($net|tonumber)))
      | "\(.id) \(.name)"' 2>/dev/null || echo "")

if [ -n "$LB_LIST" ]; then
    echo "$LB_LIST" | while read -r lb_id lb_name; do
        if [ -n "$lb_id" ]; then
            echo "   🔍 Found: $lb_name (ID: $lb_id)"
        fi
    done
    
    echo
    read -p "❓ Delete these Load Balancers? (y/N): " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "$LB_LIST" | while read -r lb_id lb_name; do
            if [ -n "$lb_id" ]; then
                echo "   🗑️  Deleting: $lb_name (ID: $lb_id)"
                curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
                    "https://api.hetzner.cloud/v1/load_balancers/$lb_id" >/dev/null 2>&1 || echo "   ❌ Failed to delete $lb_id"
            fi
        done
        echo "   ✅ Load Balancer deletion requests sent."
    else
        echo "   ⏭️  Skipping Load Balancer deletion."
    fi
else
    echo "   ✅ No Load Balancers found with 'hq' in name."
fi

echo

# Check for Networks with hq in the name
echo "🌐 Networks:"
NETWORK_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    "https://api.hetzner.cloud/v1/networks" | \
    jq -r '.networks[] | select(.name | contains("hq")) | "\(.id) \(.name)"' 2>/dev/null || echo "")

if [ -n "$NETWORK_LIST" ]; then
    echo "$NETWORK_LIST" | while read -r net_id net_name; do
        if [ -n "$net_id" ]; then
            echo "   🔍 Found: $net_name (ID: $net_id)"
        fi
    done
    
    echo
    echo "⚠️  Networks will be automatically cleaned up after Load Balancers are deleted."
    echo "   Wait a few minutes, then run terraform destroy again."
else
    echo "   ✅ No Networks found with 'hq' in name."
fi

echo

# Check for Firewalls
echo "🔥 Firewalls:"
FIREWALL_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    "https://api.hetzner.cloud/v1/firewalls" | \
    jq -r '.firewalls[] | select(.name | contains("hq")) | "\(.id) \(.name)"' 2>/dev/null || echo "")

if [ -n "$FIREWALL_LIST" ]; then
    echo "$FIREWALL_LIST" | while read -r fw_id fw_name; do
        if [ -n "$fw_id" ]; then
            echo "   🔍 Found: $fw_name (ID: $fw_id)"
        fi
    done
    
    echo
    read -p "❓ Delete these Firewalls? (y/N): " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "$FIREWALL_LIST" | while read -r fw_id fw_name; do
            if [ -n "$fw_id" ]; then
                echo "   🗑️  Deleting: $fw_name (ID: $fw_id)"
                curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
                    "https://api.hetzner.cloud/v1/firewalls/$fw_id" >/dev/null 2>&1 || echo "   ❌ Failed to delete $fw_id"
            fi
        done
        echo "   ✅ Firewall deletion requests sent."
    else
        echo "   ⏭️  Skipping Firewall deletion."
    fi
else
    echo "   ✅ No Firewalls found with 'hq' in name."
fi

echo
echo "🎉 Cleanup scan complete!"
echo
echo "💡 Tips:"
echo "   • Wait 1-2 minutes for deletions to process"
echo "   • Then try running terraform destroy again"
echo "   • Check the Hetzner Console if issues persist"
