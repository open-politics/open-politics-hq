# Helm Manager Script

A comprehensive Helm management script for the Open Politics Project that provides easy-to-use operations for managing your Kubernetes deployment.

## Features

### 🚀 **Helm Operations**
- **Install**: Deploy the application for the first time
- **Update/Upgrade**: Apply changes to existing deployment
- **Uninstall**: Remove the application (with optional PV cleanup)
- **Status**: View detailed deployment status

### 🐳 **Container Image Management**
- **Single Service Tag Update**: Update individual service image tags
- **Bulk Tag Update**: Update all application services to the same tag
- **Current Tags View**: Display all current image tags
- **Automatic Rolling Updates**: Apply tag changes immediately

### 🔧 **Debugging & Maintenance**
- **Live Logs**: View real-time logs for any service
- **Deployment Restart**: Restart individual or all services
- **Pod Status**: Monitor pod health and distribution
- **Service & Ingress Status**: Check connectivity

## Prerequisites

The script will automatically check and install missing dependencies:

- `helm` - Kubernetes package manager
- `kubectl` - Kubernetes CLI
- `yq` - YAML processor (auto-installed via brew)

## Usage

### Quick Start

```bash
# Navigate to the deployment directory
cd k8-clusters/hetzner-terraform/open-politics-hq-deployment

# Run the script
./scripts/helm-manager.sh
```

### Interactive Menu

The script provides a user-friendly menu interface:

```
╔══════════════════════════════════════════════════════════════╗
║                  Helm Management Script                     ║
║                  Open Politics Project                      ║
╚══════════════════════════════════════════════════════════════╝

Current Configuration:
  Release: open-politics
  Namespace: open-politics
  Chart: ../helm-chart
  Status: INSTALLED

Helm Operations:
  1) Install Release
  2) Update/Upgrade Release
  3) Uninstall Release
  4) Show Status

Container Image Management:
  5) Update Single Service Tag
  6) Bulk Update All Service Tags
  7) Show Current Tags

Debugging:
  8) Show Logs
  9) Restart Deployment

  0) Exit
```

## Common Workflows

### 1. Initial Deployment

```bash
./scripts/helm-manager.sh
# Select option 1 (Install Release)
```

### 2. Rolling Update with New Image Tag

#### Option A: Update Single Service
```bash
./scripts/helm-manager.sh
# Select option 5 (Update Single Service Tag)
# Choose service (e.g., backend)
# Enter new tag (e.g., v2.1.0)
# Choose 'y' to apply immediately
```

#### Option B: Bulk Update All Services
```bash
./scripts/helm-manager.sh
# Select option 6 (Bulk Update All Service Tags)
# Enter new tag for all services (e.g., v2.1.0)
# Choose 'y' to apply immediately
```

### 3. Troubleshooting

#### View Logs
```bash
./scripts/helm-manager.sh
# Select option 8 (Show Logs)
# Choose service to view logs
```

#### Restart Problematic Service
```bash
./scripts/helm-manager.sh
# Select option 9 (Restart Deployment)
# Choose service or 'All Services'
```

### 4. Check Current Status
```bash
./scripts/helm-manager.sh
# Select option 4 (Show Status)
```

## Container Image Services

The script manages the following application services:

- **backend**: Main API server (`openpoliticsproject/backend`)
- **frontend**: Web interface (`openpoliticsproject/frontend`)  
- **celery-worker**: Background task processor (`openpoliticsproject/backend`)
- **postgres**: Database (managed separately)
- **redis**: Cache/message broker (managed separately)
- **minio**: Object storage (managed separately)

## Configuration

### Default Settings

- **Release Name**: `open-politics`
- **Namespace**: `open-politics`
- **Chart Path**: `../helm-chart`
- **Values File**: `../helm-chart/values.yaml`

### Customization

To modify default settings, edit the configuration section at the top of the script:

```bash
# Configuration
CHART_PATH="../helm-chart"
VALUES_FILE="../helm-chart/values.yaml"
RELEASE_NAME="open-politics"
NAMESPACE="open-politics"
```

## Safety Features

### Backup Protection
- Automatic backup of `values.yaml` before tag updates
- Backup files are timestamped: `values.yaml.backup.1635789123`

### Confirmation Prompts
- Uninstall operations require explicit confirmation
- Persistent volume deletion is optional and confirmed separately
- Immediate deployment of tag changes is optional

### Validation
- Checks for required tools and installs missing ones
- Validates Kubernetes cluster connectivity
- Verifies chart and values file existence
- Checks release status before operations

## Troubleshooting

### Common Issues

#### 1. "Release already exists"
```bash
# Use option 2 (Update/Upgrade) instead of option 1 (Install)
```

#### 2. "yq not found"
```bash
# Script will auto-install via brew, or install manually:
brew install yq
```

#### 3. "Cannot connect to Kubernetes cluster"
```bash
# Check kubectl configuration:
kubectl cluster-info

# Or reconfigure using connect script:
./scripts/connect.sh
```

#### 4. Pod stuck in pending state
```bash
# Check node resources and pod distribution:
kubectl get nodes
kubectl describe pods -n open-politics
```

### Log Analysis

#### Backend Issues
- Select option 8 → backend
- Look for API errors, database connection issues

#### Frontend Issues  
- Select option 8 → frontend
- Check for build errors, API connectivity

#### Celery Worker Issues
- Select option 8 → celery-worker
- Monitor task processing, Redis connectivity

## Advanced Usage

### Manual Values Editing

The script creates backups but you can also manually edit values:

```bash
# Edit values file
vim helm-chart/values.yaml

# Apply changes
./scripts/helm-manager.sh
# Select option 2 (Update/Upgrade)
```

### Direct Helm Commands

The script is a wrapper around Helm. You can also use Helm directly:

```bash
# Manual upgrade with debug
helm upgrade open-politics helm-chart/ \
  --namespace open-politics \
  --values helm-chart/values.yaml \
  --debug

# Check release history
helm history open-politics -n open-politics

# Rollback to previous version
helm rollback open-politics 1 -n open-politics
```

## Files Modified

The script modifies:
- `helm-chart/values.yaml` (with automatic backup)

The script reads:
- `helm-chart/Chart.yaml`
- `helm-chart/templates/*`
- Kubernetes cluster state

## Support

For issues with the script:
1. Check that all prerequisites are installed
2. Verify Kubernetes cluster connectivity
3. Review error messages for specific issues
4. Check the backup files if values.yaml corruption occurs

For application-specific issues:
1. Use the log viewing feature (option 8)
2. Check pod status (option 4)
3. Review Kubernetes events: `kubectl get events -n open-politics`
