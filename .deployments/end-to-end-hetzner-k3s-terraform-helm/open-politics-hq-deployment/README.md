# HQ on Hetzner (K3s) — End-to-End Deployment Guide

This repository delivers a batteries‑included, reproducible way to provision a Hetzner K3s cluster and deploy your application stack with one command. It’s designed to be forked and reused. Naming defaults to the neutral app slug `hq` and, where needed, the org prefix `opp` can be used as a convention. Replace with your own branding as you see fit.

---

## Table of Contents

1. [What This Gives You](#what-this-gives-you)
2. [Quick Start](#quick-start)
3. [Prerequisites](#prerequisites)
4. [Initial Configuration](#initial-configuration)
5. [How It Works (Infra → K3s → App)](#how-it-works-infra--k3s--app)
6. [Key Configuration Flags (K3s, Traefik, Firewall)](#key-configuration-flags-k3s-traefik-firewall)
7. [Operations](#operations)
8. [DNS and TLS](#dns-and-tls)
9. [Troubleshooting](#troubleshooting)
10. [Cost](#cost)

---

## What This Gives You

- **3 Hetzner Cloud servers by default**: 1 control plane, 2 workers (configurable)
- **K3s** with sensible flags for Hetzner CCM integration
- **Traefik** Ingress with automatic TLS via Let’s Encrypt (ACME)
- **Persistent storage** using Hetzner CSI
- **Application stack via Helm**: frontend, backend API, Celery workers, Redis, optional Postgres/MinIO templates

---

## Quick Start

```bash
# From the repository root
cd hq-deployment/

# 1) One-time: copy and edit your Hetzner token
cp .tfvars.example .tfvars
${EDITOR:-nano} .tfvars   # set hcloud_token

# 2) Full deploy (infra → app)
./deploy.sh
```

The script is idempotent. Re‑running applies updates safely. Typical first deploy time: ~10–15 minutes.

## Configuration Checklist

Before running `./deploy.sh`, ensure you've completed:

- [ ] **Hetzner API Token**: Set `hcloud_token` in `.tfvars`
- [ ] **Domain**: Set `domain` in `.tfvars` 
- [ ] **Application Values**: Copy and customize `hq-cluster-chart/values.yaml`
- [ ] **Domain References**: Update all `your-domain.com` references in `values.yaml`
- [ ] **Docker Images**: Update image repositories in `values.yaml` if you push your own hq images to a registry
- [ ] **Secrets**: Replace all `xxx` placeholders with real values
- [ ] **Email Config**: Set SMTP credentials and sender info
- [ ] **SSH Keys**: Run `./scripts/manage-ssh-keys.sh generate` (or configure manually)
- [ ] **DNS Ready**: Have your domain ready for A record creation

**Critical**: The `domain` field in `.tfvars` must match `env.config.DOMAIN` in `values.yaml`.

---

## Prerequisites

- Hetzner Cloud account and API token (Read/Write)
- Local tools: `terraform`, `kubectl`, `helm`, `jq`
- An SSH key uploaded to Hetzner; the scripts can rotate/manage keys automatically

---

## Initial Configuration

### 1. Infrastructure Configuration (`.tfvars`)

Create `.tfvars` from the example and set your values:

```bash
cp .tfvars.example .tfvars
```

**Required fields:**

- `hcloud_token`: your Hetzner API token (get from [Hetzner Console](https://console.hetzner.com/projects) → Access → API Tokens)
- `domain`: your public domain for TLS and ingress (e.g., `your-domain.com`)

**Optional fields (with defaults):**

- `worker_count`: number of workers (default: 2)
- `master_server_type` / `worker_server_type`: server types (default: `cx22`)
- `location`: Hetzner location (default: `fsn1`, options: `fsn1`, `nbg1`, `hel1`, `ash`, `hil`)
- `ssh_key_name`: name of SSH key in Hetzner (scripts can rotate and update this)
- `cluster_slug`: resource naming prefix (default: `hq`)

**Note:** The `domain` variable in `.tfvars` is used by Terraform for resource naming and must match the domain configured in `values.yaml`.

### 2. Application Configuration (`hq-cluster-chart/values.yaml`)

Copy the example values file and customize:

```bash
cp hq-cluster-chart/values.example.yaml hq-cluster-chart/values.yaml
```

**Required customizations:**

**Domain & Email:**

- `email`: admin email for Let's Encrypt certificates
- `env.config.DOMAIN`: your domain (must match `.tfvars`)
- `env.config.BACKEND_CORS_ORIGINS`: update with your domain

**Application Images:**

- `image.backend.repository`: your backend Docker image
- `image.frontend.repository`: your frontend Docker image
- `image.celery-worker.repository`: your worker Docker image

**Secrets (replace all `xxx` placeholders):**

- `env.secrets.SECRET_KEY`: generate a secure random string
- `env.secrets.FIRST_SUPERUSER_PASSWORD`: admin user password
- `env.secrets.POSTGRES_PASSWORD`: database password
- `env.secrets.MINIO_ROOT_PASSWORD`: MinIO admin password
- `env.secrets.MINIO_SECRET_KEY`: MinIO secret key
- `env.secrets.SMTP_PASSWORD`: email service password
- `env.secrets.OPENAI_API_KEY`: OpenAI API key (if using AI features)
- `env.secrets.TAVILY_API_KEY`: Tavily API key (if using search features)
- `env.secrets.GOOGLE_API_KEY`: Google API key (if using Google services)
- `env.secrets.MAPBOX_ACCESS_TOKEN`: Mapbox token (if using maps)

**Email Configuration:**

- `env.secrets.SMTP_USER`: your SMTP username
- `env.secrets.EMAILS_FROM_EMAIL`: sender email address
- `env.secrets.EMAILS_FROM_NAME`: sender name

**Ingress Configuration:**

- `ingress.host`: your domain
- `traefik.ingress.kubernetes.io/router.tls.domains.0.main`: your domain
- `traefik.ingress.kubernetes.io/router.tls.domains.0.sans`: www subdomain

**Environment Configuration:**

- `env.config.DOMAIN`: your domain (must match `.tfvars`)
- `env.config.BACKEND_CORS_ORIGINS`: update with your domain
- `env.config.MINIO_ENDPOINT`: update with your object storage endpoint

### 3. SSH Key Management

The deployment automatically generates and manages SSH keys:

```bash
# Generate new SSH keys (run before first deploy)
./scripts/manage-ssh-keys.sh generate

# The script will:
# - Generate admin and worker key pairs
# - Upload public keys to Hetzner Cloud
# - Update cloud-init templates with the keys
# - Clean up old keys (optional)
```

**Manual SSH Key Setup (alternative):**
If you prefer to manage SSH keys manually:

1. Upload your SSH public key to Hetzner Cloud Console
2. Set `ssh_key_name` in `.tfvars` to match the key name
3. Update `config/cloud-init-master.yaml` and `config/cloud-init-worker.yaml` with your public key

### 4. Traefik Configuration (`config/traefik-helmchartconfig.yaml`)

The Traefik configuration contains some hardcoded values that may need adjustment:

**Load Balancer Configuration:**
- `load-balancer.hetzner.cloud/name`: "hq-prod-lb" (uses cluster naming)
- `load-balancer.hetzner.cloud/location`: "fsn1" (should match your `.tfvars` location)
- `load-balancer.hetzner.cloud/network`: "hq-prod-network" (uses cluster naming)

**ACME Configuration:**
- `email`: admin@example.com (should match your admin email)

**To customize:**
1. Update the `location` to match your Hetzner location preference
2. Update the `email` to your admin email address
3. The load balancer name and network name will automatically use your `cluster_slug` from `.tfvars`

### 5. DNS Preparation

Before deploying, prepare your DNS:

- Have your domain ready
- You'll get the Load Balancer IP after deployment and need to create A records
- Consider creating both `your-domain.com` and `www.your-domain.com` A records

---

## How It Works (Infra → K3s → App)

The `./deploy.sh` orchestrator performs two phases:

1) Provision infrastructure and bootstrap K3s

   - Terraform creates: network, firewall, servers
   - `cloud-init` installs K3s with flags that fit Hetzner CCM
   - SSH keys are managed via `./scripts/manage-ssh-keys.sh`
2) Deploy cluster components and your app

   - Configure built‑in Traefik via `HelmChartConfig` (service is `LoadBalancer`)
   - Install Hetzner Cloud Controller Manager (CCM) and CSI Driver
   - Deploy the application Helm chart in namespace `hq` (default)

Core commands you’ll use:

- `./deploy.sh`         → Full deploy (infra → app)
- `./scripts/connect.sh`→ Fetch kubeconfig from master and set kubectl context
- `./scripts/status.sh` → Summary of nodes, services, ingress, PVs
- `./scripts/logs.sh`   → Tail app logs (backend/frontend/celery/...)
- `./scripts/monitor.sh`→ Open k9s (optional TUI)
- `./scripts/destroy.sh`→ Tear everything down (with orphan cleanup)

---

## Key Configuration Flags (K3s, Traefik, Firewall)

### K3s flags (cloud‑init)

Applied automatically by `config/cloud-init-*.yaml`:

```bash
# master
INSTALL_K3S_EXEC="--disable=servicelb --disable-cloud-controller \
  --kubelet-arg cloud-provider=external \
  --node-ip=${private_ip} --tls-san=$PUBLIC_IP --write-kubeconfig-mode=644"

# workers
INSTALL_K3S_EXEC="--kubelet-arg cloud-provider=external --node-ip=${private_ip}"
```

- Use private IPs for kubelet (`--node-ip=${private_ip}`)
- Do not set provider IDs manually; CCM will populate them

### Traefik Ingress (built‑in, configured via HelmChartConfig)

- Service type `LoadBalancer`
- Annotations for Hetzner Load Balancer and private network usage
- Ports explicitly expose `80` and `443`
- ACME uses TLS‑ALPN challenge, storage persisted at `/data/acme.json`

See: `config/traefik-helmchartconfig.yaml`

### Firewall highlights (Terraform)

Inbound:

- TCP `22`, `6443`, `80`, `443`
- UDP `8472` (Flannel VXLAN)
- TCP/UDP `any` within private `10.0.0.0/16`

Outbound:

- DNS (UDP/TCP `53`), HTTP `80`, HTTPS `443`, SMTP `587/465/25`
- UDP `8472` to `0.0.0.0/0`
- TCP/UDP `any` to `10.0.0.0/16`

---

## Operations

Common tasks:

- Update image tags and roll apps with `./scripts/cluster-manager.sh`
- Re‑roll Traefik ACME attempt: menu option in `./deploy.sh` or `./scripts/check-ssl.sh`
- Connect to master via SSH: `./scripts/ssh-master.sh`

Helm details (defaults):

- Release: `hq-stack`
- Namespace: `hq`
- Chart values: `hq-cluster-chart/values.yaml` (provide your domain and secrets)

---

## DNS and TLS

### Post-Deployment DNS Setup

1) Get the Load Balancer IP:

```bash
./deploy.sh   # or: kubectl get svc traefik -n kube-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

2) Create DNS A records pointing your `domain` (and `www`) to that IP
3) Traefik will obtain Let's Encrypt certificates automatically

### Post-Deployment Configuration

After DNS is configured and certificates are issued:

1) **Verify Application Access:**
   ```bash
   ./scripts/test-deployment.sh  # Test DNS, HTTP/HTTPS, and TLS
   ```

2) **Check Application Status:**
   ```bash
   ./scripts/status.sh  # View pods, services, ingress, and resources
   ```

3) **Access Application Logs:**
   ```bash
   ./scripts/logs.sh backend    # Backend logs
   ./scripts/logs.sh frontend   # Frontend logs
   ./scripts/logs.sh celery     # Worker logs
   ```

4) **Monitor Cluster:**
   ```bash
   ./scripts/monitor.sh  # Launch k9s for cluster monitoring
   ```

### Important Notes

- If you publish an IPv6 AAAA record, ensure it matches the Load Balancer's IPv6 (or remove AAAA until configured)
- Use `./scripts/check-ssl.sh` to see ACME progress and the live certificate issuer
- Certificate issuance typically takes 2-5 minutes after DNS propagation
- If certificates fail, check DNS propagation with `dig your-domain.com`

---

## Troubleshooting

### Infrastructure Issues

- **Workers don't schedule pods (taints):** The Hetzner CCM removes `node.cloudprovider.kubernetes.io/uninitialized` taints once it's up. If the cluster deadlocks during warm‑up, the boot script handles it; you can also remove that taint manually during bring‑up.
- **No Load Balancer IP:** Confirm Traefik service is `LoadBalancer` and CCM is Ready.
- **Pod DNS failures:** Ensure firewall egress within the private network is allowed (TCP/UDP to `10.0.0.0/16`) and outbound UDP `8472` is permitted.
- **Provider ID empty:** Don't set it manually; wait for CCM to populate.

### Configuration Issues

- **Domain mismatch:** Ensure `domain` in `.tfvars` exactly matches `env.config.DOMAIN` in `values.yaml`
- **Domain references not updated:** Check that all `your-domain.com` references in `values.yaml` are updated
- **CORS errors:** Verify `env.config.BACKEND_CORS_ORIGINS` includes your domain
- **Missing secrets:** Check that all `xxx` placeholders in `values.yaml` are replaced with real values
- **Docker image pull failures:** Verify image repositories in `values.yaml` are correct and accessible
- **SSH connection failures:** Run `./scripts/manage-ssh-keys.sh generate` to create new keys

### TLS/SSL Issues

- **ACME stuck / default cert:** Verify DNS A records point to the LB IP; restart Traefik via the menu; check logs with `./scripts/check-ssl.sh`
- **Certificate not issued:** Check that your domain DNS A records point to the Load Balancer IP
- **Mixed content warnings:** Ensure all resources use HTTPS and CORS origins are configured correctly



---

## Cost

Default: 3× `cx22` + 1 Load Balancer ≈ €40–45/month. Lower costs by reducing `worker_count` or choosing smaller server types in `.tfvars`.

