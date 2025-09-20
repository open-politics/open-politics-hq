#!/bin/bash
set -e

# Open Politics HQ - Production Deployment Script
# A menu-driven, state-aware, and user-friendly wrapper for all deployment tasks.

# --- Configuration & Preamble ---
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# SSH keys are now managed automatically via scripts/manage-ssh-keys.sh

# --- Helper Functions ---

function print_header() {
    echo "--------------------------------------------------"
    echo "  $1"
    echo "--------------------------------------------------"
}

# --- State Detection ---

function get_system_state() {
    echo "🔍 Checking system state..."
    INFRA_STATE="NOT_DEPLOYED"
    APP_STATE="NOT_DEPLOYED"
    KUBECTL_STATE="NOT_CONNECTED"
    
    # Check if infrastructure is actually deployed (not just tfstate exists)
    echo "   • Checking Terraform state..."
    if [ -f "terraform.tfstate" ]; then
        echo "   • Found terraform.tfstate, checking outputs..."
        # Check if master_ip output exists (indicates servers are deployed)
        if terraform output master_ip >/dev/null 2>&1; then
            INFRA_STATE="DEPLOYED"
            echo "   • Infrastructure: ✅ DEPLOYED"
        else
            echo "   • No master_ip output found, checking for partial state..."
            # Check if any resources exist in state
            STATE_RESOURCES=$(terraform state list 2>/dev/null | wc -l | tr -d ' ')
            if [ "$STATE_RESOURCES" -gt 0 ]; then
                INFRA_STATE="PARTIAL"
                echo "   • Infrastructure: ⚠️  PARTIAL ($STATE_RESOURCES resources)"
            else
                INFRA_STATE="NOT_DEPLOYED"
                echo "   • Infrastructure: ❌ NOT_DEPLOYED"
            fi
        fi
    else
        echo "   • No terraform.tfstate found"
        echo "   • Infrastructure: ❌ NOT_DEPLOYED"
    fi
    
    # Check kubectl connection status
    echo "   • Checking Kubernetes connection..."
    if kubectl cluster-info >/dev/null 2>&1; then
        # Check if connected to the right cluster
        CURRENT_SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || echo "")
        EXPECTED_IP=$(terraform output -raw master_ip 2>/dev/null || echo "")
        
        if [ -n "$EXPECTED_IP" ] && [[ "$CURRENT_SERVER" == *"$EXPECTED_IP"* ]]; then
            KUBECTL_STATE="CONNECTED"
            echo "   • Kubernetes: ✅ CONNECTED ($EXPECTED_IP)"
        elif [ -n "$CURRENT_SERVER" ]; then
            KUBECTL_STATE="WRONG_CLUSTER"
            echo "   • Kubernetes: ⚠️  CONNECTED TO DIFFERENT CLUSTER"
        else
            KUBECTL_STATE="NOT_CONNECTED"
            echo "   • Kubernetes: ❌ NOT_CONNECTED"
        fi
    else
        KUBECTL_STATE="NOT_CONNECTED"
        echo "   • Kubernetes: ❌ NOT_CONNECTED"
    fi
    
    # Check if helm release exists
    echo "   • Checking application deployment..."
    if kubectl get namespace open-politics >/dev/null 2>&1 && helm status open-politics -n open-politics >/dev/null 2>&1; then
        APP_STATE="DEPLOYED"
        echo "   • Application: ✅ DEPLOYED"
    else
        echo "   • Application: ❌ NOT_DEPLOYED"
    fi
    
    echo "✅ State check complete!"
    echo ""
}

# --- Core Logic Functions ---



function provision_infrastructure() {
    print_header "Phase 1: Provisioning Infrastructure & K3s Cluster"
    # Pre-flight check for tfvars
    if [ ! -f ".tfvars" ]; then
        echo "❌ Error: .tfvars file not found. Please copy .tfvars.example and fill it out."
        exit 1
    fi
    if grep -q "your_hetzner_api_token_here" ".tfvars"; then
        echo "❌ Error: Default placeholder values found in .tfvars."
        exit 1
    fi

    # Only rotate SSH keys if infrastructure doesn't exist or if explicitly requested
    if [ ! -f "terraform.tfstate" ]; then
        echo "🔑 First deployment detected - rotating SSH keys..."
        ./scripts/manage-ssh-keys.sh rotate
    else
        echo "🔑 Existing deployment detected - skipping SSH key rotation"
        echo "   (Use menu option 6 to manually rotate keys if needed)"
    fi

    # Deploy with Terraform
    terraform init -upgrade
    terraform apply -var-file=.tfvars -auto-approve
    echo "✅ Infrastructure and K3s installation complete."
}

function fix_node_provider_ids() {
    print_header "Fixing Node Provider IDs for Hetzner CCM"
    
    echo "🔍 Checking current node provider IDs..."

    # Ensure CCM is present before validating
    if ! kubectl -n kube-system get deployment hcloud-cloud-controller-manager >/dev/null 2>&1; then
        echo "   ℹ️  CCM not installed yet; skipping provider ID fix (boot will install CCM)."
        return 0
    fi

    # Helper to check a node's providerID status
    check_node_pid() {
        local node_selector="$1"
        local node_name
        node_name=$(kubectl get nodes -o jsonpath="{.items[$node_selector].metadata.name}" 2>/dev/null || echo "")
        if [ -z "$node_name" ]; then
            return 0
        fi
        local pid
        pid=$(kubectl get node "$node_name" -o jsonpath='{.spec.providerID}' 2>/dev/null || echo "")
        if [[ -z "$pid" ]]; then
            echo "   • $node_name: providerID empty; waiting for CCM to populate..."
            kubectl wait --for=condition=Ready node/"$node_name" --timeout=120s >/dev/null 2>&1 || true
            # Re-check up to ~60s for CCM to set providerID
            local tries=0
            while [ $tries -lt 12 ]; do
                pid=$(kubectl get node "$node_name" -o jsonpath='{.spec.providerID}' 2>/dev/null || echo "")
                if [[ "$pid" == hcloud://* ]]; then
                    echo "     ✅ $node_name: providerID set to $pid"
                    return 0
                fi
                sleep 5
                tries=$((tries+1))
            done
            echo "     ⚠️  $node_name: providerID still empty/not set by CCM yet."
        elif [[ "$pid" == hcloud://* ]]; then
            echo "   • $node_name: ✅ providerID ok ($pid)"
        else
            echo "   • $node_name: ⚠️  providerID is non-empty and not hcloud:// ($pid). Not modifying (Kubernetes forbids changing non-empty providerID)."
        fi
    }

    # Check control-plane node(s)
    kubectl get nodes -o json | jq -r '.items[] | select(.metadata.labels["node-role.kubernetes.io/control-plane"]=="true") | "control-plane"' >/dev/null 2>&1 || true
    # Iterate over all nodes
    kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | while read -r n; do
        if [ -n "$n" ]; then
            check_node_pid "?(@.metadata.name=='$n')"
        fi
    done

    echo "✅ Provider ID verification complete."
}

function deploy_application() {
    print_header "Phase 2: Deploying Application Stack"
    
    # Check if infrastructure is deployed and kubectl is connected
    get_system_state >/dev/null 2>&1  # Silent state check
    
    if [ "$INFRA_STATE" != "DEPLOYED" ]; then
        echo "❌ Error: Infrastructure must be fully deployed before deploying application."
        echo "   Current state: $INFRA_STATE"
        echo ""
        read -p "Press Enter to continue or Ctrl+C to exit..." -r
        return 1
    fi
    
    if [ "$KUBECTL_STATE" != "CONNECTED" ]; then
        echo "ℹ️  kubectl is not connected (state: $KUBECTL_STATE). Attempting to connect now..."
        ./scripts/connect.sh || true
        # Re-check state after attempting to connect
        get_system_state >/dev/null 2>&1
        if [ "$KUBECTL_STATE" != "CONNECTED" ]; then
            echo "❌ Could not establish kubectl connection automatically."
            echo "   Run option 4 (Connect to Cluster) to troubleshoot, then retry."
            echo ""
            read -p "Press Enter to continue or Ctrl+C to exit..." -r
            return 1
        fi
    fi
    
    # Pre-flight check for values.yaml
    if [ ! -f "helm-chart/values.yaml" ]; then
        echo "❌ Error: helm-chart/values.yaml file not found."
        echo "   Please copy the .example file and fill out your secrets."
        exit 1
    fi
    if grep -q "changeThis" "helm-chart/values.yaml"; then
        echo "❌ Error: Default placeholder values found in helm-chart/values.yaml."
        echo "   Please replace all instances of 'changeThis' with your secrets."
        exit 1
    fi

    # Run the boot script which handles CCM, CSI, Traefik, and Helm first
    ./scripts/boot.sh
    echo "✅ Application stack deployed."
}

function cleanup_partial_state() {
    print_header "Cleaning Up Partial Infrastructure State"
    echo "⚠️  Detected partial infrastructure state. This can happen after an incomplete destroy."
    echo "   Current resources in Terraform state:"
    terraform state list | sed 's/^/     /'
    echo ""
    echo "   Options:"
    echo "   1) Clean up remaining resources and reset state"
    echo "   2) Attempt to complete the destroy operation"
    echo "   3) Cancel and return to menu"
    echo ""
    read -p "   Choose an option (1-3): " -r
    
    case $REPLY in
        1)
            echo "🧹 Cleaning up remaining resources..."
            ./scripts/cleanup-orphaned-resources.sh
            echo "🗑️  Removing Terraform state..."
            rm -f terraform.tfstate*
            rm -f .terraform.lock.hcl
            echo "✅ Cleanup complete. You can now run a fresh deployment."
            ;;
        2)
            echo "🔄 Attempting to complete destroy..."
            timeout 300 terraform destroy -var-file=.tfvars -auto-approve || {
                echo "⚠️  Destroy timed out or failed. Running cleanup..."
                ./scripts/cleanup-orphaned-resources.sh
                rm -f terraform.tfstate*
            }
            ;;
        3)
            echo "   Cancelled."
            ;;
        *)
            echo "   Invalid option."
            ;;
    esac
}

function destroy_infrastructure() {
    print_header "Destroying All Infrastructure"
    echo "⚠️  WARNING: This will permanently destroy all servers, volumes, and resources."
    read -p "   Are you sure? (y/n): " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Use the dedicated destroy script which handles Load Balancer cleanup
        ./scripts/destroy.sh
    else
        echo "   Aborted."
    fi
}

# --- Menu ---

function main_menu() {
    get_system_state
    print_header "Open Politics HQ - Deployment Control Panel"
    echo "Current State: Infra: $INFRA_STATE | Kubectl: $KUBECTL_STATE | App: $APP_STATE"
    
    # Show warnings and recommendations based on state
    if [ "$INFRA_STATE" = "PARTIAL" ]; then
        echo ""
        echo "⚠️  WARNING: Partial infrastructure state detected!"
        echo "   This usually happens after an incomplete destroy operation."
        echo "   Recommend running 'Clean Up Partial State' before proceeding."
    elif [ "$INFRA_STATE" = "DEPLOYED" ] && [ "$KUBECTL_STATE" = "NOT_CONNECTED" ]; then
        echo ""
        echo "⚠️  WARNING: Infrastructure is deployed but kubectl is not connected!"
        echo "   You need to connect to the cluster before deploying applications."
    elif [ "$INFRA_STATE" = "DEPLOYED" ] && [ "$KUBECTL_STATE" = "WRONG_CLUSTER" ]; then
        echo ""
        echo "⚠️  WARNING: kubectl is connected to a different cluster!"
        echo "   Reconnect to the correct cluster before proceeding."
    fi
    
    echo ""
    echo "Please choose an option:"
    
    # Show recommendations prominently based on state
    if [ "$INFRA_STATE" = "PARTIAL" ]; then
        echo "🔧 RECOMMENDED: Clean Up Partial State"
        echo ""
    elif [ "$INFRA_STATE" = "DEPLOYED" ] && [ "$KUBECTL_STATE" != "CONNECTED" ]; then
        echo "🔧 RECOMMENDED: Connect to Cluster (option 4)"
        echo ""
    fi
    
    echo "1.  Provision / Update Infrastructure (Phase 1)"
    echo "2.  Deploy / Upgrade Application (Phase 2)"
    echo "3.  Full Deploy: Phase 1 + Phase 2 (infra → app)"
    echo "4.  Connect to Cluster (configure kubectl)"
    echo "5.  Get Load Balancer IP (for DNS)"
    echo "6.  Rotate SSH Keys"
    echo "7.  SSH Key Status"
    echo "8.  Clean Up Old Backups"
    echo "9.  Clean Up Orphaned Resources"
    echo "10. Clean Up Partial State"
    echo "11. ---"
    echo "12. Destroy All Infrastructure"
    echo "0.  Exit"

    read -p "Enter choice: " -r choice
    case $choice in
        1) 
            if [ "$INFRA_STATE" = "PARTIAL" ]; then
                echo "⚠️  Warning: Infrastructure is in partial state. Consider cleanup first."
                read -p "   Continue anyway? (y/N): " -r
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    return
                fi
            fi
            provision_infrastructure ;;
        2) 
            if [ "$INFRA_STATE" != "DEPLOYED" ]; then
                echo "❌ Error: Infrastructure must be fully deployed before deploying application."
                echo "   Current state: $INFRA_STATE"
                return
            fi
            deploy_application ;;
        3)
            # Run Phase 1 then Phase 2 in sequence, reusing existing logic
            if [ "$INFRA_STATE" = "PARTIAL" ]; then
                echo "⚠️  Warning: Infrastructure is in partial state. Consider cleanup first."
                read -p "   Continue anyway? (y/N): " -r
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    return
                fi
            fi
            provision_infrastructure
            deploy_application ;;
        4) ./scripts/connect.sh ;;
        5) echo "🌐 Load Balancer IP: $(kubectl get svc traefik -n kube-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo 'Not available')" ;;
        6) ./scripts/manage-ssh-keys.sh rotate ;;
        7) ./scripts/manage-ssh-keys.sh status ;;
        8) ./scripts/manage-ssh-keys.sh cleanup ;;
        9) ./scripts/cleanup-orphaned-resources.sh ;;
        10) cleanup_partial_state ;;
        12) destroy_infrastructure ;;
        0) exit 0 ;;
        *) echo "Invalid option. Please try again." ;;
    esac
}

# --- Entrypoint ---
echo "🚀 Starting Open Politics HQ Deployment Manager..."
echo "   Loading configuration and checking system state..."
echo ""

CMD="${1:-menu}"

case "$CMD" in
    deploy)
        provision_infrastructure
        deploy_application
        ;;
    menu)
        while true; do
            main_menu
            echo ""
            read -p "Press Enter to continue or Ctrl+C to exit..." -r
        done
        ;;
    *)
        echo "Usage: $0 [deploy|menu]"
        echo "  deploy - Run full deployment (infrastructure + application)"
        echo "  menu   - Interactive menu (default)"
        ;;
esac
