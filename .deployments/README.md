# Deployment Options

Three deployment paths are available, each suited to different requirements:

1. **Docker Compose** — Local development and single-server hosting
2. **Helm Chart** — Cloud-agnostic Kubernetes deployment (requires existing cluster)
3. **Terraform + Helm** — Fully automated provisioning of a multi-node Hetzner K3s cluster

All options support the same flexibility: run everything locally, use managed services (AWS RDS, Upstash Redis, S3), or mix both approaches to balance operational burden with control.

> [!IMPORTANT]
> The Kubernetes deployment is not yet tested with our updated OSS geocoder (Nominatim).
> Memory requirements for importing the large PostgreSQL database are substantial. Since we run on Hetzner rather than hyperscale providers, we're reviewing autoscaling strategies for these temporary workloads.
> Until testing is complete, a proprietary geocoder will be available in our [providers](../backend/app/api/providers).

## Resources

### 🐳 Docker Compose
- **Location:** [docker-compose/](./docker-compose)
- **Best for:** Local development, single-server deployments
- **Requirements:** 8GB RAM, 4 CPU cores, 300GB disk (Nominatim geocoding requires ~265GB; without it ~30GB)
- **Setup time:** ~5 minutes (+ ~30 minutes for geocoding dataset import)

### ☸️ Helm Chart (Standalone)
- **Location:** [end-to-end-hetzner-k3s-terraform-helm/open-politics-hq-deployment/hq-cluster-chart](./end-to-end-hetzner-k3s-terraform-helm/open-politics-hq-deployment/hq-cluster-chart)
- **Best for:** Existing Kubernetes clusters (any cloud provider)
- **Cloud-agnostic:** Works on GKE, EKS, AKS, K3s, or any Kubernetes cluster
- **Extract for standalone use:** 
  ```bash
  ./extract-chart.sh /path/to/destination
  ```

### 🚀 End-to-End Terraform + Helm
- **Location:** [end-to-end-hetzner-k3s-terraform-helm/open-politics-hq-deployment](./end-to-end-hetzner-k3s-terraform-helm/open-politics-hq-deployment)
- **Best for:** Production deployments with full infrastructure automation
- **Includes:** Hetzner Cloud provisioning, K3s cluster setup, automatic SSL, monitoring scripts
- **Setup time:** ~15 minutes (fully automated)

---

## Quick Start: Helm Chart Only

If you already have a Kubernetes cluster and just want the Helm chart:

```bash
# Extract the chart to your preferred location
./extract-chart.sh ~/my-charts

# Configure your values
cd ~/my-charts/hq-cluster-chart
cp values.example.yaml values.yaml
# Edit values.yaml with your configuration

# Deploy
helm install hq-stack . --namespace hq --create-namespace
```

The Helm chart is completely cloud-agnostic and can be used on any Kubernetes cluster.