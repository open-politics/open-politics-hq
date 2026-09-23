'use client';

import React from 'react';

export interface SourceStream {
  sourceId: number;
  bundleId: number;
  /** The source's group anchor key — its streams leave from the group header while collapsed. */
  group: string;
}

interface DrawnStream {
  id: string;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Corner radius for the rounded elbows. */
const ELBOW_R = 6;

/**
 * Orthogonal connector through a vertical lane at `lx`: horizontal out of the
 * start, down the lane, horizontal into the end — rectangular, with only the two
 * elbows rounded (quarter-turn quads). The radius is clamped to the available
 * segment lengths, so near-aligned endpoints just draw a sharp/straight path.
 */
function elbowPath(sx: number, sy: number, lx: number, ex: number, ey: number): string {
  const dir1 = Math.sign(lx - sx) || 1; // start → lane (horizontal)
  const dirV = Math.sign(ey - sy) || 1; // lane run (vertical)
  const dir2 = Math.sign(ex - lx) || 1; // lane → end (horizontal)
  const r = Math.min(ELBOW_R, Math.abs(lx - sx), Math.abs(ex - lx), Math.abs(ey - sy) / 2);
  if (r < 0.5) {
    return `M ${sx} ${sy} L ${lx} ${sy} L ${lx} ${ey} L ${ex} ${ey}`;
  }
  return [
    `M ${sx} ${sy}`,
    `L ${lx - dir1 * r} ${sy}`,
    `Q ${lx} ${sy} ${lx} ${sy + dirV * r}`,
    `L ${lx} ${ey - dirV * r}`,
    `Q ${lx} ${ey} ${lx + dir2 * r} ${ey}`,
    `L ${ex} ${ey}`,
  ].join(' ');
}

/**
 * SourceStreams — the wiring overlay.
 *
 * Draws blue orthogonal connectors (rectangular, with lightly rounded elbows)
 * from each source row (left rail) to the bundle it streams into
 * (`output_bundle_id`) in the middle tree. Both ends are located by data
 * attribute (`[data-source-id]` / `[data-bundle-id]`) within `containerRef`, so
 * this component owns no layout — it just reads the DOM and paints on top.
 *
 * Two rules keep the bundle of connectors legible:
 *  - Lanes: each stream's vertical run sits on a dedicated lane in the gutter,
 *    assigned by source-list order — bottom of the list hugs the rail
 *    (outermost-left lane), top of the list rides nearest the tree. The runs
 *    nest predictably instead of crossing at random, and routing only ever
 *    moves outward in x (no overshoot/doubling back).
 *  - Edge clamp: a row can scroll out of view, and since the tree isn't
 *    virtualized its off-screen rect is real and far away — left alone the curve
 *    aims way off-canvas and reads as broken. An out-of-band endpoint clamps to
 *    the top/bottom edge but keeps its own lane x, so off-screen streams stay
 *    staggered along the edge rather than funnelling to one point.
 *
 * A source whose row isn't rendered (its group is collapsed) anchors to its
 * group header (`[data-source-group]`) instead; members of one collapsed group
 * that feed the same bundle are drawn once.
 *
 * `streams` must arrive in source-list order (AssetManager builds it that way)
 * so lane ranks line up with the rail. Geometry is re-measured on anything that
 * could move an anchor: container resize, tree expand/collapse (MutationObserver),
 * either column scrolling (capture-phase), window resize — all rAF-coalesced —
 * plus a short settle loop after the set changes (the gutter's CSS transition
 * mutates nothing per frame, so the observers would otherwise miss it).
 */
export function SourceStreams({
  containerRef,
  streams,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  streams: SourceStream[];
}) {
  const [drawn, setDrawn] = React.useState<DrawnStream[]>([]);
  // Clear without thrashing identity when already empty.
  const clearDrawn = React.useCallback(() => setDrawn((prev) => (prev.length === 0 ? prev : [])), []);

  const measure = React.useCallback(() => {
    const container = containerRef.current;
    if (!container || streams.length === 0) {
      clearDrawn();
      return;
    }
    const base = container.getBoundingClientRect();

    // First pass — raw endpoint coords (local to the container). Source rail
    // sits left of the tree: leave from the row's right edge, arrive at the
    // bundle row's left edge. Track the gutter bounds while we're at it.
    type Raw = { id: string; x1: number; y1: number; x2: number; y2: number };
    const raw: Raw[] = [];
    let railRightX = -Infinity;
    let treeLeftX = Infinity;
    // A collapsed group has no rows, so its streams leave from the group header;
    // several members feeding one bundle then collapse to a single line.
    const seen = new Set<string>();
    for (const { sourceId, bundleId, group } of streams) {
      const rowEl = container.querySelector(`[data-source-id="${sourceId}"]`);
      const srcEl = rowEl ?? container.querySelector(`[data-source-group="${CSS.escape(group)}"]`);
      const dstEl = container.querySelector(`[data-bundle-id="${bundleId}"]`);
      if (!srcEl || !dstEl) continue;
      const id = rowEl ? `${sourceId}-${bundleId}` : `group:${group}-${bundleId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const s = srcEl.getBoundingClientRect();
      const d = dstEl.getBoundingClientRect();
      const x1 = s.right - base.left;
      const y1 = s.top + s.height / 2 - base.top;
      const x2 = d.left - base.left;
      const y2 = d.top + d.height / 2 - base.top;
      raw.push({ id, x1, y1, x2, y2 });
      if (x1 > railRightX) railRightX = x1;
      if (x2 < treeLeftX) treeLeftX = x2;
    }
    const N = raw.length;
    if (N === 0) {
      clearDrawn();
      return;
    }

    const gutterL = railRightX;
    const gutterR = treeLeftX;
    const gutterW = Math.max(0, gutterR - gutterL);

    // INSET keeps a clamped endpoint just inside the top/bottom edge.
    const INSET = 6;
    const topY = INSET;
    const bottomY = base.height - INSET;

    // Lane x for the i-th stream (streams arrive top→bottom in source-list
    // order). Bottom of the list → leftmost lane (hugs the rail); top → nearest
    // the tree. Lanes are evenly spaced strictly inside the gutter.
    const laneX = (i: number) => gutterL + ((N - i) / (N + 1)) * gutterW;

    const next: DrawnStream[] = [];
    for (let i = 0; i < N; i++) {
      const r = raw[i];
      const lx = laneX(i);
      // An out-of-band endpoint clamps to the edge but keeps THIS stream's lane
      // x, so off-screen streams stay staggered along the edge instead of all
      // converging on one point.
      const place = (x: number, y: number) => {
        if (y < topY) return { x: lx, y: topY, clamped: true };
        if (y > bottomY) return { x: lx, y: bottomY, clamped: true };
        return { x, y, clamped: false };
      };
      const a = place(r.x1, r.y1);
      const b = place(r.x2, r.y2);
      // Both ends collapsed onto the same edge → nothing meaningful to draw.
      if (a.clamped && b.clamped && a.y === b.y) continue;
      // Orthogonal routing through the lane: horizontal out of the source, down
      // the lane's vertical run, horizontal into the bundle — rectangular, with
      // only the two elbows lightly rounded.
      next.push({
        id: r.id,
        d: elbowPath(a.x, a.y, lx, b.x, b.y),
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      });
    }
    setDrawn(next);
  }, [containerRef, streams, clearDrawn]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || streams.length === 0) {
      clearDrawn();
      return;
    }

    let scheduleRaf = 0;
    const schedule = () => {
      cancelAnimationFrame(scheduleRaf);
      scheduleRaf = requestAnimationFrame(measure);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    // Tree expand/collapse adds/removes rows and animates transforms — catch both.
    const mo = new MutationObserver(schedule);
    mo.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    // Scroll doesn't bubble; capture catches it from either scroll container.
    container.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);

    // Settle loop: the gutter's CSS transition + bundle unfolds change layout
    // without mutating the DOM per frame, so the observers above miss them.
    // Re-measure each frame for a short window so the connectors follow the
    // motion instead of snapping at the end (also covers the initial measure).
    let settleRaf = 0;
    let startTs = 0;
    const settle = (ts: number) => {
      if (startTs === 0) startTs = ts;
      measure();
      if (ts - startTs < 400) settleRaf = requestAnimationFrame(settle);
    };
    settleRaf = requestAnimationFrame(settle);

    return () => {
      cancelAnimationFrame(scheduleRaf);
      cancelAnimationFrame(settleRaf);
      ro.disconnect();
      mo.disconnect();
      container.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [containerRef, streams, measure, clearDrawn]);

  if (drawn.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
      {drawn.map((l) => (
        <g key={l.id} className="text-blue-500">
          <path d={l.d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.65} />
          <circle cx={l.x1} cy={l.y1} r={2.5} fill="currentColor" />
          <circle cx={l.x2} cy={l.y2} r={2.5} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}
