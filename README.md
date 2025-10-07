# 🌐 Open Politics HQ

> Open-source intelligence platform for political research and analysis

---
**Talk: Open Source Political Intelligence** @ CCCB Datengarten  
[🎥 Watch Presentation](https://media.ccc.de/v/dg-111)

<div align="center">
  <img src=".github/assets/images/exactly.png" alt="Open Politics HQ Platform" width="600">
</div>

## What This Does

You define analytical questions in plain language. The system applies them systematically across hundreds or thousands of documents. You get structured data you can analyze, visualize, and share.

**Example:** A researcher studying climate policy wants to analyze 500 legislative proposals. Instead of reading each one, they define a schema:
- "What's the main policy mechanism proposed? (carbon tax, cap-and-trade, regulation, subsidy, etc.)"
- "Rate the emphasis on economic impact vs environmental urgency (1-10 scale)"
- "Which industries are mentioned as affected?"

Run the analysis. Get a structured dataset. Build charts showing how framing shifts over time or differs by political party.

This works across PDFs, news articles, parliamentary records, CSVs, images, web scrapes - we are working on extending this to more content types and sources.

## Why This Exists

This started with a simple frustration: as a political scientist, I needed tools that didn't exist outside of well-funded institutions. Qualitative analysis doesn't scale—coding 500 documents by hand takes weeks. Computational methods require programming skills most domain experts don't have.

But the breakthrough isn't specific to political research. The principle is universal: **experts in any domain can articulate their analytical questions in natural language**. A journalist knows what constitutes "framing." A bureaucrat knows whether a form is properly filled out. An NGO worker knows what signals a policy shift. They just can't turn that expertise into code.

Natural language schemas solve this. Define your question once, apply it systematically to thousands of documents. The same infrastructure that analyzes parliamentary speeches can sort intake emails, process grant applications, or track regulatory changes.

This capability is too fundamental to remain locked behind institutional walls. We're building it as **public infrastructure**—open source, self-hostable, composable. Not because we're opposed to businesses or governments using it (they should!), but because our mission is clear: **enhance the public's capacity to understand and participate in complex information landscapes**.

The technology isn't exotic—schemas, maps, geocoders, local AI, vector search. Basic components. That's precisely the point. These are foundational capabilities a sophisticated open society needs, like libraries or archives, and they should be equally accessible.

## How It Works

1. **Ingest content** from files, URLs, search results, RSS feeds
2. **Define schemas** that describe what information to extract
3. **Run analysis** using AI to apply your schema at scale
4. **Explore results** through tables, visualizations, maps, or export the data

**The key insight:** Schemas work for anything. "Does this legislative text mention climate adaptation?" "What's the requested amount in this grant application?" "Which department is mentioned in this email?" Domain experts already know what questions matter—schemas let them encode that expertise without programming.

This makes analytical methods transparent and reproducible. Share your schema with colleagues or the public. They can see exactly how you defined "populist rhetoric" or "properly completed form" and apply the same lens to their own data, critique your definitions, or propose improvements.



## Links

- **[Webapp](https://open-politics.org)** — hosted instance (public registration opening soon)
- **[Documentation](https://docs.open-politics.org)** — user guides and tutorials
- **[Forum](https://forum.open-politics.org)** — community discussions

## Getting Started

### Option 1: Use the Hosted Instance

The easiest way to start. We host the infrastructure, you bring your own LLM API keys (OpenAI, Anthropic, Google, or use local Ollama if you boot this up yourself).

1. **Register** at [open-politics.org/accounts/register](https://open-politics.org/accounts/register)
2. **Add your API keys** on the home page
3. **Start uploading content** and creating schemas

> Your account also works on the [forum](https://forum.open-politics.org) for community support.

### Option 2: Self-Host with Docker

For privacy, customization, or institutional requirements. Run everything on your own infrastructure.

```bash
git clone https://github.com/open-politics/open-politics-hq.git
cd open-politics-hq
bash prepare.sh
cp .env.example .env
# Edit .env with your configuration
docker compose up
```

Default admin credentials (change these):
```bash
FIRST_SUPERUSER=app_user
FIRST_SUPERUSER_PASSWORD=app_user_password
```

You can run fully local (including Ollama for LLMs) or use a hybrid setup with managed services for PostgreSQL, Redis, and object storage.


## Architecture

The platform is built from several independent services that work together. You can run them all locally or mix local and managed services.

### Core Components

| Component | What It Does | Technology |
|-----------|-------------|------------|
| **Backend** | API, analysis jobs, MCP server | FastAPI + Python |
| **Frontend** | Web interface | Next.js + React |
| **Worker** | Background processing for large jobs | Celery |
| **Database** | Data storage with vector search | PostgreSQL + PGVector |
| **Object Storage** | File storage for uploads | MinIO (S3-compatible) |
| **Cache/Queue** | Session management, job queues | Redis |
| **Geocoding** | Location extraction and mapping | Pelias |
| **LLM** (optional) | Local AI inference | Ollama |

### Deployment Flexibility

**Fully Local:** Run everything on your own hardware. Good for air-gapped environments or complete data control.

**Hybrid:** Run the application locally but use managed services (AWS RDS, Upstash Redis, S3) to reduce operational burden.

**Kubernetes:** We provide a Helm chart at [`.deployments/kubernetes/open-politics-hq-deployment`](.deployments/kubernetes/open-politics-hq-deployment)

### LLM Support

Connect any of these AI providers:
- **Anthropic** (Claude, etc.)
- **OpenAI** (GPT-4, GPT-4o, etc.)
- **Google** (Gemini models)
- **Ollama** (run models locally—Llama, Mistral, etc.)

Configure API keys in the web interface or run Ollama locally for complete privacy.



## Who This Is For

The natural language schema approach works for any domain where expertise is articulated in language rather than code. We focus on public-interest applications:

- **Journalists** — investigate patterns across large document sets without engineering support
- **Researchers** — apply qualitative methods at quantitative scale, make analytical frameworks transparent
- **NGOs and advocacy groups** — track policy developments, process citizen reports, analyze stakeholder communications
- **Government agencies** — process intake forms, classify public comments, analyze regulatory submissions
- **Students and educators** — learn research methods with real tools, not toy examples
- **Citizens** — understand complex political developments with the same capabilities institutions have

If you're working on something that serves the public interest, we want this infrastructure to work for you. If you're a business or private institution, the code is open source—use it, but consider how your work might benefit the commons.

## Contributing

We're building this in the open. The codebase, analytical methods, and documentation are all public and improvable.

**Ways to contribute:**
- Report bugs or suggest features (GitHub Issues)
- Improve documentation or add examples
- Build and share analytical schemas
- Contribute code (see backend and frontend READMEs)
- Join community discussions on the forum

## Contact & Community

- **Email:** engage@open-politics.org
- **Forum:** [forum.open-politics.org](https://forum.open-politics.org)
- **Dev Meetings:** Wednesdays 15:30 Berlin Time

## License

AGPLv3 — see [LICENSE](LICENSE)

This means you can use, modify, and distribute this software, but any modifications or services built on it must also be open source. You can get an enterprise license for private use modifications which are not publicly deployed for one year at a time under strict ethical guidelines.
