/**
 * Sets — the reader's own groups, built from anything the network knows.
 *
 * The link structure makes groups of its own (`communities.ts`). A reader
 * makes others: "the people around Trump", "everything from documents marked
 * negative", "Interest, in Berlin". A set is a few **terms**, each one facet:
 *
 *   type    a node type                       type = Person
 *   name    the node's own name               name ~ sanction
 *   entity  one node                          = Donald Trump
 *   group   one of the network's groups       group = Energy prices · …
 *   place   a place a node is claimed at      place = Berlin
 *   set     another set — sets compose        set = Ministers
 *   value   an annotation value on the        sentiment = negative
 *           documents behind a node
 *   about   a meaning, in words — or like     ≈ sanctions on Russia
 *           some nodes, by their documents    ≈ like 74 nodes
 *   region  what is drawn inside the set's    ⬚ inside
 *           own room (`rooms.ts`)
 *
 * and an operator, one keystroke each:
 *
 *   =  is one of these                ~  loosely: a name or value that
 *   ≠  is none of these                  *contains* the words; a node, group
 *                                        or set *and what it links to*
 *
 * A term's values are alternatives (type = Person, Org). Terms narrow each
 * other (type = Interest, ~ Trump: the interests linked to Trump). ≠ takes
 * away. So intersecting two sets is two `set =` terms, and joining them one
 * term with both.
 *
 * What a set *does* is up to the reader, and the same set does it in every
 * view: highlighted, its documents opened; shown alone — the plane narrowed
 * to it and the others shown alone beside it; turned up or down (`gain.ts`);
 * placed as an anchor that gathers it (`anchoring.ts`) — a point among the
 * groups and on the map, a lane on the timeline, a pillar deep in time.
 *
 * A term can also be **graded** — a degree, not a match: a value term with
 * no values reads the number at its field (`measure`), and `≈` reads how
 * close a node is to a meaning (`about`: its phrases are alternatives, the
 * closest counts). Its set then carries a weight per node (`fields.ts`) and
 * every reader can take it graded: a surface, a pull, a colour. A graded
 * term's members are the nodes with a basis — held to a band of its degree
 * when it has one (`range`; a meaning's reach is the top band of its rank).
 * A ≠ on one takes away by degree, and a strength says how much it counts.
 *
 * Pure: a set and the network in, base node indices out. Value and meaning
 * terms are the one thing the network does not carry — the documents'
 * annotations, the embeddings — and arrive from outside: as asset ids
 * (`SetWorld.valueAssets`), or graded as a field (`SetWorld.weights`). So
 * does where things are drawn, for a room's inside (`SetWorld.inside`).
 */
import type { AnchorSpace, Place } from './anchoring';
import { absent, and, butNot, spread, strength as raise, type Field } from './fields';
import type { Network } from './network';

export type TermKind = 'type' | 'name' | 'entity' | 'group' | 'place' | 'set' | 'value' | 'about' | 'region';
/** `=` is, `~` loosely, `!` is not. */
export type TermOp = '=' | '~' | '!';
/** A value term's number compared — `severity > 7`. */
export type Cmp = '>' | '>=' | '<' | '<=';

export interface Term {
  kind: TermKind;
  op: TermOp;
  /** Alternatives. Entities by node id, groups by key, sets by id; a
   *  meaning's phrases; the rest as text. */
  values: string[];
  /** A value term's field path (`sentiment`, `topics[*]`). */
  field?: string;
  /** A value term comparing the number at `field` to its one value, instead
   *  of matching it — the documents where it passes. */
  cmp?: Cmp;
  /** A value term read as a degree — the number at `field`, no values. */
  measure?: boolean;
  /** A graded term held to a band of its degree, 0…1 both ends in — a
   *  stratum of the scale (`fields.bandsOf`); its one value is the band's
   *  name, for reading. */
  range?: [number, number];
  /** A meaning read from the documents (1), from the nodes' own names (0),
   *  or both blended (`fields.foldMeaning`); ½ when unset. */
  basis?: number;
  /** How much a graded term counts (`fields.strength`): 0 not at all, 1 as
   *  it reads, 2 decisively. 1 when unset. */
  strength?: number;
  /** A meaning made of nodes, by id: the centroid of the documents mostly
   *  about them (`rooms.roomDocuments`) — one more alternative beside the
   *  phrases. A held room's snapshot. */
  like?: string[];
}

/** A term that says something: values to match, a number to read, nodes a
 *  meaning is like, or a room to look inside. */
export const isLive = (t: Term) => t.values.length > 0 || !!t.measure || !!t.like?.length || t.kind === 'region';
/** A term that reads a degree rather than a match. */
export const graded = (t: Term) => !!t.measure || t.kind === 'about';
/** A meaning's reach as a band of its rank: the closest `share` of the
 *  nodes. */
export const reachRange = (share: number): [number, number] => [Math.max(0, 1 - share), 1];
/** Where a new meaning reaches: the closest tenth. */
export const REACH = 0.1;

export interface NodeSet {
  id: string;
  /** The reader's name for it; unset reads its terms. */
  name?: string;
  terms: Term[];
  /** −1 … +1 (`gain.ts`); placed, also how hard it pulls. */
  gain?: number;
  /** Shown alone — with any other set shown alone. */
  only?: boolean;
  /** With a degree: drawn as ground, and placed along it — deep in time its
   *  members rise toward their value by the set's gain; on the flat
   *  timeline they take lanes by value (`surface.ts`, `anchoring.ts`). */
  ground?: boolean;
  /** Where it anchors, per space — a set can stand on the map and among the
   *  groups at once: a point, or a room around it (`rooms.ts`). In `time`, a
   *  point's y alone is its own — a lane. */
  at?: Partial<Record<AnchorSpace, Place>>;
  /** "Itself ↔ and what it touches", 0…1: how strongly what links to its
   *  members comes along when it pulls or is turned up (`haloOf`). `SPREAD`
   *  when unset. */
  spread?: number;
}

/** What the network does not carry, and the network underneath. */
export interface SetWorld {
  net: Network;
  /** A top-level group's members. */
  groupMembers: (key: string) => readonly number[] | undefined;
  /** The assets a value term finds; undefined while they load. */
  valueAssets: (term: Term) => ReadonlySet<number> | undefined;
  /** A graded term's field over the network; undefined while it loads. */
  weights?: (term: Term) => Field | undefined;
  /** What is drawn inside a set's room in the shown view, over the network:
   *  null where it has no room, undefined until it is read. */
  inside?: (set: string) => Uint8Array | null | undefined;
}

export interface SetResult {
  /** Base nodes, most frequent first. */
  members: number[];
  /** A value term is still loading — the members are provisional. */
  pending: boolean;
  /** With a graded term: the degree per node over the network, NaN outside
   *  the set. Absent: every member counts fully. */
  weight?: Field;
}

export const OPS: readonly TermOp[] = ['=', '~', '!'];
/** `~` is written `∗` — loosely, as a wildcard reads; `~` in what is typed
 *  is a meaning (`≈`), as in the queries (`dialect.ts`). */
export const OP_GLYPH: Record<TermOp, string> = { '=': '=', '~': '∗', '!': '≠' };
export const CMPS: readonly Cmp[] = ['>', '>=', '<', '<='];
export const CMP_GLYPH: Record<Cmp, string> = { '>': '>', '>=': '≥', '<': '<', '<=': '≤' };
/** The next operator, as a click on it turns. A degree is had or taken
 *  away — there is no "loosely" to a score. */
export const nextOp = (op: TermOp, isGraded = false): TermOp =>
  isGraded ? (op === '!' ? '=' : '!') : OPS[(OPS.indexOf(op) + 1) % OPS.length];

/** The hues sets are drawn in — apart from the groups' own. */
export const SET_HUES = ['#e8590c', '#0ca678', '#7048e8', '#d6336c', '#1c7ed6', '#f59f00', '#2b8a3e', '#862e9c'];
export const setHue = (k: number) => SET_HUES[k % SET_HUES.length];

// ─── Reading the network ────────────────────────────────────────────────────

export const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
const foldedNames = new WeakMap<Network, string[]>();
const foldedPlaces = new WeakMap<Network, string[]>();
function namesOf(net: Network): string[] {
  let out = foldedNames.get(net);
  if (!out) foldedNames.set(net, (out = net.name.map(fold)));
  return out;
}
function placeNamesOf(net: Network): string[] {
  let out = foldedPlaces.get(net);
  if (!out) foldedPlaces.set(net, (out = net.coordNames.map(fold)));
  return out;
}

/** The mask plus everything linked to it. */
function widen(net: Network, mask: Uint8Array): Uint8Array {
  const out = Uint8Array.from(mask);
  for (let i = 0; i < net.size; i++) {
    if (!mask[i]) continue;
    for (let k = net.adjOffsets[i]; k < net.adjOffsets[i + 1]; k++) out[net.adjNodes[k]] = 1;
  }
  return out;
}

/** Whether text matches any value: equal, or — loosely — containing it. */
function texts(values: readonly string[], loose: boolean): (s: string) => boolean {
  const vs = values.map(fold).filter(Boolean);
  return loose ? (s) => vs.some((v) => s.includes(v)) : (s) => vs.includes(s);
}

/** The nodes one term of set `owner` names, `!` read as `=` (the set takes
 *  them away). */
function termMask(
  term: Term, world: SetWorld, setMask: (id: string) => Uint8Array | null, owner: string,
): Uint8Array | null {
  const { net } = world;
  const mask = new Uint8Array(net.size);
  const loose = term.op === '~';
  switch (term.kind) {
    case 'type': {
      const hit = texts(term.values, loose);
      const ok = net.types.map((t) => hit(fold(t || 'unknown')));
      for (let i = 0; i < net.size; i++) if (ok[net.type[i]]) mask[i] = 1;
      return mask;
    }
    case 'name': {
      const hit = texts(term.values, loose);
      const names = namesOf(net);
      for (let i = 0; i < net.size; i++) if (hit(names[i])) mask[i] = 1;
      return mask;
    }
    case 'place': {
      const hit = texts(term.values, loose);
      const ok = placeNamesOf(net).map(hit);
      for (let i = 0; i < net.size; i++) {
        for (let k = net.placeOffsets[i]; k < net.placeOffsets[i + 1]; k++) {
          if (ok[net.placeCoord[k]]) { mask[i] = 1; break; }
        }
      }
      return mask;
    }
    case 'entity': {
      for (const id of term.values) {
        const i = net.index.get(id);
        if (i !== undefined) mask[i] = 1;
      }
      return loose ? widen(net, mask) : mask;
    }
    case 'group': {
      for (const key of term.values) for (const i of world.groupMembers(key) ?? []) mask[i] = 1;
      return loose ? widen(net, mask) : mask;
    }
    case 'set': {
      for (const id of term.values) {
        const m = setMask(id);
        if (m) for (let i = 0; i < net.size; i++) if (m[i]) mask[i] = 1;
      }
      return loose ? widen(net, mask) : mask;
    }
    case 'value': {
      const assets = world.valueAssets(term);
      if (!assets) return null;
      for (let i = 0; i < net.size; i++) {
        for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) {
          const a = net.assetOf.get(net.annIds[k]);
          if (a !== undefined && assets.has(a)) { mask[i] = 1; break; }
        }
      }
      return mask;
    }
    case 'region': {
      const m = world.inside ? world.inside(owner) : null;
      if (m === undefined) return null;
      if (m) mask.set(m);
      return mask;
    }
    case 'about':
      return null; // graded: read as a field, never as a mask
  }
}

/** A graded term's field as it counts: raised by its strength — for a ≠,
 *  the amount it takes away, so at 0 it takes nothing. */
function counted(term: Term, w: Field): Field {
  const s = term.strength ?? 1;
  if (s === 1) return w;
  if (term.op !== '!') return raise(w, s);
  const out = new Float32Array(w.length);
  for (let i = 0; i < w.length; i++) out[i] = Number.isNaN(w[i]) ? NaN : 1 - (s === 0 ? 1 : Math.pow(1 - w[i], s));
  return out;
}

/**
 * Every set's members. A set naming itself, or a set that names it, reads as
 * empty at the point of the loop — never forever.
 */
export function evaluateSets(sets: readonly NodeSet[], world: SetWorld): Map<string, SetResult> {
  const { net } = world;
  const byId = new Map(sets.map((s) => [s.id, s]));
  const masks = new Map<string, { mask: Uint8Array; pending: boolean; weight?: Field }>();
  const visiting = new Set<string>();

  const solve = (id: string): { mask: Uint8Array; pending: boolean; weight?: Field } | null => {
    const done = masks.get(id);
    if (done) return done;
    const set = byId.get(id);
    if (!set || visiting.has(id)) return null;
    visiting.add(id);
    let pending = false;
    const setMask = (ref: string) => {
      const r = solve(ref);
      if (r?.pending) pending = true;
      return r?.mask ?? null;
    };
    let keep: Uint8Array | null = null;
    const drop = new Uint8Array(net.size);
    let weight: Field | null = null;
    const less: Field[] = [];
    for (const term of set.terms) {
      if (!isLive(term)) continue;
      if (graded(term)) {
        // Graded: a degree, not a match. Its members are the nodes it can
        // judge; a ≠ subtracts by degree instead of cutting.
        const w = world.weights?.(term);
        if (!w) { pending = true; continue; }
        if (term.op === '!' && term.range) {
          // ≠ a band: those in it are taken away, the rest stand as they are.
          const [lo, hi] = term.range;
          for (let i = 0; i < net.size; i++) if (!Number.isNaN(w[i]) && w[i] >= lo && w[i] <= hi) drop[i] = 1;
          continue;
        }
        if (term.op === '!') { less.push(counted(term, w)); continue; }
        const m = new Uint8Array(net.size);
        const [lo, hi] = term.range ?? [-Infinity, Infinity];
        for (let i = 0; i < net.size; i++) m[i] = !Number.isNaN(w[i]) && w[i] >= lo && w[i] <= hi ? 1 : 0;
        if (!keep) keep = m;
        else for (let i = 0; i < net.size; i++) keep[i] &= m[i];
        const c = counted(term, w);
        weight = weight ? and(weight, c) : c;
        continue;
      }
      const m = termMask(term, world, setMask, id);
      if (!m) { pending = true; continue; }
      if (term.op === '!') {
        for (let i = 0; i < net.size; i++) if (m[i]) drop[i] = 1;
      } else if (!keep) {
        keep = m;
      } else {
        for (let i = 0; i < net.size; i++) keep[i] &= m[i];
      }
    }
    const positive = set.terms.some((t) => t.op !== '!' && isLive(t));
    const hasAny = set.terms.some(isLive);
    const mask = new Uint8Array(net.size);
    if (hasAny) {
      // Only ≠: everything but. A positive term still loading: nothing yet.
      for (let i = 0; i < net.size; i++) mask[i] = (keep ? keep[i] : positive ? 0 : 1) && !drop[i] ? 1 : 0;
    }
    if (less.length) {
      // Degrees taken away: from the set's own, or from full for a plain set.
      const plain = !weight;
      let w: Field = weight ?? new Float32Array(net.size).fill(1);
      for (const b of less) w = butNot(w, b);
      if (plain) {
        // A plain set has no degree of its own: where no ≠ can judge a
        // member, its weight is unknown — not full, or it would stand on
        // the ridge for a score it does not have.
        for (let i = 0; i < net.size; i++) if (less.every((b) => Number.isNaN(b[i]))) w[i] = NaN;
      }
      weight = w;
    }
    let field: Field | undefined;
    if (weight) {
      field = new Float32Array(net.size).fill(NaN);
      for (let i = 0; i < net.size; i++) if (mask[i]) field[i] = weight[i];
    }
    visiting.delete(id);
    const out = { mask, pending, weight: field };
    masks.set(id, out);
    return out;
  };

  const results = new Map<string, SetResult>();
  for (const s of sets) {
    const r = solve(s.id)!;
    const members: number[] = [];
    for (let i = 0; i < net.size; i++) if (r.mask[i]) members.push(i);
    members.sort((a, b) => net.frequency[b] - net.frequency[a]);
    results.set(s.id, r.weight ? { members, pending: r.pending, weight: r.weight } : { members, pending: r.pending });
  }
  return results;
}

/** One term's say about one node: 1 or 0 for a match, the degree for a
 *  graded term as it counts (its strength applied), null where the term
 *  cannot judge it (no basis, or still loading). */
export interface TermReading {
  term: Term;
  value: number | null;
}

/**
 * Why a node is in a set, and how much: each term's reading of it, in the
 * set's own order. The product of the positive readings, with each ≠ taken
 * away, is the node's weight (`SetResult.weight`) — the function read back
 * as an explanation, never typed. `resultOf` answers `set` terms from the
 * sets already evaluated.
 */
export function explainNode(
  set: NodeSet, node: number, world: SetWorld, resultOf: (id: string) => SetResult | undefined,
): TermReading[] {
  const setMask = (id: string) => {
    const r = resultOf(id);
    if (!r) return null;
    const m = new Uint8Array(world.net.size);
    for (const i of r.members) m[i] = 1;
    return m;
  };
  return set.terms.filter(isLive).map((term) => {
    if (graded(term)) {
      const field = world.weights?.(term);
      const w = field?.[node];
      if (w === undefined || Number.isNaN(w)) return { term, value: null };
      const [lo, hi] = term.range ?? [-Infinity, Infinity];
      if (term.range && (w < lo || w > hi)) return { term, value: 0 };
      return { term, value: counted(term, Float32Array.of(w))[0] };
    }
    const m = termMask(term, world, setMask, set.id);
    return { term, value: m ? m[node] : null };
  });
}

/** A set's spread when unset — what its anchor pulled its neighbours at
 *  before spread was a dial (0.35 of 0.85). */
export const SPREAD = 0.4;

/**
 * A set's halo (`fields.spread`): its members at their degree — full for a
 * plain set — and what they link to at the set's spread. What a pull and a
 * gain reach with; the set's own weight stays its members'.
 */
export function haloOf(net: Network, set: NodeSet, result: SetResult): Field {
  let degree = result.weight;
  if (!degree) {
    degree = absent(net.size);
    for (const i of result.members) degree[i] = 1;
  }
  return spread(net, degree, set.spread ?? SPREAD);
}

// ─── Editing ────────────────────────────────────────────────────────────────

const sameFacet = (a: Term, b: Term) =>
  a.kind === b.kind && a.op === b.op && (a.field ?? '') === (b.field ?? '') && !!a.measure === !!b.measure
  && !a.cmp && !b.cmp
  && (a.range ?? []).join() === (b.range ?? []).join() && (a.basis ?? 0.5) === (b.basis ?? 0.5)
  && !!a.like === !!b.like;

/** A term added to a set: its values join a term of the same facet as
 *  alternatives — or, `apart`, it narrows as a term of its own. */
export function addTerm(set: NodeSet, term: Term, apart = false): NodeSet {
  const k = apart ? -1 : set.terms.findIndex((t) => sameFacet(t, term));
  if (k < 0) return { ...set, terms: [...set.terms, { ...term, values: [...new Set(term.values)] }] };
  const terms = set.terms.slice();
  terms[k] = { ...terms[k], values: [...new Set([...terms[k].values, ...term.values])] };
  return { ...set, terms };
}

/** The set without one of a term's values — without the term once it is
 *  empty. */
export function dropValue(set: NodeSet, termIndex: number, value: string): NodeSet {
  const terms = set.terms
    .map((t, k) => {
      if (k !== termIndex) return t;
      // A degree or a room's inside has no value of its own to drop one of:
      // dropping is taking it off. So is a snapshot with no phrase beside it.
      if (t.measure || t.kind === 'region') return null;
      if (!t.values.includes(value)) return t.values.length ? t : null;
      return { ...t, values: t.values.filter((v) => v !== value) };
    })
    .filter((t): t is Term => !!t && isLive(t));
  return { ...set, terms };
}

export const newSetId = () => `s${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`;

/** A field path's last readable segment — `document.topics[*]` → `topics`. */
export const fieldLabel = (path: string) => path.split('.').pop()!.replace('[*]', '');

/** A term in a few words; `nameOf` turns an entity, group or set id into its
 *  name. */
export function describeTerm(term: Term, nameOf: (kind: TermKind, value: string) => string): string {
  if (term.kind === 'region') return term.op === '!' ? 'outside the room' : 'inside the room';
  if (term.kind === 'about') {
    const said = [...term.values, ...(term.like?.length ? [likeLabel(term.like.length)] : [])];
    const what = `${term.op === '!' ? '≠≈' : '≈'} ${said.join(' / ')}`;
    return term.range ? `${what}, ${reachLabel(term.range)}` : what;
  }
  if (term.measure) {
    const what = fieldLabel(term.field ?? '');
    if (term.range) return `${what} ${term.op === '!' ? '≠ ' : ''}${term.values[0] ?? ''}`.trim();
    return `${term.op === '!' ? 'less ' : ''}${what}, by score`;
  }
  const what = term.kind === 'value' ? fieldLabel(term.field ?? '')
    : term.kind === 'entity' ? '' : term.kind;
  if (term.cmp) return `${what} ${term.op === '!' ? 'not ' : ''}${CMP_GLYPH[term.cmp]} ${term.values[0] ?? ''}`.trim();
  const op = term.kind === 'entity' && term.op === '=' ? '' : OP_GLYPH[term.op];
  const values = term.values.map((v) => nameOf(term.kind, v)).join(', ');
  return [what, op, values].filter(Boolean).join(' ');
}

/** A snapshot in words — `like 74 nodes`. */
export const likeLabel = (n: number) => `like ${n.toLocaleString()} node${n === 1 ? '' : 's'}`;

/** A band of a meaning's rank in words — `closest 10%`, `30–50%`. */
export function reachLabel([lo, hi]: readonly [number, number]): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return hi >= 1 ? `closest ${pct(1 - lo)}` : `${pct(1 - hi)}–${pct(1 - lo)} from the closest`;
}

export function describeSet(set: NodeSet, nameOf: (kind: TermKind, value: string) => string): string {
  if (set.name) return set.name;
  return set.terms.map((t) => describeTerm(t, nameOf)).join(' · ') || 'New set';
}

// ─── Older panels ───────────────────────────────────────────────────────────

/** An anchor as the first anchors were saved — a line of words — read as a
 *  set: `type:Person` a type term, the rest a name it contains. */
export function fromWords(a: { id: string; q: string; space: AnchorSpace; x: number; y: number; gain?: number }): NodeSet {
  const types: string[] = [];
  const text = a.q.replace(/\btype:(?:"([^"]+)"|(\S+))/gi, (_, quoted, bare) => {
    types.push(quoted ?? bare);
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  const terms: Term[] = [];
  if (types.length) terms.push({ kind: 'type', op: '=', values: types });
  if (text) terms.push({ kind: 'name', op: '~', values: [text] });
  return { id: a.id, terms, gain: a.gain, at: { [a.space]: [a.x, a.y] } };
}
