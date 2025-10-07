# Tell Terraform to include the hcloud provider
terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "1.52.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.2"
    }
  }
}

# Variables
variable "cluster_slug" {
  description = "Short identifier for this cluster (e.g., 'hq', 'opol')"
  type        = string
  default     = "hq"
}
variable "hcloud_token" {
  description = "Hetzner Cloud API Token"
  type        = string
  sensitive   = true
}

variable "worker_count" {
  description = "Number of worker nodes"
  type        = number
  default     = 2
}

variable "master_server_type" {
  description = "Server type for master node"
  type        = string
  default     = "cx22" # 2 vCPU, 4GB RAM, 40GB disk - Balanced for production
}

variable "worker_server_type" {
  description = "Server type for worker nodes"  
  type        = string
  default     = "cx22" # 2 vCPU, 4GB RAM, 40GB disk - Balanced for production
}

variable "location" {
  description = "Hetzner location"
  type        = string
  default     = "fsn1"
}

variable "ssh_key_name" {
  description = "Name of the SSH key in Hetzner Cloud"
  type        = string
  default     = "hq-admin-key"
}

variable "domain" {
  description = "Domain name for the application (used for SSL certificates and ingress)"
  type        = string
  default     = "your-domain.com"
}

# Reference the existing SSH key uploaded by the management script
# The SSH key is now managed by scripts/manage-ssh-keys.sh
data "hcloud_ssh_key" "deployment_key" {
  name = var.ssh_key_name
}

# Configure the Hetzner Cloud Provider
provider "hcloud" {
  token = var.hcloud_token
}


# SSH keys are now managed by scripts/manage-ssh-keys.sh
# This ensures proper key rotation and avoids conflicts

# Private Network
resource "hcloud_network" "private_network" {
  name     = "hq-${var.cluster_slug}-prod-network"
  ip_range = "10.0.0.0/16"
  
  labels = {
    project = "hq"
    environment = "production"
    component = "networking"
    cluster = var.cluster_slug
  }
}

resource "hcloud_network_subnet" "private_network_subnet" {
  type         = "cloud"
  network_id   = hcloud_network.private_network.id
  network_zone = "eu-central"
  ip_range     = "10.0.1.0/24"
}

# Firewall
resource "hcloud_firewall" "k8s_firewall" {
  name = "hq-${var.cluster_slug}-prod-firewall"
  
  labels = {
    project = "hq"
    environment = "production"
    component = "security"
    cluster = var.cluster_slug
  }
  
  # SSH access
  rule {
    direction = "in"
    port      = "22"
    protocol  = "tcp"
    source_ips = ["0.0.0.0/0"]
  }
  
  # Kubernetes API
  rule {
    direction = "in"
    port      = "6443"
    protocol  = "tcp"
    source_ips = ["0.0.0.0/0"]
  }
  
  # HTTP/HTTPS
  rule {
    direction = "in"
    port      = "80"
    protocol  = "tcp"
    source_ips = ["0.0.0.0/0"]
  }
  
  rule {
    direction = "in"
    port      = "443"
    protocol  = "tcp"
    source_ips = ["0.0.0.0/0"]
  }
  
  # Internal cluster communication (private network)
  rule {
    direction = "in"
    port      = "any"
    protocol  = "tcp"
    source_ips = ["10.0.0.0/16"]
  }
  
  rule {
    direction = "in"
    port      = "any"
    protocol  = "udp"
    source_ips = ["10.0.0.0/16"]
  }
  
  # Flannel VXLAN communication between nodes (public IPs)
  rule {
    direction = "in"
    port      = "8472"
    protocol  = "udp"
    source_ips = ["0.0.0.0/0"]
  }

  # Outbound DNS and Web (required for CSI, cert-manager, etc.)
  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "53"
    destination_ips = ["0.0.0.0/0"]
  }

  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "53"
    destination_ips = ["0.0.0.0/0"]
  }

  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "80"
    destination_ips = ["0.0.0.0/0"]
  }

  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "443"
    destination_ips = ["0.0.0.0/0"]
  }

  # SMTP outbound (port 587 - STARTTLS)
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "587"
    destination_ips = ["0.0.0.0/0"]
  }

  # SMTP outbound (port 465 - SSL/TLS)
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "465"
    destination_ips = ["0.0.0.0/0"]
  }

  # Optional: SMTP port 25 (if needed)
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "25"
    destination_ips = ["0.0.0.0/0"]
  }

  # Allow outbound Flannel VXLAN traffic (some environments use public IPs for VXLAN)
  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "8472"
    destination_ips = ["0.0.0.0/0"]
  }

  # Allow outbound traffic within the private network for node-to-node and pod overlay
  # communication (Flannel VXLAN and general cluster egress on the private subnet)
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["10.0.0.0/16"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["10.0.0.0/16"]
  }
}

# Master Node
resource "hcloud_server" "master_node" {
  name        = "hq-${var.cluster_slug}-prod-master"
  image       = "ubuntu-24.04"
  server_type = var.master_server_type
  location    = var.location
  
  ssh_keys = [data.hcloud_ssh_key.deployment_key.id]
  firewall_ids = [hcloud_firewall.k8s_firewall.id]
  
  public_net {
    ipv4_enabled = true
    ipv6_enabled = false
  }
  
  network {
    network_id = hcloud_network.private_network.id
    # Master node always at 10.0.1.1 (worker nodes use 10.0.1.20+)
    ip         = "10.0.1.1"
  }
  
  user_data = templatefile("${path.module}/config/cloud-init-master.yaml", {
    private_ip = "10.0.1.1"
    # public_ip will be determined dynamically during cloud-init
  })
  
  labels = {
    project = "hq"
    role    = "master"
    environment = "production"
    component = "kubernetes"
    cluster = var.cluster_slug
  }
  
  depends_on = [hcloud_network_subnet.private_network_subnet]
}

# Worker Nodes
resource "hcloud_server" "worker_nodes" {
  count = var.worker_count
  
  name        = "hq-${var.cluster_slug}-prod-worker-${count.index + 1}"
  image       = "ubuntu-24.04"
  server_type = var.worker_server_type
  location    = var.location
  
  ssh_keys = [data.hcloud_ssh_key.deployment_key.id]
  firewall_ids = [hcloud_firewall.k8s_firewall.id]
  
  public_net {
    ipv4_enabled = true
    ipv6_enabled = false
  }
  
  network {
    network_id = hcloud_network.private_network.id
    ip         = "10.0.1.${20 + count.index}"
  }
  
  user_data = templatefile("${path.module}/config/cloud-init-worker.yaml", {
    private_ip = "10.0.1.${20 + count.index}"
    master_ip  = "10.0.1.1"
  })
  
  labels = {
    project = "hq"
    role    = "worker"
    environment = "production"
    component = "kubernetes"
    cluster = var.cluster_slug
  }
  
  depends_on = [hcloud_network_subnet.private_network_subnet, hcloud_server.master_node]
}

# Outputs
output "network_id" {
  description = "ID of the private network"
  value       = hcloud_network.private_network.id
}

output "master_ip" {
  description = "Public IP of the master node"
  value       = hcloud_server.master_node.ipv4_address
}

output "worker_ips" {
  description = "Public IPs of worker nodes"
  value       = hcloud_server.worker_nodes[*].ipv4_address
}

output "master_private_ip" {
  description = "Private IP of the master node"
  value       = [for network in hcloud_server.master_node.network : network.ip][0]
}

output "worker_private_ips" {
  description = "Private IPs of worker nodes"
  value       = [for server in hcloud_server.worker_nodes : [for network in server.network : network.ip][0]]
}

output "domain" {
  description = "Configured domain name"
  value       = var.domain
}

output "cluster_slug" {
  description = "Cluster short identifier"
  value       = var.cluster_slug
}