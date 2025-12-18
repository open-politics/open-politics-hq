# Open Politics HQ

Open source intelligence platform for structured document analysis.

[Docs](https://docs.open-politics.org) · [Webapp](https://open-politics.org) · [Forum](https://forum.open-politics.org)

<div align="center">
  <img src=".github/assets/images/exactly.png" alt="Open Politics HQ Platform" width="600">
</div>

## Overview

A containerized toolstack for ingesting, storing, labeling, and analyzing documents at scale. Ingest content from files, URLs, RSS feeds, and search results. Define analytical schemas in natural language. Apply them across your data using LLMs. Store results in PostgreSQL with vector search. Export structured data, visualizations, and dashboards.

Self-hostable via Docker Compose or Kubernetes. Supports multiple LLM providers (Anthropic, OpenAI, Google, Ollama) or run models locally. Open source under AGPLv3.

## What This Is

Define analytical questions in natural language (schemas). Apply them at scale across documents. Get structured, reproducible outputs.

Example schema:

```
Primary source cited? → [government, activist, expert, anonymous]
Emotional intensity?  → 1-5
Which side gets final word? → string
```

<img src=".github/assets/images/dashboard.png" alt="Table with annotation">

Schemas are shareable and transparent — others can see exactly how you defined your framework, critique it, refine it, or apply it to their own data.

<img src=".github/assets/images/annotation-schema.png" alt="Example annotation schema">

Open source. Self-hostable, or bring your own LLM keys and use the hosted variant.

For the full story, see the [manifest](https://docs.open-politics.org/pages/project/manifest).

## Core Concepts

- **Infospaces** — project workspaces with their own vector index
- **Assets** — your documents (PDFs, CSVs, articles, feeds)

<img src=".github/assets/images/asset-manager.png" alt="Example result">

- **Schemas** — your analytical lens, defined in natural language
- **Annotations** — structured outputs from running schemas on assets
- **Chat** — conversational interface to all of the above

See the [overview](https://docs.open-politics.org/pages/app/overview) for details.

## Quickstart

**Minimum requirements:** 8GB RAM, 4 CPU cores, 300GB disk (primarily for Nominatim geocoding database; ~30GB without it).

```bash
git clone https://github.com/open-politics/open-politics-hq.git
cd open-politics-hq
cp .env.example .env
chmod +x prepare.sh
./prepare.sh # creates the .store/ geocoder directory and makes it writable
```
Edit the .env file. Any values that are still set to `changeThis` will prevent the container from starting.
```bash
FIRST_SUPERUSER=app_user
FIRST_SUPERUSER_PASSWORD=changeThis # e.g. generated with "openssl rand -base64 13"
```

```bash
docker compose up --build
```

For hosted option, Kubernetes, or hybrid setups, see the [installation guide](https://docs.open-politics.org/pages/app/installation-self-hosted).

## Architecture

| Component | Purpose |
|-----------|---------|
| Backend | API, analysis jobs, MCP server — FastAPI + Python |
| Frontend | Web interface — Next.js + React |
| Worker | Background processing for large jobs — Celery |
| Database | Data storage with vector search — PostgreSQL + pgvector |
| Object Storage | File storage for uploads — MinIO (S3-compatible) |
| Cache/Queue | Session management, job queues — Redis |
| Geocoding | Location extraction and mapping — Nominatim |
| LLM (optional) | Local AI inference — Ollama |

**LLM support:** Anthropic, OpenAI, Google, Ollama (local). Configure API keys in the web interface or run Ollama locally for complete privacy.

For deployment options (hosted, Kubernetes, hybrid), see the [installation guide](https://docs.open-politics.org/pages/app/installation-self-hosted) or look at the [deployment options](.deployments).

## Contributing

We're building in the open. See the [docs](https://docs.open-politics.org/pages/project/manifest#contact--contributing) or open an issue.

## License

AGPLv3 — see [LICENSE](LICENSE)

## Contact

**Email:** engage@open-politics.org  
**Forum:** [forum.open-politics.org](https://forum.open-politics.org)
