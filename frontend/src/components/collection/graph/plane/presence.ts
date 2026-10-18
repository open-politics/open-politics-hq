/**
 * Presence — when each node is there, not only when it first was.
 *
 * The timeline places a node at one time: its own (`nodeTimes`), which for an
 * actor is when it was first seen. That suits a point that happens — an
 * occurrence — but not an actor that recurs: Donald Trump would stand on the
 * day of his first mention and nowhere after. Deep time reads the run as a
 * space-time cube, so it needs every time a node is there:
 *
 *   as published   each node is present where its documents are — one mention
 *                  per document, in the cell of the document's own timestamp
 *   as stated      an occurrence at its own time; an entity at its own time and
 *                  at the times of the occurrences it takes part in — an actor
 *                  is there when the things it is part of happen
 *
 * The result is a CSR over nodes — the slices each is present in, ascending,
 * with how many mentions there — and the cells anything is present in, which
 * become the deck's slices. Pure; a node is its index.
 */
import type { Network } from './network';
import { cellOf, nodeTimes, parseTime, robustExtent, type Grain, type TimeSource } from './arrange';
import { publishedAt } from './network';

export interface Presence {
  /** The time cells anything is present in, ascending — the deck's slices. */
  cells: number[];
  /** Per cell: how many nodes are present in it. */
  bins: Array<{ t: number; n: number }>;
  /** Per node, CSR into `slice` / `count`: the slices it is present in,
   *  ascending, and how many mentions it has in each. */
  offsets: Uint32Array;
  slice: Int32Array;
  count: Uint32Array;
  /** Per node: its loudest slice's count — 0 when it is never present. */
  peak: Uint32Array;
  /** Nodes present at least once. */
  present: number;
}

export function presenceOf(net: Network, source: TimeSource, grain: Grain): Presence {
  // Per node: (cell, mentions) pairs, cells ascending.
  const perNode: Array<Array<[number, number]>> = new Array(net.size);
  if (source === 'published') {
    const extent = robustExtent(Float64Array.from(net.assetTime.values()));
    for (let i = 0; i < net.size; i++) {
      const byCell = new Map<number, Set<number>>();
      for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) {
        const asset = net.assetOf.get(net.annIds[k]);
        const t = asset == null ? undefined : net.assetTime.get(asset);
        if (t == null || !extent || t < extent[0] || t > extent[1]) continue;
        const c = cellOf(t, grain);
        let docs = byCell.get(c);
        if (!docs) byCell.set(c, docs = new Set());
        docs.add(asset!);
      }
      perNode[i] = [...byCell].map(([c, docs]) => [c, docs.size] as [number, number]).sort((a, b) => a[0] - b[0]);
    }
  } else {
    const own = nodeTimes(net, 'stated', (i) => publishedAt(net, i));
    const extent = robustExtent(own);
    const cell = (t: number) => (Number.isFinite(t) && extent && t >= extent[0] && t <= extent[1] ? cellOf(t, grain) : NaN);
    const occurrence = net.kinds.indexOf('occurrence');
    for (let i = 0; i < net.size; i++) {
      const byCell = new Map<number, number>();
      const c0 = cell(own[i]);
      if (!Number.isNaN(c0)) byCell.set(c0, 1);
      if (net.kind[i] !== occurrence) {
        const seen = new Set<number>();
        for (let k = net.adjOffsets[i]; k < net.adjOffsets[i + 1]; k++) {
          const n = net.adjNodes[k];
          if (net.kind[n] !== occurrence || seen.has(n)) continue;
          seen.add(n);
          const c = cell(own[n]);
          if (!Number.isNaN(c)) byCell.set(c, (byCell.get(c) ?? 0) + 1);
        }
      }
      perNode[i] = [...byCell].sort((a, b) => a[0] - b[0]);
    }
  }

  const all = new Set<number>();
  for (const pairs of perNode) for (const [c] of pairs) all.add(c);
  const cells = [...all].sort((a, b) => a - b);
  const index = new Map(cells.map((c, k) => [c, k]));
  const offsets = new Uint32Array(net.size + 1);
  for (let i = 0; i < net.size; i++) offsets[i + 1] = offsets[i] + perNode[i].length;
  const slice = new Int32Array(offsets[net.size]);
  const count = new Uint32Array(offsets[net.size]);
  const peak = new Uint32Array(net.size);
  const n = new Uint32Array(cells.length);
  let present = 0;
  for (let i = 0; i < net.size; i++) {
    let q = offsets[i];
    if (perNode[i].length) present++;
    for (const [c, m] of perNode[i]) {
      const k = index.get(c)!;
      slice[q] = k;
      count[q++] = m;
      n[k]++;
      if (m > peak[i]) peak[i] = m;
    }
  }
  return { cells, bins: cells.map((t, k) => ({ t, n: n[k] })), offsets, slice, count, peak, present };
}

/** Slices `lo..hi` of `cells` that a window `[from, to]` (cell starts)
 *  covers — `[-1, -1]` when it covers none. */
export function sliceSpan(cells: readonly number[], win: [number, number], grain: Grain): [number, number] {
  const from = cellOf(win[0], grain);
  const lo = cells.findIndex((c) => c >= from);
  if (lo < 0 || cells[lo] > win[1]) return [-1, -1];
  let hi = lo;
  while (hi + 1 < cells.length && cells[hi + 1] <= win[1]) hi++;
  return [lo, hi];
}

/** The nodes present in slices `lo..hi`, loudest there first. */
export function presentIn(p: Presence, lo: number, hi: number, visible: Uint8Array | null): number[] {
  const loud = new Map<number, number>();
  for (let i = 0; i + 1 < p.offsets.length; i++) {
    if (visible && !visible[i]) continue;
    for (let q = p.offsets[i]; q < p.offsets[i + 1]; q++) {
      const k = p.slice[q];
      if (k > hi) break;
      if (k >= lo) loud.set(i, (loud.get(i) ?? 0) + p.count[q]);
    }
  }
  return [...loud.keys()].sort((a, b) => loud.get(b)! - loud.get(a)!);
}

/** The annotations of `nodes` whose documents fall in the cells `from..to`
 *  — a window's own documents, not everything its actors ever said. */
export function annotationsWhen(net: Network, nodes: Iterable<number>, grain: Grain, from: number, to: number): number[] {
  const out = new Set<number>();
  for (const i of nodes) {
    for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) {
      const asset = net.assetOf.get(net.annIds[k]);
      const t = asset == null ? undefined : net.assetTime.get(asset);
      if (t == null) continue;
      const c = cellOf(t, grain);
      if (c >= from && c <= to) out.add(net.annIds[k]);
    }
  }
  return [...out];
}

/** Whether node i's own time falls in the cells `from..to` — as stated. */
export function ownIn(net: Network, i: number, grain: Grain, from: number, to: number): boolean {
  const t = parseTime(net.t0[i]);
  if (!Number.isFinite(t)) return false;
  const c = cellOf(t, grain);
  return c >= from && c <= to;
}
