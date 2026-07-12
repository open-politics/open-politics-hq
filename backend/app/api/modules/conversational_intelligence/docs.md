HQ-core operator docs. Each section starts with a line `@@@ <slug>`.
These teach the operator how to run workflows well. Read one before acting on
a multi-step request; they name operations you then `load` from the catalogue.

@@@ the-arc
# The Arc — running an intelligence operation

You operate HQ by composing the same verbs a user would click, then stepping
back while HQ's live machinery runs the operation. Work in this loop:

1. **Understand** — clarify the question; `web_research` to survey the landscape.
2. **Ingest** — create a bundle to hold the material, then set up sources that
   fill it (feeds, searches). One-shot research and recurring monitoring both
   land assets in the bundle.
3. **Structure** — author an annotation schema (`analysis_hub`, op `schema.create`)
   that codes what the question needs (sentiment, framing, entities, …).
4. **Monitor** — start a run over the bundle (`analysis_hub`, op `run.start`);
   make it `live` so new assets are annotated as they arrive.
5. **Visualize** — open the run beside the chat; its dashboard auto-adds a results
   table as annotations land, and the user shapes further panels there. Don't author
   formulas/panels yourself.

**Discipline that keeps you fast:**
- You start with only `catalogue`, `load`, `inspect`. Browse the catalogue for
  what you need, `load` it (a single op, or a named set), then act. Don't ask
  for tools you haven't loaded.
- Read the doc for a workflow before a multi-step build (`monitoring`, `schemas`).
- Results come back summarized. If you need the full payload of a prior result,
  `inspect(handle)` — don't re-run the operation.
- **Write posture is per operation.** Cheap reads/navigation act immediately.
  Costly/recurring actions (sources, schemas, runs) stage a prefilled form the
  user confirms — propose them, don't commit blind.
- Track a multi-step plan with `tasks`; stash findings in `working_memory`. Keep
  the plan and notes there, not re-explained in every message.

The operation is composition, not a special feature. The same loop handles
"monitor a country's politics" and "compare how outlets frame a topic" — only
the schema changes.

@@@ monitoring
# Monitoring a topic

Goal: a live operation that keeps annotating new material and updates a
dashboard, with no further action from you once set up.

Order matters (a source needs a destination bundle first):

1. **Bundle, then seed it now.** `library_hub` (op `collection.create`) makes the
   destination, e.g. "Angola Monitor" — keep its id. Immediately run a `web_research`
   sweep (`ingest_top_k`, `bundle_id` = the bundle) so the bundle has material *now*.
   Don't leave it empty: a live run over an empty bundle shows nothing until the first
   poll, and looks broken.
2. **Recurring sources.** `sources_hub` (op `create`): `kind` (rss / web_search),
   `details` (e.g. `{"feed_url": ...}` or `{"query": ...}`), `poll_interval_seconds`,
   `output_bundle_id` = the bundle. HQ polls on schedule and ingests new items
   **headless** — HQ runs between conversations, you don't. Confirming a source also
   seeds it once immediately. Before a web-search source, check the catalogue: if it
   shows `needs_setup: ["web_search"]`, no search provider is configured — offer
   RSS-only or to configure one. Never assume it's there. *Sources are the one step
   the user confirms inline — propose them and wait for the `<form_result>`.*
3. **Schema.** Author the coding schema (`analysis_hub` op `schema.create`, pass
   `schema_fields`; see the `schemas` doc). It executes when you call it — no separate
   confirmation.
4. **Live run.** `analysis_hub` op `run.start` with `source_bundle_id` = the bundle
   and `live: true` so new assets re-annotate automatically. Executes on call.
5. **Open the dashboard.** `run.start` opens the run's dashboard; it **auto-adds a
   Results Table** as annotations land. Do NOT author formulas or panels yourself —
   point the user to the dashboard to shape the panels they want.

Once the run is live your job is done: HQ's pollers + reconciler + streaming keep the
operation producing intelligence; the user shapes the dashboard from there.

@@@ schemas
# Authoring an annotation schema

A schema is a natural-language→structured-output contract: it declares fields
the LLM fills per asset. Good schemas are tight and answer the question directly.

- **One field per question.** Prefer several small, well-named fields over one
  vague blob. Give each a clear description — it's the instruction the model reads.
- **Use the right type.** Text, number, enum (fixed options), boolean, and
  **entity** (ties a value to a canonical person/place/org across assets). Use
  entity fields whenever you want to compare or connect actors.
- **Comparison lives in the schema, not in separate sources.** To compare how
  left vs right outlets frame a topic, code a `framing_lean` enum
  (`left|center|right`) and an `outlet` field on the *same* mixed bundle, then a
  panel splits by them. The system never learns "left/right" — the schema does.
- **Scales for measurement.** For "how positive/severe/certain", a 1–10 or
  ordinal enum lets panels average and trend it.
- **Don't bake verdicts into extraction.** Extract facts; compute judgments
  downstream in formulas. A `predicate` of `favors`/`disfavors` is a fact; a
  `predicate` of `is_corrupt` is a verdict — don't.

Author with `analysis_hub` op `schema.create`, passing **`schema_fields`** — a list
of `{name, type, description, options?, entity_type?, array?}` (types: text,
number, integer, boolean, enum, entity). That's the easy path; don't hand-write
`output_contract`. After a schema change, re-run extraction — old annotations
don't retro-fill.
