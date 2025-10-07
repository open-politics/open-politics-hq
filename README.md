# 🌐 Open Politics HQ

> **Turn analytical methods into shareable schemas. Apply them at scale.**

Open-source research infrastructure. Self-hostable. Made for the public.

---

**Talk: Open Source Political Intelligence** @ CCCB Datengarten  
[🎥 Watch Presentation](https://media.ccc.de/v/dg-111)

<div align="center">
  <img src=".github/assets/images/exactly.png" alt="Open Politics HQ Platform" width="600">
</div>

## What Makes This Different

A journalist knows how to identify "security framing" in news coverage. A policy analyst knows what counts as "meaningful stakeholder engagement" in legislative proposals. A bureaucrat knows whether a grant application is properly filled out.

That expertise lives in their heads, maybe in spreadsheets and notes. But sophisticated analysis infrastructure—the kind that lets you systematically apply your analytical framework across thousands of documents—has only been available to well-funded institutions.

**This gives everyone their own intelligence HQ.** Define your analytical questions in plain language. Apply them at scale. The key innovation: schemas are shareable, transparent, and improvable. Other researchers can see exactly how you defined your framework, critique it, refine it, or apply it to their own data.

Example schema for legislative analysis:
```
- What's the main policy mechanism? (carbon tax, cap-and-trade, regulation, subsidy)
- Rate emphasis on economic vs environmental framing (1-10 scale)
- Which industries are mentioned as affected? (list)
- Is international cooperation mentioned? (yes/no)
```

Run it on 500 bills. Get a structured dataset. Build charts showing how framing evolved over time or differs by party. Export for statistical analysis.

The same approach works for parliamentary speeches, news monitoring, citizen feedback processing, grant application review—anywhere domain expertise can be expressed in language.

## Why This Exists

The gap is obvious once you see it. Researchers, journalists, NGO workers all do qualitative analysis—reading documents, identifying patterns, building arguments. This works great for tens of documents. At hundreds or thousands, you're either stuck or you need to hire engineers.

Meanwhile, intelligence agencies, think tanks, and corporations have sophisticated analysis infrastructure. The tools exist, they're just not accessible.

The breakthrough is recognizing that **domain experts can already articulate their analytical questions in natural language.** A journalist knows "framing." A policy analyst knows "stakeholder engagement." An NGO worker knows what signals a policy shift. Everyone has Excel, but not everyone has infrastructure to systematically apply their analytical methods at scale.

Natural language schemas change this. The same infrastructure that analyzes legislation can sort emails, process intake forms, track regulatory changes, or monitor media coverage. Now everyone can have their HQ for their information needs.

This capability shouldn't be locked behind institutional walls. We're building it as **public infrastructure**—schemas, geocoding, vector search, local AI. Basic components, almost comedically simple when you list them out. But that's the point. These are foundational capabilities an open society needs, like libraries or archives, and they should be equally accessible.

Open source. Self-hostable. Bring your own LLM keys if you want privacy. Share your analytical frameworks publicly if you want transparency. Use it for journalism, research, advocacy, governance—anything that serves the public interest.

## How It Works

1. **Ingest content** from files, URLs, search results, RSS feeds
2. **Define schemas** that describe what information to extract
3. **Run analysis** using AI to apply your schema at scale
4. **Explore results** through tables, visualizations, maps, or export the data

The schemas are the key innovation. They let you formalize your analytical method in natural language, making qualitative approaches reproducible and transparent. Other researchers can see exactly how you defined "populist rhetoric" or "security framing" and apply the same lens to their data.



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

- **Journalists** investigating patterns across large document sets
- **Researchers** applying qualitative methods at quantitative scale
- **NGOs and advocacy groups** tracking policy developments
- **Students** learning research methods with real-world data
- **Citizens** who want sophisticated tools for understanding politics

And yes.. also business as the general principle applies to many processes and workflows needed by companies (customer support, sales, marketing, etc.)

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
