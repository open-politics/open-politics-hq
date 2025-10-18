# Deployment Options

Three deployment paths are available, each suited to different requirements:

1. **Docker Compose** — Local development and single-server hosting
2. **Helm Chart** — Kubernetes deployment (requires existing cluster connection)
3. **Terraform + Helm** — Fully automated provisioning of a multi-node Hetzner K3s cluster

All options support the same flexibility: run everything locally, use managed services (AWS RDS, Upstash Redis, S3), or mix both approaches to balance operational burden with control.

> [!IMPORTANT]
> The Kubernetes deployment is not yet tested with our updated OSS geocoder (Nominatim).
> Memory requirements for importing the large PostgreSQL database are substantial. Since we run on Hetzner rather than hyperscale providers, we're reviewing autoscaling strategies for these temporary workloads.
> Until testing is complete, a proprietary geocoder remains available in our [providers](../backend/app/api/providers).

## Resources

- **Helm Chart:** [kubernetes-helm-chart/hq-cluster-chart](./kubernetes-helm-chart/hq-cluster-chart)
- **Terraform Solution:** [end-to-end-hetzner-k3s-terraform-helm/open-politics-hq-deployment](./end-to-end-hetzner-k3s-terraform-helm/open-politics-hq-deployment)

The Terraform solution wraps the Helm chart with infrastructure provisioning.