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
  config: GraphViewConfig,
  viewMode: '2d' | '3d',
  /** Scrubber position. Place entries are interval-scoped, so an anchored node
   *  moves as the cursor moves — a company sits at the seat it actually held
   *  at that moment rather than at whichever address was seen first. */
  timeCursor?: string | null,
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
      link.distance(config.linkDistance * sizeFactor);
    }

    // d3-force-3d's forceCenter accepts a third coord — 3D mode re-centers
    // along z too. Standard d3.forceCenter only handles x,y, which was a
    // cause of "flattened on 2nd 3D mount".
    fg.d3Force('center', viewMode === '3d'
      ? d3.forceCenter(0, 0, 0)
      : d3.forceCenter(0, 0));

    // Label-aware collision. Reserves enough horizontal space for labels so
    // the painter doesn't smear neighbours' text.
    const avgLabelLen = nodes.length > 0
      ? nodes.reduce((s, n) => s + Math.min(n.label?.length ?? 0, 24), 0) / nodes.length
      : 0;
    const estLabelHalfWidth = (avgLabelLen * config.labelFontSize * 0.55) / 2;
    const baseCollision = nodes.length > 50 ? Math.min(60, 40 + nodes.length * 0.1) : 40;
    const collisionRadius = Math.max(baseCollision, estLabelHalfWidth + 22);
    fg.d3Force('collision', d3.forceCollide().radius(collisionRadius));

    // ── Layout anchors ──────────────────────────────────────────────────
    // One primitive for clustering, geography and time (see ./anchors.ts).
    // What used to be a hardcoded circle-of-type-angles is now the `type`
    // affinity anchor — one case among several, composable, same code path.
    const anchors = resolveAnchors(
      effectiveAnchors(config), nodes, config.linkDistance, timeCursor,
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
): void {
  useEffect(() => {
    applyForces((ref as ForceGraphRef).current, nodes, config, viewMode, timeCursor);
  }, [
    timeCursor,
    ref,
    nodes,
    nodes.length,
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
