/**
 * Mirror of `backend/app/api/modules/annotation/formula.py::eligible_panels`.
 *
 * Given a Formula, return the panel types its OutputRelation can drive. The
 * FormulaEditor uses this to suggest "Push to panel" choices; the backend's
 * `eligible_panels` is the authoritative version (used at snapshot time
 * and route validation).
 *
 * Conventions (match HOW_TO §Panels):
 * - `table` is the universal fallback (every Formula renders as one).
 * - `distribution`/`top` measures → table only (structured / per-row).
 * - `geo` dim → `map` added.
 * - Two or more `entity` dims → `graph` added (first two as edge, extras
 *   as edge attributes).
 * - Single `time` dim with no entity dims → `chart`.
 * - One categorical dim (field/doc) OR one entity dim alone → `pie` + `chart`.
 */

import type { Formula } from '@/client/types.gen';

/** The seven panel render types HQ supports. Mirrors the backend's
 *  ``PanelType`` literal in ``panel_config.py``; not exported on any
 *  OpenAPI response so we keep it local. */
export type PanelType =
  | 'table' | 'chart' | 'pie' | 'graph' | 'map'
  | 'measurements' | 'scatter';

export function eligiblePanels(formula: Formula): Set<PanelType> {
  const panels = new Set<PanelType>(['table']);
  const dims = formula.group ?? [];
  const measures = formula.measures ?? [];
  const kinds = dims.map(d => d.kind);

  // Pure filter (no group, no measures) → list-mode renders.
  if (dims.length === 0 && measures.length === 0) {
    panels.add('map');
    return panels;
  }

  if (kinds.includes('geo')) {
    panels.add('map');
  }

  const structured = measures.some(m => m.agg === 'distribution' || m.agg === 'top');
  if (structured) {
    return panels;
  }

  const nEntity = kinds.filter(k => k === 'entity').length;
  const nTime = kinds.filter(k => k === 'time').length;
  const nCat = kinds.filter(k => k === 'field' || k === 'doc').length;

  if (nEntity >= 2) {
    panels.add('graph');
  }
  if (nTime >= 1 && nEntity === 0) {
    panels.add('chart');
  }
  if (kinds.length === 1 && (nCat === 1 || nEntity === 1)) {
    panels.add('pie');
    panels.add('chart');
  }

  // Aggregate formulas with at least one measure render as measurements
  // (single scalar / mini table / stats — the catch-all stats panel).
  if (measures.length > 0) {
    panels.add('measurements');
  }

  // Scatter eligibility: 2 dims + ≥1 measure (label × label heatmap),
  // OR two numeric measures (true scatter).
  if (dims.length === 2 && measures.length >= 1) {
    panels.add('scatter');
  }

  return panels;
}

/**
 * The single suggested panel type for a formula — the editor's default
 * when the author hits "Push to panel" without picking one explicitly.
 *
 * Heuristic: pick the most opinionated drawable shape (graph > map > chart
 * > pie > table), falling back to table.
 */
export function suggestPanelType(formula: Formula): PanelType {
  const opts = eligiblePanels(formula);
  for (const t of ['graph', 'map', 'chart', 'pie'] as const) {
    if (opts.has(t)) return t;
  }
  return 'table';
}

/**
 * Minimal stub Formula for an ad-hoc panel — `count` over an unconfigured
 * relation. The panel renders empty until the user picks fields inline; the
 * stub keeps the dispatch happy and the engine happy (no-dim count returns
 * a single scalar row).
 *
 * Used by ``addPanel`` when no binding is supplied by the caller: the panel
 * owns this Formula privately (``Panel.formula_inline``) and never appears
 * in the intelligence formula list until promoted.
 */
export function newInlineStubFormula(name: string, id: string): Formula {
  return {
    id,
    name,
    description: undefined,
    schema_id: null,
    explosion: null,
    filter: { logic: 'and', conditions: [] },
    merge_maps: [],
    group: [],
    weight: null,
    measures: [{ name: 'count', agg: 'count' }],
    derives: [],
    snippet: null,
    output_keys: [],
    order_by: null,
    version: 1,
  } as unknown as Formula;
}
