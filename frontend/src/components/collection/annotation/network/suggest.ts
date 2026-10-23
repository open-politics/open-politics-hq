/**
 * What the set builder offers as you type — every kind of term at once.
 *
 * "tru" might be a person, the start of every name containing it, a group a
 * person heads, a place, a type, a set, or an annotation field. The builder
 * does not ask which: it offers the few best of each, nodes first — so Enter
 * on a name still goes straight to it — and the reader picks. Picking a field
 * turns the builder to that field's values (`sentiment` → `= negative`).
 *
 * Pure, over a `Catalog` the panel assembles once per network.
 */
import type { AnnotationSchemaRead } from '@/client';
import { flattenFieldPaths, walkOutputContract, type FieldShape } from '@/lib/annotations/fieldPaths';
import { findNodes, fold, type Network, type Term } from '@/components/collection/graph/plane';

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
  | { kind: 'term'; term: Term; label: string; hint?: string; count?: number; node?: number }
  | { kind: 'field'; field: FieldOption; label: string; hint?: string };

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

export function suggest(raw: string, catalog: Catalog): Suggestion[] {
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
  let named = 0;
  for (let i = 0; i < base.size; i++) if (fold(base.name[i]).includes(q)) named++;
  if (named > 1) {
    out.push({
      kind: 'term', label: `Every name containing “${raw.trim()}”`, count: named, hint: 'name ~',
      term: { kind: 'name', op: '~', values: [raw.trim()] },
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
  return out;
}

/** A field's values as terms, under the operator the builder holds — and
 *  what is typed, as it stands. */
export function valueSuggestions(
  field: FieldOption, op: Term['op'], raw: string, values: ReadonlyArray<{ value: string; count: number }>,
): Suggestion[] {
  const text = raw.trim();
  const q = fold(text);
  const listed = (values.length ? values : (field.enum ?? []).map((value) => ({ value, count: NaN })))
    .filter((v) => !q || fold(v.value).includes(q));
  const out: Suggestion[] = listed.map((v) => ({
    kind: 'term' as const, label: v.value, count: Number.isNaN(v.count) ? undefined : v.count, hint: field.label,
    term: { kind: 'value' as const, field: field.path, op, values: [v.value] },
  }));
  // A number can also be read as a degree: no value picked, the score itself
  // — what a set's ground is raised from (`plane/surface`).
  if ((field.shape === 'number' || field.shape === 'array_number') && op !== '~') {
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
