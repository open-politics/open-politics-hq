'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import dynamic from 'next/dynamic';
import { resolveEntityColor, resolvePredicateColor, type ColorOverrides } from '@/lib/annotations/colors';
import {
  buildDegreeMap,
  buildEdgeWidthFn,
  defaultGraphViewConfig,
  edgeFieldRange as edgeFieldRangePublic,
  nodeRadius,
  type ActiveSubNetwork,
  type GraphEdge,
  type GraphNode,
  type GraphViewConfig,
  type SubNetworkColor,
} from './graphTypes';
import { useThemeReads } from './forcegraph/useThemeReads';
import { useForcesEffect, applyForces } from './forcegraph/useForcesEffect';
import { useNodePainter2D } from './forcegraph/useNodePainter2D';
import { useLinkPainter2D } from './forcegraph/useLinkPainter2D';
import { useMarqueeSelection } from './forcegraph/useMarqueeSelection';
import { useGroupDrag } from './forcegraph/useGroupDrag';
import { useMaterialCache } from './forcegraph/useMaterialCache';
import { useLabelTextureCache } from './forcegraph/useLabelTextureCache';
import { useNodeThreeObject } from './forcegraph/useNodeThreeObject';
import { useLinkThreeObject } from './forcegraph/useLinkThreeObject';
import { useNodePositionUpdate3D } from './forcegraph/useNodePositionUpdate3D';
import { ZoomToolbar } from './forcegraph/ZoomToolbar';
import { EntityTypeLegend } from './forcegraph/EntityTypeLegend';
import { TopNodesList } from './forcegraph/TopNodesList';
import { Controls3DHelp } from './forcegraph/Controls3DHelp';

// =============================================================================
// Dynamic-imported renderers — Three.js (~600 KB) only ships when a panel is
// flipped to 3D. SSR is disabled because both libs touch ``window`` at module
// eval time.
// =============================================================================

const ForceGraph2D = dynamic(
  () => import('react-force-graph-2d').then(m => m.default ?? (m as any)),
  { ssr: false, loading: () => null },
) as any;

const ForceGraph3D = dynamic(
  () => import('react-force-graph-3d').then(m => m.default ?? (m as any)),
  { ssr: false, loading: () => null },
) as any;

// Re-export public symbols so the existing barrel keeps working.
export { defaultGraphViewConfig, edgeFieldRangePublic as edgeFieldRange };
export type { GraphNode, GraphEdge, GraphViewConfig };

// =============================================================================
// Imperative handle — exposed so consumers can drive search→focus, toolbar
// zoom, "re-run layout", and image export. The current D3ForceGraph had no
// equivalent (zoom buttons were internal); the new component formalizes it.
// =============================================================================

export interface ForceGraphHandle {
  zoomToFit(durationMs?: number, padding?: number): void;
  centerNode(id: string, durationMs?: number): void;
  setZoom(scale: number, durationMs?: number): void;
  getZoom(): number;
  resetView(durationMs?: number): void;
  reheatSimulation(): void;
  pauseSimulation(): void;
  resumeSimulation(): void;
  exportImage(format?: 'png' | 'jpeg'): Promise<Blob | null>;
  refresh(): void;
  getViewMode(): '2d' | '3d';
}

// =============================================================================
// Props — superset of legacy D3ForceGraphProps plus ``viewMode``,
// ``groupSelectedIds``/``onGroupSelectionChange`` (formerly internal), and a
// reserved ``highlightedEdgeId`` for the upcoming edges-as-entities work.
// =============================================================================

export interface ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  highlightedNodeId?: string | null;
  connectedNodeIds?: string[];
  mergeSelectedNodeIds?: string[];
  groupSelectedIds?: string[];
  onGroupSelectionChange?: (ids: string[]) => void;
  onNodeClick?: (node: GraphNode) => void;
  onNodeShiftClick?: (node: GraphNode) => void;
  /** Alt/Option-click handler. Conventionally used for "add to pin board"
   *  while ``onNodeShiftClick`` keeps its existing role for merge selection,
   *  so the two persistent multi-select primitives don't collide. */
  onNodeAltClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  onBackgroundClick?: () => void;
  autoResize?: boolean;
  config?: Partial<GraphViewConfig>;
  /** Persist-config callback — required for the in-canvas preset buttons
   *  (Rich detail, Randomize). When omitted, those buttons are hidden. */
  onConfigChange?: (config: GraphViewConfig) => void;
  colorOverrides?: ColorOverrides;
  hiddenEntityTypes?: Set<string>;
  hiddenPredicates?: Set<string>;
  onToggleEntityType?: (type: string) => void;
  typeIcons?: Record<string, string>;
  predicateArrows?: Record<string, 'forward' | 'backward' | 'both' | 'none'>;
  overlayState?: Map<string, 'promoted' | 'candidate' | 'rejected' | null>;
  /** Reserved for edges-as-first-class-entities work. No-op in v1. */
  highlightedEdgeId?: string | null;
  /** Multi-edge highlight set. Edges in this set get the same amber treatment
   *  as ``highlightedEdgeId`` — used for asset-scoped lenses where a single
   *  document contributes many edges that should all stand out together. */
  highlightedEdgeIds?: Set<string>;
  /** Pin-set sub-network: nodes pinned on the active pin board page. The
   *  amber lens applies to these nodes whether or not they're directly
   *  connected — the disconnect IS the signal. */
  pinNodeIds?: Set<string>;
  /** Pin-set sub-network: edges in this set form an explicit lens scoped to
   *  the active pin board page (direct connections between pinned nodes).
   *  Same amber treatment as the asset lens but a different source so the
   *  parent can compose them differently in the future. */
  pinNetworkEdges?: Set<string>;
  chrome?: 'full' | 'minimal';
  /** Explicit override of ``config.viewMode``. Inline-preview consumers pin
   * this to ``'2d'`` so the Three.js bundle never loads on detail-view
   * routes. The toolbar toggle in run-scoped / curated views writes to
   * ``config.viewMode`` instead, leaving this undefined. */
  viewMode?: '2d' | '3d';
  /** When true, suppresses the entity-type legend at canvas bottom — used by
   *  consumers whose node-detail HUD occupies the same strip. */
  legendHidden?: boolean;
  /** Relationship-as-a-lens dim cascade: when set with 1+ entity names,
   *  every node whose label matches and every edge touching such a node
   *  becomes the focused sub-network. Same dim treatment as the node-focus
   *  cascade — context preserved, focus clear. The set is matched
   *  case-insensitively against ``GraphNode.label`` and ``aliases``.
   *  When 2+ names are passed, edges between the focused nodes are the
   *  primary highlight (the canonical A↔B comparison view); edges that
   *  touch only one focused node still light up so adjacent context is
   *  visible without becoming the centerpiece. */
  focusedEntityNames?: Set<string>;
}

// =============================================================================
// Helper: format-agnostic alpha. Works for #rgb, #rrggbb, rgb()/rgba(), and
// oklch()/oklab() — the latter two land in our dark-mode CSS vars. Falls
// back to wrapping the original color in ``color-mix(in srgb, X alpha%,
// transparent)`` for anything we can't parse, which all evergreen browsers
// support.
// =============================================================================

function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  // #rgb / #rrggbb — append 2-digit hex alpha.
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const aa = Math.round(a * 255).toString(16).padStart(2, '0');
    return `${hex}${aa}`;
  }
  // rgb(R G B) or rgb(R, G, B) — convert to rgba.
  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length === 3) return `rgba(${parts.join(', ')}, ${a})`;
  }
  // oklch / oklab / hsl / lab / lch / etc — color-mix is the universal path.
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

// =============================================================================
// Multiplicatively darken an edge colour. Used in the 3D ambient-dim cascade
// where alpha modulation isn't available (the lib eats alpha and uses a
// uniform ``linkOpacity`` multiplier). Multiplying RGB toward black gives
// the visually-similar "fade against dark background" effect without
// stepping on the opacity slider. Handles ``#rrggbb`` / ``#rgb`` (predicate
// palette) and ``rgb(R, G, B)`` (theme tokens). Anything else passes through
// unchanged — the dim cascade just no-ops for that edge rather than blowing
// up rendering.
// =============================================================================

// Sub-network colour-token → hex. ``amber`` is the explicit-lens colour
// (asset highlight, keyboard nav, future pin board); ``blue`` is the
// contextual node-focus colour. Kept as a small lookup so we have one
// authoritative palette for the highlight cascade across linkColor,
// linkWidth, painter halo, and 3D label sprites.
const SUB_NETWORK_HEX: Record<SubNetworkColor, string> = {
  amber: '#f59e0b',
  blue: '#3b82f6',
};

function darkenColor(color: string, factor: number): string {
  const f = Math.max(0, Math.min(1, factor));
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = parseInt(hex.slice(1, 3), 16) * f;
    const g = parseInt(hex.slice(3, 5), 16) * f;
    const b = parseInt(hex.slice(5, 7), 16) * f;
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length === 3) {
      const [r, g, b] = parts.map(p => parseFloat(p) * f);
      return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
    }
  }
  return color;
}

// =============================================================================
// Helper: deterministic 0..1 from a string id. Used to seed the per-node z
// jitter so the same node lands in the same half-space across mode flips.
// =============================================================================

function hashStringToFloat(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert to 0..1
  return ((h >>> 0) % 10000) / 10000;
}

// =============================================================================
// Helper: arrow direction lookup with case-insensitive predicate match.
// =============================================================================

function getArrowDir(
  predicate: string,
  predicateArrows: Record<string, 'forward' | 'backward' | 'both' | 'none'> | undefined,
  showEdgeArrows: boolean,
): 'forward' | 'backward' | 'both' | 'none' {
  if (!showEdgeArrows) return 'none';
  if (!predicateArrows) return 'forward';
  const lower = predicate?.toLowerCase?.() ?? '';
  for (const [k, v] of Object.entries(predicateArrows)) {
    if (k.toLowerCase() === lower) return v;
  }
  return 'forward';
}

// =============================================================================
// Component
// =============================================================================

export const ForceGraph = forwardRef<ForceGraphHandle, ForceGraphProps>(function ForceGraph(props, fwdRef) {
  const {
    nodes,
    edges,
    width: propWidth = 800,
    height: propHeight = 600,
    highlightedNodeId = null,
    connectedNodeIds = [],
    mergeSelectedNodeIds = [],
    groupSelectedIds: propGroupSelectedIds,
    onGroupSelectionChange,
    onNodeClick,
    onNodeShiftClick,
    onNodeAltClick,
    onEdgeClick,
    onBackgroundClick,
    autoResize = false,
    config: configOverride = {},
    onConfigChange,
    colorOverrides,
    hiddenEntityTypes,
    hiddenPredicates,
    onToggleEntityType,
    typeIcons,
    predicateArrows,
    highlightedEdgeId = null,
    highlightedEdgeIds,
    pinNodeIds,
    pinNetworkEdges,
    chrome = 'full',
    viewMode: viewModeProp,
    legendHidden = false,
    focusedEntityNames,
  } = props;

  const config: GraphViewConfig = useMemo(() => ({
    ...defaultGraphViewConfig,
    ...configOverride,
  }), [configOverride]);

  // viewMode resolution: explicit prop > config > default
  const viewMode: '2d' | '3d' = viewModeProp ?? config.viewMode ?? '2d';

  const containerRef = useRef<HTMLDivElement>(null);
  const ref2D = useRef<any>(undefined);
  const ref3D = useRef<any>(undefined);
  const activeRef = viewMode === '2d' ? ref2D : ref3D;

  // ---- Auto-resize via ResizeObserver, mirrors D3ForceGraph.tsx:328–357 ----
  const [dimensions, setDimensions] = useState({ width: propWidth, height: propHeight });
  useEffect(() => {
    if (!autoResize || !containerRef.current) return;
    let timeout: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          if (w > 0 && h > 0) {
            setDimensions(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
          }
        }
      }, 80);
    });
    ro.observe(containerRef.current);
    return () => { clearTimeout(timeout); ro.disconnect(); };
  }, [autoResize]);
  const width = autoResize ? dimensions.width : propWidth;
  const height = autoResize ? dimensions.height : propHeight;

  // ---- Theme + memos ----
  const theme = useThemeReads();
  const degreeMap = useMemo(() => buildDegreeMap(edges), [edges]);
  const edgeWidthFn = useMemo(
    () => buildEdgeWidthFn(edges, config.edgeWidthField, config.edgeScaleLower, config.edgeScaleUpper),
    [edges, config.edgeWidthField, config.edgeScaleLower, config.edgeScaleUpper],
  );

  // Top-N "anchor" nodes by degree — their labels always render, regardless of
  // zoom level. Gives the user a permanent orientation map even when most
  // labels are hidden by the zoom gate. Falls back to all nodes if the graph
  // has fewer than the cap.
  const PINNED_LABEL_TOP_N = 10;
  const pinnedNodeIds = useMemo<Set<string>>(() => {
    if (nodes.length <= PINNED_LABEL_TOP_N) return new Set(nodes.map(n => n.id));
    const sorted = [...nodes].sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0));
    return new Set(sorted.slice(0, PINNED_LABEL_TOP_N).map(n => n.id));
  }, [nodes, degreeMap]);

  const entityTypeLegend = useMemo(() => {
    const typeMap = new Map<string, number>();
    for (const n of nodes) {
      if (n.type) {
        const t = n.type.toUpperCase();
        typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
      }
    }
    return Array.from(typeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        color: resolveEntityColor(type, colorOverrides),
        count,
      }));
  }, [nodes, colorOverrides]);

  const hiddenTypes = hiddenEntityTypes ?? EMPTY_SET;
  const hiddenPreds = hiddenPredicates ?? EMPTY_SET;

  // ---- Selection state ----
  // Group selection: if parent provides ``groupSelectedIds``, it's controlled.
  // Otherwise, manage internally and notify on change.
  const [internalGroupIds, setInternalGroupIds] = useState<string[]>([]);
  const groupSelectedIds = propGroupSelectedIds ?? internalGroupIds;
  const setGroupSelectedIds = useCallback((ids: string[]) => {
    if (propGroupSelectedIds !== undefined) {
      // Controlled — defer to parent
      onGroupSelectionChange?.(ids);
    } else {
      setInternalGroupIds(ids);
      onGroupSelectionChange?.(ids);
    }
  }, [propGroupSelectedIds, onGroupSelectionChange]);

  // ``subnetworkActive`` folds asset-lens / pin-set / edge-nav / cooccurs-
  // focus into the same dim cascade focused-node mode triggers. Mirrors the
  // conditions in ``activeSubNetworks`` (computed below) without depending
  // on it — both read the same source props.
  const focusedNamesActive = !!focusedEntityNames && focusedEntityNames.size > 0;
  const subnetworkActive = (
    (pinNodeIds != null && pinNodeIds.size > 0)
    || (highlightedEdgeIds != null && highlightedEdgeIds.size > 0)
    || !!highlightedEdgeId
    || focusedNamesActive
  );
  const selection = useMemo(() => ({
    highlightedNodeId,
    connectedNodeIds: new Set(connectedNodeIds),
    mergeSelectedNodeIds: new Set(mergeSelectedNodeIds),
    groupSelectedIds: new Set(groupSelectedIds),
    subnetworkActive,
  }), [highlightedNodeId, connectedNodeIds, mergeSelectedNodeIds, groupSelectedIds, subnetworkActive]);

  // ---- Hover state (drives canvas hover halo + tooltip styling) ----
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  // ---- Zoom tracking (2D only) ----
  // Stored in a ref because zoom changes fire rapidly during pinch/wheel and
  // we don't need re-renders for them — accessor callbacks (``linkColor``,
  // ``linkWidth``) are re-invoked per paint by the lib, and they read this
  // ref to taper edge alpha as the user zooms out. Without that taper, dense
  // graphs paint as a flat mass of bright lines at low zoom.
  const zoomRef = useRef(1);
  const handleZoom = useCallback((t: { k: number; x: number; y: number }) => {
    zoomRef.current = t.k;
  }, []);

  // ---- Force config wiring ----
  useForcesEffect(activeRef, nodes, edges, config, viewMode);

  // First-tick force-set + reheat. The dynamic-imported lib component
  // mounts AFTER the parent's first useEffect runs, so ``ref.current`` is
  // null when ``useForcesEffect`` first fires. The lib then mounts with
  // default forces (charge -30, link 30) and runs warmup → nodes clump.
  // Without this fallback, our overrides never get applied on initial load
  // (the user-visible "tight cluster on first 2D mount" bug).
  //
  // ``onEngineTick`` is the earliest hook that's guaranteed to fire AFTER
  // the lib has finished its data-update cycle and ``state.layout`` is set.
  // We use it to (1) write forces if they haven't been written yet, and
  // (2) reheat on tick 2 so the just-written forces drive the cooldown.
  const tickedRef = useRef<{ key: string; ticks: number }>({ key: '', ticks: 0 });
  const handleEngineTick = useCallback(() => {
    const key = `${viewMode}|${nodes.length}|${edges.length}`;
    if (tickedRef.current.key !== key) {
      tickedRef.current = { key, ticks: 0 };
    }
    tickedRef.current.ticks += 1;
    if (tickedRef.current.ticks === 1) {
      // First tick — apply our forces NOW, before the simulation cools.
      // Idempotent re: useForcesEffect (which also calls applyForces);
      // last-writer-wins semantics on d3-force's setters.
      applyForces(activeRef.current, nodesRef.current, config, viewMode);
    } else if (tickedRef.current.ticks === 2) {
      // Reheat on tick 2 so the force values written above drive the
      // remaining cooldown ticks. Safe: state.layout is definitely set by
      // now (the lib literally just called layoutTick to fire this).
      try {
        activeRef.current?.d3ReheatSimulation?.();
      } catch {
        // No-op: lib will retry on next data change.
      }
    }
  }, [viewMode, nodes.length, edges.length, config, activeRef]);

  // ---- ActiveSubNetwork synthesis ----
  // Every "this region is in focus" lens (node selection, asset highlight,
  // keyboard-nav single edge, future pin board) projects to the same
  // ``ActiveSubNetwork`` shape. Built once per highlight change and read by
  // every downstream renderer (linkColor, linkWidth, painter, 3D label
  // sprite). First match wins for colour + halo; amber lenses are inserted
  // before blue node-focus so an edge that's both incident-to-focus AND in
  // an active asset lens paints amber.
  const activeSubNetworks: ActiveSubNetwork[] = useMemo(() => {
    const out: ActiveSubNetwork[] = [];
    const pinActive = !!pinNodeIds && pinNodeIds.size > 0;
    const assetActive = !!highlightedEdgeIds && highlightedEdgeIds.size > 0;
    // Pin + asset compose as UNION ("additive") — every pin-set edge AND
    // every asset edge lights up. Single amber sub-network with both
    // contributions merged. Adding a lens always adds highlights, never
    // removes them. The empty-intersection case (asset doesn't touch pin
    // set) just means each lens contributes its own edges independently.
    //
    // Single-lens cases collapse out of the union naturally: pin-only =
    // pin contribution; asset-only = asset contribution.
    if (pinActive || assetActive) {
      const edgeIds = new Set<string>();
      const nodeIds = new Set<string>();
      if (pinActive) {
        for (const id of pinNodeIds!) nodeIds.add(id);
        if (pinNetworkEdges) {
          for (const id of pinNetworkEdges) edgeIds.add(id);
        }
      }
      if (assetActive) {
        for (const e of edges) {
          if (highlightedEdgeIds!.has(e.id)) {
            edgeIds.add(e.id);
            nodeIds.add(e.sourceId);
            nodeIds.add(e.targetId);
          }
        }
      }
      out.push({
        source: pinActive ? 'pin-set' : 'asset-lens',
        nodeIds,
        edgeIds,
        color: 'amber',
      });
    } else if (highlightedEdgeId) {
      const nodeIds = new Set<string>();
      for (const e of edges) {
        if (e.id === highlightedEdgeId) {
          nodeIds.add(e.sourceId);
          nodeIds.add(e.targetId);
          break;
        }
      }
      out.push({
        source: 'edge-nav',
        nodeIds,
        edgeIds: new Set([highlightedEdgeId]),
        color: 'amber',
      });
    }
    if (highlightedNodeId) {
      const edgeIds = new Set<string>();
      const nodeIds = new Set<string>([highlightedNodeId]);
      for (const e of edges) {
        if (e.sourceId === highlightedNodeId || e.targetId === highlightedNodeId) {
          edgeIds.add(e.id);
          nodeIds.add(e.sourceId);
          nodeIds.add(e.targetId);
        }
      }
      out.push({ source: 'node-focus', nodeIds, edgeIds, color: 'blue' });
    }
    // Relationship-as-a-lens: every node whose label / alias matches a
    // focused name lights up; edges between any two focused nodes are the
    // primary highlight, edges touching exactly one focused node are
    // included so the neighborhood stays legible. Single-name fallback
    // ("focus on X") behaves like node-focus but addressed by name —
    // useful when the panel knows the entity but not the GraphNode id.
    if (focusedNamesActive) {
      const wanted = new Set<string>();
      focusedEntityNames!.forEach(n => wanted.add(n.toLowerCase()));
      const focusedNodeIds = new Set<string>();
      for (const n of nodes) {
        if (wanted.has((n.label ?? '').toLowerCase())) {
          focusedNodeIds.add(n.id);
          continue;
        }
        if (n.aliases) {
          for (const a of n.aliases) {
            if (wanted.has(a.toLowerCase())) {
              focusedNodeIds.add(n.id);
              break;
            }
          }
        }
      }
      const edgeIds = new Set<string>();
      const nodeIds = new Set<string>(focusedNodeIds);
      // Single anchor → light up everything touching it.
      // Multi anchor  → light up edges between focused nodes (canonical
      // A↔B view) + edges where at least one end is focused (so adjacent
      // context stays visible without becoming the centerpiece).
      const multi = focusedNodeIds.size > 1;
      for (const e of edges) {
        const srcF = focusedNodeIds.has(e.sourceId);
        const tgtF = focusedNodeIds.has(e.targetId);
        if (multi) {
          if (srcF || tgtF) {
            edgeIds.add(e.id);
            nodeIds.add(e.sourceId);
            nodeIds.add(e.targetId);
          }
        } else if (srcF || tgtF) {
          edgeIds.add(e.id);
          nodeIds.add(e.sourceId);
          nodeIds.add(e.targetId);
        }
      }
      out.push({ source: 'cooccurs-focus', nodeIds, edgeIds, color: 'blue' });
    }
    return out;
  }, [edges, nodes, highlightedEdgeId, highlightedEdgeIds, pinNodeIds, pinNetworkEdges, highlightedNodeId, focusedNamesActive, focusedEntityNames]);

  // Membership lookup helper. Returns the first sub-network containing this
  // edge (priority order = insertion order; amber wins over blue). Hot-path
  // sized: typically 0–2 entries, 0–1 today.
  const subNetForEdge = useCallback((edgeId: string): ActiveSubNetwork | null => {
    for (const sn of activeSubNetworks) {
      if (sn.edgeIds.has(edgeId)) return sn;
    }
    return null;
  }, [activeSubNetworks]);

  // ---- 2D paint callbacks ----
  const paintNode2D = useNodePainter2D({
    theme,
    colorOverrides,
    typeIcons,
    selection,
    hoveredNodeId,
    config,
    degreeMap,
    pinnedNodeIds,
  });

  const paintLink2D = useLinkPainter2D({
    theme,
    colorOverrides,
    predicateArrows,
    config,
    hoveredLinkId,
    activeSubNetworks,
    degreeMap,
    edgeWidthFn,
  });

  // ---- 3D node object builder ----
  const materialCache = useMaterialCache();
  const labelCache = useLabelTextureCache(theme);
  const buildNodeThreeObject = useNodeThreeObject({
    theme,
    colorOverrides,
    selection,
    config,
    degreeMap,
    pinnedNodeIds,
    materialCache,
    labelCache,
  });

  // 3D node label visibility — anchors always show, the rest fade by camera
  // distance when ``showAllLabels`` is on. Visibility flips per-frame on the
  // sprite stashed in ``group.userData.labelSprite`` (set in useNodeThreeObject).
  const updateNodePosition3D = useNodePositionUpdate3D({
    config,
    getCamera: () => {
      try { return ref3D.current?.camera?.(); } catch { return undefined; }
    },
    getGraphBbox: () => {
      try { return ref3D.current?.getGraphBbox?.() ?? null; } catch { return null; }
    },
  });

  // ---- 3D edge label builder + per-frame opacity update ----
  // Mirrors the 2D edge-label cascade: hovered, selection-incident, or
  // camera-near. Labels live as Sprites inside the lib's link group; the
  // ``linkPositionUpdate`` callback refreshes opacity each render frame.
  const { linkThreeObject: buildLinkThreeObject, linkPositionUpdate: updateLinkPosition } = useLinkThreeObject({
    theme,
    colorOverrides,
    config,
    hoveredLinkId,
    activeSubNetworks,
    getCamera: () => {
      try { return ref3D.current?.camera?.(); } catch { return undefined; }
    },
    getGraphBbox: () => {
      try { return ref3D.current?.getGraphBbox?.() ?? null; } catch { return null; }
    },
  });

  // ---- Group-drag handlers ----
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const groupSelectedSet = selection.groupSelectedIds;
  const { onNodeDragStart, onNodeDrag, onNodeDragEnd } = useGroupDrag({
    groupSelectedIds: groupSelectedSet,
    getNodes: () => nodesRef.current,
  });

  // ---- Marquee (2D only) ----
  const marquee = useMarqueeSelection({
    enabled: viewMode === '2d',
    graphRef: ref2D,
    containerRef,
    nodes,
    onSelectionChange: setGroupSelectedIds,
    onClear: () => {
      setGroupSelectedIds([]);
      onBackgroundClick?.();
    },
    // Alt+click on a node — the overlay would otherwise swallow it. Route
    // through the same handler the canvas's node-click would dispatch in
    // 3D / non-overlay paths so pinning works uniformly.
    onAltClickNode: onNodeAltClick,
  });

  // ---- 2D↔3D mode-flip: seed/cleanup z so the 3D simulation has structure ----
  // The lib's d3-force-3d sim updates z only when a charge force operating in
  // 3D acts on a non-zero pairwise z delta. If every z is exactly 0 (or all
  // equal), pairwise deltas are 0 and no z motion happens — the graph stays
  // flat. So whenever we enter 3D, we ensure each node has a small, distinct
  // z perturbation to break symmetry; the simulation does the rest.
  const lastViewModeRef = useRef(viewMode);
  useEffect(() => {
    if (viewMode === '3d') {
      const SPREAD = 60;
      const NEAR_ZERO = 1; // any |z| below this counts as "collapsed"
      let needsJitter = true;
      for (const n of nodes as any[]) {
        if (typeof n.z === 'number' && Math.abs(n.z) > NEAR_ZERO) {
          needsJitter = false;
          break;
        }
      }
      if (needsJitter) {
        for (const n of nodes as any[]) {
          // Spread keyed off id so the same node lands in roughly the same
          // half-space across mode flips — keeps the user's mental map.
          const seed = hashStringToFloat(n.id);
          n.z = (seed - 0.5) * SPREAD;
          if (n.vz == null) n.vz = 0;
        }
      }
    }
    if (lastViewModeRef.current === '3d' && viewMode === '2d') {
      // 3D → 2D: clear any pinned z so the next 3D entry can re-jitter.
      for (const n of nodes as any[]) {
        if (n.fz != null) n.fz = null;
      }
    }
    lastViewModeRef.current = viewMode;
  }, [viewMode, nodes]);

  // ---- Background click ----
  // Force a paint nudge after clearing selection. Once the simulation has
  // cooled (cooldownTicks elapsed) react-force-graph-2d only repaints in
  // response to mouse interaction or simulation reheat. A bare prop-change
  // re-render isn't enough — which is what produces the user-visible "labels
  // disappear after empty-space click, only zoom/hover brings them back"
  // behavior. Re-issuing the current zoom is the lightest documented method
  // to trigger an internal re-render without disturbing position or scale.
  const handleBackgroundClick = useCallback(() => {
    setGroupSelectedIds([]);
    onBackgroundClick?.();
    if (viewMode === '2d') {
      requestAnimationFrame(() => {
        const z = ref2D.current?.zoom?.();
        if (typeof z === 'number') ref2D.current?.zoom?.(z, 0);
      });
    }
  }, [onBackgroundClick, setGroupSelectedIds, viewMode]);

  // ---- Node click + shift-click + alt-click ----
  // shift → merge selection (transient); alt → pin (persistent); plain → focus.
  const handleNodeClick = useCallback((node: any, event: MouseEvent) => {
    if (event?.shiftKey && onNodeShiftClick) {
      onNodeShiftClick(node as GraphNode);
    } else if (event?.altKey && onNodeAltClick) {
      onNodeAltClick(node as GraphNode);
    } else {
      onNodeClick?.(node as GraphNode);
    }
  }, [onNodeClick, onNodeShiftClick, onNodeAltClick]);

  const handleLinkClick = useCallback((link: any) => {
    onEdgeClick?.(link as GraphEdge);
  }, [onEdgeClick]);

  // ---- Tooltip strings ----
  const nodeLabel = useCallback((node: any) => {
    const n = node as GraphNode;
    const parts = [n.label, `Type: ${n.type}`];
    if (n.frequency && n.frequency > 1) parts.push(`Frequency: ${n.frequency}`);
    if (n.sourceAssetCount) parts.push(`Sources: ${n.sourceAssetCount}`);
    const deg = degreeMap.get(n.id) ?? 0;
    if (deg > 0) parts.push(`Connections: ${deg}`);
    return parts.join('<br/>');
  }, [degreeMap]);

  const linkLabel = useCallback((link: any) => {
    const e = link as GraphEdge;
    const parts = [e.predicate];
    if (e.weight != null) parts.push(`weight: ${e.weight}`);
    if (e.confidence != null) parts.push(`confidence: ${e.confidence}`);
    if (e.frequency != null && e.frequency > 1) parts.push(`frequency: ${e.frequency}`);
    if (e.context) parts.push(e.context.length > 80 ? e.context.slice(0, 80) + '...' : e.context);
    return parts.join('<br/>');
  }, []);

  // ---- Visibility accessors ----
  const nodeVisibility = useCallback((node: any) => {
    const n = node as GraphNode;
    return !hiddenTypes.has((n.type ?? '').toUpperCase());
  }, [hiddenTypes]);

  const linkVisibility = useCallback((link: any) => {
    const e = link as GraphEdge & { source?: GraphNode; target?: GraphNode };
    if (hiddenPreds.has(e.predicate)) return false;
    const srcType = (typeof e.source === 'object' ? e.source?.type : null)?.toUpperCase();
    const tgtType = (typeof e.target === 'object' ? e.target?.type : null)?.toUpperCase();
    if (srcType && hiddenTypes.has(srcType)) return false;
    if (tgtType && hiddenTypes.has(tgtType)) return false;
    return true;
  }, [hiddenTypes, hiddenPreds]);

  // ---- Edge color / width / arrow accessors ----
  // Format-agnostic alpha: appending "33" only works for #rrggbb. With oklch
  // strings (used in dark mode), `${oklch(...)}33` is invalid and canvas
  // falls back to transparent black — manifests as "edges invisible on dark
  // mode". ``withAlpha`` rebuilds the color in a format that supports alpha
  // for both inputs.
  //
  // Edge alpha is a product of two factors:
  //   1. selection alpha — edges in the active sub-network keep alpha 1,
  //      others drop to 0.2 when any sub-network is active
  //   2. zoom alpha — at zoom < 1 (zoomed out) edges fade so dense graphs
  //      don't paint as a solid white mat. Floored at 0.35 so very-zoomed
  //      out is still readable. Selected/hovered edges bypass via the
  //      painter's hover halo, so this taper is purely about ambient mass.
  const linkColor = useCallback((link: any) => {
    const e = link as GraphEdge;
    const sn = subNetForEdge(e.id);
    if (sn) {
      return SUB_NETWORK_HEX[sn.color];
    }

    let baseColor: string;
    if (config.edgeColorMode === 'predicate') {
      baseColor = resolvePredicateColor(e.predicate, colorOverrides);
    } else {
      baseColor = theme.edgeStroke;
    }

    const anyActive = activeSubNetworks.length > 0;

    // 3D path: alpha modulation is unavailable (Three.Color discards alpha,
    // and the lib's ``linkOpacity`` material multiplier is uniform). Dim
    // non-focal edges by darkening RGB toward black instead — visually
    // equivalent to alpha-against-dark-bg, no double-dim risk with
    // ``linkOpacity3D``.
    if (viewMode === '3d') {
      if (anyActive) return darkenColor(baseColor, 0.3);
      return baseColor;
    }

    let alpha = anyActive ? 0.2 : 1;

    const k = zoomRef.current;
    if (k < 1) {
      // Asymmetric taper: light mode the bg blends "up" to gray so a 0.35
      // floor still reads. Dark mode the bg is near-black, so the same
      // floor makes edges look black-on-black. Floor at 0.6 is a compromise
      // — enough softening to break up the "solid white mat" feel at low
      // zoom in light mode, while keeping dark-mode edges visible.
      const zoomAlpha = Math.max(0.6, Math.min(1, 0.65 + (k - 0.4) * 0.7));
      alpha *= zoomAlpha;
    }

    return alpha < 1 ? withAlpha(baseColor, alpha) : baseColor;
  }, [activeSubNetworks, subNetForEdge, config.edgeColorMode, colorOverrides, theme.edgeStroke, viewMode]);

  const linkWidth = useCallback((link: any) => {
    const e = link as GraphEdge;
    const base = edgeWidthFn(e);
    // Thicken amber sub-network edges (asset lens / edge nav) so they read
    // on busy graphs; blue (node-focus) keeps base width — colour alone is
    // enough contrast there, thickening competes with the amber lens.
    const sn = subNetForEdge(e.id);
    if (sn?.color === 'amber') return base * 2.5 + 1;
    return base;
  }, [edgeWidthFn, subNetForEdge]);

  // S6: curvature map for parallel edges. When two predicates connect the
  // same node pair, fan them apart so edge labels don't stack at a single
  // midpoint. Single-edge connections stay perfectly straight.
  const curvatureByEdgeId = useMemo(() => {
    const groups = new Map<string, GraphEdge[]>();
    for (const e of edges) {
      const a = e.sourceId < e.targetId ? e.sourceId : e.targetId;
      const b = e.sourceId < e.targetId ? e.targetId : e.sourceId;
      const key = `${a}|${b}`;
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    }
    const result = new Map<string, number>();
    for (const list of groups.values()) {
      if (list.length === 1) {
        result.set(list[0].id, 0);
        continue;
      }
      // Distribute curvatures around 0: e.g. 3 edges → -0.3, 0, +0.3
      const step = 0.25;
      const offset = (list.length - 1) / 2;
      list.forEach((edge, i) => {
        const slot = (i - offset) * step;
        // Direction flips when source/target are swapped from the canonical
        // (sorted) pair, so curvature stays consistent visually.
        const a = edge.sourceId < edge.targetId ? edge.sourceId : edge.targetId;
        const direction = edge.sourceId === a ? 1 : -1;
        result.set(edge.id, slot * direction);
      });
    }
    return result;
  }, [edges]);

  const linkCurvature = useCallback((link: any) => {
    const curv = curvatureByEdgeId.get((link as GraphEdge).id) ?? 0;
    // Stash on link so the custom canvas painter can compute the bezier
    // midpoint (for hovered edge labels and backward-arrow placement).
    (link as any).__curvature = curv;
    return curv;
  }, [curvatureByEdgeId]);

  const linkArrowLength = useCallback((link: any) => {
    const e = link as GraphEdge;
    const dir = getArrowDir(e.predicate, predicateArrows, config.showEdgeArrows);
    return dir === 'forward' || dir === 'both' ? 5 : 0;
  }, [predicateArrows, config.showEdgeArrows]);

  const linkArrowColor = useCallback((link: any) => {
    if (config.edgeColorMode === 'predicate') {
      return resolvePredicateColor((link as GraphEdge).predicate, colorOverrides);
    }
    return theme.edgeStroke;
  }, [config.edgeColorMode, colorOverrides, theme.edgeStroke]);

  // ---- 3D custom link material ----
  // The lib's default material for cylinder-thickness links is
  // ``MeshLambertMaterial`` — a lit material that needs scene lighting to
  // show its colour. On dark backgrounds the lit pixels darken to the point
  // of looking solid black, which is exactly the user-visible "edges are
  // black on 3D dark mode" symptom we couldn't shift by tuning opacity or
  // theme tokens. Overriding with ``MeshBasicMaterial`` removes lighting
  // from the equation: the cylinder paints in its full RGB regardless of
  // the lights in the scene. Materials are cached by (color, opacity) so
  // we don't allocate one per link per frame.
  const linkMaterialCache = useRef<Map<string, THREE.MeshBasicMaterial>>(new Map());
  useEffect(() => () => {
    for (const m of linkMaterialCache.current.values()) m.dispose();
    linkMaterialCache.current.clear();
  }, []);

  const linkMaterial3D = useCallback((link: any) => {
    const color = linkColor(link);
    const opacity = config.linkOpacity3D;
    const key = `${color}|${opacity}`;
    let mat = linkMaterialCache.current.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      });
      linkMaterialCache.current.set(key, mat);
    }
    return mat;
  }, [linkColor, config.linkOpacity3D]);

  // ---- Imperative handle delegating to active ref ----
  useImperativeHandle(fwdRef, (): ForceGraphHandle => ({
    zoomToFit: (durationMs = 400, padding) => {
      const p = padding ?? computeAutoFitPadding(nodesRef.current.length, viewMode, Math.min(width, height));
      activeRef.current?.zoomToFit?.(durationMs, p);
    },
    centerNode: (id, durationMs = 600) => {
      const node = nodesRef.current.find(n => n.id === id);
      if (!node || node.x == null || node.y == null) return;
      if (viewMode === '2d') {
        ref2D.current?.centerAt?.(node.x, node.y, durationMs);
        ref2D.current?.zoom?.(config.clickZoomScale, durationMs);
      } else {
        // 3D: position camera so the node is in front. The previous 200-unit
        // distance was too tight — the focused node took up most of the view
        // and neighbors were off-screen. 600 puts the focused node in the
        // foreground while keeping ~6–8 typical degree-1 neighbors visible.
        const distance = NODE_FOCUS_DISTANCE_3D;
        const distRatio = 1 + distance / Math.hypot(node.x ?? 1, node.y ?? 1, node.z ?? 1);
        ref3D.current?.cameraPosition?.(
          {
            x: (node.x ?? 0) * distRatio,
            y: (node.y ?? 0) * distRatio,
            z: (node.z ?? 0) * distRatio,
          },
          { x: node.x, y: node.y, z: node.z ?? 0 },
          durationMs,
        );
      }
    },
    setZoom: (scale, durationMs = 200) => {
      if (viewMode === '2d') {
        ref2D.current?.zoom?.(scale, durationMs);
      }
      // 3D: no direct equivalent; users orbit/dolly via mouse.
    },
    getZoom: () => {
      if (viewMode === '2d' && typeof ref2D.current?.zoom === 'function') {
        try {
          return ref2D.current.zoom();
        } catch {
          return 1;
        }
      }
      return 1;
    },
    resetView: (durationMs = 800) => {
      const p = computeAutoFitPadding(nodesRef.current.length, viewMode, Math.min(width, height));
      if (viewMode === '2d') {
        ref2D.current?.zoomToFit?.(durationMs, p);
      } else {
        ref3D.current?.zoomToFit?.(durationMs, p);
      }
    },
    reheatSimulation: () => activeRef.current?.d3ReheatSimulation?.(),
    pauseSimulation: () => activeRef.current?.pauseAnimation?.(),
    resumeSimulation: () => activeRef.current?.resumeAnimation?.(),
    exportImage: async (format = 'png') => {
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      let canvas: HTMLCanvasElement | null = null;
      if (viewMode === '2d') {
        canvas = containerRef.current?.querySelector('canvas') ?? null;
      } else {
        const renderer = ref3D.current?.renderer?.();
        canvas = renderer?.domElement ?? null;
      }
      if (!canvas) return null;
      return new Promise<Blob | null>(resolve => canvas!.toBlob(blob => resolve(blob), mime));
    },
    refresh: () => {
      // 3D has refresh; 2D auto-redraws when sim is active. For 2D, a tiny
      // reheat reliably triggers a repaint.
      if (viewMode === '3d') {
        ref3D.current?.refresh?.();
      } else {
        ref2D.current?.d3ReheatSimulation?.();
      }
    },
    getViewMode: () => viewMode,
  }), [viewMode, config.clickZoomScale]);

  // Auto-fit on first render and when canvas size settles. ``width`` /
  // ``height`` come from ``useState`` initialised with the prop defaults
  // (800 / 600); when ``autoResize`` is on, ResizeObserver patches them to
  // the actual rendered dimensions async. The effect therefore needs both
  // dimensions in its deps — without them the 600ms timer would close over
  // the stale 800/600 and feed those into ``computeAutoFitPadding``,
  // computing a panel-sized padding for an inline 260px canvas and zooming
  // way out.
  //
  // ``fitKey`` buckets dimensions into 50px steps so a few-pixel
  // ResizeObserver wobble after layout settles doesn't keep retriggering
  // the fit. We re-fit when viewMode flips, when nodes mount, or when the
  // bucketed canvas size changes.
  const lastFitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!config.autoFitOnLoad) return;
    if (nodes.length === 0) return;
    const fitKey = `${viewMode}|${Math.round(width / 50) * 50}|${Math.round(height / 50) * 50}`;
    if (lastFitKeyRef.current === fitKey) return;
    const padding = Math.round(computeAutoFitPadding(nodes.length, viewMode, Math.min(width, height)) * INITIAL_LOAD_PADDING_FACTOR);
    const t = setTimeout(() => {
      activeRef.current?.zoomToFit?.(900, padding);
      lastFitKeyRef.current = fitKey;
    }, 600);
    return () => clearTimeout(t);
  }, [viewMode, nodes.length, width, height, config.autoFitOnLoad, activeRef]);

  // Auto-zoom to highlighted node on selection change. Single RAF-driven
  // motion with cubic ease-in-out + a small radial arc — Mapbox flyTo
  // style. Pan and zoom happen simultaneously: the camera lifts ~18% away
  // from the origin at the midpoint of the move (3D) or zooms out ~22% at
  // the midpoint (2D), then settles at the landing distance. Reads as one
  // continuous arcing flight rather than two discrete stages.
  // Skipped when ``config.zoomOnNodeClick`` is off (e.g. inline preview).
  const lastZoomedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!config.zoomOnNodeClick) {
      lastZoomedRef.current = null;
      return;
    }
    if (!highlightedNodeId) {
      lastZoomedRef.current = null;
      return;
    }
    if (lastZoomedRef.current === highlightedNodeId) return;
    const node = nodesRef.current.find(n => n.id === highlightedNodeId);
    if (!node || node.x == null || node.y == null) return;

    let cancelled = false;
    let rafId: number | null = null;
    let settleTimeout: ReturnType<typeof setTimeout> | null = null;

    const TOTAL_MS = 1400;
    const ARC_3D = 0.18;       // radial outward lift at midpoint (fraction of distance)
    const ARC_2D = 0.22;       // zoom-out dip at midpoint (fraction of zoom)
    // Cubic ease-in-out — starts gentle, accelerates through the middle,
    // settles softly at the end. Matches the maps-flyTo feel.
    const ease = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Brief settle delay so positions are stable when the node was just
    // dropped into the simulation.
    settleTimeout = setTimeout(() => {
      if (cancelled) return;
      const t0 = performance.now();

      if (viewMode === '2d') {
        // Read current camera state for start point. centerAt() with no
        // args returns the current center; zoom() with no args returns
        // the current scale.
        let startCx = 0, startCy = 0, startZoom = 1;
        try {
          const cur = ref2D.current?.centerAt?.();
          if (cur && typeof cur.x === 'number') {
            startCx = cur.x;
            startCy = cur.y;
          }
          startZoom = ref2D.current?.zoom?.() ?? 1;
        } catch { /* noop */ }

        const endCx = node.x!;
        const endCy = node.y!;
        const endZoom = config.clickZoomScale;

        const tick2D = () => {
          if (cancelled) return;
          const linearT = Math.min(1, (performance.now() - t0) / TOTAL_MS);
          const t = ease(linearT);

          const cx = startCx + (endCx - startCx) * t;
          const cy = startCy + (endCy - startCy) * t;
          const linZoom = startZoom + (endZoom - startZoom) * t;
          // Sin-arc dip — peaks at t=0.5, returns to 1 at endpoints so the
          // landing zoom is always exactly ``endZoom``.
          const dip = 1 - ARC_2D * Math.sin(t * Math.PI);
          const zoom = Math.max(0.1, linZoom * dip);

          ref2D.current?.centerAt?.(cx, cy, 0);
          ref2D.current?.zoom?.(zoom, 0);

          if (linearT < 1) rafId = requestAnimationFrame(tick2D);
        };
        rafId = requestAnimationFrame(tick2D);
      } else {
        const dist = NODE_FOCUS_DISTANCE_3D;
        const hypot = Math.max(1, Math.hypot(node.x ?? 1, node.y ?? 1, node.z ?? 1));
        const closeRatio = 1 + dist / hypot;
        const endPos = {
          x: (node.x ?? 0) * closeRatio,
          y: (node.y ?? 0) * closeRatio,
          z: (node.z ?? 0) * closeRatio,
        };
        const endLookAt = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };

        // Read start camera position from the lib. When this is the first
        // selection we'll have whatever the auto-fit landed on, which is
        // a fine starting frame for the flight.
        let startPos = { ...endPos };
        try {
          const cur = ref3D.current?.cameraPosition?.();
          if (cur && typeof cur.x === 'number') {
            startPos = { x: cur.x, y: cur.y, z: cur.z };
          }
        } catch { /* noop */ }

        // Smoothly transition lookAt from the previous focus to the new
        // one. If we don't know the previous focus (first selection),
        // start from the graph centre.
        const prevId = lastZoomedRef.current;
        const prev = prevId ? nodesRef.current.find(n => n.id === prevId) : null;
        const startLookAt = prev
          ? { x: prev.x ?? 0, y: prev.y ?? 0, z: prev.z ?? 0 }
          : { x: 0, y: 0, z: 0 };

        const tick3D = () => {
          if (cancelled) return;
          const linearT = Math.min(1, (performance.now() - t0) / TOTAL_MS);
          const t = ease(linearT);

          // Linear interpolation of camera position from start to end.
          const lpx = startPos.x + (endPos.x - startPos.x) * t;
          const lpy = startPos.y + (endPos.y - startPos.y) * t;
          const lpz = startPos.z + (endPos.z - startPos.z) * t;
          // Radial arc — push outward from the origin at midpoint so the
          // camera lifts during the pan rather than going stop-start. Goes
          // back to 1.0 at endpoints so the landing position is exact.
          const arc = 1 + ARC_3D * Math.sin(t * Math.PI);
          const px = lpx * arc;
          const py = lpy * arc;
          const pz = lpz * arc;

          // LookAt lerps from previous focus to new focus through the
          // motion — this is the smooth pivot the user asked for.
          const lax = startLookAt.x + (endLookAt.x - startLookAt.x) * t;
          const lay = startLookAt.y + (endLookAt.y - startLookAt.y) * t;
          const laz = startLookAt.z + (endLookAt.z - startLookAt.z) * t;

          ref3D.current?.cameraPosition?.(
            { x: px, y: py, z: pz },
            { x: lax, y: lay, z: laz },
            0, // 0 = instant; we drive the easing per frame
          );

          if (linearT < 1) rafId = requestAnimationFrame(tick3D);
        };
        rafId = requestAnimationFrame(tick3D);
      }

      lastZoomedRef.current = highlightedNodeId;
    }, 50);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimeout !== null) clearTimeout(settleTimeout);
    };
  }, [highlightedNodeId, viewMode, config.zoomOnNodeClick, config.clickZoomScale]);

  // =============================================================================
  // Render
  // =============================================================================

  // Memoize graphData object identity so the lib doesn't re-init the
  // simulation on unrelated re-renders (theme flips, hover state, etc).
  const graphDataMemo = useMemo(() => ({ nodes, links: edges }), [nodes, edges]);

  const sharedProps = {
    width,
    height,
    graphData: graphDataMemo,
    nodeId: 'id',
    linkSource: 'sourceId',
    linkTarget: 'targetId',
    nodeLabel,
    linkLabel,
    nodeVisibility,
    linkVisibility,
    linkColor,
    linkWidth,
    linkCurvature,
    linkDirectionalArrowLength: linkArrowLength,
    linkDirectionalArrowColor: linkArrowColor,
    linkDirectionalArrowRelPos: 1,
    onNodeClick: handleNodeClick,
    onLinkClick: handleLinkClick,
    onBackgroundClick: handleBackgroundClick,
    onNodeHover: (n: any) => setHoveredNodeId(n?.id ?? null),
    onLinkHover: (l: any) => setHoveredLinkId(l?.id ?? null),
    onNodeDragStart,
    onNodeDrag,
    onNodeDragEnd,
    onEngineTick: handleEngineTick,
    enableNodeDrag: true,
    cooldownTicks: config.cooldownTicks,
    // Keep warmup short so my-force-set runs before settle finishes; the
    // first-tick reheat (handleEngineTick) re-pumps alpha so the cooldown
    // ticks settle under the right forces.
    warmupTicks: Math.min(config.warmupTicks, 30),
    d3AlphaDecay: 0.03,
    d3VelocityDecay: 0.4,
  };

  return (
    <div ref={containerRef} className="w-full h-full relative" style={{ minWidth: 0, minHeight: 0 }}>
      {viewMode === '2d' ? (
        <ForceGraph2D
          ref={ref2D}
          {...sharedProps}
          nodeCanvasObject={paintNode2D}
          nodeCanvasObjectMode={() => 'replace'}
          linkCanvasObject={paintLink2D}
          linkCanvasObjectMode={() => 'after'}
          onZoom={handleZoom}
          autoPauseRedraw={false}
          enableZoomInteraction={(e: MouseEvent) => !e.altKey}
          enablePanInteraction={(e: MouseEvent) => !e.altKey}
          backgroundColor="rgba(0,0,0,0)"
        />
      ) : (
        <ForceGraph3D
          ref={ref3D}
          {...sharedProps}
          nodeThreeObject={buildNodeThreeObject}
          nodePositionUpdate={updateNodePosition3D}
          linkThreeObject={buildLinkThreeObject}
          linkThreeObjectExtend={true}
          linkPositionUpdate={updateLinkPosition}
          linkMaterial={linkMaterial3D}
          nodeOpacity={config.nodeOpacity3D}
          linkOpacity={config.linkOpacity3D}
          showNavInfo={false}
          backgroundColor="rgba(0,0,0,0)"
          rendererConfig={{ preserveDrawingBuffer: true, alpha: true }}
          numDimensions={3}
          forceEngine={config.forceEngine}
        />
      )}

      {viewMode === '2d' && marquee.overlay}

      {chrome === 'full' && (
        <>
          <ZoomToolbar
            handle={{
              current: {
                setZoom: (s, d) => {
                  if (viewMode === '2d') ref2D.current?.zoom?.(s, d);
                },
                zoomToFit: (d, p) => {
                  const padding = p ?? computeAutoFitPadding(nodesRef.current.length, viewMode, Math.min(width, height));
                  activeRef.current?.zoomToFit?.(d, padding);
                },
                resetView: (d) => {
                  const padding = computeAutoFitPadding(nodesRef.current.length, viewMode, Math.min(width, height));
                  if (viewMode === '2d') ref2D.current?.zoomToFit?.(d ?? 800, padding);
                  else ref3D.current?.zoomToFit?.(d ?? 800, padding);
                },
                getZoom: () => {
                  if (viewMode === '2d' && typeof ref2D.current?.zoom === 'function') {
                    try { return ref2D.current.zoom(); } catch { return 1; }
                  }
                  return 1;
                },
              },
            }}
            groupSelectedCount={groupSelectedIds.length}
            hideStepButtons={viewMode === '3d'}
            config={config}
            onConfigChange={onConfigChange}
            onReheatSimulation={() => activeRef.current?.d3ReheatSimulation?.()}
          />
          <EntityTypeLegend
            entries={entityTypeLegend}
            hiddenTypes={hiddenTypes}
            onToggle={onToggleEntityType}
            hidden={legendHidden}
          />
          {/* Top-N anchor list — bottom-center, just above the legend. Hides
              when a node is focused or any sub-network HUD is up (HUD takes
              over) and can be dismissed for the session via the × on the
              strip. ``legendHidden`` doubles as the subnet-HUD signal —
              parent flips it whenever any HUD overlay is mounted. */}
          <TopNodesList
            nodes={nodes}
            degreeMap={degreeMap}
            highlightedNodeId={highlightedNodeId}
            onNodeClick={(node) => onNodeClick?.(node)}
            colorOverrides={colorOverrides}
            hidden={legendHidden}
          />
          {viewMode === '3d' && (
            <div className="absolute top-2 right-18 z-20" style={{ pointerEvents: 'auto' }}>
              <Controls3DHelp />
            </div>
          )}
        </>
      )}
    </div>
  );
});

ForceGraph.displayName = 'ForceGraph';

const EMPTY_SET: Set<string> = new Set();
// Multiplier on the auto-fit padding for the first paint. <1 pulls the
// camera closer (less margin) than ``zoomToFit`` would default to. Tuned
// for "the cluster fills the panel without nodes touching the edges".
const INITIAL_LOAD_PADDING_FACTOR = 0.78;

// Graph-size-aware autoFit padding. Empirically tuned: small graphs (~20 n)
// need ~120 to feel airy; mid (~100) need ~200; large (1k+) want 280+ so the
// camera is far enough back that the cluster reads as a whole rather than
// nodes pressed against the canvas edges.
// 3D click-zoom camera distance from focused node. Tuned so the focused node
// is in the foreground but its 1- and 2-step neighbourhood stays visible —
// felt much too close at 600 in real graphs, then a touch close at 1100.
const NODE_FOCUS_DISTANCE_3D = 1300;

// Auto-fit padding scaled to graph size — bigger graphs want more breathing
// room. 2D padding is a pixel margin in canvas units; 3D padding feeds
// camera distance via ``zoomToFit`` and lands the camera much farther back
// at the same numeric value, so 3D needs its own progression. 2D values are
// tuned for an ~800px panel and scale down for smaller canvases (the inline
// triplet preview at 260px would otherwise push the cluster off-frame).
function computeAutoFitPadding(
  nodeCount: number,
  viewMode: '2d' | '3d' = '2d',
  canvasSize?: number,
): number {
  if (viewMode === '3d') {
    if (nodeCount <= 25) return 200;
    if (nodeCount <= 75) return 270;
    if (nodeCount <= 200) return 340;
    if (nodeCount <= 600) return 420;
    return 500;
  }
  // Base values are tuned for ~800px panels and produce a ~40% margin —
  // breathing room without feeling cramped.
  const base = (() => {
    if (nodeCount <= 25) return 310;
    if (nodeCount <= 75) return 420;
    if (nodeCount <= 200) return 525;
    if (nodeCount <= 600) return 630;
    return 730;
  })();
  if (canvasSize == null || canvasSize >= 800) return base;
  // Padding shrinks much faster than the canvas. At 800px we want ~40%
  // margin (panel feel); at 260px (inline triplet preview) we want closer
  // to ~12% so 3–10 node clusters fill the box rather than floating in it.
  // Quadratic falloff hits both targets without making mid-size canvases
  // feel cramped.
  const scale = Math.max(0.06, Math.pow(canvasSize / 800, 2));
  return Math.round(base * scale);
}
