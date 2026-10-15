/**
 * Arrangements — what organises the plane: groups, time, or place.
 *
 * One primitive, as `forcegraph/anchors.ts` argues for the canvas graph: **an
 * arrangement says where each node is pulled, and how hard.** cosmos already
 * has the force for it — a per-node cluster, a position per cluster, a
 * per-node strength — so every core view is the same four arrays and a few
 * force settings, and switching view is handing the plane another set:
 *
 *   groups    a cluster per community, positioned where its members gather
 *   time      a cluster per time cell, laid out left to right
 *   geo       a cluster per coordinate, at its Web-Mercator position — so a
 *             map under the plane, following its camera, lines up
 *
 * Optional `targets` move nodes before the forces take over (a transition, so
 * the change of view reads as movement, not a cut), and `include` says which
 * nodes the view is *about* — the geo view leaves out what cannot be placed.
 *
 * Pure: `(Network, choices) → Arrangement`. The plane applies it.
 */
import type { GraphConfig } from '@cosmos.gl/graph';
import { pickPlace, RUNG_PRESETS, type RungWeights } from '../forcegraph/anchors';
import { placesOf, type Network } from './network';

export interface Arrangement {
  kind: 'groups' | 'time' | 'geo';
  /** The view and its choices — `geo:stated`, `time:published:month`. Targets
   *  move nodes only when this changes; a live run replacing its graph under
   *  the same view keeps its shape. */
  key: string;
  /** Per node: its cluster, or undefined to float free. */
  clusters: (number | undefined)[];
  /** `[x0, y0, x1, y1, …]` per cluster in space units; undefined = where its
   *  members happen to gather. */
  clusterPositions: (number | undefined)[];
  /** Per node pull, 0–1. */
  strength: Float32Array;
  /** Where nodes move to first, NaN = stay. */
  targets?: Float32Array;
  /** Nodes the view is about (1); the rest leave the picture. */
  include?: Uint8Array;
  forces: GraphConfig;
  /** How hot the layout runs after the change. */
  heat: number;
}

// ─── Groups ─────────────────────────────────────────────────────────────────

/** Communities pull together; where each settles is the layout's business. */
export function byGroups(net: Network, groupOf: (i: number) => number): Arrangement {
  const clusters: (number | undefined)[] = new Array(net.size);
  const strength = new Float32Array(net.size);
  for (let i = 0; i < net.size; i++) {
    const g = groupOf(i);
    clusters[i] = g >= 0 ? g : undefined;
    strength[i] = g >= 0 ? 0.6 : 0;
  }
  return {
    kind: 'groups', key: 'groups', clusters, clusterPositions: [], strength,
    forces: { simulationGravity: 0.2, simulationCenter: 0, simulationCluster: 0.15, simulationRepulsion: 0.8 },
    heat: 0.5,
  };
}

// ─── Time ───────────────────────────────────────────────────────────────────

export type TimeSource = 'stated' | 'published';
export type Grain = 'day' | 'week' | 'month' | 'quarter' | 'year';
const GRAIN_MS: Record<Grain, number> = {
  day: 86_400_000, week: 7 * 86_400_000, month: 30.44 * 86_400_000,
  quarter: 91.31 * 86_400_000, year: 365.25 * 86_400_000,
};

/** When each node is, in ms — NaN where it has no time.
 *
 *  `stated` is the engine's own ladder: the row's time, else the document's
 *  date (`t0`). `published` is the earliest own timestamp of the assets that
 *  produced the node — when it was *reported*, which is not a claim. */
export function nodeTimes(net: Network, source: TimeSource, publishedAt: (i: number) => number): Float64Array {
  const out = new Float64Array(net.size).fill(NaN);
  for (let i = 0; i < net.size; i++) {
    out[i] = source === 'published' ? publishedAt(i) : parseTime(net.t0[i]);
  }
  return out;
}

/** ISO date or partial date ("2024", "2024-03") → ms; NaN when unreadable. */
export function parseTime(v: string | null | undefined): number {
  if (!v) return NaN;
  const s = /^\d{4}$/.test(v) ? `${v}-01-01` : /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : v;
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/** The extent most nodes fall in, so one model-written "1580" cannot squash a
 *  year of news into a pixel: the 2nd–98th percentile, fenced at three
 *  interquartile ranges — the percentiles alone cannot exclude anything from
 *  a small run, the fence alone would be too tight on a lopsided one. A corpus
 *  spread evenly over decades has a wide fence, and keeps its decades. What
 *  falls outside is counted, never dropped silently. */
export function robustExtent(times: Float64Array): [number, number] | null {
  const xs = Array.from(times).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))];
  const iqr = Math.max(at(0.75) - at(0.25), 86_400_000);
  const lo = Math.max(at(0.02), at(0.25) - 3 * iqr);
  const hi = Math.min(at(0.98), at(0.75) + 3 * iqr);
  return hi > lo ? [lo, hi] : [lo, lo + 86_400_000];
}

/** A grain that gives the extent ~20–120 cells. */
export function autoGrain(extent: [number, number]): Grain {
  const span = extent[1] - extent[0];
  for (const g of ['day', 'week', 'month', 'quarter'] as Grain[]) if (span / GRAIN_MS[g] <= 120) return g;
  return 'year';
}

/** The start of t's cell, in ms (UTC). */
export function cellOf(t: number, grain: Grain): number {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (grain) {
    case 'day': return Date.UTC(y, m, d.getUTCDate());
    case 'week': {
      const day = Date.UTC(y, m, d.getUTCDate());
      return day - ((new Date(day).getUTCDay() + 6) % 7) * 86_400_000;   // Monday
    }
    case 'month': return Date.UTC(y, m, 1);
    case 'quarter': return Date.UTC(y, m - (m % 3), 1);
    case 'year': return Date.UTC(y, 0, 1);
  }
}

export interface Timeline {
  arrangement: Arrangement;
  grain: Grain;
  extent: [number, number] | null;
  /** Node count per cell, for the strip. */
  bins: { t: number; n: number }[];
  undated: number;
  outside: number;
  /** Per node: its cell start, NaN when undated or outside. */
  cell: Float64Array;
}

/** Time left to right: one cluster per cell across the width of the space,
 *  every dated node pulled into its column. */
export function byTime(net: Network, times: Float64Array, space: number, grain?: Grain, key = 'time'): Timeline {
  const extent = robustExtent(times);
  const g = grain ?? (extent ? autoGrain(extent) : 'month');
  const cell = new Float64Array(net.size).fill(NaN);
  const counts = new Map<number, number>();
  let undated = 0, outside = 0;
  for (let i = 0; i < net.size; i++) {
    const t = times[i];
    if (!Number.isFinite(t)) { undated++; continue; }
    if (!extent || t < extent[0] || t > extent[1]) { outside++; continue; }
    const c = cellOf(t, g);
    cell[i] = c;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const cells = [...counts.keys()].sort((a, b) => a - b);
  const index = new Map(cells.map((c, k) => [c, k]));
  const lo = cells[0] ?? 0, hi = cells[cells.length - 1] ?? 1;
  const x = (c: number) => space * (0.08 + 0.84 * (hi > lo ? (c - lo) / (hi - lo) : 0.5));

  const clusters: (number | undefined)[] = new Array(net.size);
  const clusterPositions: (number | undefined)[] = [];
  cells.forEach((c) => clusterPositions.push(x(c), space / 2));
  const strength = new Float32Array(net.size);
  const targets = new Float32Array(net.size * 2).fill(NaN);
  for (let i = 0; i < net.size; i++) {
    const c = cell[i];
    if (Number.isNaN(c)) { clusters[i] = undefined; continue; }
    clusters[i] = index.get(c);
    strength[i] = 1;
    targets[2 * i] = x(c) + jitter(net.id[i], 1) * 12;
    targets[2 * i + 1] = space / 2 + jitter(net.id[i], 2) * space * 0.12;
  }
  return {
    arrangement: {
      kind: 'time', key: `${key}:${g}`, clusters, clusterPositions, strength, targets,
      forces: { simulationGravity: 0, simulationCenter: 0, simulationCluster: 0.6, simulationRepulsion: 0.4 },
      heat: 0.6,
    },
    grain: g, extent, undated, outside, cell,
    bins: cells.map((t) => ({ t, n: counts.get(t)! })),
  };
}

// ─── Place ──────────────────────────────────────────────────────────────────

export type PlacePreset = keyof typeof RUNG_PRESETS;
export { RUNG_PRESETS };

/** Web Mercator → plane space. North is up: cosmos's space y grows upward. */
export function toSpace(lat: number, lon: number, space: number): [number, number] {
  const phi = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const mx = (lon + 180) / 360;
  const my = (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
  return [mx * space, (1 - my) * space];
}

/** Plane space → `[lat, lon]`. */
export function fromSpace(x: number, y: number, space: number): [number, number] {
  const mx = x / space, my = 1 - y / space;
  const lon = mx * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
  return [lat, lon];
}

export interface Geography {
  arrangement: Arrangement;
  /** Per node: the coordinate it anchors on (index into `net.coords`), or -1. */
  coord: Int32Array;
  /** Per node: how far the claim is trusted (the rung's weight), 0 if none. */
  weight: Float32Array;
  /** The places in use, most nodes first. */
  places: { coord: number; name: string; lat: number; lon: number; nodes: number[] }[];
  placed: number;
}

/**
 * Each node at the place the ladder picks for it (`anchors.pickPlace` under a
 * preset — the same choice the canvas graph makes). A node is pulled to its
 * coordinate as hard as its claim is trusted: a stated site firmly, a
 * document's subject barely. Unplaced nodes linked to a placed one stay, drawn
 * toward it by the link; the rest leave the view.
 */
export function byPlace(
  net: Network, preset: PlacePreset, space: number,
  { cursor = null, keepNeighbours = true }: { cursor?: string | null; keepNeighbours?: boolean } = {},
): Geography {
  const rungs: RungWeights = RUNG_PRESETS[preset]?.rungs ?? RUNG_PRESETS.stated.rungs;
  const coord = new Int32Array(net.size).fill(-1);
  const weight = new Float32Array(net.size);
  const at = new Map<number, number[]>();
  for (let i = 0; i < net.size; i++) {
    const best = pickPlace(placesOf(net, i), rungs, cursor);
    if (!best) continue;
    coord[i] = best.place.coord;
    weight[i] = best.weight;
    let list = at.get(best.place.coord);
    if (!list) at.set(best.place.coord, (list = []));
    list.push(i);
  }

  const used = [...at.keys()];
  const clusterOf = new Map(used.map((c, k) => [c, k]));
  const clusterPositions: (number | undefined)[] = [];
  for (const c of used) clusterPositions.push(...toSpace(net.coords[2 * c], net.coords[2 * c + 1], space));

  const clusters: (number | undefined)[] = new Array(net.size).fill(undefined);
  const strength = new Float32Array(net.size);
  const targets = new Float32Array(net.size * 2).fill(NaN);
  const include = new Uint8Array(net.size);
  for (let i = 0; i < net.size; i++) {
    const c = coord[i];
    if (c < 0) continue;
    const k = clusterOf.get(c)!;
    clusters[i] = k;
    strength[i] = weight[i];
    // Spread a crowded place's nodes over a disc that grows with the crowd,
    // so they arrive as a cloud around it rather than a single dot.
    const r = 0.6 * Math.sqrt(at.get(c)!.length) * jitterUnit(net.id[i], 3);
    const a = 2 * Math.PI * jitterUnit(net.id[i], 4);
    targets[2 * i] = clusterPositions[2 * k]! + r * Math.cos(a);
    targets[2 * i + 1] = clusterPositions[2 * k + 1]! + r * Math.sin(a);
    include[i] = 1;
  }
  if (keepNeighbours) {
    for (let i = 0; i < net.size; i++) {
      if (include[i]) continue;
      // Start beside the first placed neighbour; the link does the rest.
      for (let e = net.adjOffsets[i]; e < net.adjOffsets[i + 1]; e++) {
        const j = net.adjNodes[e];
        if (coord[j] < 0) continue;
        include[i] = 1;
        targets[2 * i] = targets[2 * j] + jitter(net.id[i], 5) * 2;
        targets[2 * i + 1] = targets[2 * j + 1] + jitter(net.id[i], 6) * 2;
        break;
      }
    }
  }

  return {
    arrangement: {
      kind: 'geo', key: `geo:${preset}`, clusters, clusterPositions, strength, targets, include,
      // No gravity, no centre: the map is the frame. Weak repulsion and short
      // springs, so a place's cloud stays near its place at every zoom.
      forces: {
        simulationGravity: 0, simulationCenter: 0, simulationCluster: 1,
        simulationRepulsion: 0.05, simulationLinkSpring: 0.3, simulationLinkDistance: 1,
      },
      heat: 0.4,
    },
    coord, weight, placed: [...at.values()].reduce((n, l) => n + l.length, 0),
    places: used
      .map((c) => ({
        coord: c, name: net.coordNames[c], lat: net.coords[2 * c], lon: net.coords[2 * c + 1],
        nodes: at.get(c)!,
      }))
      .sort((a, b) => b.nodes.length - a.nodes.length),
  };
}

// ─── Stable noise ───────────────────────────────────────────────────────────

/** [0, 1) from an id — the same node lands in the same spot every time. */
function jitterUnit(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}
const jitter = (s: string, salt: number) => jitterUnit(s, salt) * 2 - 1;
