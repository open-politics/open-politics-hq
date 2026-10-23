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
