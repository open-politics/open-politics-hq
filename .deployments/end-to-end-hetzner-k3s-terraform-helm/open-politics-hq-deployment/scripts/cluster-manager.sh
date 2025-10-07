#!/bin/bash

# ==============================================================================
# Helm Management Script for Open Politics Project
# ==============================================================================
# This script provides comprehensive Helm chart management including:
# - Install/Uninstall/Update operations
# - Container image tag updates for rolling deployments
# - Interactive menu for easy operation
# ==============================================================================

set -euo pipefail

# Configuration
CHART_PATH="./hq-cluster-chart"
VALUES_FILE="./hq-cluster-chart/values.yaml"
RELEASE_NAME="hq-stack"
NAMESPACE="hq"
# Helm behavior (configurable via env)
HELM_TIMEOUT="${HELM_TIMEOUT:-600s}"
HELM_WAIT="${HELM_WAIT:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ==============================================================================
# Utility Functions
# ==============================================================================

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# ------------------------------------------------------------------------------
# Centralized backup helpers (store all backups in one daily tar archive)
# ------------------------------------------------------------------------------

BACKUP_DIR=".backups"

backup_init() {
    mkdir -p "$BACKUP_DIR/.staging"
    echo "$BACKUP_DIR/backups-$(date +%Y%m%d).tar"
}

# Adds a file to the daily archive under timestamped path
# usage: backup_add_file <file_path> [label_prefix]
backup_add_file() {
    local src="$1"
    local label="${2:-}"
    local archive
    archive="$(backup_init)"
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    local staging
    staging="$BACKUP_DIR/.staging/$stamp"
    mkdir -p "$staging"
    local rel
    rel="$src"
    if [[ "$rel" == ./* ]]; then rel="${rel#./}"; fi
    if [[ "$rel" == /* ]]; then rel="${rel#$(pwd)/}"; fi
    if [[ -n "$label" ]]; then rel="$label/$rel"; fi
    mkdir -p "$staging/$(dirname "$rel")"
    cp "$src" "$staging/$rel" 2>/dev/null || true
    tar -rf "$archive" -C "$BACKUP_DIR/.staging" "$stamp" 2>/dev/null || tar -cf "$archive" -C "$BACKUP_DIR/.staging" "$stamp"
    rm -rf "$staging"
}

# Check if required tools are installed
check_requirements() {
    local missing_tools=()
    
    if ! command -v helm &> /dev/null; then
        missing_tools+=("helm")
    fi
    
    if ! command -v kubectl &> /dev/null; then
        missing_tools+=("kubectl")
    fi
    
    if [ ${#missing_tools[@]} -gt 0 ]; then
        error "Missing required tools: ${missing_tools[*]}"
        error "Please install them and try again."
        exit 1
    fi
}

# Validate that we're in the right directory
validate_environment() {
    # If running from scripts directory, go up one level
    if [[ $(basename "$PWD") == "scripts" ]]; then
        cd ..
    fi
    
    if [[ ! -f "$VALUES_FILE" ]]; then
        error "Values file not found at: $VALUES_FILE"
        error "Please run this script from the deployment directory or scripts directory."
        exit 1
    fi
    
    if [[ ! -d "$CHART_PATH" ]]; then
        error "Chart directory not found at: $CHART_PATH"
        exit 1
    fi
    
    # Check kubectl connection
    if ! kubectl cluster-info &> /dev/null; then
        error "Cannot connect to Kubernetes cluster. Please check your kubectl configuration."
        exit 1
    fi
}

# ==============================================================================
# Container Image Management Functions
# ==============================================================================

# Get current image tag for a service
get_current_tag() {
    local service="$1"
    # Extract tag using grep and sed
    grep -A 3 "^  ${service}:" "$VALUES_FILE" | grep "tag:" | sed 's/.*tag: *"\?\([^"]*\)"\?.*/\1/' 2>/dev/null || echo "not-found"
}

# Update image tag for a service
update_image_tag() {
    local service="$1"
    local new_tag="$2"
    
    info "Updating ${service} image tag to: ${new_tag}"
    
    # Centralized backup of values file
    backup_add_file "$VALUES_FILE" "hq"
    
    # Update the tag using sed
    # Find the service section and update the tag line
    sed -i.tmp "/^  ${service}:/,/^  [a-zA-Z]/ s/tag: *\".*\"/tag: \"${new_tag}\"/" "$VALUES_FILE"
    rm -f "${VALUES_FILE}.tmp"
    
    success "Updated ${service} tag to ${new_tag}"
}

# Interactive image tag update
interactive_tag_update() {
    echo -e "\n${CYAN}=== Container Image Tag Update ===${NC}"
    
    # Get available services with their current tags
    local services=("backend" "frontend" "celery-worker")
    
    echo -e "\n${YELLOW}Current Image Tags:${NC}"
    for service in "${services[@]}"; do
        local current_tag=$(get_current_tag "$service")
        printf "  %-15s: %s\n" "$service" "$current_tag"
    done
    
    echo -e "\n${YELLOW}Services:${NC}"
    echo "  1) backend"
    echo "  2) frontend" 
    echo "  3) celery-worker"
    echo "  0) Back to main menu"
    
    echo
    read -p "Select service (0-3): " choice
    
    case $choice in
        0) return ;;
        1) selected_service="backend" ;;
        2) selected_service="frontend" ;;
        3) selected_service="celery-worker" ;;
        *) error "Invalid selection."; return ;;
    esac
    
    local current_tag=$(get_current_tag "$selected_service")
    echo -e "\n${YELLOW}Service:${NC} $selected_service"
    echo -e "${YELLOW}Current tag:${NC} $current_tag"
    
    echo
    read -p "Enter new tag: " new_tag
    
    if [[ -n "$new_tag" ]]; then
        update_image_tag "$selected_service" "$new_tag"
        
        echo
        read -p "Apply changes now? (y/N): " apply_now
        
        if [[ "$apply_now" =~ ^[Yy]$ ]]; then
            helm_upgrade
        else
            info "Tag updated. Run 'Update/Upgrade' to apply changes."
        fi
    else
        warn "No tag entered."
    fi
}

# Bulk tag update (update multiple services to same tag)
bulk_tag_update() {
    echo -e "\n${CYAN}=== Bulk Image Tag Update ===${NC}"
    
    local services=("backend" "frontend" "celery-worker")
    
    echo -e "\n${YELLOW}This will update all services to the same tag:${NC}"
    echo "  • backend"
    echo "  • frontend"
    echo "  • celery-worker"
    
    echo
    read -p "Enter new tag for all services: " new_tag
    
    if [[ -n "$new_tag" ]]; then
        echo -e "\n${YELLOW}Updating all services to: ${new_tag}${NC}"
        
        for service in "${services[@]}"; do
            update_image_tag "$service" "$new_tag"
        done
        
        echo
        read -p "Apply changes now? (y/N): " apply_now
        
        if [[ "$apply_now" =~ ^[Yy]$ ]]; then
            helm_upgrade
        else
            info "Tags updated. Run 'Update/Upgrade' to apply changes."
        fi
    else
        warn "No tag entered."
    fi
}

# ==============================================================================
# Helm Operations
# ==============================================================================

# Check if release exists
release_exists() {
    helm list -n "$NAMESPACE" | grep -q "^$RELEASE_NAME\s" 2>/dev/null
}

# Install Helm release
helm_install() {
    echo -e "\n${CYAN}=== Installing Helm Release ===${NC}"
    
    if release_exists; then
        warn "Release '$RELEASE_NAME' already exists in namespace '$NAMESPACE'."
        echo "Use 'Update/Upgrade' instead, or 'Uninstall' first."
        return 1
    fi
    
    # Create namespace if it doesn't exist
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        info "Creating namespace: $NAMESPACE"
        kubectl create namespace "$NAMESPACE"
    fi
    
    log "Installing Helm release: $RELEASE_NAME"
    log "Chart: $CHART_PATH"
    log "Namespace: $NAMESPACE"
    
    local wait_flag="--wait"
    if [[ "$HELM_WAIT" != "true" ]]; then
        wait_flag="--wait=false"
    fi
    helm install "$RELEASE_NAME" "$CHART_PATH" \
        --namespace "$NAMESPACE" \
        --values "$VALUES_FILE" \
        --timeout "$HELM_TIMEOUT" \
        $wait_flag
    
    if [[ $? -eq 0 ]]; then
        success "Successfully installed release: $RELEASE_NAME"
        show_release_status
    else
        error "Failed to install release: $RELEASE_NAME"
        return 1
    fi
}

# Upgrade Helm release
helm_upgrade() {
    echo -e "\n${CYAN}=== Upgrading Helm Release ===${NC}"
    
    if ! release_exists; then
        warn "Release '$RELEASE_NAME' does not exist in namespace '$NAMESPACE'."
        echo "Use 'Install' instead."
        return 1
    fi
    
    log "Upgrading Helm release: $RELEASE_NAME"
    
    local wait_flag="--wait"
    if [[ "$HELM_WAIT" != "true" ]]; then
        wait_flag="--wait=false"
    fi
    helm upgrade "$RELEASE_NAME" "$CHART_PATH" \
        --namespace "$NAMESPACE" \
        --values "$VALUES_FILE" \
        --timeout "$HELM_TIMEOUT" \
        $wait_flag
    
    if [[ $? -eq 0 ]]; then
        success "Successfully upgraded release: $RELEASE_NAME"
        show_release_status
    else
        error "Failed to upgrade release: $RELEASE_NAME"
        return 1
    fi
}

# Uninstall Helm release
helm_uninstall() {
    echo -e "\n${CYAN}=== Uninstalling Helm Release ===${NC}"
    
    if ! release_exists; then
        warn "Release '$RELEASE_NAME' does not exist in namespace '$NAMESPACE'."
        return 1
    fi
    
    echo -e "${RED}WARNING: This will completely remove the application and all its data!${NC}"
    echo -e "${YELLOW}Release: $RELEASE_NAME${NC}"
    echo -e "${YELLOW}Namespace: $NAMESPACE${NC}"
    
    read -p "Are you sure you want to uninstall? (y/N): " confirm
    
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        log "Uninstalling Helm release: $RELEASE_NAME"
        
        helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE"
        
        if [[ $? -eq 0 ]]; then
            success "Successfully uninstalled release: $RELEASE_NAME"
            
            echo -e "\n${YELLOW}Would you like to delete persistent volumes? (y/N):${NC}"
            read -p "" delete_pvs
            
            if [[ "$delete_pvs" =~ ^[Yy]$ ]]; then
                warn "Deleting persistent volumes..."
                kubectl delete pvc --all -n "$NAMESPACE" 2>/dev/null || true
            fi
        else
            error "Failed to uninstall release: $RELEASE_NAME"
            return 1
        fi
    else
        info "Uninstall cancelled."
    fi
}

# Show release status
show_release_status() {
    echo -e "\n${CYAN}=== Release Status ===${NC}"
    
    if release_exists; then
        helm status "$RELEASE_NAME" -n "$NAMESPACE"
        
        echo -e "\n${CYAN}=== Pod Status ===${NC}"
        kubectl get pods -n "$NAMESPACE" -o wide
        
        echo -e "\n${CYAN}=== Service Status ===${NC}"
        kubectl get svc -n "$NAMESPACE"
        
        echo -e "\n${CYAN}=== Ingress Status ===${NC}"
        kubectl get ingress -n "$NAMESPACE" 2>/dev/null || echo "No ingress found"
    else
        warn "Release '$RELEASE_NAME' not found in namespace '$NAMESPACE'"
    fi
}

# Show detailed logs
show_logs() {
    echo -e "\n${CYAN}=== Application Logs ===${NC}"
    
    if ! release_exists; then
        warn "Release '$RELEASE_NAME' does not exist."
        return 1
    fi
    
    local services=("backend" "frontend" "celery-worker")
    
    echo -e "\n${YELLOW}Available Services:${NC}"
    for i in "${!services[@]}"; do
        printf "  %d) %s\n" $((i+1)) "${services[i]}"
    done
    echo "  0) Back to main menu"
    
    read -p "Select service to view logs (0-${#services[@]}): " choice
    
    if [[ "$choice" == "0" ]]; then
        return
    fi
    
    if [[ "$choice" -ge 1 && "$choice" -le ${#services[@]} ]]; then
        local selected_service="${services[$((choice-1))]}"
        local pod_name=$(kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/name=${selected_service}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
        
        if [[ -n "$pod_name" ]]; then
            info "Showing logs for: $selected_service (pod: $pod_name)"
            echo -e "${YELLOW}Press Ctrl+C to exit logs${NC}\n"
            kubectl logs -f "$pod_name" -n "$NAMESPACE"
        else
            error "No pod found for service: $selected_service"
        fi
    else
        error "Invalid selection."
    fi
}

# ==============================================================================
# Main Menu
# ==============================================================================

show_menu() {
    clear
    echo -e "${PURPLE}================================================${NC}"
    echo -e "${PURPLE}           Helm Management Script              ${NC}"
    echo -e "${PURPLE}           Open Politics Project               ${NC}"
    echo -e "${PURPLE}================================================${NC}"
    
    echo -e "\n${CYAN}Release: ${YELLOW}$RELEASE_NAME${NC} | ${CYAN}Namespace: ${YELLOW}$NAMESPACE${NC}"
    
    if release_exists; then
        echo -e "${CYAN}Status: ${GREEN}INSTALLED${NC}"
    else
        echo -e "${CYAN}Status: ${RED}NOT INSTALLED${NC}"
    fi
    
    echo -e "\n${CYAN}HELM OPERATIONS${NC}"
    echo "  1) Install Release"
    echo "  2) Update/Upgrade Release"  
    echo "     (env: HELM_WAIT=$HELM_WAIT, HELM_TIMEOUT=$HELM_TIMEOUT)"
    echo "  3) Uninstall Release"
    echo "  4) Show Status"
    
    echo -e "\n${CYAN}IMAGE MANAGEMENT${NC}"
    echo "  5) Update Single Service Tag"
    echo "  6) Update All Service Tags" 
    echo "  7) Show Current Tags"
    
    echo -e "\n${CYAN}DEBUGGING${NC}"
    echo "  8) Show Logs"
    echo "  9) Rerollout Deployment"
    
    echo -e "\n  0) Exit"
    echo
}

# Rerollout a deployment
rerollout_deployment() {
    echo -e "\n${CYAN}=== Rerollout Deployment ===${NC}"
    
    if ! release_exists; then
        warn "Release '$RELEASE_NAME' does not exist."
        return 1
    fi
    
    local services=("backend" "frontend" "celery-worker")
    
    echo -e "\n${YELLOW}Available Services:${NC}"
    for i in "${!services[@]}"; do
        printf "  %d) %s\n" $((i+1)) "${services[i]}"
    done
    echo "  $((${#services[@]}+1))) All Services"
    echo "  0) Back to main menu"
    
    read -p "Select service to restart (0-$((${#services[@]}+1))): " choice
    
    if [[ "$choice" == "0" ]]; then
        return
    elif [[ "$choice" == "$((${#services[@]}+1))" ]]; then
        info "Restarting all deployments..."
        for service in "${services[@]}"; do
            kubectl rollout restart deployment/"$service" -n "$NAMESPACE" 2>/dev/null || warn "Failed to restart $service"
        done
        success "Rerollout command issued for all services."
    elif [[ "$choice" -ge 1 && "$choice" -le ${#services[@]} ]]; then
        local selected_service="${services[$((choice-1))]}"
        info "Restarting deployment: $selected_service"
        kubectl rollout restart deployment/"$selected_service" -n "$NAMESPACE"
        success "Rerollout command issued for $selected_service."
    else
        error "Invalid selection."
    fi
}

# Show current tags
show_current_tags() {
    echo -e "\n${CYAN}=== Current Container Image Tags ===${NC}"
    
    local services=("backend" "frontend" "celery-worker" "postgres" "redis" "minio")
    
    for service in "${services[@]}"; do
        local tag=$(get_current_tag "$service")
        if [[ "$tag" != "not-found" ]]; then
            printf "  %-15s: %s\n" "$service" "$tag"
        fi
    done
}

handle_non_interactive_mode() {
    local command="$1"
    shift
    
    case "$command" in
        "update-tags")
            if [[ -z "$1" ]]; then
                error "New tag must be provided."
                exit 1
            fi
            local new_tag="$1"
            local services=("backend" "frontend" "celery-worker")
            info "Bulk updating tags to '$new_tag' and upgrading release."
            for service in "${services[@]}"; do
                update_image_tag "$service" "$new_tag"
            done
            helm_upgrade
            ;;
        "rerollout")
            if [[ -z "$1" ]]; then
                error "Service name ('all', 'backend', 'frontend', 'celery-worker') must be provided."
                exit 1
            fi
            local service_to_restart="$1"
            local services=("backend" "frontend" "celery-worker")
            
            if [[ "$service_to_restart" == "all" ]]; then
                info "Rerolling all deployments..."
                for service in "${services[@]}"; do
                    kubectl rollout restart deployment/"$service" -n "$NAMESPACE" 2>/dev/null || warn "Failed to restart $service"
                done
                success "Rerollout command issued for all services."
            elif [[ " ${services[*]} " =~ " ${service_to_restart} " ]]; then
                info "Rerolling deployment: $service_to_restart"
                kubectl rollout restart deployment/"$service_to_restart" -n "$NAMESPACE"
                success "Rerollout command issued for $service_to_restart."
            else
                error "Invalid service for rerollout: '$service_to_restart'. Valid options: all, ${services[*]}"
                exit 1
            fi
            ;;
        *)
            error "Unknown command: $command"
            echo "Available commands: update-tags <tag>, rerollout <service|all>"
            exit 1
            ;;
    esac
}

# Main script execution
main() {
    check_requirements
    validate_environment
    
    if [[ $# -gt 0 ]]; then
        handle_non_interactive_mode "$@"
        exit 0
    fi
    
    while true; do
        show_menu
        read -p "Select an option (0-9): " choice
        
        case $choice in
            1)
                helm_install
                ;;
            2)
                helm_upgrade
                ;;
            3)
                helm_uninstall
                ;;
            4)
                show_release_status
                ;;
            5)
                interactive_tag_update
                ;;
            6)
                bulk_tag_update
                ;;
            7)
                show_current_tags
                ;;
            8)
                show_logs
                ;;
            9)
                rerollout_deployment
                ;;
            0)
                log "Goodbye!"
                exit 0
                ;;
            *)
                error "Invalid option. Please select 0-9."
                ;;
        esac
        
        echo
        read -p "Press Enter to continue..." -r
    done
}

# Run main function
main "$@"
