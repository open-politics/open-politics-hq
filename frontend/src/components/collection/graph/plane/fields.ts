/**
 * Fields — a weight per node that comes in degrees.
 *
 * A set gives every node a 1 or a 0. A field gives it a degree: how high its
 * documents score on a 1–10 scale, how close it reads to a meaning. Gain,
 * light, pulls and surfaces each turn a field into a picture, so any field
 * works with any reader in any view (`docs/plans/meaning/PLAN.md`, *The
 * panel's algebra*).
 *
 * A field is a `Float32Array` over the network's nodes, in 0…1, with `NaN`
 * where a node has no basis. **Absent is never zero**: a node whose documents
 * carry no score is not a node that scores low, and every operation below
 * keeps the two apart.
 */
import type { View } from './collapse';
import type { Network } from './network';

export type Field = Float32Array;

/** Weights keyed by annotation id, as `/network/weigh` sends them: listed
 *  ids have a basis, every other annotation is absent. */
export interface WeightColumn {
  ids: readonly number[];
  weights: readonly number[];
}

/** A field with no basis anywhere. */
export const absent = (n: number): Field => new Float32Array(n).fill(NaN);

/**
 * Per-annotation weights onto the nodes they produced: a node's weight is the
 * mean over those of its annotations that have one, skipping the rest — never
 * counting them as zero. A node none of whose annotations has a basis is NaN.
 */
export function foldAnnotations(net: Network, column: WeightColumn): Field {
  const byAnn = new Map<number, number>();
  for (let i = 0; i < column.ids.length; i++) byAnn.set(column.ids[i], column.weights[i]);
  const out = absent(net.size);
  for (let n = 0; n < net.size; n++) {
    let sum = 0;
    let k = 0;
    for (let j = net.annOffsets[n]; j < net.annOffsets[n + 1]; j++) {
      const w = byAnn.get(net.annIds[j]);
      if (w === undefined || Number.isNaN(w)) continue;
      sum += w;
      k++;
    }
    if (k) out[n] = sum / k;
  }
  return out;
}

/** Weights per array element: the annotation, the entity the element
 *  names, the weight — `/network/weigh`'s `element` column. */
export interface ElementColumn {
  annotation: readonly number[];
  name: readonly string[];
  weights: readonly number[];
}

const foldName = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Per-element weights onto the entities they name: a node's weight is the
 * mean over the elements, in its own annotations, that name it — an actor's
 * stance from the rows where it is that actor's. Nodes no element names are
 * absent: a score that belongs to actors says nothing about the places and
 * documents beside them.
 */
export function foldElements(net: Network, column: ElementColumn): Field {
  const byKey = new Map<string, { sum: number; k: number }>();
  for (let i = 0; i < column.annotation.length; i++) {
    const w = column.weights[i];
    if (Number.isNaN(w)) continue;
    const key = `${column.annotation[i]}\u0001${foldName(column.name[i])}`;
    const acc = byKey.get(key) ?? { sum: 0, k: 0 };
    acc.sum += w;
    acc.k++;
    byKey.set(key, acc);
  }
  const out = absent(net.size);
  for (let n = 0; n < net.size; n++) {
    const name = foldName(net.name[n] ?? '');
    let sum = 0;
    let k = 0;
    for (let j = net.annOffsets[n]; j < net.annOffsets[n + 1]; j++) {
      const acc = byKey.get(`${net.annIds[j]}\u0001${name}`);
      if (!acc) continue;
      sum += acc.sum / acc.k;
      k++;
    }
    if (k) out[n] = sum / k;
  }
  return out;
}

/** A field from what `/network/weigh` sends: by element where the score
 *  belongs to the entities in an array, by annotation otherwise. */
export function foldWeights(
  net: Network,
  w: { annotation: WeightColumn; element?: ElementColumn | null },
): Field {
  return w.element && w.element.annotation.length ? foldElements(net, w.element) : foldAnnotations(net, w.annotation);
}

/** Weights per name — `about`'s *said* basis: a node takes its own name's. */
export interface LabelColumn {
  names: readonly string[];
  weights: readonly number[];
}

/**
 * A meaning onto the nodes (`about`), on two bases blended by `basis`: what
 * a node's documents say — *context*, its annotations' column folded — and
 * what its own name says — *said*, by name. `basis` 0 reads the name alone,
 * 1 the documents alone. A node with one basis reads that one: a missing
 * side is left out of its blend, never counted as zero.
 */
export function foldMeaning(
  net: Network,
  w: { annotation: WeightColumn; label?: LabelColumn | null },
  basis: number,
): Field {
  const context = foldAnnotations(net, w.annotation);
  if (!w.label?.names.length) return context;
  const said = new Map<string, number>();
  for (let i = 0; i < w.label.names.length; i++) said.set(w.label.names[i], w.label.weights[i]);
  const b = Math.min(1, Math.max(0, basis));
  const out = absent(net.size);
  for (let n = 0; n < net.size; n++) {
    const c = context[n];
    const s = said.get(net.name[n]?.trim() ?? '');
    const hasC = !Number.isNaN(c);
    const hasS = s !== undefined && !Number.isNaN(s);
    if (hasC && hasS) out[n] = (1 - b) * s + b * c;
    else if (hasC && b > 0) out[n] = c;
    else if (hasS && b < 1) out[n] = s;
  }
  return out;
}

/**
 * Each known weight as its rank share among the known, 0…1 — ties sharing
 * their mean rank, a single one at 1. What makes a meaning's reach read "the
 * closest tenth of the nodes" whatever its similarities run to; absent stays
 * absent.
 */
export function ranked(field: Field): Field {
  const known: number[] = [];
  for (let i = 0; i < field.length; i++) if (!Number.isNaN(field[i])) known.push(i);
  known.sort((a, b) => field[a] - field[b]);
  const out = absent(field.length);
  const n = known.length;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && field[known[j + 1]] === field[known[i]]) j++;
    const share = n === 1 ? 1 : (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) out[known[k]] = share;
    i = j + 1;
  }
  return out;
}

/**
 * A field over the base network as the view draws it: a drawn node standing
 * for several (a collapsed group) weighs the mean of its members that have a
 * basis — absent when none has.
 */
export function onView(view: View, field: Field): Field {
  const out = absent(view.net.size);
  for (let u = 0; u < view.net.size; u++) {
    let sum = 0;
    let k = 0;
    for (let j = view.memberOffsets[u]; j < view.memberOffsets[u + 1]; j++) {
      const w = field[view.memberIds[j]];
      if (Number.isNaN(w)) continue;
      sum += w;
      k++;
    }
    if (k) out[u] = sum / k;
  }
  return out;
}

// ─── Combining ───────────────────────────────────────────────────────────────
// Where "absent, never zero" holds or leaks. Each rule says what an unknown
// operand does, because each answers a different question.

/** And: how much a node is all of these. Unknown if any operand is — a node
 *  cannot be judged on a term it has no basis for. */
export function and(...fields: Field[]): Field {
  const n = fields[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 1;
    for (const f of fields) v *= f[i]; // NaN propagates
    out[i] = v;
  }
  return out;
}

/** Or: how much a node is any of these — the most of what is known. Unknown
 *  only when every operand is. */
export function or(...fields: Field[]): Field {
  const n = fields[0]?.length ?? 0;
  const out = absent(n);
  for (let i = 0; i < n; i++) {
    for (const f of fields) {
      const v = f[i];
      if (!Number.isNaN(v) && !(out[i] >= v)) out[i] = v;
    }
  }
  return out;
}

/** But not: `a · (1 − b)`. Where `b` is unknown, `a` stands — what is not
 *  known cannot be taken away. */
export function butNot(a: Field, b: Field): Field {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Number.isNaN(b[i]) ? a[i] : a[i] * (1 - b[i]);
  return out;
}

/** Strength: `a^s`. Above 1 a term grows decisive, below 1 forgiving; at 0 it
 *  is neutral — 1, not 0, so switching a term off never empties a set.
 *  Unknown stays unknown. */
export function strength(a: Field, s: number): Field {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Number.isNaN(a[i]) ? NaN : s === 0 ? 1 : Math.pow(a[i], s);
  return out;
}

/**
 * Spread: a set's halo — "itself ↔ and what it touches". Members stand at
 * their own degree (`degree`, NaN outside the set); a node outside that
 * links to members stands at `k` times the most it touches; the rest are
 * absent. A halo, never the set's weight: what readers that reach past the
 * set (a pull, a gain) take, while its members, strata, ground and *why*
 * read the set alone — a stance says nothing about the places beside the
 * actor.
 */
export function spread(net: Network, degree: Field, k: number): Field {
  const out = Float32Array.from(degree);
  if (k <= 0) return out;
  for (let i = 0; i < net.size; i++) {
    if (!Number.isNaN(degree[i])) continue;
    let most = NaN;
    for (let e = net.adjOffsets[i]; e < net.adjOffsets[i + 1]; e++) {
      const w = degree[net.adjNodes[e]];
      if (!Number.isNaN(w) && !(most >= w)) most = w;
    }
    if (!Number.isNaN(most)) out[i] = k * most;
  }
  return out;
}

/** How many nodes have a basis, and the range they span. */
export function extent(field: Field): { known: number; lo: number; hi: number } {
  let known = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of field) {
    if (Number.isNaN(v)) continue;
    known++;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return known ? { known, lo, hi } : { known, lo: NaN, hi: NaN };
}

// ─── Strata ──────────────────────────────────────────────────────────────────

/** A band of a field's degree, both ends in, and its name in the field's own
 *  units. */
export interface Band {
  lo: number;
  hi: number;
  label: string;
}

/** How a field's weights were read (`/network/weigh`'s `scale`). */
export interface Scale {
  by: 'declared' | 'rank' | 'threshold' | 'none' | string;
  min?: number | null;
  max?: number | null;
}

/**
 * The strata of a scale, lowest first — what a landscape is taken apart by.
 * A declared scale of a few whole steps (1–10) is cut in pairs of its own
 * steps, named in them (`9–10`); a longer or fractional one in fifths, named
 * by its values; a ranked field in fifths of the run (`top fifth`).
 */
export function bandsOf(scale: Scale | null | undefined, count = 5): Band[] {
  const fifths = (name: (k: number) => string): Band[] =>
    Array.from({ length: count }, (_, k) => ({ lo: k / count, hi: (k + 1) / count, label: name(k) }));
  if (scale?.by === 'declared' && scale.min != null && scale.max != null && scale.max > scale.min) {
    const { min, max } = scale;
    const steps = max - min;
    const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    if (Number.isInteger(min) && Number.isInteger(max) && steps + 1 <= 2 * count + 1) {
      // Whole steps, a pair to a band: 1–2, 3–4, … — the last takes what is
      // left. Edges sit half a step out, so the bands meet: a mean of 2.5 (a
      // node's documents scoring 2 and 3) lies in one, never between.
      const at = (v: number) => Math.min(1, Math.max(0, (v - min) / steps));
      const out: Band[] = [];
      for (let v = min; v <= max; v += 2) {
        const top = Math.min(max, v + 1);
        out.push({ lo: at(v - 0.5), hi: at(top + 0.5), label: top === v ? fmt(v) : `${fmt(v)}–${fmt(top)}` });
      }
      return out;
    }
    return fifths((k) => `${fmt(min + (k / count) * steps)}–${fmt(min + ((k + 1) / count) * steps)}`);
  }
  const names = ['bottom fifth', 'lower fifth', 'middle fifth', 'upper fifth', 'top fifth'];
  return fifths((k) => (count === 5 ? names[k] : `${k + 1} of ${count}`));
}

/** How many nodes stand in each band — a node whose weight lies between two
 *  bands' ends counts in the one whose range holds it, lower first. */
export function strata(field: Field, bands: readonly Band[]): number[] {
  const out = bands.map(() => 0);
  for (const w of field) {
    if (Number.isNaN(w)) continue;
    const k = bands.findIndex((b) => w >= b.lo - 1e-6 && w <= b.hi + 1e-6);
    if (k >= 0) out[k]++;
  }
  return out;
}
