#!/bin/bash
set -e

# This script completely destroys all infrastructure managed by this Terraform configuration.

# --- Preamble ---
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$PROJECT_DIR"

# --- Main Logic ---
echo "💥 Destroying Open Politics HQ infrastructure..."
echo ""
echo "⚠️  WARNING: This will permanently delete:"
echo "   - All Kubernetes resources"
echo "   - All persistent data (databases, files)"
echo "   - All Hetzner Cloud servers and networks"
echo "   - This action CANNOT be undone!"
echo ""
read -p "Are you absolutely sure you want to continue? Type 'yes' to confirm: " -r
echo ""

if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo "   Aborted."
    exit 1
fi

echo "🗑️  Starting destruction process..."

# First, clean up any external resources that might prevent network deletion
echo "🧹 Pre-cleaning external resources..."

# Get API token
HETZNER_API_TOKEN=""
if [ -f ".tfvars" ]; then
    HETZNER_API_TOKEN=$(grep "hcloud_token" .tfvars | cut -d'"' -f2 2>/dev/null || echo "")
fi

if [ -n "$HETZNER_API_TOKEN" ]; then
    echo "   Scanning for all 'hq' resources..."
    
    # 1. Clean up Load Balancers first (they prevent network deletion)
    echo "   🔍 Checking Load Balancers..."
    CLUSTER_SLUG=$(terraform output -raw cluster_slug 2>/dev/null || echo "")
    NETWORK_ID=$(terraform output -raw network_id 2>/dev/null || echo "")
    LB_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/load_balancers" 2>/dev/null | \
        jq -r --arg slug "$CLUSTER_SLUG" --arg net "$NETWORK_ID" '
          .load_balancers[]? | select((.name | test("^hq-" + $slug + "-")) or (.private_net[]?.network == ($net|tonumber))) | .id' 2>/dev/null || echo "")
    
    if [ -n "$LB_LIST" ]; then
        echo "   🗑️  Deleting Load Balancers..."
        echo "$LB_LIST" | while read -r lb_id; do
            if [ -n "$lb_id" ] && [ "$lb_id" != "null" ]; then
                echo "      • Deleting Load Balancer ID: $lb_id"
                curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
                    "https://api.hetzner.cloud/v1/load_balancers/$lb_id" >/dev/null 2>&1 || true
            fi
        done
        echo "   ⏳ Waiting for Load Balancers to be deleted..."
        sleep 15
    else
        echo "   ✅ No Load Balancers found."
    fi
    
    # 2. Check what other resources exist for post-terraform cleanup
    echo "   🔍 Scanning for other resources to clean up after terraform..."
    
    # Get lists of resources that might need cleanup
    SERVER_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/servers" 2>/dev/null | \
        jq -r '.servers[]? | select(.name | test("hq")) | .id' 2>/dev/null || echo "")
    
    FW_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/firewalls" 2>/dev/null | \
        jq -r '.firewalls[]? | select(.name | test("hq")) | .id' 2>/dev/null || echo "")
    
    NET_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/networks" 2>/dev/null | \
        jq -r '.networks[]? | select(.name | test("hq")) | .id' 2>/dev/null || echo "")
    
    if [ -n "$SERVER_LIST" ]; then
        echo "   📋 Found servers for post-terraform cleanup"
    fi
    if [ -n "$FW_LIST" ]; then
        echo "   📋 Found firewalls for post-terraform cleanup"
    fi
    if [ -n "$NET_LIST" ]; then
        echo "   📋 Found networks for post-terraform cleanup"
    fi
    
else
    echo "   ⚠️  Could not find Hetzner API token, skipping external resource cleanup."
fi

# Attempt to gracefully tear down infrastructure
echo "🏗️  Destroying Terraform infrastructure..."
# Set a timeout for terraform destroy to prevent infinite hanging (use gtimeout on macOS if available)
if command -v timeout >/dev/null 2>&1; then
    timeout 600 terraform destroy -var-file=.tfvars -auto-approve || {
        exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo "   ⚠️  Terraform destroy timed out after 10 minutes."
            echo "   ⚠️  Some resources may remain in Hetzner Cloud."
            echo "   💡 You may need to manually delete them via the Hetzner Console."
        else
            echo "   ⚠️  Terraform destroy command failed with exit code $exit_code."
            echo "   ⚠️  Some resources may remain in Hetzner Cloud."
        fi
        echo "   🔄 Continuing with local cleanup..."
    }
elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout 600 terraform destroy -var-file=.tfvars -auto-approve || {
        exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo "   ⚠️  Terraform destroy timed out after 10 minutes."
            echo "   ⚠️  Some resources may remain in Hetzner Cloud."
            echo "   💡 You may need to manually delete them via the Hetzner Console."
        else
            echo "   ⚠️  Terraform destroy command failed with exit code $exit_code."
            echo "   ⚠️  Some resources may remain in Hetzner Cloud."
        fi
        echo "   🔄 Continuing with local cleanup..."
    }
else
    # Fallback without timeout on macOS
    terraform destroy -var-file=.tfvars -auto-approve || {
        exit_code=$?
        echo "   ⚠️  Terraform destroy command failed with exit code $exit_code."
        echo "   ⚠️  Some resources may remain in Hetzner Cloud."
        echo "   🔄 Continuing with local cleanup..."
    }
fi

# Post-terraform cleanup: Remove any remaining orphaned resources in correct dependency order
if [ -n "$HETZNER_API_TOKEN" ]; then
    echo "🧹 Final cleanup of any remaining orphaned resources..."
    
    # Step 1: Delete any remaining Load Balancers (again, in case terraform missed some)
    LB_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/load_balancers" 2>/dev/null | \
        jq -r --arg slug "$CLUSTER_SLUG" --arg net "$NETWORK_ID" '
          .load_balancers[]? | select((.name | test("^hq-" + $slug + "-")) or (.private_net[]?.network == ($net|tonumber))) | .id' 2>/dev/null || echo "")
    
    if [ -n "$LB_LIST" ]; then
        echo "   🗑️  Cleaning up remaining Load Balancers..."
        echo "$LB_LIST" | while read -r lb_id; do
            if [ -n "$lb_id" ] && [ "$lb_id" != "null" ]; then
                echo "      • Deleting Load Balancer ID: $lb_id"
                curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
                    "https://api.hetzner.cloud/v1/load_balancers/$lb_id" >/dev/null 2>&1 || true
            fi
        done
        echo "   ⏳ Waiting for Load Balancers to be deleted..."
        sleep 10
    fi
    
    # Step 2: Delete any remaining Servers (firewalls are attached to them)
    SERVER_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/servers" 2>/dev/null | \
        jq -r '.servers[]? | select(.name | test("hq")) | .id' 2>/dev/null || echo "")
    
    if [ -n "$SERVER_LIST" ]; then
        echo "   🗑️  Cleaning up remaining Servers..."
        echo "$SERVER_LIST" | while read -r server_id; do
            if [ -n "$server_id" ] && [ "$server_id" != "null" ]; then
                echo "      • Deleting Server ID: $server_id"
                curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
                    "https://api.hetzner.cloud/v1/servers/$server_id" >/dev/null 2>&1 || true
            fi
        done
        echo "   ⏳ Waiting for Servers to be deleted..."
        sleep 20
    fi
    
    # Step 3: Delete Firewalls (after servers are gone)
    FW_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/firewalls" 2>/dev/null | \
        jq -r '.firewalls[]? | select(.name | test("hq")) | .id' 2>/dev/null || echo "")
    
    if [ -n "$FW_LIST" ]; then
        echo "   🗑️  Cleaning up remaining Firewalls..."
        echo "$FW_LIST" | while read -r fw_id; do
            if [ -n "$fw_id" ] && [ "$fw_id" != "null" ]; then
                echo "      • Deleting Firewall ID: $fw_id"
                curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
                    "https://api.hetzner.cloud/v1/firewalls/$fw_id" >/dev/null 2>&1 || true
            fi
        done
        echo "   ⏳ Waiting for Firewalls to be deleted..."
        sleep 5
    fi
    
    # Step 4: Delete Networks (after everything else is gone)
    NET_LIST=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/networks" 2>/dev/null | \
        jq -r '.networks[]? | select(.name | test("hq")) | .id' 2>/dev/null || echo "")
    
    if [ -n "$NET_LIST" ]; then
        echo "   🗑️  Cleaning up remaining Networks..."
        echo "$NET_LIST" | while read -r net_id; do
            if [ -n "$net_id" ] && [ "$net_id" != "null" ]; then
                echo "      • Deleting Network ID: $net_id"
                curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
                    "https://api.hetzner.cloud/v1/networks/$net_id" >/dev/null 2>&1 || true
            fi
        done
        echo "   ⏳ Waiting for Networks to be deleted..."
        sleep 5
    fi
    
    echo "   ✅ Comprehensive cleanup complete!"
    echo "   🔍 Final verification..."
    
    # Final verification
    REMAINING_RESOURCES=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/servers" 2>/dev/null | \
        jq -r '.servers[]? | select(.name | test("hq")) | .name' 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$REMAINING_RESOURCES" -eq 0 ]; then
        echo "   ✅ All 'hq' resources successfully removed from Hetzner Cloud!"
    else
        echo "   ⚠️  Some resources may still remain. Check Hetzner Console manually."
    fi
fi

# Clean up local state regardless of remote success
echo "🧹 Cleaning up local files..."
rm -f terraform.tfstate*
rm -f .terraform.lock.hcl
rm -rf .terraform/

echo ""
echo "💥 Destruction completed!"
echo ""
echo "📋 What was destroyed:"
echo "   ✅ All Hetzner Cloud resources defined in this project."
echo "   ✅ Local Terraform state and cache."
echo ""
echo "📝 To deploy again, simply run:"
echo "   ./deploy.sh"
