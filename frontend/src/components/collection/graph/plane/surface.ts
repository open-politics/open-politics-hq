/**
 * Surfaces — a field drawn as ground.
 *
 * A field (`fields.ts`) says how much of something each node is: how high its
 * documents score on a 1–10 scale, how close it reads to a meaning. A surface
 * draws that as terrain over the plane — ridges where the high-scoring nodes
 * stand, valleys where the low ones do, nothing where nothing is known — and
 * lets the nodes rise to it.
 *
 * Deep time first, where the view has a height to give: x stays the groups'
 * layout, depth stays time, and the value becomes height within each slice.
 * The ground then runs across the layout and back through time — a landscape
 * of the scale, read as the run goes on.
 *
 *   lift      each node's height eased from its layout toward its value —
 *             the reader's weight says how far (`towardField`)
 *   ground    per slice, the field's kernel-weighted mean over x, smoothed a
 *             little through time; a cell with too little under it is no
 *             ground at all (`surfaceGrid`)
 *
 * The ground is measured from the lifted positions, so at full weight the
 * nodes stand on it. Pure; plane space in, plane space out.
 */
import type { Field } from './fields';
import type { Presence } from './presence';

/** Where a field's 0 and 1 lie on the plane's height. */
export interface Span {
  /** Plane y at weight 0 — the valley floor. */
  lo: number;
  /** Plane y at weight 1 — the ridge. */
  hi: number;
}

/** The height of a weight on the span. */
export const heightOf = (w: number, span: Span) => span.lo + w * (span.hi - span.lo);

/**
 * Positions with each node's height eased toward its value: `s` 0 leaves the
 * layout as it is, 1 stands every node on its value. A node without a basis
 * keeps its layout height — it has nowhere to rise to.
 */
export function towardField(pos: Float32Array, field: Field, span: Span, s: number): Float32Array {
  const out = Float32Array.from(pos);
  if (s <= 0) return out;
  const t = Math.min(1, s);
  for (let i = 0; i < field.length; i++) {
    const w = field[i];
    if (Number.isNaN(w)) continue;
    const y = pos[2 * i + 1];
    if (!Number.isFinite(y)) continue;
    out[2 * i + 1] = y + t * (heightOf(w, span) - y);
  }
  return out;
}

/** The ground: per slice, a height per column across x. */
export interface Ground {
  /** Columns across x, and where they sit. */
  cols: number;
  x0: number;
  x1: number;
  /** Rows: one per slice, as `Presence.cells`. */
  rows: number;
  /** `rows × cols`, row-major: the weight there, 0…1 — NaN where there is no
   *  ground (too little known under it). */
  height: Float32Array;
  /** `rows × cols`: how much stands under each cell, 0…1 of the most. */
  cover: Float32Array;
}

export interface GroundOptions {
  cols?: number;
  /** Kernel width, in columns. */
  width?: number;
  /** Below this share of the most-covered cell, a cell is no ground. */
  floor?: number;
  /** Through time: how much a slice borrows from its neighbours, 0…0.5. */
  carry?: number;
}

/**
 * The field as ground over the layout's x, slice by slice. Each node present
 * in a slice spreads its weight over nearby columns (a Gaussian kernel); a
 * column's height is the weighted mean of what reaches it, its cover the
 * amount. Absent nodes add nothing — neither weight nor cover.
 */
export function surfaceGrid(
  pos: Float32Array,
  field: Field,
  presence: Presence,
  x0: number,
  x1: number,
  { cols = 48, width = 1.6, floor = 0.06, carry = 0.25 }: GroundOptions = {},
): Ground {
  const rows = presence.cells.length;
  const sum = new Float64Array(rows * cols);
  const mass = new Float64Array(rows * cols);
  const step = (x1 - x0) / Math.max(1, cols - 1);
  const reach = Math.ceil(width * 3);
  const inv = 1 / (2 * width * width);

  for (let i = 0; i < field.length; i++) {
    const w = field[i];
    if (Number.isNaN(w)) continue;
    const x = pos[2 * i];
    if (!Number.isFinite(x) || step <= 0) continue;
    const c = (x - x0) / step;
    const from = Math.max(0, Math.floor(c - reach));
    const to = Math.min(cols - 1, Math.ceil(c + reach));
    for (let k = presence.offsets[i]; k < presence.offsets[i + 1]; k++) {
      const row = presence.slice[k] * cols;
      for (let j = from; j <= to; j++) {
        const d = j - c;
        const g = Math.exp(-d * d * inv);
        sum[row + j] += g * w;
        mass[row + j] += g;
      }
    }
  }

  // A little through time, so a ridge reads as a ridge and not a flicker.
  let s2 = sum, m2 = mass;
  if (carry > 0 && rows > 1) {
    s2 = new Float64Array(sum.length);
    m2 = new Float64Array(mass.length);
    for (let r = 0; r < rows; r++) {
      for (let j = 0; j < cols; j++) {
        const at = r * cols + j;
        let a = (1 - 2 * carry) * sum[at], b = (1 - 2 * carry) * mass[at];
        const up = r > 0 ? at - cols : at, down = r < rows - 1 ? at + cols : at;
        a += carry * (sum[up] + sum[down]);
        b += carry * (mass[up] + mass[down]);
        s2[at] = a;
        m2[at] = b;
      }
    }
  }

  let most = 0;
  for (const m of m2) if (m > most) most = m;
  const height = new Float32Array(rows * cols).fill(NaN);
  const cover = new Float32Array(rows * cols);
  for (let k = 0; k < height.length; k++) {
    const share = most > 0 ? m2[k] / most : 0;
    cover[k] = share;
    if (share >= floor) height[k] = s2[k] / m2[k];
  }
  return { cols, x0, x1, rows, height, cover };
}
