'use client';

import { useEffect, type MutableRefObject } from 'react';
// d3-force-3d (NOT d3-force) — same module the lib uses internally for its
// own simulation. Standard d3-force only operates on x,y; injecting those
// forces overrides the lib's 3D-aware versions and locks z values flat
// (manifests as: 2nd 3D mount renders all nodes on a plane). d3-force-3d
// reads the simulation's ``numDimensions()`` and updates x,y[,z] accordingly.
import * as d3 from 'd3-force-3d';
import type { GraphNode, GraphEdge, GraphViewConfig } from '../graphTypes';

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

    if (config.clusterByType) {
      const types = Array.from(new Set(nodes.map(n => n.type.toUpperCase()))).sort();
      const typeAngle = new Map<string, number>();
      types.forEach((t, i) => typeAngle.set(t, (2 * Math.PI * i) / types.length));
      const radius = config.linkDistance * 2;

      fg.d3Force('clusterX', d3.forceX<any>((d: any) => {
        const angle = typeAngle.get(d.type?.toUpperCase()) ?? 0;
        return Math.cos(angle) * radius;
      }).strength(config.clusterStrength));

      fg.d3Force('clusterY', d3.forceY<any>((d: any) => {
        const angle = typeAngle.get(d.type?.toUpperCase()) ?? 0;
        return Math.sin(angle) * radius;
      }).strength(config.clusterStrength));
    } else {
      fg.d3Force('clusterX', null);
      fg.d3Force('clusterY', null);
    }
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
): void {
  useEffect(() => {
    applyForces((ref as ForceGraphRef).current, nodes, config, viewMode);
  }, [
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
    config.forceEngine,
  ]);
}
