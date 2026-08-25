/**
 * The Composer's model — one shape, two surfaces.
 *
 * The Composer answers one question: **which datapoints am I looking at?** That
 * question is asked in at least nine places today, in three storage conventions
 * and three key vocabularies. This module is the normalisation: every surface
 * maps its own storage into `ComposerModel`, edits it through one UI, and maps
 * it back.
 *
 * Two adapters exist right now because the surfaces genuinely differ:
 *
 * ```
 *   graph panes   SECTION: + SHOW: on the panel's GQL string   ← the future
 *   table panel   panel_config.columns, a flat path list       ← until the fold
 * ```
 *
 * The GQL side is the one the architecture is moving to (`docs/plans/
 * observation-model/STATE.md`: *"GQL becomes the one control surface"*). The
 * table adapter exists so the Composer can replace the column-header checkboxes
 * **now**, and it is meant to be deleted the day `q` reaches every panel type —
 * at which point `fromSchemaFields`/`toColumns` go and nothing else changes.
 *
 * **Samples come from loaded rows, not from the run.** A field's example values
 * and its filled-count are computed from whatever the surface already has in
 * memory. That is honest for a picker — you are choosing against data you can
 * see — but it is NOT run-wide coverage: a field filled once in 500 rows looks
 * empty here if those 500 rows were not loaded. The field census (a server-side
 * pass over the whole run) is what makes it complete; until then every count is
 * labelled with the sample size it came from.
 */
import type { RowColumn, RowItem, SectionRows } from
  '@/components/collection/graph/panes/rowTypes';
import { refsOf, scalarsOf } from
  '@/components/collection/graph/panes/rowTypes';

/* ── The model ─────────────────────────────────────────────────────────── */

/** How a field is drawn — colour, icon, and how its samples read. */
export type FieldKind =
  | 'entity' | 'nominal' | 'ordinal' | 'metric' | 'interval' | 'spatial' | 'text';

/** One datapoint the Composer can offer. */
export interface ComposerField {
  /** Stable id. Also what the adapter writes back — a column key or a path. */
  id: string;
  label: string;
  /** Which group (section, or schema) this belongs to. */
  groupId: string;
  kind: FieldKind;
  /** `declared` came from the contract; `shape` was found in the data. Drawn
   *  differently, because a field the engine guessed and one the schema stated
   *  must not look equally authoritative. */
  source: 'declared' | 'shape';
  entityType?: string | null;
  unit?: string | null;
  /** Distinct example values from the loaded rows, as text. */
  samples: string[];
  /** The first RAW value found for this field, across all loaded rows.
   *
   *  This is what the exemplar row draws. Raw rather than text because the
   *  point is to render it through the surface's own cell renderer — a date as
   *  a date, an entity as a badge, a list as a mini-table — so what you toggle
   *  is exactly what you will get. `undefined` means no loaded row filled it,
   *  which the composer states rather than drawing an empty cell. */
  exemplar?: unknown;
  /** Of `sampled` rows, how many had a value here. */
  filled: number;
  sampled: number;
}

/** A section (graph) or a schema (table) — what a grain can be. */
export interface ComposerGroup {
  id: string;
  label: string;
  /** The schema's declared layout role, verbatim, when it said one. Carried,
   *  not interpreted — a closed set of role names would be this module deciding
   *  what the schema meant. */
  role?: string | null;
  /** Rows behind this group, for the "6 · 23 rows" line. */
  rowCount?: number;
}

export interface ComposerModel {
  groups: ComposerGroup[];
  fields: ComposerField[];
  /** The active group — the grain. Everything else is scoped to it. */
  grain: string | null;
  /** Selected field ids **in display order**. Order is the whole point: it is
   *  what the strip edits and what `SHOW:` preserves. */
  selected: string[];
}

/* ── Sampling ──────────────────────────────────────────────────────────── */

const MAX_SAMPLES = 8;

/** Readable text for one cell value — entity refs by name, scalars as-is. */
export function cellText(raw: unknown): string[] {
  const refs = refsOf(raw);
  if (refs.length) return refs.map(r => r.name).filter(Boolean);
  return scalarsOf(raw).map(v => String(v)).filter(s => s !== '');
}

function sampleColumn(items: readonly RowItem[], key: string) {
  const seen = new Set<string>();
  let filled = 0;
  let exemplar: unknown;
  for (const it of items) {
    const raw = it.cells?.[key];
    const texts = cellText(raw);
    if (texts.length) {
      filled += 1;
      // **The exemplar is composite, and deliberately not a true row.** Row 1
      // may leave `via` empty where row 4 fills it; showing row 1 would
      // understate the schema. Each field takes the first row that HAS a
      // value, so the composite answers "what could a result look like" rather
      // than "what does this one happen to say".
      if (exemplar === undefined) exemplar = raw;
    }
    for (const t of texts) {
      if (seen.size < MAX_SAMPLES) seen.add(t);
    }
  }
  return { samples: [...seen], filled, sampled: items.length, exemplar };
}

/* ── Adapter: graph panes (SECTION: / SHOW:) ───────────────────────────── */

const KIND_OF: Record<string, FieldKind> = {
  nominal: 'nominal', ordinal: 'ordinal', metric: 'metric',
  interval: 'interval', spatial: 'spatial', polar: 'nominal',
};

function fieldFromColumn(
  col: RowColumn, groupId: string, items: readonly RowItem[], total: number,
): ComposerField {
  const page = sampleColumn(items, col.key);
  // **The server's count wins.** The page-scoped one is a fact about
  // scrolling; the census is a fact about the corpus, and a field filled 3
  // times in 480 rows is precisely the one a picker must not call empty.
  const hasCensus = col.filled !== undefined;
  const filled = hasCensus ? col.filled! : page.filled;
  const sampled = hasCensus ? total : page.sampled;
  // Prefer values the page actually holds — they came with a real row, so the
  // exemplar can render the raw shape. Fall back to the census when the page
  // has none, which is the case the census exists for.
  const samples = page.samples.length ? page.samples : (col.examples ?? []);
  const exemplar = page.exemplar !== undefined
    ? page.exemplar
    : (col.examples?.[0] as unknown);
  return {
    id: col.key,
    label: col.label || col.key,
    groupId,
    kind: col.ref === 'entity' ? 'entity' : (KIND_OF[col.kind] ?? 'nominal'),
    source: col.source,
    entityType: col.entityType ?? null,
    unit: col.unit ?? null,
    samples, filled, sampled, exemplar,
  };
}

/**
 * Build the model from what the graph already put on the wire.
 *
 * No fetch: the tables are the same payload the panes render, so the Composer
 * cannot disagree with them about what exists — the same reason the docs pane
 * is a fold rather than a query of its own.
 */
export function fromSectionRows(
  tables: readonly SectionRows[],
  q: string,
  roleOf?: (section: string) => string | null | undefined,
): ComposerModel {
  const groups: ComposerGroup[] = tables.map(t => ({
    id: t.section,
    label: t.section,
    role: roleOf?.(t.section) ?? null,
    rowCount: t.total,
  }));

  const requested = readChannel(q, 'SECTION');
  const grain = requested[0] ?? groups[0]?.id ?? null;

  const fields: ComposerField[] = [];
  for (const t of tables) {
    for (const col of t.columns) {
      fields.push(fieldFromColumn(col, t.section, t.items, t.total));
    }
  }

  // `SHOW:` is section-relative — `SHOW:by` and `SHOW:observations.by` address
  // the same column — so strip a qualifying head before matching.
  const shown = readChannel(q, 'SHOW').map(s => {
    const head = s.split('.')[0];
    return groups.some(g => g.id.toLowerCase() === head.toLowerCase())
      ? s.slice(head.length + 1)
      : s;
  }).filter(Boolean);

  const inGrain = fields.filter(f => f.groupId === grain);
  const selected = shown.length
    ? shown.filter(s => inGrain.some(f => f.id.toLowerCase() === s.toLowerCase()))
    // No `SHOW:` means every column — that is what the backend does, and the
    // Composer must open showing what the surface is showing.
    : inGrain.map(f => f.id);

  return { groups, fields, grain, selected };
}

/** Write the model back into a GQL string, leaving every other clause alone. */
export function applyToGql(q: string, model: ComposerModel): string {
  let out = q;
  out = writeChannel(out, 'SECTION', model.grain ? [model.grain] : []);
  const all = model.fields.filter(f => f.groupId === model.grain).map(f => f.id);
  // Selecting everything is the absence of a clause, not a clause listing
  // everything — so the bar stays readable and the default stays visible.
  const same = all.length === model.selected.length
    && all.every(a => model.selected.includes(a));
  out = writeChannel(out, 'SHOW', same ? [] : model.selected);
  return out.trim();
}

/* ── Channel read/write — targeted, so unrelated clauses survive ───────── */

export function readChannel(q: string, name: string): string[] {
  if (!q) return [];
  const re = new RegExp(`\\b${name}:\\s*([^\\s]+)`, 'i');
  const m = re.exec(q);
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
}

export function writeChannel(q: string, name: string, values: string[]): string {
  const re = new RegExp(`\\s*\\b${name}:\\s*[^\\s]+`, 'ig');
  const without = (q || '').replace(re, '').trim();
  if (!values.length) return without;
  const clause = `${name}:${values.join(',')}`;
  return without ? `${without} ${clause}` : clause;
}

/* ── Adapter: the table panel (panel_config.columns) ───────────────────── */

/** What the table knows about one field, from `getTargetKeysForScheme`. */
export interface SchemaFieldInput {
  key: string;
  name: string;
  type: string;
}

/**
 * Build the model for a schema-and-columns surface.
 *
 * `columns: []` means **show all** — a convention the table already relies on,
 * preserved here rather than reinvented, because two editors disagreeing about
 * what empty means is one of the defects the Composer exists to remove.
 */
export function fromSchemaFields(
  groups: readonly { id: number; label: string; fields: readonly SchemaFieldInput[] }[],
  columns: readonly string[],
  /** Loaded annotation values per group, for samples. */
  valuesOf?: (groupId: number) => readonly unknown[],
  readValue?: (value: unknown, key: string) => unknown,
): ComposerModel {
  const outGroups: ComposerGroup[] = groups.map(g => ({
    id: String(g.id), label: g.label,
  }));
  const fields: ComposerField[] = [];
  for (const g of groups) {
    const values = valuesOf?.(g.id) ?? [];
    for (const f of g.fields) {
      const seen = new Set<string>();
      let filled = 0;
      let exemplar: unknown;
      for (const v of values) {
        const raw = readValue ? readValue(v, f.key) : undefined;
        const texts = cellText(raw);
        if (texts.length) {
          filled += 1;
          if (exemplar === undefined) exemplar = raw;
        }
        for (const t of texts) if (seen.size < MAX_SAMPLES) seen.add(t);
      }
      fields.push({
        id: `${g.id}:${f.key}`,
        label: f.name || f.key,
        groupId: String(g.id),
        kind: kindFromJsonType(f.type),
        source: 'declared',
        samples: [...seen], filled, sampled: values.length, exemplar,
      });
    }
  }
  const grain = outGroups[0]?.id ?? null;
  const inGrain = fields.filter(f => f.groupId === grain);
  const selected = columns.length
    ? inGrain.filter(f => columns.includes(f.id.split(':').slice(1).join(':')))
        .map(f => f.id)
    : inGrain.map(f => f.id);
  return { groups: outGroups, fields, grain, selected };
}

/** Back to the flat path list the table persists. Empty when everything in the
 *  grain is selected, preserving "empty means all". */
export function toColumns(model: ComposerModel): string[] {
  const inGrain = model.fields.filter(f => f.groupId === model.grain);
  if (inGrain.length === model.selected.length) return [];
  return model.selected.map(id => id.split(':').slice(1).join(':'));
}

function kindFromJsonType(t: string): FieldKind {
  if (t === 'integer' || t === 'number') return 'metric';
  if (t === 'boolean') return 'nominal';
  if (t === 'array' || t === 'object') return 'nominal';
  return 'text';
}

/* ── Editing ───────────────────────────────────────────────────────────── */

export function toggleField(model: ComposerModel, id: string): ComposerModel {
  const has = model.selected.includes(id);
  return {
    ...model,
    // Appended, not inserted at its palette position: the order you pick in is
    // the order you meant, and it is the only ordering signal a click carries.
    selected: has ? model.selected.filter(s => s !== id) : [...model.selected, id],
  };
}

export function reorder(model: ComposerModel, from: number, to: number): ComposerModel {
  if (from === to || from < 0 || to < 0) return model;
  const next = [...model.selected];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...model, selected: next };
}

export function setGrain(model: ComposerModel, grain: string): ComposerModel {
  if (grain === model.grain) return model;
  // The grain decides which fields are addressable at all, so a selection from
  // the old one cannot survive into the new. Opening on "everything" matches
  // what an unconfigured surface shows.
  return {
    ...model, grain,
    selected: model.fields.filter(f => f.groupId === grain).map(f => f.id),
  };
}

export function fieldsOfGrain(model: ComposerModel): ComposerField[] {
  return model.fields.filter(f => f.groupId === model.grain);
}
