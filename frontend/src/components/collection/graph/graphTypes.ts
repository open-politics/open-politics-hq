import * as d3 from 'd3';

// =============================================================================
// Public graph data types — shared by run-scoped, curated, and inline-preview
// graph surfaces. Naming intentionally generic ("Graph", not "Triplet") so the
// upcoming edges-as-first-class-entities work doesn't need a rename pass.
// =============================================================================

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  frequency?: number;
  sourceAssetCount?: number;
  sourceAssetIds?: number[];
  /** Raw annotation ids this node was extracted from. Derived fields like
   * ``sourceAssetIds`` can be built from these via the rows fetch. */
  annotationIds?: number[];
  aliases?: string[];
  properties?: Record<string, any>;
  // d3-force / react-force-graph mutates these during simulation — declared
  // here so consumers reading positions after a render see the right shape.
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  predicate: string;
  frequency?: number;
  weight?: number;
  confidence?: number;
  sourceAssetCount?: number;
  date?: string;
  context?: string;
  properties?: Record<string, any>;
}

// =============================================================================
// ActiveSubNetwork — single primitive for every "this region of the graph is
// in focus" lens. Each lens (node selection, asset highlight, keyboard-nav,
// pin board, future search/time-window/schema-filter) projects to the same
// shape:
//   - ``nodeIds`` membership (used by node painter for halos / pinning)
//   - ``edgeIds`` to highlight (driven by linkColor, linkWidth, label opacity,
//     painter halo, 3D label scale boost)
//   - a colour token (visual identity — blue ⇒ contextual node-focus,
//     amber ⇒ explicit lens like asset / pin / keyboard-nav)
//
// The graph reads from a list of active sub-networks rather than ad-hoc
// ``highlightedEdgeId`` / ``highlightedEdgeIds`` / per-edge incidence
// checks. List shape (vs. single) is intentional: we keep "one active at a
// time" today (last interaction wins, set by the parent), but the rendering
// cascade already iterates correctly so future composition (multi-lens,
// pin-board view + asset-lens, etc.) is a parent-side change only.
//
// Iteration order is the priority order — first match wins for color +
// thickness + halo. Asset/edge-nav lenses come first (amber), node-focus
// last (blue), so an edge that's both incident-to-focused-node AND in an
// active asset lens paints amber.
// =============================================================================

export type SubNetworkColor = 'blue' | 'amber';

export type SubNetworkSource =
  | 'node-focus'      // single node + its incident edges
  | 'asset-lens'      // edges spawned by a single asset's triplets
  | 'edge-nav'        // single edge — keyboard navigation / evidence-card hover
  | 'pin-set'         // pin board page — direct edges between pinned nodes
  | 'cooccurs-focus'; // relationship-as-a-lens — entities + edges between them

export interface ActiveSubNetwork {
  source: SubNetworkSource;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  color: SubNetworkColor;
  /** Optional label for future UI badges (e.g. "Asset 12", "Pins: cluster A"). */
  label?: string;
}

// =============================================================================
// View configuration — controls layout, display, and renderer behavior. Stored
// per-panel in ``panelConfig.settings.graphViewConfig`` (run-scoped) or via the
// caller's ``onGraphConfigChange`` callback (curated view). Inline preview
// hardcodes its own overrides.
//
// New fields in this rev:
//  - ``viewMode`` — '2d' (Canvas) | '3d' (Three.js, dynamic-imported)
//  - ``cooldownTicks`` — auto-stop simulation after N ticks
//  - ``labelMinScale`` — hide node labels below this zoom level (perf at scale)
//  - ``forceEngine`` — 'd3' (default) | 'ngraph' (faster settle for >10k nodes)
//  - 3D-only: ``cameraType``, ``sphereWidthSegments``, ``nodeOpacity3D``,
//    ``linkOpacity3D``
//
// Backward-compat: stored configs from older versions lack these fields and
// fall through ``{ ...defaultGraphViewConfig, ...stored }`` — no migration.
// =============================================================================

export interface GraphViewConfig {
  // Interaction
  zoomOnNodeClick: boolean;
  clickZoomScale: number;
  zoomTransitionMs: number;

  // Layout / forces
  chargeStrength: number;
  linkDistance: number;
  warmupTicks: number;
  cooldownTicks: number;
  forceEngine: 'd3' | 'ngraph';

  // Display
  showNodeLabels: boolean;
  /** When true, render labels for *all* nodes (sized by degree, faded by
   *  zoom/camera-distance for far-away ones). When false, only the top-N
   *  anchor nodes (highest degree) plus selection/hover state get labels.
   *  Default false — large graphs read better with anchor labels only. */
  showAllLabels: boolean;
  showEdgeLabels: boolean;
  labelFontSize: number;
  showEdgeArrows: boolean;
  showNodeIcons: boolean;
  /** Hide node labels when canvas zoom drops below this fraction. Selected,
   * connected, and hovered nodes always render their label. */
  labelMinScale: number;
  /** Hide edge labels when canvas zoom drops below this fraction. Hovered
   * edges and edges incident to the selected node always render. */
  edgeLabelMinScale: number;

  // Clustering
  clusterByType: boolean;
  clusterStrength: number;

  // Edge display
  edgeColorMode: 'uniform' | 'predicate';
  edgeWidthField: 'auto' | 'none' | string;
  edgeScaleLower: number | null;
  edgeScaleUpper: number | null;

  // Node extras
  showNodeProperties: boolean;

  // Fit
  autoFitOnLoad: boolean;

  // View mode (2D / 3D toggle)
  viewMode: '2d' | '3d';

  // 3D-only
  cameraType: 'perspective' | 'orthographic';
  sphereWidthSegments: number;
  nodeOpacity3D: number;
  linkOpacity3D: number;
}

export const defaultGraphViewConfig: GraphViewConfig = {
  zoomOnNodeClick: true,
  // 1.1 — a gentle bump-on-click that draws the eye without overshooting.
  // 1.2 felt a touch close on busy graphs. The user can still zoom
  // further manually.
  clickZoomScale: 1.1,
  zoomTransitionMs: 300,
  // Stronger default repulsion + longer settle than the legacy SVG renderer.
  // Canvas labels need more whitespace to stay legible vs SVG ``<text>`` which
  // could overflow without anti-aliasing artifacts. Live tuning still happens
  // in the popover.
  chargeStrength: -500,
  linkDistance: 180,
  warmupTicks: 100,
  cooldownTicks: 200,
  forceEngine: 'd3',
  showNodeLabels: true,
  // Anchor labels only by default — top-N highest-degree nodes plus the
  // current selection state. Large graphs read as a clean web with a
  // handful of orientation labels. Toggle ``showAllLabels`` (popover) to
  // render every node's label, sized by degree and faded by zoom in 2D
  // / camera distance in 3D so the dense interior stays legible.
  showAllLabels: false,
  // Edge labels on by default but zoom-gated (see ``edgeLabelMinScale``) so
  // dense regions stay readable while the connections themselves are
  // labelled when you zoom in. Hovered edges and edges incident to the
  // selected node always paint regardless of zoom.
  showEdgeLabels: true,
  labelFontSize: 12,
  showEdgeArrows: true,
  // Icons inside node circles read as "comicy" at the default zoom for
  // densely-connected clusters. Keep the option but make it opt-in — the
  // entity-type color (legend) carries the type signal cleanly enough.
  showNodeIcons: false,
  labelMinScale: 0.4,
  edgeLabelMinScale: 0.8,
  clusterByType: false,
  clusterStrength: 0.3,
  edgeColorMode: 'uniform',
  edgeWidthField: 'auto',
  edgeScaleLower: null,
  edgeScaleUpper: null,
  showNodeProperties: false,
  autoFitOnLoad: true,
  viewMode: '2d',
  cameraType: 'perspective',
  sphereWidthSegments: 12,
  nodeOpacity3D: 0.9,
  // 3D edge opacity. With our ``MeshBasicMaterial`` override (see
  // ForceGraph.tsx) edges paint at full RGB regardless of scene lighting,
  // so this multiplier alone controls how prominent they read. 0.6 keeps
  // them clearly visible against the dark canvas without flattening node
  // labels or edge labels behind them.
  linkOpacity3D: 0.6,
};

// =============================================================================
// Public helpers — used by the popover (edge-field availability detection) and
// by the painter hooks. Kept in this file so the public barrel only re-exports
// stable surface area.
// =============================================================================

const EDGE_PX_MIN = 1;
const EDGE_PX_MAX = 5;

export function detectEdgeFields(edges: GraphEdge[]): string[] {
  if (edges.length === 0) return [];
  const out = new Set<string>();
  for (const edge of edges) {
    if (edge.properties) {
      for (const key of Object.keys(edge.properties)) {
        if (['computed_weight', 'weight', 'confidence', 'date', 'context'].includes(key)) {
          out.add(key);
        }
      }
    }
    if (edge.weight !== undefined) out.add('weight');
    if (edge.confidence !== undefined) out.add('confidence');
    if (edge.date !== undefined) out.add('date');
    if (edge.context !== undefined) out.add('context');
  }
  return Array.from(out);
}

export function getEdgeFieldValue(e: GraphEdge, f: string): number {
  const direct = (e as any)[f];
  if (direct != null && typeof direct === 'number') return direct;
  const fromProps = e.properties?.[f];
  if (fromProps != null && typeof fromProps === 'number') return fromProps;
  return 1;
}

/** Compute { min, max } of a numeric field across edges. */
export function edgeFieldRange(edges: GraphEdge[], field: string): { min: number; max: number } | null {
  if (field === 'none' || edges.length === 0) return null;
  const resolved = field === 'auto'
    ? (detectEdgeFields(edges).includes('weight') ? 'weight'
      : edges.some(e => e.frequency !== undefined) ? 'frequency' : null)
    : field;
  if (!resolved) return null;
  const vals = edges.map(e => getEdgeFieldValue(e, resolved));
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

export function buildEdgeWidthFn(
  edges: GraphEdge[],
  field: GraphViewConfig['edgeWidthField'],
  scaleLower: number | null,
  scaleUpper: number | null,
): (edge: GraphEdge) => number {
  const uniform = (EDGE_PX_MIN + EDGE_PX_MAX) / 2;
  if (field === 'none') return () => uniform;

  if (field === 'auto') {
    const available = detectEdgeFields(edges);
    if (available.includes('computed_weight')) return buildEdgeWidthFn(edges, 'computed_weight', scaleLower, scaleUpper);
    if (available.includes('weight')) return buildEdgeWidthFn(edges, 'weight', scaleLower, scaleUpper);
    if (edges.some(e => e.frequency !== undefined)) return buildEdgeWidthFn(edges, 'frequency', scaleLower, scaleUpper);
    return () => uniform;
  }

  const range = edgeFieldRange(edges, field);
  if (!range || range.min === range.max) return () => uniform;

  const lo = scaleLower ?? range.min;
  const hi = scaleUpper ?? range.max;
  if (lo >= hi) return () => uniform;

  const scale = d3.scaleSqrt().domain([lo, hi]).range([EDGE_PX_MIN, EDGE_PX_MAX]).clamp(true);
  return (edge: GraphEdge) => scale(getEdgeFieldValue(edge, field));
}

export function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of edges) {
    map.set(e.sourceId, (map.get(e.sourceId) ?? 0) + 1);
    map.set(e.targetId, (map.get(e.targetId) ?? 0) + 1);
  }
  return map;
}

/** Node rendered radius based on connection count. Selected nodes render
 * larger (base 20 vs 12) so they're visually salient regardless of degree. */
export function nodeRadius(degree: number, isHighlighted: boolean = false): number {
  const base = isHighlighted ? 20 : 12;
  return Math.max(base, Math.min(30, base + degree * 1.5));
}
