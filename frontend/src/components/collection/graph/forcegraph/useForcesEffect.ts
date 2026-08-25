'use client';

import { useEffect, type MutableRefObject } from 'react';
// d3-force-3d (NOT d3-force) — same module the lib uses internally for its
// own simulation. Standard d3-force only operates on x,y; injecting those
// forces overrides the lib's 3D-aware versions and locks z values flat
// (manifests as: 2nd 3D mount renders all nodes on a plane). d3-force-3d
// reads the simulation's ``numDimensions()`` and updates x,y[,z] accordingly.
import * as d3 from 'd3-force-3d';
import type { GraphNode, GraphEdge, GraphViewConfig } from '../graphTypes';
import { anchorTarget, effectiveAnchors, resolveAnchors } from './anchors';
import { treatmentFor } from './edgeKinds';

// =============================================================================
// useForcesEffect — wires the d3 force configuration onto react-force-graph's
// internal simulation. The library exposes the same d3 instance via
// ``graphRef.current.d3Force(name, force)``, so the existing forceLink /
// forceManyBody / forceCenter / forceCollide / cluster forces port over
// verbatim from the SVG renderer.
//
// Synchronous (no RAF defer): touching ``state.d3ForceLayout`` via
// ``fg.d3Force(name, force)`` is safe at any time — it never reads or
// mutates ``state.layout`` (the wrapper that races during prop updates).
// The previous crash motivation (state.layout undefined) came from
// ``d3ReheatSimulation`` flipping ``engineRunning`` on while the wrapper
// was being torn down; we only reheat from ``onEngineTick`` now, which by
// construction runs *after* state.layout is set.
// =============================================================================

interface ForceGraphRef {
  current: {
    d3Force: (name: string, force?: any | null) => any;
    d3ReheatSimulation: () => any;
  } | undefined | null;
}

/** Floor and ceiling on a link's pull. The floor is what stops a well-attested
 *  edge between two busy nodes from going slack; the ceiling stops one rigid
 *  edge from dragging the rest of the layout after it. */
const LINK_MIN = 0.15;
const LINK_MAX = 0.9;
/** Attestation counts above this stop adding rigidity. Log-scaled below it, so
 *  the gap between 1 and 5 documents matters and the gap between 300 and 340
 *  does not. */
const ATTESTATION_SATURATION = 24;

/**
 * How hard one edge pulls its endpoints together.
 *
 * **d3's default is anti-chain.** It is `1 / min(degree(source), degree(target))`,
 * a heuristic for keeping hubs from collapsing — and it means the strength of a
 * connection is decided entirely by how busy its endpoints are. A five-step
 * concealment chain running through a bank that appears in 340 payments gets
 * the *weakest* links in the graph, so the one structure the whole query
 * language exists to surface is the first thing the simulation pulls apart.
 * The best-attested chain was the weakest thing on screen.
 *
 * So attestation raises the strength and degree only damps it: an edge nobody
 * has corroborated still behaves like d3's default, and an edge forty documents
 * agree on approaches rigid however busy its endpoints are.
 */
/** How much a link crossing two clusters is damped.
 *
 *  **An edge inside a pile and an edge across piles are different statements.**
 *  Within a cell it says *these belong together*; across cells it says *these
 *  are related*. Drawing both at the same strength is the same category error
 *  as drawing containment and relation as one grey line — and it is why the
 *  first clustering pass looked like no clustering at all: link strength
 *  reaches 0.9 with a rest length far shorter than the cell pitch, so any
 *  cross-cell edge simply dragged both endpoints out of their cells.
 *
 *  Damped, never removed. A cluster layout that hides the edges between groups
 *  answers "what are the groups" by discarding "how do they touch", which is
 *  usually the actual question. */
const CROSS_CLUSTER_DAMP = 0.12;

/** …and its rest length is stretched, so the piles have somewhere to be. */
const CROSS_CLUSTER_STRETCH = 3;

const clusterOf = (v: any) =>
  (typeof v === 'object' && v ? v.cluster : null) ?? null;

/** Do these two endpoints sit in different, known piles? Unknown on either side
 *  is NOT a crossing: a node with no value for the cluster key is unplaced, and
 *  weakening its links would push it further from the only context it has. */
function crossesClusters(l: any): boolean {
  const a = clusterOf(l.source), b = clusterOf(l.target);
  return Boolean(a && b && a !== b);
}

/**
 * How much room one node occupies — label-aware, so the painter doesn't smear
 * neighbours' text.
 *
 * Exported because the cluster cells are sized from it: a cell drawn or pulled
 * to a different size than the nodes inside it actually need is a boundary in
 * the wrong place, and collision then pushes the pile straight through it.
 */
export function collisionRadiusFor(
  nodes: ReadonlyArray<GraphNode>, config: GraphViewConfig,
): number {
  const avgLabelLen = nodes.length > 0
    ? nodes.reduce((s, n) => s + Math.min(n.label?.length ?? 0, 24), 0) / nodes.length
    : 0;
  const estLabelHalfWidth = (avgLabelLen * config.labelFontSize * 0.55) / 2;
  const base = nodes.length > 50 ? Math.min(60, 40 + nodes.length * 0.1) : 40;
  return Math.max(base, estLabelHalfWidth + 22);
}

function makeLinkStrength(edges: ReadonlyArray<GraphEdge>) {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }
  // d3 replaces `source`/`target` with node objects once the simulation binds.
  const idOf = (v: any) => (typeof v === 'object' && v ? v.id : v);

  return (l: any): number => {
    const a = degree.get(idOf(l.source)) ?? 1;
    const b = degree.get(idOf(l.target)) ?? 1;
    const degreeTerm = 1 / Math.max(1, Math.min(a, b));
    const weight = Math.max(1, Number(l.weight ?? l.frequency ?? 1) || 1);
    // 0 at a single mention, → 1 at saturation.
    const attest = Math.min(1, Math.log1p(weight - 1) / Math.log1p(ATTESTATION_SATURATION));
    const raw = degreeTerm + (1 - degreeTerm) * attest;
    const bounded = Math.max(LINK_MIN, Math.min(LINK_MAX, raw));
    const t = treatmentFor(l as any);
    // Containment outranks everything, including the cluster damping: a thing
    // inside another thing belongs with it whichever pile either landed in.
    if (t.nest > 0) return Math.min(1, bounded + t.nest);
    return crossesClusters(l) ? bounded * CROSS_CLUSTER_DAMP : bounded;
  };
}

/**
 * Pure, ref-free function that writes the configured forces onto an active
 * ForceGraph imperative ref. Exported so ForceGraph.tsx can also call it from
 * ``onEngineTick`` (first-tick force-set is required because the lib is
 * dynamically imported and the ref is null on initial useEffect — without
 * this fallback, default forces lock in and the graph stays clumped).
 */
export function applyForces(
  fg: ForceGraphRef['current'],
  nodes: GraphNode[],
  /** Needed for link strength: attestation has to beat d3's degree default,
   *  or the best-attested chain is the weakest thing in the graph. */
  edges: ReadonlyArray<GraphEdge>,
  config: GraphViewConfig,
  viewMode: '2d' | '3d',
  /** Scrubber position. Place entries are interval-scoped, so an anchored node
   *  moves as the cursor moves — a company sits at the seat it actually held
   *  at that moment rather than at whichever address was seen first. */
  timeCursor?: string | null,
  /** The panel's committed query. Layout bindings written in the bar outrank
   *  the stored config — see `effectiveAnchors`. Passed down rather than read
   *  from a store so the force effect stays a pure function of what it draws. */
  query?: string,
): void {
  if (!fg || typeof fg.d3Force !== 'function') return;
  if (config.forceEngine === 'ngraph') return;

  // S5: graph-size-aware scaling. Small graphs get stronger spread so labels
  // can breathe; large graphs use the user's configured values directly.
  const sizeFactor = nodes.length <= 15
    ? 2.5
    : nodes.length <= 30
    ? 2.5 - ((nodes.length - 15) / 15) * 0.5  // 2.5 → 2.0
    : nodes.length <= 100
    ? 2.0 - ((nodes.length - 30) / 70) * 1.0  // 2.0 → 1.0
    : 1.0;

  try {
    fg.d3Force('charge', d3.forceManyBody().strength(config.chargeStrength * sizeFactor));

    const link = fg.d3Force('link');
    if (link && typeof link.distance === 'function') {
      const base = config.linkDistance * sizeFactor;
      // A cross-cluster edge wants a longer rest length as well as a weaker
      // pull: at the base distance it is actively asking two piles to overlap,
      // and no anchor strength can win an argument it is having with geometry.
      link.distance((l: any) => {
        // **Containment is a distance, not a line.** B being inside A means
        // they are close, and a link at the normal rest length puts them side
        // by side — which is the opposite of the claim. Short and strong is
        // what makes nesting read; painting alone never did.
        const t = treatmentFor(l as any);
        if (t.nest > 0) return base * (1 - t.nest * 0.75);
        return crossesClusters(l) ? base * CROSS_CLUSTER_STRETCH : base;
      });
    }
    if (link && typeof link.strength === 'function') {
      link.strength(makeLinkStrength(edges));
    }

    // d3-force-3d's forceCenter accepts a third coord — 3D mode re-centers
    // along z too. Standard d3.forceCenter only handles x,y, which was a
    // cause of "flattened on 2nd 3D mount".
    fg.d3Force('center', viewMode === '3d'
      ? d3.forceCenter(0, 0, 0)
      : d3.forceCenter(0, 0));

    const collisionRadius = collisionRadiusFor(nodes, config);
    fg.d3Force('collision', d3.forceCollide().radius(collisionRadius));

    // ── Layout anchors ──────────────────────────────────────────────────
    // One primitive for clustering, geography and time (see ./anchors.ts).
    // What used to be a hardcoded circle-of-type-angles is now the `type`
    // affinity anchor — one case among several, composable, same code path.
    const anchors = resolveAnchors(
      // `collisionRadius` is how much room one node actually occupies, and a
      // cell has to be sized from its contents — see `clusterCells`.
      effectiveAnchors(config, query).map(
        a => (a.kind === 'cluster' ? { ...a, nodeRadius: collisionRadius } : a),
      ),
      nodes, config.linkDistance, timeCursor,
    );

    if (anchors.length) {
      // Hard-pinned nodes are fixed in world space rather than pulled: the
      // simulation must not fight a verifiable coordinate. Clearing fx/fy for
      // everything else is what lets a node released from a pin settle again.
      for (const n of nodes as any[]) {
        const px = anchorTarget(anchors, n, 'x');
        const py = anchorTarget(anchors, n, 'y');
        const pz = anchorTarget(anchors, n, 'z');
        n.fx = px.pinned ? px.value : null;
        n.fy = py.pinned ? py.value : null;
        n.fz = pz.pinned ? pz.value : null;
      }

      // Per-node target AND per-node strength — strength 0 leaves a node
      // completely free, which is how anchored and unanchored nodes share one
      // layout without a second force or a separate branch.
      const axisForce = (axis: 'x' | 'y' | 'z') => {
        const f = axis === 'x' ? d3.forceX : axis === 'y' ? d3.forceY : d3.forceZ;
        return f<any>((d: any) => anchorTarget(anchors, d, axis).value)
          .strength((d: any) => anchorTarget(anchors, d, axis).strength);
      };
      fg.d3Force('anchorX', axisForce('x'));
      fg.d3Force('anchorY', axisForce('y'));
      // z only in 3D — installing it in 2D flattens nothing but wastes work.
      fg.d3Force('anchorZ', viewMode === '3d' ? axisForce('z') : null);
    } else {
      for (const n of nodes as any[]) { n.fx = null; n.fy = null; n.fz = null; }
      fg.d3Force('anchorX', null);
      fg.d3Force('anchorY', null);
      fg.d3Force('anchorZ', null);
    }
    // Legacy force names, cleared so a config that predates anchors doesn't
    // leave a stale cluster force installed alongside the new one.
    fg.d3Force('clusterX', null);
    fg.d3Force('clusterY', null);
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('[ForceGraph] applyForces skipped — lib state in transition:', err);
    }
  }
}

export function useForcesEffect(
  ref: MutableRefObject<any> | { current: any },
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: GraphViewConfig,
  viewMode: '2d' | '3d',
  timeCursor?: string | null,
  query?: string,
): void {
  useEffect(() => {
    applyForces(
      (ref as ForceGraphRef).current, nodes, edges, config, viewMode, timeCursor, query,
    );
  }, [
    timeCursor,
    query,
    ref,
    nodes,
    nodes.length,
    edges,
    edges.length,
    viewMode,
    config.chargeStrength,
    config.linkDistance,
    config.labelFontSize,
    config.clusterByType,
    config.clusterStrength,
    // Anchors are an array; identity is stable because the config object is
    // only replaced on an actual edit.
    config.anchors,
    config.forceEngine,
  ]);
}
