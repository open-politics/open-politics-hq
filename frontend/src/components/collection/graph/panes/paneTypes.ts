/**
 * PaneSpec — a pane is a name and a query.
 *
 * This replaces `HudConfig`, which had four **named** slots (`items`,
 * `evidence`, `bars`, `lanes`), each with a bespoke type and a bespoke
 * selector. Its own docstring said the right thing — *"nothing is hardcoded as
 * the activity source or the item source"* — while `LanesChannel.rows` was a
 * closed enum of five and every new finding wanted a fifth slot. The HUD was
 * exactly one generalisation behind the schema layer, which had already stopped
 * knowing any nouns.
 *
 * So: `n` panes, each carrying a query, and the *kind* of surface is inferred
 * from the shape of what that query folds rather than chosen by which component
 * someone wrote. `PANEL:Observations` and `PANEL:Consignments` are the same
 * mechanism; only the first happens to match a preset.
 *
 * Backend siblings: `graph/channels.py::PANE_PRESETS` (the starting bindings)
 * and `graph/channels.py::PANEL` (the clause).
 */
import type { GraphEdge, GraphNode } from '../graphTypes';

/**
 * What a surface draws, inferred from the fold.
 *
 * ```
 *   fold key                        surface            kind
 *   ─────────────────────────       ───────────        ──────
 *   (no BY)                         a set              canvas
 *   BY k                            k → measure        list    (ranked)
 *   BY k₁, k₂                       k₁ × k₂ → measure  matrix  (cross)
 *   BY k, <ordinal | interval>      k × position       lanes   (sequence)
 *   BY k where k is spatial         k → measure @ xy   map
 * ```
 *
 * Two kinds are not folds at all, and both are supplied by the panel rather
 * than computed here:
 *
 * * `detail` — a single selected thing, rendered whole. Node info.
 * * `table`  — one section's ROWS, projected by `SHOW:`. It does not appear in
 *   the table above because it is not derived from nodes: folding nodes is what
 *   produced `payment ×8` instead of eight payments. The server ships the rows
 *   beside the graph and this renders them.
 * * `docs`   — the same rows regrouped by the DOCUMENT that produced them. The
 *   one surface that runs source → graph rather than graph → source.
 */
export type SurfaceKind =
  | 'items' | 'list' | 'matrix' | 'lanes' | 'map' | 'detail' | 'table' | 'docs'
  | 'canvas';

/** Where a pane takes its rows from. */
export type PaneFollow = 'lens' | 'selection' | 'pinned';

/** Which region of the panel a pane sits in. */
export type PaneRegion = 'right' | 'left' | 'bottom';

export interface PaneSpec {
  id: string;
  /** Free-form, the analyst's word. Matched case-insensitively against the
   *  preset table for a starting binding, and otherwise just a label. */
  name: string;
  region: PaneRegion;
  /** The pane's own query, when unlinked. Composes over the panel's query by
   *  narrowing: a pane filters and folds the set the canvas already holds, so
   *  it can never disagree with what is on screen. */
  q?: string;
  /** Linked panes re-derive from the panel's query on every commit. Unlinking
   *  is what gives a pane its own bar. */
  linked: boolean;
  /** Omitted ⇒ inferred from the fold shape. Set only when the analyst
   *  overrode it, which is why it is optional rather than defaulted. */
  kind?: SurfaceKind;
  follow: PaneFollow;
  collapsed?: boolean;
  /** Channels the analyst has touched, which therefore stop following the
   *  query. *The query proposes, configuration disposes* — derivation only ever
   *  turns panes ON, and never overwrites something being read. */
  pinnedFields?: string[];
  /** **This pane IS a view of the query, not a thing the analyst made.**
   *
   *  A table pane exists because `SECTION:` named a section; it has no identity
   *  of its own and no content the query does not decide. So it follows the
   *  query, and the "never subtract" rule does not apply to it — that rule
   *  protects something someone chose to open, and nobody chose this.
   *
   *  Getting the distinction wrong is what produced a panel stuck showing one
   *  pane called `exhibits` reading "No rows for this query" while the engine
   *  was returning tables for `observations` and `actors`: the seeding was
   *  gated on `panes.length === 0`, so once a panel had ANY pane, a new section
   *  could never get one. */
  derived?: boolean;
}

/** How wide (or tall) each region is, in px.
 *
 *  The side columns were fixed at 300 and 240, which is enough for a name and a
 *  count and not enough for a table — and the table is now the surface a reader
 *  spends time in. A width is a reading preference, not a design constant, so it
 *  belongs to the panel rather than to the stylesheet.
 *
 *  `bottom` is a HEIGHT. One field because a region has exactly one axis it can
 *  grow along, and naming them separately would invite setting the one that
 *  does nothing. */
export type RegionSize = Partial<Record<PaneRegion, number>>;

/** Bounds, so a drag cannot make a region unusable or hide the canvas. */
export const REGION_MIN: Record<PaneRegion, number> = {
  left: 180, right: 220, bottom: 80,
};
export const REGION_MAX: Record<PaneRegion, number> = {
  left: 720, right: 900, bottom: 420,
};

export const REGION_DEFAULT: Record<PaneRegion, number> = {
  left: 240, right: 300, bottom: 144,
};

/** Which way a region grows when its handle is dragged inward.
 *
 *  The side columns are anchored to their own edge, so `left` grows with the
 *  pointer and `right` grows against it; `bottom` is anchored to the floor and
 *  grows upward. Written once here rather than as three sign flips at the call
 *  site, where the wrong sign reads as the handle being broken. */
export const REGION_AXIS: Record<PaneRegion, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
  left: { axis: 'x', sign: 1 },
  right: { axis: 'x', sign: -1 },
  bottom: { axis: 'y', sign: -1 },
};

export function clampRegion(region: PaneRegion, px: number): number {
  return Math.max(REGION_MIN[region], Math.min(REGION_MAX[region], Math.round(px)));
}

/** The whole HUD, as data. */
export interface PaneLayoutConfig {
  panes: PaneSpec[];
  /** Per-region width/height. Absent ⇒ `REGION_DEFAULT`. */
  regionSize?: RegionSize;
  /** Panel-level: the bottom strip is a pane like any other, but it is the one
   *  every panel starts with, so its absence is meaningful. */
  showActivity?: boolean;
}

/** One row of a folded surface. Every kind reads this same shape, which is what
 *  makes the router a router rather than five components sharing a name. */
export interface SurfaceRow {
  /** Fold key(s). One entry per `BY` term; empty for an unfolded set. */
  keys: string[];
  /** The measure, already resolved. */
  value: number;
  /** What this row is, for the click target and the pin. */
  nodeId?: string;
  edgeId?: string;
  label: string;
  /** Interval, for `lanes`. */
  t0?: string | null;
  t1?: string | null;
  /** Coordinates, for `map`. */
  lat?: number | null;
  lon?: number | null;
  /** Provenance, so every value can carry its justification. */
  justification?: string | null;
  quote?: string | null;
  assetIds?: number[];
  annotationIds?: number[];

  // ─── What the thing IS ────────────────────────────────────────────────
  //
  // Carried because an unfolded row is a *node*, and a pane that shows only
  // its name and a count has thrown away everything that made it worth
  // listing. Absent on folded rows, where the row is a bucket rather than a
  // thing and these would be a lie.
  /** Declared kind of act, or entity type — `Payment`, `Organization`. */
  type?: string | null;
  kind?: 'entity' | 'occurrence' | null;
  /** Where it happened, strongest rung first. */
  place?: string | null;
  /** Role slots it occupied. */
  roles?: string[];
  /** Forwarded row fields — modality, stance, amount. Rendered through
   *  `<Value>` so each carries its own justification. */
  properties?: Record<string, unknown>;
  /** Uncalibrated size the document stated, when it stated one. */
  magnitude?: number | null;
  /** How many documents attest it. */
  docCount?: number;
}

export interface Surface {
  kind: SurfaceKind;
  rows: SurfaceRow[];
  /** Names of the fold keys, for headers. */
  keyNames: string[];
  /** What the engine decided that the query did not say. Rendered, always. */
  legend?: string[];
}

export const defaultPaneLayout: PaneLayoutConfig = {
  panes: [],
  showActivity: true,
};

/**
 * Infer the surface kind from what the fold produced.
 *
 * The decision table above, as code. Note that `map` beats `lanes` beats
 * `matrix`: a spatial key has coordinates and nothing else does, an ordinal
 * second key is a sequence and reads as one, and everything else with two keys
 * is a cross.
 */
export function inferKind(rows: SurfaceRow[], keyNames: string[]): SurfaceKind {
  // **No fold key ⇒ the rows ARE the things, so show the things.**
  //
  // This used to return a ranked bar list, which is a category error: a bar
  // measures a *bucket*, and with no `BY` there are no buckets — every row is
  // one node and its "value" is just how often it was named. The pane came out
  // as a chart of nothing, where "Minister P2 · 21" told you neither that
  // Minister P2 is a person nor what the 21 counted.
  //
  // A bar is right the moment a fold key exists, because then the number is
  // the answer to a question someone asked.
  if (keyNames.length === 0) return 'items';
  if (rows.some(r => r.lat != null && r.lon != null)) return 'map';
  if (keyNames.length >= 2) {
    const sequential = rows.some(r => r.t0 != null);
    return sequential ? 'lanes' : 'matrix';
  }
  return rows.some(r => r.t0 != null) ? 'lanes' : 'list';
}

/** Stable id for a new pane. Not random — a pane's identity has to survive a
 *  reload, and `Math.random` in a config is how two panes become one. */
export function paneId(name: string, existing: ReadonlyArray<PaneSpec>): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'pane';
  if (!existing.some(p => p.id === base)) return base;
  let i = 2;
  while (existing.some(p => p.id === `${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export type { GraphEdge, GraphNode };
