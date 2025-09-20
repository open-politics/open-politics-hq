# SSH Key Management for Open Politics HQ

This directory contains a secure SSH key management system that automatically generates and rotates SSH keys for the Hetzner Cloud deployment without exposing private keys.

## Security Features

🔐 **Private Key Protection**
- Private keys are generated in temporary directories (`/tmp`) that are automatically cleaned up
- Private keys are never logged, printed, or stored in persistent locations (except for the admin key which goes to `~/.ssh/`)
- Worker private key is embedded directly into cloud-init and removed from local storage

🔄 **Automatic Key Rotation**
- Generates fresh SSH key pairs on each deployment
- Uploads public keys to Hetzner Cloud via API
- Updates cloud-init templates with new keys
- Removes old SSH keys from Hetzner Cloud

🛡️ **API-Based Management**
- Uses Hetzner Cloud API to manage SSH keys
- No manual key uploads required
- Automatic cleanup of old keys starting with "open-politics"

## Scripts

### `manage-ssh-keys.sh`

Main SSH key management script with the following commands:

```bash
# Rotate SSH keys (run before deployment)
./scripts/manage-ssh-keys.sh rotate

# Check current SSH key status
./scripts/manage-ssh-keys.sh status

# Show help
./scripts/manage-ssh-keys.sh help
```

### Integration with `deploy.sh`

The SSH key rotation is automatically integrated into the deployment workflow:

1. **Automatic Rotation**: When you run `./deploy.sh`, it automatically rotates SSH keys before provisioning infrastructure
2. **Menu Options**: 
   - Option 6: Rotate SSH Keys
   - Option 7: SSH Key Status

## How It Works

### Key Generation Process

1. **Generate Key Pairs**: Creates new ed25519 SSH key pairs in temporary storage
2. **Upload to Hetzner**: Uploads public keys to Hetzner Cloud via API
3. **Update Templates**: Uses template files to generate cloud-init configurations
4. **Clean Old Keys**: Removes old SSH keys from Hetzner Cloud
5. **Update Config**: Updates Terraform configuration with new key names

### Template System

The system uses template files for cloud-init configuration:

- `config/cloud-init-master.yaml.template` - Master node template
- `config/cloud-init-worker.yaml.template` - Worker node template

These templates contain placeholders that are replaced with actual key data:

- `__ADMIN_PUBLIC_KEY__` - Admin public key (for SSH access)
- `__WORKER_PUBLIC_KEY__` - Worker public key (for master node)
- `__WORKER_PRIVATE_KEY_CONTENT__` - Worker private key (for worker nodes to access master)

### Generated Files

The following files are generated from templates:

- `config/cloud-init-master.yaml` - Generated master node cloud-init
- `config/cloud-init-worker.yaml` - Generated worker node cloud-init

## Usage Examples

### First Time Setup

```bash
# Run full deployment (includes SSH key rotation)
./deploy.sh

# Or just rotate keys manually
./scripts/manage-ssh-keys.sh rotate
```

### Check Current Keys

```bash
# View SSH key status in Hetzner Cloud and local config
./scripts/manage-ssh-keys.sh status
```

### Manual Key Rotation

```bash
# Rotate keys without deploying
./scripts/manage-ssh-keys.sh rotate

# Then apply changes
terraform plan
terraform apply -var-file=.tfvars
```

## Security Considerations

### What's Stored Where

| Key Type | Location | Purpose |
|----------|----------|---------|
| Admin Private Key | `~/.ssh/open-politics-admin-*` | Local SSH access to cluster |
| Admin Public Key | Hetzner Cloud + cloud-init | Server authentication |
| Worker Private Key | cloud-init only (worker nodes) | Worker→Master SSH access |
| Worker Public Key | cloud-init only (master node) | Worker authentication |

### Key Lifecycle

1. **Generation**: Keys are generated in `/tmp` with secure permissions (600)
2. **Usage**: Admin private key is copied to `~/.ssh/`, worker private key embedded in cloud-init
3. **Cleanup**: Temporary files are automatically removed
4. **Rotation**: Old keys are deleted from Hetzner Cloud on next rotation

### Best Practices

- ✅ Run key rotation before each deployment
- ✅ Use the automatic rotation in `deploy.sh`
- ✅ Verify key status after rotation
- ❌ Don't manually edit the generated cloud-init files
- ❌ Don't store worker private keys persistently

## Troubleshooting

### Permission Denied

If you get permission denied errors:

```bash
# Check if admin private key exists
ls -la ~/.ssh/open-politics-admin-*

# Ensure correct permissions
chmod 600 ~/.ssh/open-politics-admin-*
```

### API Errors

If Hetzner API calls fail:

```bash
# Check API token in .tfvars
grep hcloud_token .tfvars

# Verify API access
curl -H "Authorization: Bearer YOUR_TOKEN" https://api.hetzner.cloud/v1/ssh_keys
```

### Template Errors

If template processing fails:

```bash
# Check template files exist
ls -la config/*.template

# Verify jq is installed
which jq

# Check curl is available
which curl
```

### Key Mismatch

If SSH connection fails after deployment:

```bash
# Check current key status
./scripts/manage-ssh-keys.sh status

# Try connecting with the latest key
ssh -i ~/.ssh/open-politics-admin-* cluster@MASTER_IP

# Or use the connect script
./scripts/connect.sh
```

## Dependencies

The SSH key management system requires:

- `curl` - For Hetzner API calls
- `jq` - For JSON processing
- `ssh-keygen` - For key generation
- `awk`, `sed` - For template processing

These are automatically checked when running the script.
