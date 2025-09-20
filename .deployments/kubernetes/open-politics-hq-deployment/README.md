# Open Politics HQ - Kubernetes Deployment

Production-ready deployment configuration for the Open Politics platform on Hetzner Cloud. This setup uses Terraform for infrastructure provisioning and Helm for application deployment on a K3s cluster.

## Overview

This deployment creates a complete, self-contained environment with the following components:

**Infrastructure**
- K3s cluster (1 master + configurable workers) on Hetzner Cloud
- Hetzner Load Balancer with automatic failover
- Persistent volumes for data storage

**Platform Services**  
- Traefik ingress controller with automatic Let's Encrypt SSL
- PostgreSQL database with persistent storage
- Redis for caching and session management

**Application Stack**
- Open Politics frontend (React/Next.js)
- Backend FastAPI server
- Celery task workers for background processing

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/open-politics/open-politics-hq
cd open-politics-hq/.deployment/kubernetes/open-politics-hq-deployment
```

### 2. Make the Scripts Executable
```bash
chmod +x init.sh deploy.sh scripts/*
```

### 3. Initialize Configuration Files
```bash
./init.sh
```
This copies the example configuration files that you need to fill out.

### 4. Configure Your Deployment
Edit the configuration files:
- **`.tfvars`** - Add your Hetzner API token and adjust server settings
- **`hq-kubernetes-chart/values.yaml`** - Configure application secrets and settings

### 5. Deploy
```bash
./deploy.sh
```
This script is safe to re-run. It will automatically detect the current state and either create the infrastructure from scratch or apply necessary updates. The process takes approximately 10 minutes.

## Prerequisites

### Required Tools
- Terraform
- kubectl
- helm
- jq
- curl
- (k9s) optional for cluster monitoring

```bash
# macOS (with Homebrew)
brew install terraform kubectl helm jq k9s curl
```

### Account Requirements
*   **Hetzner Cloud Account:** An API token with Read & Write permissions


## Core Commands

| Command | Purpose |
| :--- | :--- |
| `./init.sh` | Copy example configuration files to get started |
| `./deploy.sh` | Run the full deployment and update process |
| `./scripts/connect.sh`| Connect `kubectl` to your cluster |
| `./scripts/destroy.sh`| **(Destructive)** Tear down all infrastructure |

## Cost Information
The default setup consists of 3 `cx22` servers and a Load Balancer, costing approximately **€42/month**. You can reduce costs by editing `.tfvars` to use fewer workers or smaller server types.

You can also choose just a master node by setting `worker_count` to 0 in `.tfvars` and choose a more capable master node.

Our recommendation for the master node `CCX13`:   

| Resource | Specification |
|----------|--------------|
| vCPU     | 2           |
| RAM      | 8 GB        |
| Storage  | 80 GB       |
| Traffic  | 20 TB       |
| Hourly   | € 0.02      |
| Monthly  | € 14.86     |

Should do the job for a single user.
