/**
 * panelCompile — the compile middleware.
 *
 * Pure function ``compileForPanel(panel, schemas) → Formula``. Runs at
 * the request boundary inside :func:`useAnnotationView`. The renderer
 * never sees a compile call site — it just passes the Panel.
 *
 *   Panel.panel_config (visual roles)         ─┐
 *   Panel.formula      (seed: filter, derives, ├─►  effective Formula
 *                       weight, snippet, ...)  │     (sent to /view)
 *   Schemas (for shape inference)              ─┘
 *
 * Why a middleware (not write-through in the popover): one source of
 * truth (``panel_config``) for visual roles; the engine spec is derived
 * deterministically at fetch time. Config change in → fresh Formula
 * out → fresh /view request. No drift, no duplicate writes.
 *
 * Workspace-bound panels (``panel.formula_ref`` set) bypass compile —
 * the Workspace-authored Formula wins. Visual roles still drive the
 * renderer (D1).
 */

import type {
  Panel,
  PieVizConfig,
  ChartVizConfig,
  MapVizConfig,
  GraphVizConfig,
  ScatterVizConfig,
} from './types';
import type {
  Formula,
  Dimension,
  Measure,
  AnnotationSchemaRead,
} from '@/client';
import { inferFieldShape, type FieldShape } from './fieldPaths';

// ── Dimension construction ────────────────────────────────────────────────

function dimKindForShape(shape: FieldShape): {
  kind: Dimension['kind'];
  interval?: Dimension['interval'];
} {
  switch (shape) {
    case 'date':
      return { kind: 'time', interval: 'month' };
    case 'entity':
    case 'array_entity':
      return { kind: 'entity' };
    default:
      return { kind: 'field' };
  }
}

/** Resolve a Dimension from a field path against the panel's schema.
 *  Returns null when the path is empty/null. The dimension ``name``
 *  defaults to the path itself so the row keys are addressable from
 *  the renderer by the same string the user picked.
 *
 *  When ``timeIntervalOverride`` is provided, treat the dimension as
 *  time-shaped regardless of inferred field shape. This lets users
 *  whose date fields lack JSON-Schema ``format: "date"`` annotations
 *  still get proper time bucketing — picking an interval is the
 *  explicit signal that "I want this bucketed as time". The backend
 *  applies ``date_trunc`` per interval; non-parseable values bucket
 *  to NULL and the renderer surfaces them as ``<UNKNOWN>``. */
function asDim(
  path: string | null | undefined,
  schema: AnnotationSchemaRead | undefined,
  timeIntervalOverride?: Dimension['interval'],
): Dimension | null {
  if (!path) return null;
  const shape = schema ? inferFieldShape(schema, path) : 'string';
  const { kind: inferredKind, interval } = dimKindForShape(shape);
  const kind: Dimension['kind'] = timeIntervalOverride ? 'time' : inferredKind;
  const dim: Dimension = { name: path, kind, path };
  if (kind === 'time') {
    dim.interval = timeIntervalOverride ?? interval ?? 'month';
  }
  return dim;
}

// ── Measure construction ──────────────────────────────────────────────────

/** Build a Measure from a role value. Accepts:
 *
 *  - ``null`` / ``undefined`` / ``'count'`` → count(*)
 *  - ``'<path>'``                          → mean(path) (numeric)
 *  - ``'<agg>:<path>'``                   → agg(path)
 *
 *  The path-to-numeric default is mean — the common case for chart Y
 *  series and pie value sizing. For sum/min/max/etc., the Workspace
 *  authors via the math-line.
 */
function asMeasure(spec: string | null | undefined): Measure {
  if (!spec || spec === 'count') {
    return { name: 'count', agg: 'count' };
  }
  const m = /^(count|mean|sum|max|min|median|mode|distribution|top):(.+)$/.exec(spec);
  if (m) {
    const agg = m[1] as Measure['agg'];
    const path = m[2];
    return { name: spec, path, agg };
  }
  return { name: spec, path: spec, agg: 'mean' };
}

// ── Schema resolution ─────────────────────────────────────────────────────

function pickSchema(
  panel: Panel,
  schemas: AnnotationSchemaRead[],
): AnnotationSchemaRead | undefined {
  const id = panel.formula?.schema_id ?? null;
  if (id != null) return schemas.find((s) => s.id === id);
  if (schemas.length === 1) return schemas[0];
  return undefined;
}

// ── The compile entry ─────────────────────────────────────────────────────

/** Translate Panel (panel_config + seed formula) into the effective
 *  Formula that drives /view. Pure — no side effects, no store reads. */
export function compileForPanel(
  panel: Panel,
  schemas: AnnotationSchemaRead[],
): Formula {
  const base: Formula = panel.formula ?? ({} as Formula);

  // Workspace-bound: the saved Formula is the truth. The renderer still
  // reads panel_config for visual mapping (slice_by → row.keys[slice_by]),
  // but the engine-side spec stays as authored.
  if (panel.formula_ref) return base;

  const schema = pickSchema(panel, schemas);
  const cfg = panel.panel_config;

  switch (cfg.kind) {
    case 'pie': {
      const c = cfg as PieVizConfig;
      const group = [asDim(c.slice_by, schema), asDim(c.facet, schema)].filter(
        (d): d is Dimension => d !== null,
      );
      return { ...base, group, measures: [asMeasure(c.value)] };
    }

    case 'chart': {
      const c = cfg as ChartVizConfig;
      // Time interval overrides the default month bucket when x is a
      // date-shape field. The compile passes it into Dimension.interval
      // so the backend's date_trunc uses the right granularity.
      const ti = c.time_interval as Dimension['interval'] | undefined;
      const group = [asDim(c.x, schema, ti), asDim(c.color, schema)].filter(
        (d): d is Dimension => d !== null,
      );
      const measures = c.y && c.y.length > 0
        ? c.y.map(asMeasure)
        : [asMeasure('count')];
      return { ...base, group, measures };
    }

    case 'map': {
      const c = cfg as MapVizConfig;
      if (c.mode === 'Area Geometry') {
        const group = [asDim(c.position, schema), asDim(c.color, schema)].filter(
          (d): d is Dimension => d !== null,
        );
        // Color role doubles as the Area Geometry measure name when set; else count.
        return { ...base, group, measures: [asMeasure(c.color)] };
      }
      // Markers mode: list-mode (one row per annotation). Engine ships the
      // value blob; the renderer geocodes per-row by reading cfg.position.
      // No group/measures needed.
      return { ...base, group: [], measures: [] };
    }

    case 'table':
      // List-mode by default. Aggregate-mode tables happen when the
      // formula already declares measures (Workspace-authored stats
      // tables) — caller's responsibility, we just pass through.
      return base;

    case 'graph': {
      const c = cfg as GraphVizConfig;
      // Triplet source = one group dim on the triplet array path; the
      // backend's graph_stream uses formula.group[0].path as the
      // triplet field. Edge weight defaults to count().
      if (c.source) {
        const dim = asDim(c.source, schema);
        return {
          ...base,
          group: dim ? [dim] : [],
          measures: [asMeasure(c.edge_weight_field)],
        };
      }
      return base;
    }

    case 'measurements':
      // Pure Workspace-bound — the seed formula IS the spec.
      return base;

    case 'scatter': {
      const c = cfg as ScatterVizConfig;
      const group = [
        asDim(c.x, schema),
        asDim(c.y, schema),
        asDim(c.color, schema),
      ].filter((d): d is Dimension => d !== null);
      return { ...base, group, measures: [asMeasure(c.size)] };
    }
  }
}

/** True if the compiled formula carries enough spec to make a /view
 *  request worthwhile. Used by the renderer's enabled-flag and by the
 *  PanelConfigPopover's "is configured" predicate so they agree. */
export function isPanelConfigured(panel: Panel): boolean {
  // Workspace-bound is always configured.
  if (panel.formula_ref) return true;
  const cfg = panel.panel_config;
  switch (cfg.kind) {
    case 'pie':         return !!(cfg as PieVizConfig).slice_by;
    case 'chart':       return !!(cfg as ChartVizConfig).x
                              || ((cfg as ChartVizConfig).y?.length ?? 0) > 0;
    case 'map':         return !!(cfg as MapVizConfig).position;
    // Tables show all fields by default — no role needed to be "configured".
    case 'table':       return true;
    case 'graph':       return !!(cfg as GraphVizConfig).source;
    case 'measurements': return true;
    case 'scatter':     return !!((cfg as ScatterVizConfig).x && (cfg as ScatterVizConfig).y);
  }
}
