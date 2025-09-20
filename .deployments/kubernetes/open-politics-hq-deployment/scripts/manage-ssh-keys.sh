#!/bin/bash
set -euo pipefail

# SSH Key Management Script for Open Politics HQ
# This script securely generates SSH keys and manages them via Hetzner API
# Private keys are never exposed to logs or persistent storage

# --- Configuration ---
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$PROJECT_DIR"

# Generate timestamp once to ensure consistency
TIMESTAMP="$(date +%s)"

# Key names in Hetzner Cloud
ADMIN_KEY_NAME="open-politics-admin-${TIMESTAMP}"
WORKER_KEY_NAME="open-politics-worker-${TIMESTAMP}"

# Temporary directory for key generation (will be cleaned up)
TEMP_DIR="/tmp/op-ssh-keys-$$"

# --- Helper Functions ---

function print_header() {
    echo "================================================================"
    echo "  $1"
    echo "================================================================"
}

function log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >&2
}

function error() {
    echo "[ERROR] $1" >&2
}

function cleanup() {
    if [ -d "$TEMP_DIR" ]; then
        log "Cleaning up temporary files..."
        rm -rf "$TEMP_DIR"
    fi
}

# Ensure cleanup on exit
trap cleanup EXIT

# --- API Functions ---

function get_hetzner_token() {
    # Prefer environment variables to keep secrets out of files
    if [ -n "${HETZNER_API_TOKEN:-}" ]; then
        echo "$HETZNER_API_TOKEN"
        return 0
    fi
    if [ -n "${TF_VAR_hcloud_token:-}" ]; then
        echo "$TF_VAR_hcloud_token"
        return 0
    fi
    if [ -f ".tfvars" ]; then
        local tv
        tv=$(grep -E "^\s*hcloud_token\s*=\s*\".*\"\s*$" .tfvars | cut -d'"' -f2)
        if [ -n "$tv" ]; then
            echo "$tv"
            return 0
        fi
    fi
    error "Hetzner API token not found. Set HETZNER_API_TOKEN or TF_VAR_hcloud_token, or add hcloud_token to .tfvars"
    return 1
}

function call_hetzner_api() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"
    local token="$4"
    
    local curl_opts=(
        -s
        -X "$method"
        -H "Authorization: Bearer $token"
        -H "Content-Type: application/json"
    )
    
    if [ -n "$data" ]; then
        curl_opts+=(-d "$data")
    fi
    
    curl "${curl_opts[@]}" "https://api.hetzner.cloud/v1/$endpoint"
}

function delete_old_ssh_keys() {
    local token="$1"
    
    log "Cleaning up old SSH keys starting with 'open-politics'..."
    
    # Get all SSH keys
    local keys_response
    keys_response=$(call_hetzner_api "GET" "ssh_keys" "" "$token")
    if ! echo "$keys_response" | jq -e '.ssh_keys' >/dev/null 2>&1; then
        error "Hetzner API error while listing keys: $(echo "$keys_response" | jq -r '.error.message // .message // .error // "unknown error"')"
        return 1
    fi
    
    # Parse and delete old keys
    echo "$keys_response" | jq -r '.ssh_keys[] | select(.name | startswith("open-politics")) | "\(.id) \(.name)"' | while read -r key_id key_name; do
        if [ -n "$key_id" ] && [ -n "$key_name" ]; then
            log "Deleting old SSH key: $key_name (ID: $key_id)"
            call_hetzner_api "DELETE" "ssh_keys/$key_id" "" "$token" > /dev/null
        fi
    done
}

function upload_ssh_key() {
    local key_name="$1"
    local public_key="$2"
    local token="$3"
    
    local data
    data=$(jq -n --arg name "$key_name" --arg public_key "$public_key" '{
        name: $name,
        public_key: $public_key
    }')
    
    local response
    response=$(call_hetzner_api "POST" "ssh_keys" "$data" "$token")
    # Optional debug
    if [ "${HETZNER_DEBUG:-}" = "1" ]; then
        echo "[DEBUG] Hetzner API response: $response" >&2
    fi
    
    # Extract the key ID from response
    echo "$response" | jq -r '.ssh_key.id'
}

# --- Key Generation Functions ---

function generate_ssh_keypair() {
    local key_name="$1"
    local temp_key_path="$TEMP_DIR/$key_name"
    
    log "Generating SSH key pair: $key_name"
    
    # Generate RSA key pair (for compatibility with tutorial)
    ssh-keygen -t rsa -b 4096 -f "$temp_key_path" -N "" -C "$key_name" >/dev/null 2>&1
    
    # Return paths (caller will read them immediately)
    echo "$temp_key_path" "$temp_key_path.pub"
}

function update_cloud_init_from_template() {
    local template_type="$1"  # "master" or "worker"
    local admin_pubkey="$2"
    local worker_pubkey="$3"
    local worker_privkey_file="$4"
    
    local template_file="config/cloud-init-${template_type}.yaml.template"
    local output_file="config/cloud-init-${template_type}.yaml"
    
    log "Generating cloud-init config: $(basename "$output_file")"
    
    if [ ! -f "$template_file" ]; then
        error "Template file not found: $template_file"
        return 1
    fi
    
    # No backup needed - file is generated from template
    # If needed, the template file serves as the backup source
    
    # Start with the template
    cp "$template_file" "$output_file"
    
    # Replace admin public key placeholder
    sed -i.tmp "s|__ADMIN_PUBLIC_KEY__|$admin_pubkey|g" "$output_file"
    
    # Replace worker public key placeholder (master only)
    if [[ "$template_type" == "master" ]]; then
        sed -i.tmp "s|__WORKER_PUBLIC_KEY__|$worker_pubkey|g" "$output_file"
    fi
    
    # Replace worker private key content (worker only)
    if [[ "$template_type" == "worker" && -f "$worker_privkey_file" ]]; then
        # Create properly indented private key content
        local indented_key="$TEMP_DIR/indented_worker_key"
        while IFS= read -r line; do
            echo "      $line"
        done < "$worker_privkey_file" > "$indented_key"
        
        # Replace the placeholder with the indented key content
        awk '
        /__WORKER_PRIVATE_KEY_CONTENT__/ {
            while ((getline line < "'"$indented_key"'") > 0) {
                print line
            }
            close("'"$indented_key"'")
            next
        }
        { print }
        ' "$output_file" > "$output_file.new"
        
        mv "$output_file.new" "$output_file"
    fi
    
    # Clean up temp files
    rm -f "$output_file.tmp" 2>/dev/null || true
    if [ -n "${indented_key:-}" ]; then
        rm -f "$indented_key" 2>/dev/null || true
    fi
}

function update_terraform_ssh_key_name() {
    local new_admin_key_name="$1"
    
    log "Updating Terraform configuration with new SSH key name"
    
    # Update the ssh_key_name in .tfvars
    if [ -f ".tfvars" ]; then
        # Only create one backup per day to avoid clutter
        local backup_file=".tfvars.backup.$(date +%Y%m%d)"
        if [ ! -f "$backup_file" ]; then
            cp ".tfvars" "$backup_file"
            log "Created daily backup: $backup_file"
        fi
        sed -i.tmp "s/ssh_key_name = \".*\"/ssh_key_name = \"$new_admin_key_name\"/g" ".tfvars"
        rm -f ".tfvars.tmp"
    fi
    
    # Update main.tf to reference the uploaded key
    if [ -f "main.tf" ]; then
        # Only create one backup per day to avoid clutter
        local backup_file="main.tf.backup.$(date +%Y%m%d)"
        if [ ! -f "$backup_file" ]; then
            cp "main.tf" "$backup_file"
            log "Created daily backup: $backup_file"
        fi
        # Only update the ssh_key_name variable, not all defaults
        sed -i.tmp "/variable \"ssh_key_name\"/,/^}/ s/default     = \".*\"/default     = \"$new_admin_key_name\"/" "main.tf"
        rm -f "main.tf.tmp"
    fi
}

# --- Main Functions ---

function rotate_ssh_keys() {
    print_header "SSH Key Rotation Process"
    
    # Get Hetzner API token
    local token
    token=$(get_hetzner_token)
    if [ -z "$token" ]; then
        error "Could not retrieve Hetzner API token"
        return 1
    fi
    # Validate token has access
    local probe
    probe=$(call_hetzner_api "GET" "ssh_keys" "" "$token")
    if ! echo "$probe" | jq -e '.ssh_keys' >/dev/null 2>&1; then
        error "Hetzner API token seems invalid or lacks permissions: $(echo "$probe" | jq -r '.error.message // .message // .error // "unknown error"')"
        return 1
    fi
    
    # Create temporary directory
    mkdir -p "$TEMP_DIR"
    chmod 700 "$TEMP_DIR"
    
    # Delete old SSH keys from Hetzner
    delete_old_ssh_keys "$token"
    
    # Generate new SSH key pairs
    log "Generating new SSH key pairs..."
    
    # Generate admin key pair
    local admin_key_result
    admin_key_result=$(generate_ssh_keypair "$ADMIN_KEY_NAME")
    local admin_privkey=$(echo "$admin_key_result" | cut -d' ' -f1)
    local admin_pubkey_file=$(echo "$admin_key_result" | cut -d' ' -f2)
    
    # Generate worker key pair
    local worker_key_result
    worker_key_result=$(generate_ssh_keypair "$WORKER_KEY_NAME")
    local worker_privkey=$(echo "$worker_key_result" | cut -d' ' -f1)
    local worker_pubkey_file=$(echo "$worker_key_result" | cut -d' ' -f2)
    
    # Read public keys
    local admin_pubkey worker_pubkey
    admin_pubkey=$(cat "$admin_pubkey_file")
    worker_pubkey=$(cat "$worker_pubkey_file")
    
    # Upload admin key to Hetzner (used by Terraform)
    log "Uploading admin SSH key to Hetzner Cloud..."
    local admin_key_id
    admin_key_id=$(upload_ssh_key "$ADMIN_KEY_NAME" "$admin_pubkey" "$token")
    
    if [ -z "$admin_key_id" ] || [ "$admin_key_id" = "null" ]; then
        error "Failed to upload admin SSH key to Hetzner"
        return 1
    fi
    
    log "Admin SSH key uploaded successfully (ID: $admin_key_id)"
    
    # Upload worker key to Hetzner (for reference)
    log "Uploading worker SSH key to Hetzner Cloud..."
    local worker_key_id
    worker_key_id=$(upload_ssh_key "$WORKER_KEY_NAME" "$worker_pubkey" "$token")
    
    if [ -z "$worker_key_id" ] || [ "$worker_key_id" = "null" ]; then
        error "Failed to upload worker SSH key to Hetzner"
        return 1
    fi
    
    log "Worker SSH key uploaded successfully (ID: $worker_key_id)"
    
    # Update cloud-init templates
    log "Updating cloud-init templates..."
    update_cloud_init_from_template "master" "$admin_pubkey" "$worker_pubkey" ""
    update_cloud_init_from_template "worker" "$admin_pubkey" "$worker_pubkey" "$worker_privkey"
    
    # Update Terraform configuration
    update_terraform_ssh_key_name "$ADMIN_KEY_NAME"
    
    # Store the admin private key securely for immediate use
    log "Storing admin private key for deployment use..."
    local admin_key_path="$HOME/.ssh/$(basename "$ADMIN_KEY_NAME")"
    cp "$admin_privkey" "$admin_key_path"
    chmod 600 "$admin_key_path"
    
    log "Admin private key stored at: $admin_key_path"
    
    print_header "SSH Key Rotation Complete"
    echo "✅ New SSH keys generated and configured:"
    echo "   Admin Key: $ADMIN_KEY_NAME (ID: $admin_key_id)"
    echo "   Worker Key: $WORKER_KEY_NAME (ID: $worker_key_id)"
    echo "   Admin private key: $admin_key_path"
    echo ""
    echo "🔄 Cloud-init templates updated with new keys"
    echo "🔄 Terraform configuration updated"
    echo ""
    echo "⚠️  Next steps:"
    echo "   1. Run terraform plan to verify configuration"
    echo "   2. Run terraform apply to deploy with new keys"
    echo "   3. Old servers will be replaced with new SSH keys"
}

function show_current_keys() {
    print_header "Current SSH Key Status"
    
    local token
    token=$(get_hetzner_token)
    if [ -z "$token" ]; then
        error "Could not retrieve Hetzner API token"
        return 1
    fi
    
    log "Fetching SSH keys from Hetzner Cloud..."
    local keys_response
    keys_response=$(call_hetzner_api "GET" "ssh_keys" "" "$token")
    
    echo "SSH Keys in Hetzner Cloud:"
    echo "$keys_response" | jq -r '.ssh_keys[] | "  \(.name) (ID: \(.id)) - \(.fingerprint)"'
    
    echo ""
    echo "Local cloud-init configuration:"
    if [ -f "config/cloud-init-master.yaml" ]; then
        echo "  Master node keys:"
        grep "ssh-ed25519" "config/cloud-init-master.yaml" | sed 's/^/    /'
    fi
    
    if [ -f "config/cloud-init-worker.yaml" ]; then
        echo "  Worker node admin key:"
        grep "ssh-ed25519" "config/cloud-init-worker.yaml" | sed 's/^/    /'
    fi
}

function cleanup_old_backups() {
    print_header "Cleaning Up Old Backup Files"
    
    local files_found=false
    
    # Find and remove old backup files (older than 7 days)
    log "Looking for backup files older than 7 days..."
    
    # Find .tfvars backups older than 7 days
    find . -name ".tfvars.backup.*" -type f -mtime +7 2>/dev/null | while read -r file; do
        if [ -n "$file" ]; then
            files_found=true
            log "Removing old backup: $file"
            rm -f "$file"
        fi
    done
    
    # Find main.tf backups older than 7 days
    find . -name "main.tf.backup.*" -type f -mtime +7 2>/dev/null | while read -r file; do
        if [ -n "$file" ]; then
            files_found=true
            log "Removing old backup: $file"
            rm -f "$file"
        fi
    done
    
    # Find cloud-init backups older than 7 days
    find config/ -name "*.backup.*" -type f -mtime +7 2>/dev/null | while read -r file; do
        if [ -n "$file" ]; then
            files_found=true
            log "Removing old backup: $file"
            rm -f "$file"
        fi
    done
    
    if ! $files_found; then
        log "No old backup files found to clean up"
    fi
    
    echo ""
    echo "🧹 Backup cleanup complete"
}

function show_usage() {
    echo "SSH Key Management for Open Politics HQ"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  rotate     - Generate new SSH keys and update all configurations"
    echo "  status     - Show current SSH key status"
    echo "  cleanup    - Remove old backup files (older than 7 days)"
    echo "  help       - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 rotate    # Rotate SSH keys (run before deployment)"
    echo "  $0 status    # Check current key configuration"
    echo "  $0 cleanup   # Clean up old backup files"
}

# --- Main Script Logic ---

# Check dependencies
for tool in curl jq ssh-keygen; do
    if ! command -v "$tool" &> /dev/null; then
        error "Required tool not found: $tool"
        echo "Please install: $tool"
        exit 1
    fi
done

# Parse command
case "${1:-help}" in
    "rotate")
        rotate_ssh_keys
        ;;
    "status")
        show_current_keys
        ;;
    "cleanup")
        cleanup_old_backups
        ;;
    "help"|"--help"|"-h")
        show_usage
        ;;
    *)
        error "Unknown command: ${1:-}"
        echo ""
        show_usage
        exit 1
        ;;
esac
