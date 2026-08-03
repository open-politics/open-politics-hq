'use client';

/**
 * LanesPane — time × category. The third panel from the sketch.
 *
 * Rows are a category, x is time, and each bar is one occurrence's interval.
 * The rows default to **place**, which gives "which place was active when" —
 * but the row binding is a channel like any other, so it takes `kind`,
 * `node_type`, `serves`, or a role just as happily. Nothing here knows what a
 * place is.
 *
 * **Two clocks.** Binding x to `activity` rather than `time` is where the court
 * case becomes visible: the lanes show *the period a claim covers* while the
 * scrubber runs over *when it was said*. `Projection.time` and
 * `Projection.activity` exist for exactly this, and this is the surface that
 * pays for them.
 *
 * Reads the same `t0`/`t1` (or `a0`/`a1`) as the canvas and the scrubber, so
 * all three agree by construction rather than by discipline.
 */
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { clockOf, timeExtent, type Clock, type GraphEdge, type GraphNode } from '../graphTypes';

/** What a lane is keyed on. `place` is the default; the rest are the other
 *  categorical things an occurrence already carries. */
export type LaneRowKey = 'place' | 'node_type' | 'kind' | 'group' | 'event';

/** Which clock the x-axis runs on. `time` is when it happened / was recorded;
 *  `activity` is the period it is *about*. Usually the same; when they differ,
 *  the difference is the finding.
 *
 *  Aliases the shared `Clock` — the lanes, the scrubber and `filterByCursor`
 *  read an interval through one `clockOf`, because the scrubber and the filter
 *  disagreeing about which clock they were on is the bug that made this
 *  explicit in the first place. */
export type LaneClock = Clock;

interface Props {
  nodes: ReadonlyArray<GraphNode>;
  rowKey?: LaneRowKey;
  clock?: LaneClock;
  /** ISO cursor from the scrubber, drawn as a vertical rule so the lanes and
   *  the timeline read as one instrument. */
  cursor?: string | null;
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
  maxRows?: number;
  className?: string;
  /** Needed only for `rowKey: 'event'` — an occurrence's occasion is reached
   *  through its `during` edge, not read off the node. */
  edges?: ReadonlyArray<GraphEdge>;
}

/** occurrence id → the event it belongs to.
 *
 *  An observation's occasion is reached through its `during` edge, so unlike
 *  every other lane key this one is a property of the graph rather than of the
 *  node — which is why the pane needs edges at all. Laning by event is what
 *  turns the strip into chapters and sentences: the band is the happening, the
 *  ticks inside it are what each document reported of it. */
function eventLanes(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
): Map<string, string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = new Map<string, string>();
  for (const e of edges) {
    const target = byId.get(e.targetId);
    if (!target || (target.type || '').toLowerCase() !== 'event') continue;
    // First one wins — a row belonging to two events lanes under the first,
    // which beats duplicating it and double-counting the band.
    if (!out.has(e.sourceId)) out.set(e.sourceId, target.label);
  }
  return out;
}

function laneOf(
  n: GraphNode, key: LaneRowKey, events: Map<string, string>,
): string | null {
  switch (key) {
    case 'place': return n.place ?? null;
    case 'node_type': return n.nodeType ?? n.type ?? null;
    case 'kind': return n.kind ?? null;
    case 'event': return events.get(n.id) ?? null;
    case 'group': {
      const g = n.groupValue;
      if (typeof g === 'string') return g;
      if (Array.isArray(g)) return g[0] ?? null;
      if (g && typeof g === 'object') {
        // A weighted profile lanes by its strongest label — an actor sits in
        // the lane of the interest they mostly serve.
        const top = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
        return top?.[0] ?? null;
      }
      return null;
    }
  }
}

const span = (n: GraphNode, clock: LaneClock) => clockOf(n, clock);

export function LanesPane({
  nodes, edges = [], rowKey = 'place', clock = 'time', cursor,
  selectedId, onSelect, maxRows = 12, className,
}: Props) {
  const { lanes, lo, hi } = useMemo(() => {
    const events = rowKey === 'event' ? eventLanes(nodes, edges) : new Map<string, string>();
    const occ = nodes.filter(n => n.kind === 'occurrence');
    const extent = timeExtent(occ.map(n => span(n, clock)));
    if (!extent) return { lanes: [], lo: 0, hi: 1 };
    const byLane = new Map<string, GraphNode[]>();
    for (const n of occ) {
      const lane = laneOf(n, rowKey, events);
      if (!lane) continue;                 // unplaced rows get no lane, not a fake one
      const list = byLane.get(lane);
      if (list) list.push(n); else byLane.set(lane, [n]);
    }
    return {
      // Busiest lanes first, truncated — a hundred one-row lanes is not a view.
      lanes: [...byLane.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, maxRows),
      lo: Date.parse(extent.min),
      hi: Date.parse(extent.max),
    };
  }, [nodes, edges, rowKey, clock, maxRows]);

  if (lanes.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        Nothing to lane by {rowKey.replace('_', ' ')}. Bind a place or a kind on
        the projection, or switch the row axis.
      </p>
    );
  }

  const width = Math.max(1, hi - lo);
  const pct = (iso?: string | null, fallback = 100) =>
    iso ? ((Date.parse(iso) - lo) / width) * 100 : fallback;
  const cursorPct = cursor ? pct(cursor, 100) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('relative px-2 py-1.5', className)}>
        {cursorPct != null && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/70"
            style={{ left: `calc(${Math.max(0, Math.min(100, cursorPct))}% )` }}
          />
        )}
        {lanes.map(([lane, items]) => (
          <div key={lane} className="flex items-center gap-1.5 py-0.5">
            <span className="w-[76px] shrink-0 truncate text-[10px] text-muted-foreground">
              {lane}
            </span>
            <div className="relative h-3 flex-1 rounded-sm bg-muted/40">
              {items.map(n => {
                const s = span(n, clock);
                const a = Math.max(0, Math.min(100, pct(s.t0, 0)));
                // An open end runs to the edge of the window — that is what
                // "from here onward" means, and clipping it to a hairline
                // would under-report every bare-timestamp binding.
                const b = Math.max(a, Math.min(100, pct(s.t1, 100)));
                return (
                  <Tooltip key={n.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelect?.(n.id)}
                        className={cn(
                          'absolute inset-y-0 rounded-sm transition-colors',
                          selectedId === n.id
                            ? 'bg-primary'
                            : 'bg-primary/45 hover:bg-primary/70',
                        )}
                        style={{
                          left: `${a}%`,
                          width: `${Math.max(1.2, b - a)}%`,
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div className="font-medium">{n.label}</div>
                      <div className="text-muted-foreground">
                        {(s.t0 ?? '?').slice(0, 10)}
                        {s.t1 && s.t1 !== s.t0 ? ` → ${s.t1.slice(0, 10)}` : ''}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <span className="w-6 shrink-0 text-right tabular-nums text-[10px] text-muted-foreground">
              {items.length}
            </span>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
