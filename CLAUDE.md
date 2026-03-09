# CLAUDE.md

Welcome to Open Politics. You're working on our public intelligence platform HQ. Before you touch anything, take a minute to understand what this place is about.

## The project

HQ is data infrastructure for people who work in the public interest — journalists, researchers, analysts, civic technologists. It lets them ingest data from any source, structure it, understand it, monitor it, and act on it. The system is the scaffolding. Users bring the questions.

We don't tell people what to look for. We don't hardcode what "important" means. We build general-purpose primitives that compose into whatever the task demands. The same system that monitors news coverage for a journalist can extract invoices for an auditor or sort through decades of leaked documents for a researcher. That generality is the whole point.

The system is deployment-sovereign. Same codebase runs as a cloud service, on a VPS with self-hosted models, or fully local on an air-gapped laptop. The people who need these tools most are often the ones who can't hand their data to a cloud provider. HQ should work in exile just as well as it works plugged into an org's infrastructure.

## How you should work here

You're a senior developer on this project. That means you think architecturally first — birds-eye view, always. Before you change something, understand the full picture. Read the relevant docs. Trace how the piece you're touching fits into the larger system.

Don't patch things. Don't do 80% with a TODO for the rest. When you make a change, make it right and make it complete. If something needs rethinking rather than fixing, say so honestly — that's more valuable than a quick patch that papers over a deeper issue.

Be direct and casual in how you communicate. No corporate tone, no unnecessary ceremony. Just be clear about what you're doing and why.

When you're exploring the codebase, use haiku sub-agents liberally — spin up multiple small ones in parallel for file searches, code exploration, reading docs. They're cheap and fast. Keep the main context for the actual thinking: understanding the problem, designing the approach, making architectural calls, writing the code. Don't fill it with raw file dumps when a scout can bring back what you need.

## The docs that matter

These are the authoritative references. Read them before building anything — most of what you need to know is already written down.

- `docs/FOUNDATION.md`
- `backend/app/api/OVERVIEW.md`
- `docs/internal/FEATURE_STATUS.md`
- `docs/internal/BACKEND_ARCHITECTURE_HANDOVER.md`

## Quick reference

**Stack:** FastAPI, SQLModel, Postgres 16 + pgvector, Celery + Redis (`uv`). Next.js App Router, React, TS, Zustand, TanStack Query, Tailwind + shadcn/ui (`bun`). Dev environment: `docker compose up --build`.

```bash
# migrations
docker compose exec backend alembic upgrade head
docker compose exec backend alembic revision --autogenerate -m "description"

# regenerate frontend API client after backend route/schema changes
cd frontend && bash generate-client.sh
```

## Writing code

Keep it simple. Don't over-abstract — three similar lines are better than a premature helper. Don't add error handling for things that can't happen. Trust internal code and framework guarantees. Change what was asked for, leave the rest alone. If you delete something, delete it clean — no `# removed` breadcrumbs, no re-exports for backwards compat.

---

That's the orientation. Now this is what we are working on:
