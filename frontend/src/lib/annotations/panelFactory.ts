/**
 * Panel factory — constructs default :class:`Panel` instances for each
 * panel type. Each panel ships with:
 *
 * - an empty :class:`Formula` (the data spec — filled in by RolePicker)
 * - a typed :class:`PanelVizConfig` matching the panel type (the viz
 *   map — filled in by RolePicker)
 * - empty ``fields[]`` (projection — only used by rows view)
 * - empty ``scopes_in`` / ``merge_maps`` / ``time_source``
 * - a default ``grid_position``
 *
 * The RolePicker writes both ``formula`` (data side) and
 * ``panel_config`` (visual side) when the user picks roles. The renderer
 * reads both: ``formula`` runs through the engine via FormulaQuery;
 * ``panel_config`` drives visual channels.
 */

import { nanoid } from 'nanoid';
import type {
  Panel,
  PanelType,
  PanelVizConfig,
  PieVizConfig,
  ChartVizConfig,
  MapVizConfig,
  TableVizConfig,
  GraphVizConfig,
  MeasurementsVizConfig,
  ScatterVizConfig,
} from './types';
import type { Formula } from '@/client';

/** A blank Formula — pure filter, no group / measures / derives.
 *  The RolePicker fills this in as the user picks data-side roles. */
export function emptyFormula(opts: { id?: string; name?: string } = {}): Formula {
  return {
    id: opts.id ?? nanoid(),
    name: opts.name ?? 'untitled',
    description: undefined,
    schema_id: null,
    explosion: null,
    filter: { logic: 'and', conditions: [] },
    merge_maps: [],
    group: [],
    weight: null,
    measures: [],
    derives: [],
    snippet: null,
    output_keys: [],
    order_by: null,
    version: 1,
  } as unknown as Formula;
}

/** A per-type default panel_config — kind set, every role slot empty. */
export function defaultVizConfig(type: PanelType): PanelVizConfig {
  switch (type) {
    case 'pie':
      return {
        kind: 'pie',
        slice_by: null,
        value: null,
        facet: null,
        max_slices: null,
        legend: true,
      } as PieVizConfig;
    case 'chart':
      return {
        kind: 'chart',
        x: null,
        y: [],
        color: null,
        mark: 'timeline',
        time_interval: 'month',
        stacked: false,
        analytics_overlays: {},
        show_statistics: false,
      } as ChartVizConfig;
    case 'map':
      return {
        kind: 'map',
        position: null,
        mode: 'markers',
        color: null,
        label: [],
        geocode_source: null,
        show_labels: true,
        show_areas: false,
      } as MapVizConfig;
    case 'table':
      return {
        kind: 'table',
        columns: [],
        explode: null,
        sort: null,
        density: 'comfortable',
      } as TableVizConfig;
    case 'graph':
      return {
        kind: 'graph',
        source: null,
        target: null,
        edge_label: null,
        edge_weight_field: null,
        edge_weight_mode: 'count',
        forward_properties: [],
        node_group_by: null,
        edge_group_by: null,
        null_policy: 'skip',
        layout: { kind: 'force_directed', params: {} },
        dim_unmatched: true,
        edits: null,
      } as GraphVizConfig;
    case 'measurements':
      return {
        kind: 'measurements',
        display_mode: 'scalar',
        label: null,
      } as MeasurementsVizConfig;
    case 'scatter':
      return {
        kind: 'scatter',
        x: null,
        y: null,
        color: null,
        size: null,
        mark: 'dot',
        legend: true,
      } as ScatterVizConfig;
  }
}

/** Default grid size per panel type. Map/graph need more screen real
 *  estate; pie/observation are compact. */
function defaultGrid(type: PanelType): { x: number; y: number; w: number; h: number } {
  const w = { pie: 4, chart: 6, map: 6, table: 8, graph: 6, measurements: 3, scatter: 5 }[type];
  const h = { pie: 4, chart: 5, map: 6, table: 5, graph: 6, measurements: 2, scatter: 5 }[type];
  return { x: 0, y: 0, w, h };
}

/** Construct a fresh :class:`Panel` for ``type``. The caller is
 *  expected to call ``addPanel`` (in the store) which positions it on
 *  the grid; the ``grid_position`` here is a placeholder.
 */
export function makePanel(args: {
  type: PanelType;
  name?: string;
  id?: string;
}): Panel {
  const { type } = args;
  const id = args.id ?? nanoid();
  return {
    id,
    type,
    name: args.name ?? `${type[0].toUpperCase()}${type.slice(1)} panel`,
    description: undefined,
    formula: emptyFormula({ name: args.name }),
    formula_ref: null,
    fields: [],
    panel_config: defaultVizConfig(type),
    time_source: null,
    scopes_in: [],
    merge_maps: [],
    grid_position: defaultGrid(type),
    collapsed: false,
  };
}
