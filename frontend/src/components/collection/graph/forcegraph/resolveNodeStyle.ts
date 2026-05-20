import * as d3 from 'd3';
import type { GraphNode } from '../graphTypes';

// =============================================================================
// resolveNodeStyle — pure selection-precedence resolver. Given a node, the
// active selection state, the base entity-type color, and theme tokens, return
// the visual properties that should be applied. Both 2D (canvas) and 3D
// (Three.js material) renderers consume this so behavior is byte-identical.
//
// Precedence order (mirrors D3ForceGraph.tsx:944–987 verbatim):
//   1. mergeSelectedNodeIds  → +0.3 brighten, ring #f59e0b (amber-500), w=4
//   2. groupSelectedIds      → +0.15 brighten, ring #06b6d4 (cyan-500), w=3, dashed
//   3. highlightedNodeId     → +0.5 brighten, ring #2563eb (blue-600), w=3, scale=1.6
//   4. connectedNodeIds      → +0.2 brighten, ring #10b981 (emerald-500)
//   5. dimmed (when highlightedNodeId set & node not in any of the above)
//                            → opacity 0.4, fill darken(0.5), label = edgeLabel
//
// A node may be in multiple sets; the first match wins. The 16-combo test
// snapshots all set-membership combinations to pin this contract.
// =============================================================================

export interface NodeSelectionState {
  highlightedNodeId: string | null;
  connectedNodeIds: ReadonlySet<string>;
  /** When true, an asset / pin / edge-nav sub-network is active even with no
   *  single focused node. Drives the same dim treatment for non-member
   *  nodes as ``highlightedNodeId`` does. */
  subnetworkActive?: boolean;
  mergeSelectedNodeIds: ReadonlySet<string>;
  groupSelectedIds: ReadonlySet<string>;
}

export interface ThemeTokens {
  edgeStroke: string;
  nodeStroke: string;
  nodeLabel: string;
  edgeLabel: string;
  labelHalo: string;
}

export interface ResolvedNodeStyle {
  /** Fill color (hex) after brighten/darken cascade. */
  fillColor: string;
  /** Ring/stroke color, or null to fall through to theme.nodeStroke. */
  ringColor: string;
  /** Stroke width in px. */
  ringWidth: number;
  /** Dash pattern, or null for solid. 3D mode ignores this. */
  ringDash: [number, number] | null;
  /** 0..1; 0.4 when this node is dimmed against an active highlight. */
  opacity: number;
  /** Multiplier on base radius — 1.6 for highlighted, 1 otherwise. */
  scale: number;
  /** Color for the node's text label. */
  labelColor: string;
  /** Whether this node should always render its label regardless of zoom. */
  labelAlwaysVisible: boolean;
}

const RING_MERGE = '#f59e0b';
const RING_GROUP = '#06b6d4';
const RING_HIGHLIGHT = '#2563eb';
const RING_CONNECTED = '#10b981';

function safeColor(hex: string, mutate: (c: d3.RGBColor | d3.HSLColor) => d3.RGBColor | d3.HSLColor): string {
  const c = d3.color(hex);
  if (!c) return hex;
  return mutate(c).toString();
}

export function brighten(hex: string, amount: number): string {
  return safeColor(hex, c => c.brighter(amount));
}

export function darken(hex: string, amount: number): string {
  return safeColor(hex, c => c.darker(amount));
}

export function resolveNodeStyle(
  node: GraphNode,
  selection: NodeSelectionState,
  baseColor: string,
  theme: ThemeTokens,
): ResolvedNodeStyle {
  const id = node.id;
  const { highlightedNodeId: h, connectedNodeIds: c, mergeSelectedNodeIds: m, groupSelectedIds: g, subnetworkActive: sn } = selection;
  const isMerge = m.has(id);
  const isHi = h === id;
  const isGroup = g.has(id);
  const isConn = c.has(id);
  // Either a focal node is selected OR a sub-network lens is on. Both should
  // dim non-member nodes identically — the visual semantic is "this region
  // is in focus, the rest fades back".
  const focusActive = !!h || !!sn;

  // Fill cascade — order matches D3ForceGraph.tsx:957–962.
  let fill: string;
  if (isMerge) fill = brighten(baseColor, 0.3);
  else if (isHi) fill = brighten(baseColor, 0.5);
  else if (isGroup) fill = brighten(baseColor, 0.15);
  else if (isConn) fill = brighten(baseColor, 0.2);
  else if (focusActive && !isConn) fill = darken(baseColor, 0.5);
  else fill = baseColor;

  // Ring color cascade — order matches D3ForceGraph.tsx:967–971.
  let ringColor: string;
  if (isMerge) ringColor = RING_MERGE;
  else if (isGroup) ringColor = RING_GROUP;
  else if (isHi) ringColor = RING_HIGHLIGHT;
  else if (isConn) ringColor = RING_CONNECTED;
  else ringColor = theme.nodeStroke;

  // Stroke width — selected states stay prominent, default stroke thinner
  // than the legacy SVG renderer (2 → 1.25) so packed clusters don't read as
  // a chaotic mass of thick rings. Selected/group/merge widths preserved.
  const ringWidth = isMerge ? 4 : isGroup ? 3 : isHi ? 3 : 1.25;

  // Dashed only on group/marquee selection — D3ForceGraph.tsx:974.
  const ringDash: [number, number] | null = isGroup ? [4, 2] : null;

  // Dimmed when focus (focal node or sub-network) is active and this node
  // is not in any "interesting" set.
  const dimmed = focusActive && !isHi && !isConn && !isMerge;
  const opacity = dimmed ? 0.4 : 1;

  // Scale for highlighted only (radius 20 vs 12 = 1.667; nodeRadius() handles
  // the actual base; this carries the "highlighted" hint to renderers that
  // can scale via uniform multiplier).
  const scale = isHi ? 1.6 : 1;

  // Label color — D3ForceGraph.tsx:981–983.
  let labelColor: string;
  if (isMerge) labelColor = RING_MERGE;
  else if (dimmed) labelColor = theme.edgeLabel;
  else labelColor = theme.nodeLabel;

  // Selected/connected/merge nodes always render their label even at low zoom.
  const labelAlwaysVisible = isMerge || isHi || isGroup || isConn;

  return {
    fillColor: fill,
    ringColor,
    ringWidth,
    ringDash,
    opacity,
    scale,
    labelColor,
    labelAlwaysVisible,
  };
}
