'use client';

/**
 * useGeoPaint — everything drawn *under* the nodes in geographic space.
 *
 * Three decorations, one paint pass, because they share a projection and must
 * share it exactly:
 *
 * 1. **Country outlines** — the world map, drawn into the force-graph canvas
 *    rather than composited from a tile layer. No deck.gl fork, no token, no
 *    tile server, and it works in the same canvas the simulation already owns.
 * 2. **Trajectory arcs** — a movement spans two places; showing it as a dot on
 *    the origin quietly asserts it stayed there.
 * 3. **Divergence connectors** — a node's runner-up position, ghosted, with the
 *    gap drawn. A company registered where nothing happens is a lead.
 *
 * **The projection is `anchors.mercator` at `anchors.geoRadius`, not a copy.**
 * Outlines that drift from nodes by a scale factor would be worse than no map:
 * a coastline that is subtly wrong is a lie told confidently.
 *
 * Geometry is **lazily imported** (`worldLow`, ~276 KB) the first time the
 * underlay is switched on, so a graph that never touches geography pays
 * nothing for it. Tiles stay deferred for the reason `graphmap.md` argues:
 * most graphs have well under 20% geocodable nodes, and a mostly-empty map is
 * a worse frame than no map.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_RUNGS,
  geoRadius,
  haversineKm,
  mercator,
  placeDivergence,
  resolvePlace,
  trajectoryEnds,
  type RungWeights,
} from './anchors';
import type { GraphNode, GraphViewConfig } from '../graphTypes';
import type { ThemeTokens } from './resolveNodeStyle';

export type GeoPainter = (ctx: CanvasRenderingContext2D, globalScale: number) => void;

interface Deps {
  nodes: ReadonlyArray<GraphNode>;
  config: GraphViewConfig;
  theme: ThemeTokens;
  rungs?: RungWeights;
  timeCursor?: string | null;
}

type Ring = Array<[number, number]>;

/** Module-level cache: the world is fetched once per session, not per panel. */
let worldRings: Ring[] | null = null;
let worldPromise: Promise<Ring[]> | null = null;

function loadWorld(): Promise<Ring[]> {
  if (worldRings) return Promise.resolve(worldRings);
  if (!worldPromise) {
    worldPromise = import('@amcharts/amcharts5-geodata/worldLow')
      .then((mod) => {
        const fc: any = (mod as any).default ?? mod;
        const rings: Ring[] = [];
        for (const f of fc.features ?? []) {
          const g = f.geometry;
          if (!g) continue;
          const polys = g.type === 'Polygon' ? [g.coordinates]
            : g.type === 'MultiPolygon' ? g.coordinates
            : [];
          for (const poly of polys) {
            // Outer ring only. Holes (lakes, enclaves) cost geometry for
            // detail nobody reads at graph zoom.
            const outer = poly?.[0];
            if (Array.isArray(outer) && outer.length > 2) rings.push(outer as Ring);
          }
        }
        worldRings = rings;
        return rings;
      })
      .catch(() => {
        // A missing map must never take the graph down with it.
        worldRings = [];
        return [];
      });
  }
  return worldPromise;
}

export function useGeoPaint({
  nodes, config, theme, rungs = DEFAULT_RUNGS, timeCursor,
}: Deps): GeoPainter | undefined {
  const enabled = config.mapMode === 'underlay';
  const radius = geoRadius(config.linkDistance);
  // STATE, not a ref. `projected` reads `worldRings` at render time, so the
  // outlines can only appear on a render — and bumping a ref causes none. The
  // map therefore drew nothing until something else happened to re-render the
  // panel, which on a settled graph is never. The old comment ("a re-render on
  // arrival is enough to repaint") was true and nothing was producing one.
  const [, setLoaded] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadWorld().then(() => { if (live) setLoaded(n => n + 1); });
    return () => { live = false; };
  }, [enabled]);

  // Project the outlines once per radius. Re-projecting 200k points every
  // frame would drop the simulation to single-digit fps.
  const projected = useMemo(() => {
    if (!enabled || !worldRings) return null;
    return worldRings.map(ring => ring.map(([lon, lat]) => mercator(lat, lon, radius)));
  }, [enabled, radius, worldRings?.length]);

  // Overlays are cheap (one entry per anchored node) so they recompute freely.
  const overlays = useMemo(() => {
    if (!enabled) return { arcs: [], ghosts: [] };
    const arcs: Array<[[number, number], [number, number]]> = [];
    const ghosts: Array<{ at: [number, number]; from: [number, number]; km: number | null }> = [];
    for (const n of nodes) {
      const ends = trajectoryEnds(n, timeCursor);
      if (ends) {
        arcs.push([
          mercator(ends[0][0], ends[0][1], radius),
          mercator(ends[1][0], ends[1][1], radius),
        ]);
        continue;   // a leg has no seat, so it cannot diverge from one
      }
      const d = placeDivergence(n, rungs, timeCursor);
      if (d) {
        ghosts.push({
          at: mercator(d.ghost.lat!, d.ghost.lon!, radius),
          from: mercator(d.primary.lat!, d.primary.lon!, radius),
          km: haversineKm(d.primary, d.ghost),
        });
      }
    }
    return { arcs, ghosts };
  }, [enabled, nodes, radius, rungs, timeCursor]);

  return useMemo(() => {
    if (!enabled) return undefined;
    return (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const px = (n: number) => n / globalScale;   // keep strokes hairline at any zoom
      ctx.save();

      // ---- Outlines ----
      if (projected) {
        ctx.strokeStyle = theme.edgeStroke;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = px(0.7);
        ctx.beginPath();
        for (const ring of projected) {
          ctx.moveTo(ring[0][0], ring[0][1]);
          for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
          ctx.closePath();
        }
        ctx.stroke();
      }

      // ---- Divergence: ghost + connector ----
      // Dashed and faint, because the ghost is a position the node is NOT at.
      // Drawing it solid would put two equally-confident marks on the map for
      // one thing, which is exactly the ambiguity this is meant to expose.
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([px(3), px(3)]);
      ctx.lineWidth = px(0.8);
      ctx.strokeStyle = '#f59e0b';
      for (const g of overlays.ghosts) {
        ctx.beginPath();
        ctx.moveTo(g.from[0], g.from[1]);
        ctx.lineTo(g.at[0], g.at[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(g.at[0], g.at[1], px(4), 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // ---- Trajectory arcs ----
      // Bowed, so two legs between the same pair do not overlap into one line
      // and read as a single journey.
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = px(1.2);
      ctx.strokeStyle = theme.edgeStroke;
      for (const [[ax, ay], [bx, by]] of overlays.arcs) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const dx = bx - ax, dy = by - ay;
        const bow = 0.18;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(mx - dy * bow, my + dx * bow, bx, by);
        ctx.stroke();
      }

      ctx.restore();
    };
  }, [enabled, projected, overlays, theme.edgeStroke]);
}

/**
 * Place clusters currently on the map — the data behind the region pane.
 *
 * Clicking one writes `near:"X"<Nkm` into the query, which scopes the canvas,
 * the item pane and the evidence pane together. That is the whole point of
 * the region mode: a spatial gesture that behaves like every other filter
 * rather than like a separate viewport.
 */
export function placeClusters(
  nodes: ReadonlyArray<GraphNode>,
  rungs: RungWeights = DEFAULT_RUNGS,
  cursor?: string | null,
): Array<{ place: string; count: number; lat: number; lon: number }> {
  const by = new Map<string, { place: string; count: number; lat: number; lon: number }>();
  for (const n of nodes) {
    const r = resolvePlace(n, rungs, cursor);
    if (!r || !r.place.place) continue;
    const key = r.place.place.toLowerCase();
    const hit = by.get(key);
    if (hit) hit.count += 1;
    else by.set(key, { place: r.place.place, count: 1, lat: r.place.lat!, lon: r.place.lon! });
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}
