/**
 * What the set builder reads when it is typed to instead of picked from —
 * the queries' dialect (AQL, GQL: `lib/query/*`), read into set terms
 * (`plane/sets.ts`):
 *
 *   type:Person            a kind by its key: type name place group set
 *   location = Gaza City   a field by its name or path; `:` and `=` alike,
 *                          spaces around them or not
 *   -type:Org  type!=Org   not
 *   name:tru*  Trump*      loosely (∗): names containing it; a node, group
 *                          or set with what links to it
 *   severity > 7           a field's number, compared (> >= < <=)
 *   ~ceasefire talks       by meaning (≈)
 *   "Donald Trump"         a name, exactly — its node when it has one
 *   type:Person,Org        a comma: either
 *
 * Space between clauses is and. A value runs to the next key, so it needs no
 * quotes; quotes keep a comma, or a word that looks like a key, inside one.
 * Words before the first key are a name containing them, as in the queries.
 *
 * Pure, over the panel's `Catalog`. `spell` writes a term back, so a chip
 * can be turned into text again and every offer can show how it is typed.
 */
import {
  REACH, fieldLabel, fold, reachRange, type Cmp, type Network, type Term, type TermKind, type TermOp,
} from '@/components/collection/graph/plane';
import type { Catalog, FieldOption } from './suggest';

/** The kinds a key names. */
export type KindKey = 'type' | 'name' | 'place' | 'group' | 'set';
const KINDS: Record<string, KindKey> = {
  type: 'type', types: 'type', name: 'name', names: 'name', place: 'place', places: 'place',
  group: 'group', groups: 'group', set: 'set', sets: 'set',
};
/** Words for a place, when no field of the run is called that. */
const PLACE_WORDS = new Set(['location', 'where', 'geo']);

export type Target =
  | { kind: KindKey }
  | { kind: 'value'; field: FieldOption }
  | { kind: 'about' }
  /** A key that names nothing — `locaton:`. */
  | { kind: 'unknown'; key: string }
  /** Words before any key. */
  | { kind: 'words' };

export interface Clause {
  target: Target;
  op: TermOp;
  cmp?: Cmp;
  /** As typed, quotes kept (`alternatives` reads them), without its `*`. */
  value: string;
  quoted: boolean;
  /** Where it starts in the line. */
  at: number;
}

/** A clause read as a term — with how it reads, and its node or count. */
export interface Reading {
  term: Term;
  label: string;
  count?: number;
  node?: number;
}

/** Keys compare without case, spaces, `_`, `-` or `[*]`. */
const squash = (s: string) => fold(s).replace(/\[\*\]/g, '').replace(/[\s_-]+/g, '');

export function targetOf(key: string, catalog: Catalog): Target {
  const k = squash(key);
  if (KINDS[k]) return { kind: KINDS[k] };
  const field = catalog.fields.find((f) => [f.label, fieldLabel(f.path), f.path].some((s) => squash(s) === k));
  if (field) return { kind: 'value', field };
  if (PLACE_WORDS.has(k)) return { kind: 'place' };
  return { kind: 'unknown', key };
}

/** How a field is typed: its own name when that says which, else its path. */
export function keyOf(field: FieldOption, fields: readonly FieldOption[]): string {
  const short = fieldLabel(field.path);
  const k = squash(short);
  const unique = !KINDS[k] && fields.filter((f) => squash(fieldLabel(f.path)) === k).length === 1;
  return unique ? short : field.path.replace(/\[\*\]/g, '');
}

// A clause starts at the line's start or after a space: `-`/`!` for not,
// then `~`, or a key and its operator. `[:=]` may lead a comparison
// (`severity: >3`).
const HEAD = /(^|\s)([-!]?)(?:(~)|([\p{L}\p{N}_.[\]*]+?)\s*((?:[:=]\s*)?[<>]=?|!=|==|:|=))/gu;

/** The line, read into clauses. */
export function read(line: string, catalog: Catalog): Clause[] {
  // Nothing inside quotes starts a clause.
  const quoted: Array<[number, number]> = [];
  for (const m of line.matchAll(/"[^"]*"?/g)) quoted.push([m.index!, m.index! + m[0].length]);
  const inQuotes = (i: number) => quoted.some(([a, b]) => i > a && i < b);

  const heads: Array<{ start: number; end: number; target: Target; neg: boolean; op: string }> = [];
  for (const m of line.matchAll(HEAD)) {
    const start = m.index! + m[1].length;
    if (inQuotes(start)) continue;
    const neg = !!m[2];
    if (m[3]) { heads.push({ start, end: m.index! + m[0].length, target: { kind: 'about' }, neg, op: '~' }); continue; }
    const key = m[4];
    const target = targetOf(key, catalog);
    // A word that names nothing starts a clause only as `word:` — else it is
    // part of a value (`10:30`, `a = b` in a phrase).
    if (target.kind === 'unknown' && !(m[5] === ':' && /^\p{L}/u.test(key) && line[start + m[2].length + key.length] === ':')) continue;
    heads.push({ start, end: m.index! + m[0].length, target, neg, op: m[5].replace(/\s+/g, '') });
  }

  const clauses: Clause[] = [];
  const lead = line.slice(0, heads[0]?.start ?? line.length);
  if (lead.trim()) clauses.push(clause({ kind: 'words' }, false, '', lead, line.length - line.trimStart().length));
  heads.forEach((h, k) => {
    const raw = line.slice(h.end, heads[k + 1]?.start ?? line.length);
    clauses.push(clause(h.target, h.neg, h.op, raw, h.start));
  });
  return clauses;
}

function clause(target: Target, neg: boolean, written: string, raw: string, at: number): Clause {
  let value = raw.trim();
  const loose = value.endsWith('*');
  if (loose) value = value.slice(0, -1).trimEnd();
  const quoted = value.startsWith('"');
  const cmpOp = written.replace(/^[:=]/, '');
  const cmp = (['>', '>=', '<', '<='] as const).find((c) => c === cmpOp);
  const op: TermOp = neg || written === '!=' ? '!' : loose ? '~' : '=';
  return { target, op, cmp, value, quoted, at };
}

/** A value without its quotes. */
const plain = (v: string) => v.replace(/"/g, '').trim();

/** A value's alternatives: commas outside quotes. */
export function alternatives(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of raw) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim()).filter(Boolean);
}

/** One of a closed list by what was typed: exactly, or the only one that
 *  contains it. */
function one<T>(items: readonly T[], text: (t: T) => string, value: string): T | undefined {
  const q = fold(value);
  const exact = items.find((t) => fold(text(t)) === q);
  if (exact) return exact;
  const some = items.filter((t) => fold(text(t)).includes(q));
  return some.length === 1 ? some[0] : undefined;
}

const sum = (xs: Array<number | undefined>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Names containing (or equal to) any of the words, counted. */
function namesCount(net: Network, words: readonly string[], loose: boolean): number {
  const vs = words.map(fold);
  let n = 0;
  for (let i = 0; i < net.size; i++) {
    const s = fold(net.name[i]);
    if (loose ? vs.some((v) => s.includes(v)) : vs.includes(s)) n++;
  }
  return n;
}

/** A kind whose values are a closed list — named, kept by key, counted. */
export type Listed = 'type' | 'place' | 'group' | 'set';
export function listOf(kind: Listed, catalog: Catalog): Array<{ key: string; name: string; count: number }> {
  switch (kind) {
    case 'type': return catalog.types.map((x) => ({ key: x.name, name: x.name, count: x.count }));
    case 'place': return catalog.places.map((x) => ({ key: x.name, name: x.name, count: x.count }));
    case 'group': return catalog.groups.map((x) => ({ key: x.key, name: x.label, count: x.size }));
    case 'set': return catalog.sets.map((x) => ({ key: x.id, name: x.label, count: x.count }));
  }
}

/** A clause as a term — undefined while what it names is not settled: an
 *  empty value, or one a closed list holds more than one of. */
export function resolve(c: Clause, catalog: Catalog): Reading | undefined {
  const { base } = catalog;
  const not = c.op === '!' ? '≠ ' : '';
  const t = c.target;
  if (!plain(c.value)) return undefined;
  if (t.kind === 'about') {
    const phrase = plain(c.value);
    return {
      term: { kind: 'about', op: c.op === '!' ? '!' : '=', values: [phrase], range: reachRange(REACH) },
      label: `${c.op === '!' ? '≠≈' : '≈'} ${phrase} — by meaning`,
    };
  }
  if (t.kind === 'unknown') return undefined;
  const values = alternatives(c.value);
  if (!values.length) return undefined;
  if (t.kind === 'value') {
    const what = t.field.label;
    if (c.cmp) {
      if (!Number.isFinite(Number(values[0]))) return undefined;
      return {
        term: { kind: 'value', field: t.field.path, op: c.op === '!' ? '!' : '=', cmp: c.cmp, values: [values[0]] },
        label: `${what} ${c.op === '!' ? 'not ' : ''}${c.cmp} ${values[0]}`,
      };
    }
    return {
      term: { kind: 'value', field: t.field.path, op: c.op, values },
      label: `${what} ${c.op === '~' ? 'containing' : c.op === '!' ? '≠' : '='} ${values.join(' / ')}`,
    };
  }
  if (t.kind === 'words' || t.kind === 'name') {
    // `"Donald Trump"`: its node, when one is named exactly that — `*`, with
    // what links to it.
    if (t.kind === 'words' && c.quoted && values.length === 1) {
      const q = fold(values[0]);
      const hits: number[] = [];
      for (let i = 0; i < base.size && hits.length < 2; i++) if (fold(base.name[i]) === q) hits.push(i);
      if (hits.length === 1) {
        const i = hits[0];
        return {
          term: { kind: 'entity', op: c.op, values: [base.id[i]] }, node: i,
          label: `${not}${base.name[i]}`, count: base.frequency[i],
        };
      }
    }
    // Words before any key read loosely, as the queries read free text.
    const op: TermOp = t.kind === 'words' && !c.quoted && c.op === '=' ? '~' : c.op;
    return {
      term: { kind: 'name', op, values },
      label: `${op === '!' ? 'No name' : op === '~' ? 'Names containing' : 'Named exactly'} ${values.map((v) => `“${v}”`).join(' / ')}`,
      count: namesCount(base, values, op === '~'),
    };
  }
  // The closed lists: a type, place, group or set by its name.
  const list = listOf(t.kind, catalog);
  // Loosely, a type or place is any containing the words — as typed.
  if (c.op === '~' && (t.kind === 'type' || t.kind === 'place')) {
    const hits = values.flatMap((v) => list.filter((x) => fold(x.name).includes(fold(v))));
    return { term: { kind: t.kind, op: '~', values }, label: `${t.kind} containing ${values.join(' / ')}`, count: sum(hits.map((h) => h.count)) };
  }
  const found = values.map((v) => one(list, (x) => x.name, v));
  if (found.some((f) => !f)) return undefined;
  const hits = [...new Map(found.map((f) => [f!.key, f!])).values()];
  return {
    term: { kind: t.kind, op: c.op, values: hits.map((h) => h.key) },
    label: `${t.kind} ${c.op === '~' ? '∗' : c.op === '!' ? '≠' : '='} ${hits.map((h) => h.name).join(' / ')}`,
    count: c.op === '!' ? undefined : sum(hits.map((h) => h.count)),
  };
}

/** A value as typed: quoted when it holds a comma, a quote or a key's mark. */
const word = (v: string) => (/[",:=<>~*]|^\s|\s$/.test(v) || !v ? `"${v.replace(/"/g, '')}"` : v);

/** A term written back in the dialect — undefined for what cannot be typed
 *  (a room's inside, a held snapshot, a score). */
export function spell(
  term: Term, nameOf: (kind: TermKind, value: string) => string, fields: readonly FieldOption[],
): string | undefined {
  if (term.kind === 'region' || term.like?.length || term.measure) return undefined;
  const not = term.op === '!' ? '-' : '';
  const loose = term.op === '~' ? '*' : '';
  if (term.kind === 'about') return term.values.length === 1 ? `${not}~${term.values[0]}` : undefined;
  if (term.kind === 'entity') {
    if (term.values.length !== 1) return undefined;
    return `${not}"${nameOf('entity', term.values[0]).replace(/"/g, '')}"${loose}`;
  }
  const values = term.values.map((v) => word(term.kind === 'group' || term.kind === 'set' ? nameOf(term.kind, v) : v)).join(',');
  if (term.kind === 'value') {
    const field = fields.find((f) => f.path === term.field);
    const key = field ? keyOf(field, fields) : (term.field ?? '').replace(/\[\*\]/g, '');
    if (term.cmp) return `${not}${key} ${term.cmp} ${term.values[0]}`;
    return `${not}${key} = ${values}${loose}`;
  }
  return `${not}${term.kind}:${values}${loose}`;
}

/** The field a line's last clause is choosing a value of, and the words so
 *  far — what the builder asks the run's values for. */
export function openField(line: string, catalog: Catalog): { field: FieldOption; search: string } | null {
  const last = read(line, catalog).at(-1);
  if (last?.target.kind !== 'value' || last.cmp) return null;
  return { field: last.target.field, search: alternatives(last.value).at(-1) ?? '' };
}
