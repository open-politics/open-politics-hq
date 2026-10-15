/**
 * Buckets → what the overview draws, for a mode, a set of sections and a
 * time window. Pure, and cheap enough to rerun on every brush move: a run's
 * buckets are bounded by places × sections × cells (a few thousand), not by
 * its rows.
 *
 *   assets    distinct assets per place, from the asset buckets
 *   rows      rows per place across every real section (the document
 *             pseudo-section only when it is all there is)
 *   sections  rows per place across the chosen sections
 *
 * Rungs stay apart end to end: a place carries `row` (rows that stated it)
 * and `doc` (rows placed there only by their document), and the map draws
 * them differently.
 */
import type { OverviewBuckets, OverviewMode, OverviewPlan } from './types';

export interface Marker {
  /** Index into `buckets.places`. */
  p: number;
  lon: number;
  lat: number;
  name: string;
  row: number;
  doc: number;
  total: number;
}

export interface TimeBin {
  t: number;
  n: number;
}

export type TimeWindow = [number, number] | null;

const DOCUMENT_SUFFIX = ':@document';

export function isDocumentSection(key: string): boolean {
  return key.endsWith(DOCUMENT_SUFFIX);
}

/** Parsed cell times, index-aligned with `buckets.cells`. */
export function cellTimes(b: OverviewBuckets): number[] {
  return b.cells.map((c) => Date.parse(c));
}

/** The section indices a mode counts. */
export function activeSections(
  b: OverviewBuckets,
  mode: OverviewMode,
  chosen: ReadonlySet<string>,
): Set<number> {
  const out = new Set<number>();
  const real = b.sections.filter((s) => !isDocumentSection(s.key));
  b.sections.forEach((s, i) => {
    if (mode === 'sections') {
      if (chosen.has(s.key)) out.add(i);
    } else if (real.length === 0 || !isDocumentSection(s.key)) {
      out.add(i);
    }
  });
  return out;
}

function inWindow(cell: number, times: number[], win: TimeWindow): boolean {
  if (!win) return true;
  if (cell < 0) return false;
  const t = times[cell];
  return t >= win[0] && t <= win[1];
}

/** Place markers for the current reading. Unlocated buckets never draw. */
export function markers(
  b: OverviewBuckets,
  mode: OverviewMode,
  sections: ReadonlySet<number>,
  win: TimeWindow,
  times: number[] = cellTimes(b),
): Marker[] {
  const row = new Map<number, number>();
  const doc = new Map<number, number>();
  const add = (p: number, rung: 0 | 1, n: number) => {
    if (p < 0) return;
    const m = rung === 0 ? row : doc;
    m.set(p, (m.get(p) ?? 0) + n);
  };
  if (mode === 'assets') {
    for (const [rung, p, cell, n] of b.assets) if (inWindow(cell, times, win)) add(p, rung, n);
  } else {
    for (const [s, rung, p, cell, n] of b.rows) {
      if (sections.has(s) && inWindow(cell, times, win)) add(p, rung, n);
    }
  }
  const out: Marker[] = [];
  const seen = new Set<number>([...row.keys(), ...doc.keys()]);
  for (const p of seen) {
    const r = row.get(p) ?? 0;
    const d = doc.get(p) ?? 0;
    out.push({
      p, lon: b.places.lon[p], lat: b.places.lat[p], name: b.places.name[p],
      row: r, doc: d, total: r + d,
    });
  }
  return out.sort((x, y) => y.total - x.total);
}

/** Rows (or assets) that point at a place nobody could locate — the count
 *  behind "not located", for the current reading. */
export function unlocatedCount(
  b: OverviewBuckets,
  mode: OverviewMode,
  sections: ReadonlySet<number>,
  win: TimeWindow,
  times: number[] = cellTimes(b),
): number {
  let n = 0;
  if (mode === 'assets') {
    for (const [, p, cell, c] of b.assets) if (p < 0 && inWindow(cell, times, win)) n += c;
  } else {
    for (const [s, , p, cell, c] of b.rows) {
      if (p < 0 && sections.has(s) && inWindow(cell, times, win)) n += c;
    }
  }
  return n;
}

/** The time strip, sorted, plus what has no date at all. */
export function histogram(
  b: OverviewBuckets,
  mode: OverviewMode,
  sections: ReadonlySet<number>,
  times: number[] = cellTimes(b),
): { bins: TimeBin[]; undated: number } {
  const acc = new Map<number, number>();
  let undated = 0;
  const add = (cell: number, n: number) => {
    if (cell < 0) { undated += n; return; }
    const t = times[cell];
    acc.set(t, (acc.get(t) ?? 0) + n);
  };
  if (mode === 'assets') {
    for (const [cell, n] of b.asset_time) add(cell, n);
  } else {
    for (const [s, cell, n] of b.hist) if (sections.has(s)) add(cell, n);
  }
  const bins = [...acc.entries()].map(([t, n]) => ({ t, n })).sort((x, y) => x.t - y.t);
  return { bins, undated };
}

/** The bins a strip should actually draw: the robust extent the server chose,
 *  so a model-written "1900" does not squash two years into one pixel. */
export function clampBins(bins: TimeBin[], extent: [string | null, string | null]): {
  bins: TimeBin[]; outside: number;
} {
  const lo = extent[0] ? Date.parse(extent[0]) : -Infinity;
  const hi = extent[1] ? Date.parse(extent[1]) : Infinity;
  let outside = 0;
  const kept: TimeBin[] = [];
  for (const b of bins) {
    if (b.t < lo || b.t > hi) outside += b.n;
    else kept.push(b);
  }
  return { bins: kept, outside };
}

/** Rows counted under the current reading, and how many of them are placed
 *  and dated — the stats card's denominators. */
export function sectionTotals(
  b: OverviewBuckets,
  sections: ReadonlySet<number>,
): { rows: number; placed: number; dated: number } {
  let rows = 0, placed = 0, dated = 0;
  b.sections.forEach((s, i) => {
    if (!sections.has(i)) return;
    rows += s.rows; placed += s.placed; dated += s.dated;
  });
  return { rows, placed, dated };
}

/** Section key → its plan, for labels and bindings. */
export function sectionPlans(plan: OverviewPlan | null) {
  const out = new Map<string, OverviewPlan['schemas'][number]['sections'][number]>();
  for (const schema of plan?.schemas ?? []) for (const s of schema.sections) out.set(s.key, s);
  return out;
}

/** A section's display label — prefixed with its schema when a run has more
 *  than one, so two `events` sections stay distinguishable. */
export function sectionLabel(plan: OverviewPlan | null, key: string): string {
  const schemas = plan?.schemas ?? [];
  for (const schema of schemas) {
    const s = schema.sections.find((x) => x.key === key);
    if (s) return schemas.length > 1 ? `${schema.name} · ${s.label}` : s.label;
  }
  return key.split(':').slice(1).join(':');
}

/** [[west, south], [east, north]] around the markers — what the camera fits
 *  to once. Null when there is nothing to frame. */
export function boundsOf(ms: Marker[]): [[number, number], [number, number]] | null {
  if (ms.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const m of ms) {
    w = Math.min(w, m.lon); e = Math.max(e, m.lon);
    s = Math.min(s, m.lat); n = Math.max(n, m.lat);
  }
  return [[w, s], [e, n]];
}
