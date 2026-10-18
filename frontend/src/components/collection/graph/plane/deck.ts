/**
 * The deck's reading of the run as a space-time cube — pure, so it can be
 * tested without a GPU (`TimeDeck` draws it).
 *
 * The plate is the groups layout: a node keeps its place at every time, so
 * a region is a topic. Depth is time. On that:
 *
 *   thread    an entity present in neighbouring slices — a line straight back
 *             through the deck, thick where it is loud, broken where it is quiet
 *   point     an occurrence, or an entity seen once — in its slice
 *   flat      a link whose two ends are present in the same slice: a relation
 *             at that time, drawn in that slice
 *   stream    a link whose ends never meet in time — it runs across the depth,
 *             between their nearest presences
 *
 * At the cut (the present, or the slicer's instant) the deck reads change:
 *
 *   onset     a thread begins here — first present now, and still next time
 *   quiet     a thread that ran up to here — present the two slices before,
 *             not now
 *
 * One-off mentions are neither: they would flood both on a busy day.
 */
import type { Network } from './network';
import type { Presence } from './presence';

export const DECK_DEFAULTS = { depth: 0.32, ahead: 3, vanish: [0.3, -0.3] as [number, number] };
/** Slices ahead of the present keep this much light, falling off per slice. */
const AHEAD = 0.42;
/** With a cut: the rest of the window, and the past left in front of it. */
const WINDOW = 0.5;
const PAST = 0.28;
/** Names a slice offers, loudest first — as many as fit are shown. */
export const NAMED_PRESENT = 160;

/** How much light slice k gets with the present's front at f (continuous). */
export function sliceAlpha(k: number, front: number, width: number, falloff = DECK_DEFAULTS.ahead): number {
  const d = k - front;
  if (d < 0) return Math.max(0, 1 + d / 0.8);                 // behind: gone within a slice
  if (d <= width) return 1;
  return AHEAD * Math.exp(-(d - width) / falloff);
}

/** How much light slice k gets with a cut at `cut` (continuous) through a
 *  present from `front` over `width` more slices: the cut's own slice full,
 *  the rest of the window half, the past a trace, what is ahead fading. */
export function cutAlpha(k: number, front: number, width: number, cut: number, falloff = DECK_DEFAULTS.ahead): number {
  const near = Math.max(0, 1 - Math.abs(k - cut));
  const base = k < front ? PAST * Math.exp((k - front) / 1.2)
    : k <= front + width ? WINDOW
      : AHEAD * Math.exp(-(k - front - width) / falloff);
  return Math.max(near, base);
}

export interface DeckData {
  /** Per slice: the nodes present (and shown), and how loudly — parallel. */
  nodes: number[][];
  loud: number[][];
  /** Per slice k: the entities present at k and at k + 1 — a thread's
   *  segment from k into the next slice. */
  threads: number[][];
  /** Per slice: links whose ends are both present there. */
  flat: number[][];
  /** Per slice: links whose ends never meet in time, by their nearer end. */
  streams: number[][];
  /** Per link: the slices a stream runs between, source then target (-1: not
   *  a stream). */
  span: Int32Array;
  /** Per slice: entities worth naming there, loudest first. */
  named: number[][];
  /** Per node: the slice it is first present in, -1 = never (or hidden). */
  first: Int32Array;
  /** Every node drawn somewhere — what the plate spans. */
  drawn: number[];
}

const lists = (n: number): number[][] => Array.from({ length: n }, () => []);

export function deckSlices(net: Network, p: Presence, visible: Uint8Array | null): DeckData {
  const count = p.cells.length;
  const nodes = lists(count), loud = lists(count), threads = lists(count);
  const flat = lists(count), streams = lists(count);
  const first = new Int32Array(net.size).fill(-1);
  const drawn: number[] = [];
  const occurrence = net.kinds.indexOf('occurrence');
  const shown = (i: number) => !visible || !!visible[i];

  for (let i = 0; i < net.size; i++) {
    const a = p.offsets[i], b = p.offsets[i + 1];
    if (a === b || !shown(i)) continue;
    first[i] = p.slice[a];
    drawn.push(i);
    const thread = net.kind[i] !== occurrence;
    for (let q = a; q < b; q++) {
      const k = p.slice[q];
      nodes[k].push(i);
      loud[k].push(p.count[q]);
      if (thread && q + 1 < b && p.slice[q + 1] === k + 1) threads[k].push(i);
    }
  }

  const span = new Int32Array(net.links * 2).fill(-1);
  for (let j = 0; j < net.links; j++) {
    const s = net.source[j], t = net.target[j];
    if (first[s] < 0 || first[t] < 0) continue;
    // Walk both presences together: where they meet the link lies flat;
    // if they never do, it is a stream between their nearest slices.
    let x = p.offsets[s], y = p.offsets[t];
    const xe = p.offsets[s + 1], ye = p.offsets[t + 1];
    let met = false, gap = Infinity, sa = -1, sb = -1;
    while (x < xe && y < ye) {
      const ks = p.slice[x], kt = p.slice[y];
      if (ks === kt) { flat[ks].push(j); met = true; x++; y++; continue; }
      if (!met && Math.abs(ks - kt) < gap) { gap = Math.abs(ks - kt); sa = ks; sb = kt; }
      if (ks < kt) x++; else y++;
    }
    if (!met && sa >= 0) {
      span[2 * j] = sa;
      span[2 * j + 1] = sb;
      streams[Math.min(sa, sb)].push(j);
    }
  }

  const named = nodes.map((ns, k) => ns
    .map((i, q) => ({ i, m: loud[k][q] }))
    .filter(({ i }) => net.kind[i] !== occurrence)
    .sort((a, b) => b.m - a.m || net.frequency[b.i] - net.frequency[a.i])
    .slice(0, NAMED_PRESENT)
    .map(({ i }) => i));

  return { nodes, loud, threads, flat, streams, span, named, first, drawn };
}

/** What changes at slice k: threads that begin there, and threads that ran
 *  up to it and are not there now. */
export function deckChange(d: DeckData, k: number): { onset: number[]; quiet: number[] } {
  if (k < 0 || k >= d.nodes.length) return { onset: [], quiet: [] };
  const onset = d.threads[k].filter((i) => d.first[i] === k);
  // threads[k - 2] ran from k - 2 into k - 1; those not here now went quiet.
  const now = new Set(d.nodes[k]);
  const quiet = k >= 2 ? d.threads[k - 2].filter((i) => !now.has(i)) : [];
  return { onset, quiet };
}

/** Where the drawn nodes lie (0.5–99.5 %), with a margin: the plate. Fixed
 *  across slices, so where things are is comparable from one time to the
 *  next. Sampled — it is asked as often as the layout moves. */
export function deckExtent(pos: Float32Array, nodes: readonly number[]): [number, number, number, number] | null {
  if (!nodes.length) return null;
  const stride = Math.max(1, Math.floor(nodes.length / 8000));
  const xs: number[] = [], ys: number[] = [];
  for (let q = 0; q < nodes.length; q += stride) {
    const i = nodes[q];
    const x = pos[2 * i], y = pos[2 * i + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  if (!xs.length) return null;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (v: number[], t: number) => v[Math.min(v.length - 1, Math.floor(t * v.length))];
  const x0 = q(xs, 0.005), x1 = q(xs, 0.995), y0 = q(ys, 0.005), y1 = q(ys, 0.995);
  const m = Math.max(x1 - x0, y1 - y0, 1) * 0.04;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

/** Where streams from before the cut pass through it — slice coordinates,
 *  continuous — interpolated in the plane: `[x, y, link]` triples. */
export function deckCrossings(net: Network, d: DeckData, pos: Float32Array, cut: number): Float32Array {
  const out: number[] = [];
  for (let k = 0; k < d.streams.length && k < cut - 1e-3; k++) {
    for (const j of d.streams[k]) {
      const za = d.span[2 * j], zb = d.span[2 * j + 1];
      if (Math.max(za, zb) <= cut + 1e-3) continue;
      const a = net.source[j], b = net.target[j];
      const t = (cut - za) / (zb - za);
      out.push(pos[2 * a] + t * (pos[2 * b] - pos[2 * a]), pos[2 * a + 1] + t * (pos[2 * b + 1] - pos[2 * a + 1]), j);
    }
  }
  return Float32Array.from(out);
}
