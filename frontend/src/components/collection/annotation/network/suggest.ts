/**
 * What the set builder offers as you type — every kind of term at once.
 *
 * "tru" might be a person, the start of every name containing it, a group a
 * person heads, a place, a type, a set, or an annotation field. The builder
 * does not ask which: it offers the few best of each, nodes first — so Enter
 * on a name still goes straight to it — and the reader picks. Picking a field
 * writes its key (`location = `) and the builder turns to its values. Pinned
 * last, always: every name containing the words (`tru*`), and the words by
 * meaning (`~tru`) — what the documents and names say, not what they spell.
 *
 * Typed in the dialect (`dialect.ts`: `type:Person location = Ga`), the line
 * as typed comes first, and the last clause's completions after it — each
 * carrying the line's other clauses, so one pick takes the whole line.
 *
 * Pure, over a `Catalog` the panel assembles once per network.
 */
import type { AnnotationSchemaRead } from '@/client';
import { flattenFieldPaths, walkOutputContract, type FieldShape } from '@/lib/annotations/fieldPaths';
import { REACH, fieldLabel, findNodes, fold, reachRange, type Cmp, type Network, type Term, type TermOp } from '@/components/collection/graph/plane';
import { alternatives, listOf, read, resolve, type Clause } from './dialect';

/** An annotation field a value term can read. */
export interface FieldOption {
  path: string;
  label: string;
  /** The schemas that carry it. */
  schemas: string[];
  shape: FieldShape;
  enum?: string[];
}

export interface Catalog {
  base: Network;
  types: ReadonlyArray<{ name: string; count: number }>;
  groups: ReadonlyArray<{ key: string; label: string; size: number }>;
  places: ReadonlyArray<{ name: string; count: number }>;
  sets: ReadonlyArray<{ id: string; label: string; count: number }>;
  fields: readonly FieldOption[];
}

export type Suggestion =
  | {
    kind: 'term'; term: Term; label: string; hint?: string; count?: number; node?: number;
    /** The line's other clauses, taken with it. */
    also?: Term[];
    /** The line as typed — not an offer of the builder's. */
    typed?: boolean;
    /** Kept at the foot: the words loosely, and by meaning. */
    pinned?: boolean;
  }
  | { kind: 'field'; field: FieldOption; label: string; hint?: string }
  /** Words for the input — a key, to go on typing after (`type:`). */
  | { kind: 'text'; text: string; label: string; hint?: string };

export type Value = { value: string; count: number };

/** Fields whose values read as words, numbers or flags — what `=` and `~`
 *  make sense of. Entities are the graph's own; objects hold fields. */
const VALUE_SHAPES = new Set<FieldShape>([
  'string', 'enum_string', 'number', 'boolean', 'date', 'array_string', 'array_string_enum', 'array_number',
]);

export function fieldsOf(schemas: readonly AnnotationSchemaRead[]): FieldOption[] {
  const byPath = new Map<string, FieldOption>();
  for (const schema of schemas) {
    for (const f of flattenFieldPaths(walkOutputContract(schema))) {
      if (!VALUE_SHAPES.has(f.shape)) continue;
      const known = byPath.get(f.path);
      if (known) { if (!known.schemas.includes(schema.name)) known.schemas.push(schema.name); continue; }
      byPath.set(f.path, {
        path: f.path, label: f.label, schemas: [schema.name], shape: f.shape,
        enum: f.enum?.map(String),
      });
    }
  }
  return [...byPath.values()];
}

/** Places by how many nodes are claimed at them. */
export function placesOf(net: Network): { name: string; count: number }[] {
  const counts = new Uint32Array(net.coordNames.length);
  for (let i = 0; i < net.size; i++) {
    const seen = new Set<number>();
    for (let k = net.placeOffsets[i]; k < net.placeOffsets[i + 1]; k++) seen.add(net.placeCoord[k]);
    seen.forEach((c) => counts[c]++);
  }
  const byName = new Map<string, number>();
  net.coordNames.forEach((name, c) => { if (counts[c]) byName.set(name, (byName.get(name) ?? 0) + counts[c]); });
  return [...byName].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

const rank = (q: string) => (s: string) => (s.startsWith(q) ? 0 : s.includes(` ${q}`) ? 1 : 2);

function best<T>(items: readonly T[], text: (t: T) => string, q: string, limit: number): T[] {
  const r = rank(q);
  return items
    .map((item) => ({ item, s: fold(text(item)) }))
    .filter((x) => x.s.includes(q))
    .sort((a, b) => r(a.s) - r(b.s))
    .slice(0, limit)
    .map((x) => x.item);
}

export function suggest(raw: string, catalog: Catalog, values: readonly Value[] = []): Suggestion[] {
  const clauses = read(raw, catalog);
  const last = clauses.at(-1);
  if (!last) return [];
  if (clauses.length === 1 && last.target.kind === 'words' && !last.quoted && last.op === '=') return offers(raw, catalog);

  const done = clauses.slice(0, -1).map((c) => resolve(c, catalog)).filter((r) => !!r);
  const also = done.map((r) => r.term);
  const line = resolve(last, catalog);
  const out: Suggestion[] = [];
  if (line) {
    out.push({
      kind: 'term', typed: true, also, term: line.term, node: also.length ? undefined : line.node,
      label: [...done, line].map((r) => r.label).join(' · '), count: also.length ? undefined : line.count,
      hint: clauses.length > done.length + 1 ? 'as typed — a clause that names nothing is left out' : 'as typed',
    });
  }
  const same = (t: Term) => !!line && JSON.stringify(t) === JSON.stringify(line.term);
  for (const s of completions(last, catalog, values)) {
    if (s.kind === 'term' && same(s.term)) continue;
    out.push(s.kind === 'term' ? { ...s, also } : s);
  }
  return out;
}

const KIND_KEYS = ['type', 'place', 'group', 'set', 'name'] as const;

/** Two words a slip of the keys apart: at most two letters changed, added or
 *  dropped. */
function typo(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 3) return false;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] <= 2;
}

/** Bare words: the few best of every kind, then the words loosely and by
 *  meaning. */
function offers(raw: string, catalog: Catalog): Suggestion[] {
  const q = fold(raw);
  if (!q) return [];
  const { base } = catalog;
  const out: Suggestion[] = [];

  for (const i of findNodes(base, raw, 5)) {
    out.push({
      kind: 'term', node: i, label: base.name[i], count: base.frequency[i],
      hint: base.types[base.type[i]] || 'unknown',
      term: { kind: 'entity', op: '=', values: [base.id[i]] },
    });
  }
  for (const t of best(catalog.types, (t) => t.name, q, 3)) {
    out.push({ kind: 'term', label: t.name, count: t.count, hint: 'type', term: { kind: 'type', op: '=', values: [t.name] } });
  }
  for (const g of best(catalog.groups, (g) => g.label, q, 3)) {
    out.push({ kind: 'term', label: g.label, count: g.size, hint: 'group', term: { kind: 'group', op: '=', values: [g.key] } });
  }
  for (const p of best(catalog.places, (p) => p.name, q, 3)) {
    out.push({ kind: 'term', label: p.name, count: p.count, hint: 'place', term: { kind: 'place', op: '=', values: [p.name] } });
  }
  for (const s of best(catalog.sets, (s) => s.label, q, 3)) {
    out.push({ kind: 'term', label: s.label, count: s.count, hint: 'set', term: { kind: 'set', op: '=', values: [s.id] } });
  }
  for (const f of best(catalog.fields, (f) => `${f.label} ${f.path}`, q, 4)) {
    out.push({ kind: 'field', field: f, label: f.label, hint: `field · ${f.schemas.join(', ')}` });
  }
  // A kind's own key, once the words start it — how a kind is typed.
  for (const k of KIND_KEYS) {
    if (q.length >= 2 && k.startsWith(q)) out.push({ kind: 'text', text: `${k}:`, label: `${k}: …`, hint: `every ${k}, to pick from` });
  }
  const words = raw.trim();
  let named = 0;
  for (let i = 0; i < base.size; i++) if (fold(base.name[i]).includes(q)) named++;
  out.push({
    kind: 'term', pinned: true, label: `names containing “${words}”`, count: named, hint: `${words}*`,
    term: { kind: 'name', op: '~', values: [words] },
  });
  out.push({
    kind: 'term', pinned: true, label: `“${words}” by meaning`, hint: `~${words}`,
    term: { kind: 'about', op: '=', values: [words], range: reachRange(REACH) },
  });
  return out;
}

/** What completes a line's last clause: its kind's names, its field's
 *  values, the nodes its words name — or, for a key that names nothing, the
 *  keys it might have meant. */
function completions(c: Clause, catalog: Catalog, values: readonly Value[]): Suggestion[] {
  const t = c.target;
  const words = alternatives(c.value);
  const earlier = words.slice(0, -1);
  const typing = c.value.trimEnd().endsWith(',') ? '' : words.at(-1) ?? '';
  const q = fold(typing);
  /** An offer joins the alternatives typed before it. */
  const joined = (base: Term, value: string): Term => ({ ...base, values: [...new Set([...earlier, value])] });
  switch (t.kind) {
    case 'type': case 'place': case 'group': case 'set': {
      const list = listOf(t.kind, catalog);
      const before = earlier.map((v) => list.find((x) => fold(x.name) === fold(v))?.key ?? v);
      // Loosely a type or place contains the words; a name picked from them
      // is that one. A group or set held loosely keeps what links to it.
      const op = c.op === '~' && (t.kind === 'type' || t.kind === 'place') ? '=' : c.op;
      return (q ? best(list, (x) => x.name, q, 8) : list.slice(0, 8)).map((x) => ({
        kind: 'term' as const, label: x.name, count: x.count, hint: t.kind,
        term: { kind: t.kind, op, values: [...new Set([...before, x.key])] },
      }));
    }
    case 'value':
      return valueSuggestions(t.field, c.op, typing, values, c.cmp).map((s) => (
        s.kind === 'term' && !s.term.measure ? { ...s, term: joined(s.term, s.term.values[0]) } : s));
    case 'words': case 'name':
      if (!q) return [];
      return findNodes(catalog.base, typing, 5).map((i) => ({
        kind: 'term' as const, node: i, label: catalog.base.name[i], count: catalog.base.frequency[i],
        hint: catalog.base.types[catalog.base.type[i]] || 'unknown',
        term: { kind: 'entity' as const, op: c.op, values: [catalog.base.id[i]] },
      }));
    case 'unknown': {
      const k = fold(t.key);
      const near = (s: string) => { const w = fold(s); return w.includes(k) || k.includes(w) || typo(w, k); };
      const out: Suggestion[] = [];
      for (const kind of KIND_KEYS) if (near(kind)) out.push({ kind: 'text', text: `${kind}:`, label: `${kind}: …`, hint: 'a kind' });
      for (const f of catalog.fields.filter((f) => near(f.label) || near(fieldLabel(f.path))).slice(0, 5)) {
        out.push({ kind: 'field', field: f, label: f.label, hint: `field · ${f.schemas.join(', ')}` });
      }
      if (!out.length) out.push({ kind: 'text', text: '', label: `“${t.key}” is not a field or a kind here`, hint: 'type:  place:  name:  group:  set:  or a field' });
      return out;
    }
    case 'about':
      return [];
  }
}

/** A field's values as terms, under the operator the builder holds — and
 *  what is typed, as it stands. */
export function valueSuggestions(
  field: FieldOption, op: TermOp, raw: string, values: readonly Value[], cmp?: Cmp,
): Suggestion[] {
  const text = raw.trim();
  const numeric = field.shape === 'number' || field.shape === 'array_number';
  // A comparison has nothing to pick from: the number typed is the term.
  if (cmp) {
    return numeric || Number.isFinite(Number(text)) ? [] : [{
      kind: 'text', text: '', label: `${field.label} compares numbers — ${cmp} needs one`, hint: 'severity > 7',
    }];
  }
  const q = fold(text);
  const listed = (values.length ? values : (field.enum ?? []).map((value) => ({ value, count: NaN })))
    .filter((v) => !q || fold(v.value).includes(q));
  const out: Suggestion[] = listed.map((v) => ({
    kind: 'term' as const, label: v.value, count: Number.isNaN(v.count) ? undefined : v.count, hint: field.label,
    term: { kind: 'value' as const, field: field.path, op, values: [v.value] },
  }));
  // A number can also be read as a degree: no value picked, the score itself
  // — what a set's ground is raised from (`plane/surface`).
  if (numeric && op !== '~') {
    out.unshift({
      kind: 'term', hint: field.label,
      label: op === '!' ? `Less ${field.label}, by score` : `${field.label}, by score — as ground`,
      term: { kind: 'value', field: field.path, op, values: [], measure: true },
    });
  }
  if (text && (op === '~' || !listed.some((v) => fold(v.value) === q))) {
    out.unshift({
      kind: 'term', hint: field.label,
      label: `${op === '~' ? 'Containing' : op === '!' ? 'Not' : 'Exactly'} “${text}”`,
      term: { kind: 'value', field: field.path, op, values: [text] },
    });
  }
  return out;
}
