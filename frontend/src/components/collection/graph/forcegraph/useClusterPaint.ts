'use client';

/**
 * useClusterPaint — the cells a `CLUSTER:` binding produced, drawn under the
 * nodes.
 *
 * Spatial separation without labels is a rearrangement, not an answer: the
 * reader sees four piles and has to hover a node in each to learn what they
 * are. Every tool that clusters well says what the piles are — Gephi's
 * partition legend, Bloom's category chips, Cytoscape's group boxes — and the
 * saying is most of the value.
 *
 * Drawn as a soft field and a label, never as a hard box. A cell boundary is
 * not a claim about membership: nodes are *pulled* toward a centre and the
 * local forces move them, so a node near an edge is genuinely near that edge
 * and a crisp rectangle would assert a partition the layout does not enforce.
 *
 * The label carries its count, because `MVP` S4 — a number on screen states
 * its denominator — applies to the picture as much as to the table.
 */
import { useMemo } from 'react';
import { clusterCells, geoRadius, type ClusterCell } from './anchors';
import type { GraphNode, GraphViewConfig } from '../graphTypes';

export type ClusterPainter =
  (ctx: CanvasRenderingContext2D, globalScale: number) => void;

interface Deps {
  nodes: ReadonlyArray<GraphNode>;
  config: GraphViewConfig;
  /** Only paints when the committed query actually bound a cluster — the same
   *  condition `effectiveAnchors` uses, so the labels and the forces can never
   *  disagree about whether clustering is on. */
  query?: string;
  /** The collision radius the simulation is using, so cells are drawn the size
   *  they are pulled to. */
  nodeRadius?: number;
}

/** Distinct hue per cell, stable in the cells' own order (largest first) so a
 *  colour does not change meaning when the query narrows. */
function hueOf(i: number, n: number): number {
  return Math.round((360 * i) / Math.max(1, n));
}

export function useClusterPaint(
  { nodes, config, query, nodeRadius = 40 }: Deps,
): ClusterPainter | undefined {
  const cells = useMemo<ClusterCell[]>(() => {
    if (!query || !/\bCLUSTER:/i.test(query)) return [];
    const counts = new Map<string, number>();
    for (const n of nodes) {
      if (n.cluster) counts.set(n.cluster, (counts.get(n.cluster) ?? 0) + 1);
    }
    // Same cell geometry the FORCES use, including the node radius — a label
    // drawn from a different cell size than the one the simulation is pulling
    // toward is a boundary in the wrong place, which is worse than none.
    return [...clusterCells(
      counts, geoRadius(config.linkDistance), nodeRadius,
    ).values()];
  }, [nodes, query, config.linkDistance, nodeRadius]);

  return useMemo(() => {
    if (!cells.length) return undefined;
    return (ctx: CanvasRenderingContext2D, globalScale: number) => {
      ctx.save();
      cells.forEach((cell, i) => {
        const h = hueOf(i, cells.length);
        const [x, y] = cell.at;

        // A soft field, not a boundary. The gradient fades to nothing at the
        // cell radius so two adjacent piles blend rather than abut — which is
        // what the layout actually does.
        const g = ctx.createRadialGradient(x, y, 0, x, y, cell.r);
        g.addColorStop(0, `hsla(${h}, 65%, 55%, 0.10)`);
        g.addColorStop(1, `hsla(${h}, 65%, 55%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, cell.r, 0, 2 * Math.PI);
        ctx.fill();

        // The label sits ABOVE the cell rather than at its centre, where the
        // nodes are. Centred text under a pile of nodes is unreadable at every
        // zoom that matters.
        const size = Math.max(10, 13 / globalScale);
        ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = `hsla(${h}, 55%, 45%, 0.85)`;
        ctx.fillText(cell.label, x, y - cell.r - size * 0.3);

        // S4 — the count, so a big pile and a small one are distinguishable
        // when zoom has flattened their areas.
        ctx.font = `${size * 0.8}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = `hsla(${h}, 30%, 50%, 0.7)`;
        ctx.fillText(`${cell.count}`, x, y - cell.r + size * 0.9);
      });
      ctx.restore();
    };
  }, [cells]);
}
