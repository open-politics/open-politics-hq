# 🌐 Open Politics HQ

> **Open source intelligence platform for 21st century research and analysis**

---
**Open Source Political Intelligence - What is that?** @ CCCB Datengarten  
[🎥 Watch Presentation](https://media.ccc.de/v/dg-111)

<div align="center">
  <img src=".github/assets/images/exactly.png" alt="Open Politics HQ Platform" width="600">
</div>

Why? 

 The modern information landscape is a (see up) battlefield across thousands of documents, sources, and events. Reading and sorting everything is impossible. Conducting research with creative yet reliable methods is difficult.

Our approach?

Combining the qualitative with the quantitative. 

Design the question in natural language, the most profound programming language with the most flexible structure that is out there. This allows experts from many domains (journalists, researchers, NGOs, etc.) to work on the "lenses" that are used to extract the information from the content.

We apply these lenses methodically to our data stored in our [information spaces](https://docs.open-politics.org/information-spaces).


- **[Webapp](https://open-politics.org)**
- **[Documentation](https://docs.open-politics.org)** for user guides & tutorials
  

### Usage

> Public registration opening very soon.

### Hosted Webapp
1. Register [here](https://open-politics.org/accounts/register) 

2. Log [here](https://open-politics.org/accounts/login)

> Note: You can log in to the [forum](https://forum.open-politics.org) with the same account.

### Self-Hosted with Docker
1. Clone the repository and prepare the environment:
```bash
git clone https://github.com/open-politics/open-politics-hq.git
cd open-politics-hq
bash prepare.sh
cp .env.example .env
```

Log in with the 
```bash
FIRST_SUPERUSER=app_user
FIRST_SUPERUSER_PASSWORD=app_user_password
```
set in the .env file.


## 🏗️ Services

HQ allows flexible deployment options from fully self-hosted to hybrid cloud setups. Check out also our Kubernetes Helm chart [here](.deployments/kubernetes/open-politics-hq-deployment).

### 📦 Core Services

| Service | Technology | Purpose |
|---------|------------|---------|
| **Backend** | FastAPI & MCP Server | API endpoints, business logic, and Model Context Protocol server |
| **Frontend** | Next.js | Web application interface and user experience |
| **Celery Worker** | Python | Background task processing and job queues |
| **Redis** | In-memory store | Caching, session storage, and message broker |
| **Ollama** | Local LLM | On-premises large language model inference |
| **Pelias** | Geocoding | Geographic data processing and location services |
| **MinIO** | Object storage | File storage and document management |
| **PostgreSQL** | Database + PGVector | Core database with vector search capabilities |

### 🚀 Deployment Options

#### 🏠 Fully Self-Hosted
Complete local deployment with all services running on your infrastructure:
```bash
# All services included
- Backend, Frontend, Celery Worker
- Redis, Ollama, Pelias, MinIO, PostgreSQL
```

#### ☁️ Hybrid Cloud
Lean local deployment with managed cloud services:
```bash
# Core services locally
- Backend, Frontend, Celery Worker, Pelias

# Managed alternatives
- Redis → Upstash Redis
- MinIO → AWS S3 / Google Cloud Storage
- PostgreSQL → Managed PostgreSQL (AWS RDS, Google Cloud SQL, etc.)
```

Kubernetes deployment:

see the helm chart [here](.deployments/kubernetes/open-politics-hq-deployment)


### Implemented LLM Providers:
- Ollama
- OpenAI
- Google

Set their API keys on the home page:



## Contact
engage@open-politics.org


## License
AGPLv3 licensed - see [LICENSE](LICENSE)
