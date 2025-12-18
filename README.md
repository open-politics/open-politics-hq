# Open Politics HQ

Open source intelligence platform for structured document analysis and management.

[Docs](https://docs.open-politics.org) · [Webapp](https://open-politics.org) · [Forum](https://forum.open-politics.org)

<div align="center">
  <img src=".github/assets/images/exactly.png" alt="Open Politics HQ Platform" width="600">
</div>

## Overview

A platform to manage your data, write with sources, and analyse documents at scale. Ingest content from files, URLs, RSS feeds, and search results — set up recurring ingestion to keep your workspace updated. Annotate documents with structured labels. Run analysis across your data. Chat with your documents through a conversational interface.

Self-hostable via Docker Compose or Kubernetes. Supports multiple LLM providers (Anthropic, OpenAI, Google, Ollama) or run models locally. Open source under AGPLv3.

<img src=".github/assets/images/asset-manager.png" alt="Asset Manager">
<img src=".github/assets/images/annotation-schema.png" alt="Annotation Schema">
<img src=".github/assets/images/dashboard.png" alt="Dashboard">

## Core Idea

Define what you're looking for in natural language (schemas). Apply them at scale across your documents. Get structured, reproducible outputs.

**Example: Analyzing news coverage**
```
Primary source cited? → [government, activist, expert, anonymous]
Emotional intensity?  → 1-5
Which side gets final word? → string
```

**Example: Extracting invoice data**
```
Invoice number? → string
Total amount? → number
Date? → date
Vendor name? → string
```

**Example: Sorting through old files**
```
Document type? → [contract, correspondence, report, other]
Date range? → [pre-2020, 2020-2022, post-2022]
Relevance? → [critical, important, archive]
```

Schemas are shareable and transparent — others can see exactly how you defined your framework, critique it, refine it, or apply it to their own data.

## Core Concepts

**Infospaces** — project workspaces that keep your data separate. Each has its own vector index for semantic search.

Within an infospace:

- **Assets** — your documents (PDFs, CSVs, articles, feeds). Composable: a PDF breaks into pages, a CSV into rows. Organise with bundles for batch analysis.
- **Schemas** — your analytical lens, defined in natural language with strict output definitions.
- **Analysis** — run schemas across assets to produce structured annotations.
- **Dashboards** — explore results through tables, charts, maps. Export or share.
- **Chat** — conversational interface to query assets, build schemas, run analysis, find similar items.

```
Infospace
├── Assets (PDFs, CSVs, articles, feeds)
├── Bundles (folders for organization)
├── Schemas (analytical questions)
└── Analysis → Annotations → Dashboards
```

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
