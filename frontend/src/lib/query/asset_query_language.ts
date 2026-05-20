/**
 * AQL — Asset Query Language
 *
 * A query string that compiles to AssetQuery on the backend.
 * This file provides the syntax reference, example queries,
 * and a client-side parser for rendering query pills in the UI.
 *
 * ═══════════════════════════════════════════════════════════
 *  SYNTAX REFERENCE
 * ═══════════════════════════════════════════════════════════
 *
 *  Free text (FTS via websearch_to_tsquery — handles phrases, negation, OR natively):
 *    corruption                          → word match (stemmed)
 *    "Deutsche Bank"                     → exact phrase (adjacent words)
 *    -sports                             → exclude term
 *    climate or energy                   → OR (either term)
 *
 *  Semantic search (pgvector similarity on asset embeddings):
 *    ~corruption                         → top-k by similarity
 *    ~corruption>0.7                     → only results above similarity threshold
 *    ~corruption<0.3                     → only distant/tangential results
 *
 *  Filters:
 *    kind:pdf                            → asset kind
 *    kind:pdf,email                      → multiple kinds (OR)
 *    -kind:image                         → exclude kind
 *    after:2019-01                       → date range start (event_timestamp → created_at)
 *    before:2022-12                      → date range end
 *    bundle:"leaked docs"               → scope to bundle (name or ID)
 *    bundle:42                           → scope to bundle by ID
 *    tag:favorite                        → filter by asset tag
 *    tag:important,review                → multiple tags (AND)
 *
 *  Entity search (graph-first with text fallback):
 *    entity:"Angela Merkel"              → exact match (canonical name + aliases)
 *    entity:"A","B"                      → either entity (OR)
 *    entity:~politician                  → semantic similarity on entity embeddings
 *    entity:~politician>0.7              → with threshold
 *    -entity:"name"                      → exclude assets connected to entity
 *
 *  Annotation filters (JSONB pushdown on annotation.value):
 *    annotation:sentiment>=0.8          → numeric comparison
 *    annotation:category=="financial"   → exact text match
 *    annotation:doc.topics.0=="climate" → nested JSONB path (dot notation)
 *    annotation:event_date>=2019-01-01  → date comparison (lexicographic on ISO strings)
 *    run:42                              → scope annotation queries to specific run
 *
 * ═══════════════════════════════════════════════════════════
 *  COMPOSITION RULES
 * ═══════════════════════════════════════════════════════════
 *
 *  Space between tokens  →  AND
 *  Comma within a value  →  OR (kind:pdf,email = pdf OR email)
 *  - prefix              →  NOT / exclude
 *  ~ prefix              →  semantic similarity
 *  "quotes"              →  exact phrase (text) or literal value (filters)
 *  Multiple same-type    →  entity:"A" entity:"B" = must match BOTH
 *  Comma within filter   →  entity:"A","B" = must match EITHER
 *
 * ═══════════════════════════════════════════════════════════
 *  OPERATORS
 * ═══════════════════════════════════════════════════════════
 *
 *  ==    exact text match              annotation:category=="financial"
 *  !=    not equal                     annotation:status!="draft"
 *  >=    greater or equal (num/date)   annotation:score>=0.8
 *  >     greater than                  ~query>0.7
 *  <=    less or equal                 annotation:score<=0.3
 *  <     less than                     ~query<0.5
 *
 *  For >= / <= / > / <: values that look numeric are compared as floats.
 *  Otherwise compared as text (ISO date strings sort correctly).
 *
 * ═══════════════════════════════════════════════════════════
 *  SEARCHABLE ASSET FIELDS
 * ═══════════════════════════════════════════════════════════
 *
 *  Free text searches:
 *    text_content    FTS (websearch_to_tsquery, GIN indexed)
 *    title           ILIKE fallback (OR'd with FTS)
 *
 *  entity: searches:
 *    Entity.canonical_name    (case-insensitive)
 *    Entity.aliases           (JSON array)
 *    Fallback: Asset.text_content + Asset.title (ILIKE)
 *
 *  annotation: searches:
 *    Annotation.value JSONB            (GIN indexed, nested paths via #>>)
 */

// ─── Types ───

export type PillType =
  | 'text'
  | 'semantic'
  | 'kind'
  | 'date'
  | 'bundle'
  | 'asset'
  | 'entity'
  | 'entity_semantic'
  | 'tag'
  | 'annotation'
  | 'run'
  | 'children';

export interface QueryPill {
  type: PillType;
  label: string;
  value: string;
  negated: boolean;
  raw: string; // original token for reconstruction
}

export interface ParsedQueryResponse {
  text?: string;
  semantic?: { text: string; threshold?: number; op?: string };
  kinds?: string[];
  excluded_kinds?: string[];
  date_after?: string;
  date_before?: string;
  bundle_refs?: string[];
  asset_refs?: string[];
  tags?: string[];
  entities?: string[][];
  entity_negations?: string[];
  entity_semantic?: { text: string; threshold?: number; op?: string };
  annotations?: { field: string; op: string; value: string; negated?: boolean }[];
  run_ids?: number[];
  children_limit?: number;
}

// ─── Available filter values ───

export const ASSET_KINDS = [
  'pdf', 'web', 'image', 'video', 'audio', 'text', 'csv',
  'csv_row', 'mbox', 'email', 'pdf_page', 'text_chunk',
  'image_region', 'video_scene', 'audio_segment', 'article',
  'rss_feed', 'file',
] as const;

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'created_at_desc', label: 'Newest first' },
  { value: 'created_at_asc', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
] as const;

export const FILTER_PREFIXES = [
  { prefix: 'kind:', hint: 'Asset type', values: ASSET_KINDS },
  { prefix: 'after:', hint: 'Date from (ISO)', values: null },
  { prefix: 'before:', hint: 'Date until (ISO)', values: null },
  { prefix: 'bundle:', hint: 'Bundle name or ID, comma-separated', values: null },
  { prefix: 'asset:', hint: 'Asset title(s), comma-separated', values: null },
  { prefix: 'tag:', hint: 'Asset tag (e.g. favorite)', values: null },
  { prefix: 'entity:', hint: 'Entity name', values: null },
  { prefix: 'annotation:', hint: 'field==value', values: null },
  { prefix: 'run:', hint: 'Run ID', values: null },
  { prefix: 'children:', hint: 'none | 3 | 10 | 50 — child match limit', values: null },
] as const;

// ─── Example queries ───

export const QUERY_EXAMPLES = [
  // Basic text
  { q: 'corruption', desc: 'Full-text search' },
  { q: '"Deutsche Bank"', desc: 'Exact phrase match' },
  { q: '"Deutsche Bank" -sports', desc: 'Phrase with exclusion' },

  // Semantic
  { q: '~political lobbying', desc: 'Semantic similarity search' },
  { q: '~corruption>0.7', desc: 'Semantic with similarity threshold' },
  { q: '"Deutsche Bank" ~corruption', desc: 'Hybrid: phrase + semantic' },

  // Filters
  { q: 'corruption kind:pdf after:2019', desc: 'Text + kind + date' },
  { q: 'kind:pdf,email after:2019 before:2022', desc: 'Multiple kinds + date range' },

  // Tags
  { q: 'tag:favorite', desc: 'Favorited assets' },
  { q: 'tag:favorite kind:pdf', desc: 'Favorited PDFs' },

  // Entities
  { q: 'entity:"Angela Merkel"', desc: 'Entity search (graph → text fallback)' },
  { q: 'entity:"Angela Merkel" entity:"Deutsche Bank"', desc: 'Connection between two entities' },
  { q: 'entity:"A","B" after:2019', desc: 'Either entity, date-filtered' },
  { q: 'entity:~politician', desc: 'Semantic entity discovery' },
  { q: 'entity:~"financial institution">0.7', desc: 'Semantic entity with threshold' },

  // Annotations
  { q: 'run:42 annotation:sentiment>=0.8', desc: 'Annotation field filter' },
  { q: 'run:42 annotation:category=="financial"', desc: 'Annotation exact match' },
  { q: 'annotation:event_date>=2019-01-01', desc: 'Annotation date filter (any run)' },

  // Super-queries
  {
    q: 'kind:pdf entity:"Angela Merkel" entity:"Deutsche Bank" after:2019 before:2022 run:42 annotation:category=="financial" ~"political lobbying"',
    desc: 'Full composite: kind + entities + dates + annotation + semantic',
  },
] as const;

// ─── Client-side pill parser ───

const PREFIX_RE = /^(-)?([a-z]+):(.+)$/s;
const THRESHOLD_RE = /([><]=?)([\d.]+)$/;

/**
 * Parse a query string into pills for visual rendering.
 * This is a lightweight client-side mirror of the backend parser —
 * the backend does the real parsing, this just drives the UI pills.
 */
export function parseQueryToPills(query: string): QueryPill[] {
  if (!query?.trim()) return [];

  const tokens = tokenize(query.trim());
  const pills: QueryPill[] = [];

  for (const token of tokens) {
    const prefixMatch = token.match(PREFIX_RE);

    if (prefixMatch) {
      const negated = prefixMatch[1] === '-';
      const prefix = prefixMatch[2];
      const rest = prefixMatch[3];

      if (prefix === 'kind') {
        pills.push({ type: 'kind', label: 'Kind', value: stripQuotes(rest), negated, raw: token });
      } else if (prefix === 'after') {
        pills.push({ type: 'date', label: 'After', value: stripQuotes(rest), negated: false, raw: token });
      } else if (prefix === 'before') {
        pills.push({ type: 'date', label: 'Before', value: stripQuotes(rest), negated: false, raw: token });
      } else if (prefix === 'bundle') {
        pills.push({ type: 'bundle', label: 'Bundle', value: stripQuotes(rest), negated: false, raw: token });
      } else if (prefix === 'asset') {
        pills.push({ type: 'asset', label: 'Asset', value: stripQuotes(rest), negated: false, raw: token });
      } else if (prefix === 'tag') {
        pills.push({ type: 'tag', label: 'Tag', value: stripQuotes(rest), negated: false, raw: token });
      } else if (prefix === 'run') {
        pills.push({ type: 'run', label: 'Run', value: rest, negated: false, raw: token });
      } else if (prefix === 'entity') {
        if (rest.startsWith('~')) {
          const semText = rest.slice(1);
          pills.push({ type: 'entity_semantic', label: 'Entity ~', value: stripQuotes(semText), negated, raw: token });
        } else {
          pills.push({ type: 'entity', label: 'Entity', value: stripQuotes(rest), negated, raw: token });
        }
      } else if (prefix === 'annotation') {
        pills.push({ type: 'annotation', label: 'Annotation', value: rest, negated, raw: token });
      } else if (prefix === 'children') {
        pills.push({ type: 'children', label: 'Children', value: stripQuotes(rest), negated: false, raw: token });
      }
      continue;
    }

    // Semantic
    if (token.startsWith('~')) {
      const semText = token.slice(1);
      pills.push({ type: 'semantic', label: '~', value: stripQuotes(semText), negated: false, raw: token });
      continue;
    }

    // Free text
    pills.push({ type: 'text', label: 'Text', value: token, negated: token.startsWith('-'), raw: token });
  }

  return pills;
}

/**
 * Reconstruct a query string from pills (after user removes/edits a pill).
 */
export function pillsToQuery(pills: QueryPill[]): string {
  return pills.map((p) => p.raw).join(' ');
}

/**
 * Build pills from the backend's parsed response (more accurate than client-side parsing).
 */
export function parsedResponseToPills(parsed: ParsedQueryResponse): QueryPill[] {
  const pills: QueryPill[] = [];

  if (parsed.text) {
    pills.push({ type: 'text', label: 'Text', value: parsed.text, negated: false, raw: parsed.text });
  }
  if (parsed.semantic) {
    const raw = parsed.semantic.threshold
      ? `~${parsed.semantic.text}${parsed.semantic.op ?? '>'}${parsed.semantic.threshold}`
      : `~${parsed.semantic.text}`;
    pills.push({ type: 'semantic', label: '~', value: parsed.semantic.text, negated: false, raw });
  }
  for (const k of parsed.kinds ?? []) {
    pills.push({ type: 'kind', label: 'Kind', value: k, negated: false, raw: `kind:${k}` });
  }
  for (const k of parsed.excluded_kinds ?? []) {
    pills.push({ type: 'kind', label: 'Kind', value: k, negated: true, raw: `-kind:${k}` });
  }
  if (parsed.date_after) {
    pills.push({ type: 'date', label: 'After', value: parsed.date_after, negated: false, raw: `after:${parsed.date_after}` });
  }
  if (parsed.date_before) {
    pills.push({ type: 'date', label: 'Before', value: parsed.date_before, negated: false, raw: `before:${parsed.date_before}` });
  }
  if (parsed.bundle_refs?.length) {
    const val = parsed.bundle_refs.join(', ');
    const raw = 'bundle:' + parsed.bundle_refs.map((b) => (/\s/.test(b) ? `"${b}"` : b)).join(',');
    pills.push({ type: 'bundle', label: 'Bundle', value: val, negated: false, raw });
  }
  if (parsed.asset_refs?.length) {
    const val = parsed.asset_refs.join(', ');
    const raw = 'asset:' + parsed.asset_refs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(',');
    pills.push({ type: 'asset', label: 'Asset', value: val, negated: false, raw });
  }
  for (const t of parsed.tags ?? []) {
    pills.push({ type: 'tag', label: 'Tag', value: t, negated: false, raw: `tag:${t}` });
  }
  for (const group of parsed.entities ?? []) {
    const val = group.join(', ');
    const raw = group.map((e) => (/\s/.test(e) ? `"${e}"` : e)).join(',');
    pills.push({ type: 'entity', label: 'Entity', value: val, negated: false, raw: `entity:${raw}` });
  }
  for (const e of parsed.entity_negations ?? []) {
    const raw = /\s/.test(e) ? `-entity:"${e}"` : `-entity:${e}`;
    pills.push({ type: 'entity', label: 'Entity', value: e, negated: true, raw });
  }
  if (parsed.entity_semantic) {
    const s = parsed.entity_semantic;
    const raw = s.threshold ? `entity:~${s.text}${s.op ?? '>'}${s.threshold}` : `entity:~${s.text}`;
    pills.push({ type: 'entity_semantic', label: 'Entity ~', value: s.text, negated: false, raw });
  }
  for (const a of parsed.annotations ?? []) {
    const raw = `annotation:${a.field}${a.op}${a.value}`;
    pills.push({ type: 'annotation', label: 'Annotation', value: `${a.field} ${a.op} ${a.value}`, negated: a.negated ?? false, raw });
  }
  for (const id of parsed.run_ids ?? []) {
    pills.push({ type: 'run', label: 'Run', value: String(id), negated: false, raw: `run:${id}` });
  }
  if (parsed.children_limit != null) {
    const val = parsed.children_limit === 0 ? 'none' : String(parsed.children_limit);
    pills.push({ type: 'children', label: 'Children', value: val, negated: false, raw: `children:${val}` });
  }

  return pills;
}

// ─── Query manipulation helpers ───
// These let the helper panel insert/remove/toggle filters in the query string.

/**
 * Toggle a kind filter in the query. If kind:X exists, remove it. Otherwise append it.
 */
export function toggleKindInQuery(query: string, kind: string): string {
  const pills = parseQueryToPills(query);
  const idx = pills.findIndex((p) => p.type === 'kind' && !p.negated && p.value.split(',').includes(kind));
  if (idx >= 0) {
    pills.splice(idx, 1);
    return pillsToQuery(pills);
  }
  return (query ? query + ' ' : '') + `kind:${kind}`;
}

/**
 * Check if a kind is currently active in the query.
 */
export function isKindActive(query: string, kind: string): boolean {
  const pills = parseQueryToPills(query);
  return pills.some((p) => p.type === 'kind' && !p.negated && p.value.split(',').includes(kind));
}

/**
 * Set or clear a date filter (after: or before:) in the query.
 */
export function setDateInQuery(query: string, which: 'after' | 'before', value: string): string {
  const pills = parseQueryToPills(query);
  const label = which === 'after' ? 'After' : 'Before';
  const idx = pills.findIndex((p) => p.type === 'date' && p.label === label);

  if (idx >= 0) {
    if (value) {
      pills[idx] = { ...pills[idx], value, raw: `${which}:${value}` };
    } else {
      pills.splice(idx, 1);
    }
    return pillsToQuery(pills);
  }
  if (value) {
    return (query ? query + ' ' : '') + `${which}:${value}`;
  }
  return query;
}

/**
 * Get the current date filter value from the query, or empty string.
 */
export function getDateFromQuery(query: string, which: 'after' | 'before'): string {
  const pills = parseQueryToPills(query);
  const label = which === 'after' ? 'After' : 'Before';
  const pill = pills.find((p) => p.type === 'date' && p.label === label);
  return pill?.value ?? '';
}

/**
 * Set or clear a run filter in the query.
 */
export function setRunInQuery(query: string, runId: string): string {
  const pills = parseQueryToPills(query);
  const idx = pills.findIndex((p) => p.type === 'run');
  if (idx >= 0) {
    if (runId) {
      pills[idx] = { ...pills[idx], value: runId, raw: `run:${runId}` };
    } else {
      pills.splice(idx, 1);
    }
    return pillsToQuery(pills);
  }
  if (runId) {
    return (query ? query + ' ' : '') + `run:${runId}`;
  }
  return query;
}

/**
 * Set, change, or clear the children: limit in the query.
 * value: 'none' | '3' | '10' | '' (empty = remove token, back to default)
 */
export function setChildrenInQuery(query: string, value: string): string {
  const pills = parseQueryToPills(query);
  const idx = pills.findIndex((p) => p.type === 'children');
  if (idx >= 0) {
    if (value) {
      pills[idx] = { ...pills[idx], value, raw: `children:${value}` };
    } else {
      pills.splice(idx, 1);
    }
    return pillsToQuery(pills);
  }
  if (value) {
    return (query ? query + ' ' : '') + `children:${value}`;
  }
  return query;
}

/**
 * Get the current children: value from the query, or empty string (= default).
 */
export function getChildrenFromQuery(query: string): string {
  const pills = parseQueryToPills(query);
  const pill = pills.find((p) => p.type === 'children');
  return pill?.value ?? '';
}

/**
 * Insert a complete token into the query (entity, annotation pattern, etc.)
 */
export function insertToken(query: string, token: string): string {
  return (query ? query + ' ' : '') + token;
}

// ─── Internal helpers ───

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current: string[] = [];
  let inQuotes = false;

  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current.push(ch);
    } else if (ch === ' ' && !inQuotes) {
      if (current.length) {
        tokens.push(current.join(''));
        current = [];
      }
    } else {
      current.push(ch);
    }
  }
  if (current.length) tokens.push(current.join(''));
  return tokens;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}
