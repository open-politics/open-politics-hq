/**
 * complete — what can be typed here, from what this run actually has.
 *
 * The addressing grammar has a ladder, and until now it was only *stated* after
 * the fact: you wrote `CLUSTER:Location`, the query ran, and the legend told
 * you what it had decided you meant. That is the right thing to say and the
 * wrong time to say it. A completion says it while there is still a choice.
 *
 * The ladder, and this module walks exactly it — no second opinion:
 *
 * ```
 *   type · kind · role · place · section     a reserved key
 *   <section>.<field>                        the row's own column
 *   Location · Interest                      an entity TYPE → its neighbour
 *   places · interests                       a SECTION → the types it minted
 *   anything else                            a property on the node
 * ```
 *
 * Suggestions come from `graph.meta.index`, which is read off the **assembled
 * graph** rather than the contract — offering `Location` on a run whose query
 * has already excluded every place is a suggestion that returns nothing, and a
 * completion list that lies is worse than none because it is believed.
 */
import { GQL_TOKENS } from '@/lib/query/graph_query_language';

/** What a run is addressable by. Mirrors `_graph_index` in the route. */
export interface GraphIndex {
  sections: Record<string, Array<{
    key: string; label: string; kind: string; ref?: string | null; source: string;
  }>>;
  types: string[];
  roles: string[];
  predicates: string[];
  properties: string[];
}

export interface Completion {
  /** What replaces the token being typed. */
  value: string;
  /** What it is, in the reader's terms — never a type name from the code. */
  detail: string;
  /** Grouping header. */
  group: string;
}

export const EMPTY_INDEX: GraphIndex = {
  sections: {}, types: [], roles: [], predicates: [], properties: [],
};

/** The token under the cursor — everything back to the last unquoted space.
 *
 *  Quotes are respected because interests are multi-word far more often than
 *  not, and a completer that breaks `serves:"port priv` at the space offers
 *  nothing at the exact moment it would help most. */
export function tokenAt(text: string, caret: number): { start: number; token: string } {
  let start = 0, quote: string | null = null;
  for (let i = 0; i < caret; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ' ') start = i + 1;
  }
  return { start, token: text.slice(start, caret) };
}

const CHANNELS = ['SECTION', 'SHOW', 'CLUSTER', 'COLOR', 'WEIGHT', 'PANEL'];

/** Channels whose value is an address rather than a literal. */
const ADDRESSING = new Set(['SECTION', 'SHOW', 'CLUSTER', 'COLOR', 'WEIGHT']);

const has = (s: string, q: string) => s.toLowerCase().includes(q.toLowerCase());

/** What sits inside an entity reference. Fixed because the shape is: a `{name,
 *  type}` object is the model's own foreign-key form, and a slot that carried
 *  something else would not be a reference. */
const ENTITY_LEAVES = ['name', 'type'] as const;

/**
 * Completions for the token being typed.
 *
 * Ordered by the ladder, so the first suggestion is the one the resolver would
 * actually pick. A list ordered by string similarity would put `places` above
 * `place` for `CLUSTER:plac`, and those resolve to different things.
 */
export function completions(
  text: string, caret: number, index: GraphIndex, limit = 12,
): Completion[] {
  const { token } = tokenAt(text, caret);
  const out: Completion[] = [];
  const push = (c: Completion) => { if (out.length < limit) out.push(c); };

  const colon = token.indexOf(':');
  if (colon < 0) {
    // A bare dotted path is a FILTER address — `observations.magnitude>8`. It
    // reaches the same columns a channel does, because the addressing grammar
    // cannot be true in one half of the language and false in the other.
    const bareDot = token.lastIndexOf('.');
    if (bareDot > 0) {
      const head = token.slice(0, bareDot).toLowerCase();
      const tail = token.slice(bareDot + 1);
      for (const col of index.sections[head] ?? []) {
        if (has(col.key, tail)) {
          push({
            value: `${head}.${col.key}`,
            detail: col.source === 'shape'
              ? `${col.kind} · found in the data`
              : `${col.kind} · declared`,
            group: `${head} columns`,
          });
        }
      }
      if (out.length) return out;
    }
    // No colon yet — offer the channels and the filter prefixes.
    for (const c of CHANNELS) {
      if (has(c, token)) push({ value: `${c}:`, detail: hintFor(c), group: 'clause' });
    }
    for (const t of GQL_TOKENS) {
      const head = t.token.split(/[:<>=]/)[0];
      if (head && /^[a-z.]+$/.test(head) && has(head, token)) {
        push({ value: `${head}:`, detail: t.hint, group: 'filter' });
      }
    }
    // A bare word that names a section is almost always meant as one.
    for (const s of Object.keys(index.sections)) {
      if (has(s, token)) {
        push({ value: `SECTION:${s}`, detail: 'this run has this section',
               group: 'clause' });
      }
    }
    return out;
  }

  const channel = token.slice(0, colon);
  const partial = token.slice(colon + 1);
  const upper = channel.toUpperCase();
  const prefix = token.slice(0, colon + 1);

  // `observations.` — inside a section, so offer its columns and nothing else.
  const dot = partial.lastIndexOf('.');
  if (dot >= 0) {
    const head = partial.slice(0, dot).toLowerCase();
    const tail = partial.slice(dot + 1);
    for (const col of index.sections[head] ?? []) {
      if (has(col.key, tail)) {
        push({
          value: `${prefix}${head}.${col.key}`,
          detail: col.source === 'shape'
            ? `${col.kind} · found in the data`
            : `${col.kind} · declared`,
          group: `${head} columns`,
        });
      }
    }
    // **A path may keep going.** `observations.by` is an entity slot, and
    // `observations.by.name` is a real address in every position — the filter
    // half accepted it long before the other two did. Offering only one level
    // would teach that the grammar stops there.
    const seg = partial.slice(0, dot).toLowerCase().split('.');
    const sec = index.sections[seg[0]];
    const parent = sec?.find(c => c.key.toLowerCase() === seg[seg.length - 1]);
    if (parent?.ref === 'entity') {
      for (const leaf of ENTITY_LEAVES) {
        if (has(leaf, tail)) {
          push({
            value: `${prefix}${partial.slice(0, dot)}.${leaf}`,
            detail: `the ${leaf} of whatever fills ${seg[seg.length - 1]}`,
            group: 'inside the slot',
          });
        }
      }
    }
    return out;
  }

  if (upper === 'SECTION' || upper === 'PANEL') {
    for (const s of Object.keys(index.sections)) {
      if (has(s, partial)) {
        push({ value: prefix + s,
               detail: `${index.sections[s].length} columns`, group: 'sections' });
      }
    }
    return out;
  }

  if (ADDRESSING.has(upper)) {
    // **The ladder, in resolution order.** The first suggestion is what the
    // engine would pick, which is the only ordering that cannot mislead.
    if (upper === 'CLUSTER' || upper === 'COLOR') {
      for (const k of ['type', 'kind', 'role', 'place', 'section']) {
        if (has(k, partial)) {
          push({ value: prefix + k, detail: `each node's ${k}`, group: 'reserved' });
        }
      }
    }
    for (const t of index.types) {
      if (has(t, partial)) {
        push({ value: prefix + t, detail: `the ${t} it connects to`, group: 'types' });
      }
    }
    for (const s of Object.keys(index.sections)) {
      if (has(s, partial)) {
        push({ value: prefix + s, detail: `the section ${s}`, group: 'sections' });
      }
    }
    for (const p of index.properties) {
      if (has(p, partial)) {
        push({ value: prefix + p, detail: 'a property on the node',
               group: 'properties' });
      }
    }
    // Every section's columns, qualified — the spelling that never collides
    // with a reserved word.
    for (const [sec, cols] of Object.entries(index.sections)) {
      for (const col of cols) {
        if (has(col.key, partial) && partial) {
          push({ value: `${prefix}${sec}.${col.key}`,
                 detail: `${col.kind} on ${sec}`, group: `${sec} columns` });
        }
      }
    }
    return out;
  }

  // A filter prefix — offer this run's own values.
  const pools: Record<string, string[]> = {
    type: index.types, role: index.roles, predicate: index.predicates,
    pred: index.predicates, kind: ['occurrence', 'entity'],
  };
  for (const v of pools[channel.toLowerCase()] ?? []) {
    if (has(v, partial)) push({ value: prefix + v, detail: '', group: channel });
  }
  return out;
}

function hintFor(channel: string): string {
  switch (channel) {
    case 'SECTION': return 'which section\'s rows — splits into one table each';
    case 'SHOW': return 'the table\'s columns; arity picks the surface';
    case 'CLUSTER': return 'group the canvas into labelled cells';
    case 'COLOR': return 'node fill';
    case 'WEIGHT': return 'node size';
    case 'PANEL': return 'add a pane';
    default: return '';
  }
}

/** Apply a completion to the text, returning the new text and caret. */
export function applyCompletion(
  text: string, caret: number, c: Completion,
): { text: string; caret: number } {
  const { start } = tokenAt(text, caret);
  const next = text.slice(0, start) + c.value + text.slice(caret);
  return { text: next, caret: start + c.value.length };
}
