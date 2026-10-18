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
 * Pure: a set and the network in, base node indices out. Value terms are the
 * one thing the network does not carry — the documents' annotations — and
 * arrive from outside as asset ids (`SetWorld.valueAssets`).
 */
import type { AnchorSpace } from './anchoring';
import type { Network } from './network';

export type TermKind = 'type' | 'name' | 'entity' | 'group' | 'place' | 'set' | 'value';
/** `=` is, `~` loosely, `!` is not. */
export type TermOp = '=' | '~' | '!';

export interface Term {
  kind: TermKind;
  op: TermOp;
  /** Alternatives. Entities by node id, groups by key, sets by id; the rest
   *  as text. */
  values: string[];
  /** A value term's field path (`sentiment`, `topics[*]`). */
  field?: string;
}

export interface NodeSet {
  id: string;
  /** The reader's name for it; unset reads its terms. */
  name?: string;
  terms: Term[];
  /** −1 … +1 (`gain.ts`); placed, also how hard it pulls. */
  gain?: number;
  /** Shown alone — with any other set shown alone. */
  only?: boolean;
  /** Where it anchors, per space — a set can stand on the map and among the
   *  groups at once. In `time`, only y is the anchor's own. */
  at?: Partial<Record<AnchorSpace, [number, number]>>;
}

/** What the network does not carry, and the network underneath. */
export interface SetWorld {
  net: Network;
  /** A top-level group's members. */
  groupMembers: (key: string) => readonly number[] | undefined;
  /** The assets a value term finds; undefined while they load. */
  valueAssets: (term: Term) => ReadonlySet<number> | undefined;
}

export interface SetResult {
  /** Base nodes, most frequent first. */
  members: number[];
  /** A value term is still loading — the members are provisional. */
  pending: boolean;
}

export const OPS: readonly TermOp[] = ['=', '~', '!'];
export const OP_GLYPH: Record<TermOp, string> = { '=': '=', '~': '~', '!': '≠' };
/** The next operator, as a click on it turns. */
export const nextOp = (op: TermOp): TermOp => OPS[(OPS.indexOf(op) + 1) % OPS.length];

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

/** The nodes one term names, `!` read as `=` (the set takes them away). */
function termMask(term: Term, world: SetWorld, setMask: (id: string) => Uint8Array | null): Uint8Array | null {
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
  }
}

/**
 * Every set's members. A set naming itself, or a set that names it, reads as
 * empty at the point of the loop — never forever.
 */
export function evaluateSets(sets: readonly NodeSet[], world: SetWorld): Map<string, SetResult> {
  const { net } = world;
  const byId = new Map(sets.map((s) => [s.id, s]));
  const masks = new Map<string, { mask: Uint8Array; pending: boolean }>();
  const visiting = new Set<string>();

  const solve = (id: string): { mask: Uint8Array; pending: boolean } | null => {
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
    for (const term of set.terms) {
      if (!term.values.length) continue;
      const m = termMask(term, world, setMask);
      if (!m) { pending = true; continue; }
      if (term.op === '!') {
        for (let i = 0; i < net.size; i++) if (m[i]) drop[i] = 1;
      } else if (!keep) {
        keep = m;
      } else {
        for (let i = 0; i < net.size; i++) keep[i] &= m[i];
      }
    }
    const positive = set.terms.some((t) => t.op !== '!' && t.values.length);
    const hasAny = set.terms.some((t) => t.values.length);
    const mask = new Uint8Array(net.size);
    if (hasAny) {
      // Only ≠: everything but. A positive term still loading: nothing yet.
      for (let i = 0; i < net.size; i++) mask[i] = (keep ? keep[i] : positive ? 0 : 1) && !drop[i] ? 1 : 0;
    }
    visiting.delete(id);
    const out = { mask, pending };
    masks.set(id, out);
    return out;
  };

  const results = new Map<string, SetResult>();
  for (const s of sets) {
    const r = solve(s.id)!;
    const members: number[] = [];
    for (let i = 0; i < net.size; i++) if (r.mask[i]) members.push(i);
    members.sort((a, b) => net.frequency[b] - net.frequency[a]);
    results.set(s.id, { members, pending: r.pending });
  }
  return results;
}

/** What links to the members and is not one — what an anchor pulls lightly. */
export function around(net: Network, members: readonly number[], limit = 1600): number[] {
  const inSet = new Set(members);
  const near = new Set<number>();
  for (const i of members) {
    for (let k = net.adjOffsets[i]; k < net.adjOffsets[i + 1]; k++) {
      const j = net.adjNodes[k];
      if (!inSet.has(j)) near.add(j);
    }
  }
  return [...near].sort((a, b) => net.frequency[b] - net.frequency[a]).slice(0, limit);
}

// ─── Editing ────────────────────────────────────────────────────────────────

const sameFacet = (a: Term, b: Term) => a.kind === b.kind && a.op === b.op && (a.field ?? '') === (b.field ?? '');

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
    .map((t, k) => (k === termIndex ? { ...t, values: t.values.filter((v) => v !== value) } : t))
    .filter((t) => t.values.length);
  return { ...set, terms };
}

export const newSetId = () => `s${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`;

/** A field path's last readable segment — `document.topics[*]` → `topics`. */
export const fieldLabel = (path: string) => path.split('.').pop()!.replace('[*]', '');

/** A term in a few words; `nameOf` turns an entity, group or set id into its
 *  name. */
export function describeTerm(term: Term, nameOf: (kind: TermKind, value: string) => string): string {
  const what = term.kind === 'value' ? fieldLabel(term.field ?? '')
    : term.kind === 'entity' ? '' : term.kind;
  const op = term.kind === 'entity' && term.op === '=' ? '' : OP_GLYPH[term.op];
  const values = term.values.map((v) => nameOf(term.kind, v)).join(', ');
  return [what, op, values].filter(Boolean).join(' ');
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
