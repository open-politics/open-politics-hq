'use client';

/**
 * TimeScrubber — activity bars plus a cursor over the graph's own intervals.
 *
 * Two properties make this trustworthy rather than decorative:
 *
 * 1. **The bars histogram the same intervals the graph filters on.** Both read
 *    the same clock off the nodes and edges already on screen, through the same
 *    `clockOf`, so the bars can never disagree with what the canvas shows. A
 *    separate aggregate query would drift the moment a filter changed.
 * 2. **It never refetches.** Intervals ride the graph payload (Phase D1), so
 *    scrubbing is a pure client-side predicate. Dragging is immediate.
 *
 * Property 1 was false until the clock became explicit. The bars preferred
 * `a0`/`a1` per item while `filterByCursor` read `t0`/`t1` unconditionally, so
 * with any `activity` binding in play the histogram counted the period items
 * were *about* while the cursor filtered on when they *happened*. Which clock
 * is in force is now one value, chosen on the bar, passed to both.
 *
 * Untimed items are *not* hidden. Most graphs are partly undated, and dropping
 * everything without a timestamp the moment someone touches the slider would
 * make the control feel broken. The scrubber narrows what *has* time.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Clock as ClockIcon, Pause, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  activityCoverage, clockOf, intervalCovers, timeExtent,
  type Clock, type GraphEdge, type GraphNode,
} from '../graphTypes';

const BUCKETS = 48;

interface Props {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  /** ISO cursor, or null when the scrubber is off (everything visible). */
  cursor: string | null;
  onCursorChange: (next: string | null) => void;
  /** Which clock the bars and the cursor both run on. See `clockOf`. */
  clock?: Clock;
  onClockChange?: (next: Clock) => void;
  /** Where the scrubber sits. `inline` puts it in the layout flow above the
   *  canvas; `overlay` floats it along the bottom of the canvas; `hidden`
   *  removes it.
   *
   *  A prop rather than two components, because which one reads better depends
   *  on the dashboard — a tall panel wants it inline, a wide one wants the
   *  vertical space back — and switching should never be a rewrite. */
  placement?: 'inline' | 'overlay' | 'hidden';
  className?: string;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function TimeScrubber({
  nodes, edges, cursor, onCursorChange,
  clock = 'time', onClockChange, placement = 'inline', className,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // How many items could answer on the second clock. Nothing to show means the
  // toggle is disabled rather than silently switching to an empty histogram —
  // same argument `frame_coverage` makes for greying out an axis.
  const covered = useMemo(
    () => activityCoverage(edges) + activityCoverage(nodes),
    [nodes, edges],
  );

  // Extent over edges *and* nodes: an edge carries the relationship's interval,
  // a node the union of everything that named it, and either alone can be the
  // wider range depending on how the projections were bound.
  const extent = useMemo(
    () => timeExtent([
      ...edges.map(e => clockOf(e, clock)),
      ...nodes.map(n => clockOf(n, clock)),
    ]),
    [nodes, edges, clock],
  );

  const { bars, timed } = useMemo(() => {
    if (!extent) return { bars: [] as number[], timed: 0 };
    const lo = Date.parse(extent.min), hi = Date.parse(extent.max);
    const span = Math.max(1, hi - lo);
    const counts = new Array<number>(BUCKETS).fill(0);
    let n = 0;
    // Edges are the unit of "something happened" — a node's interval is a
    // consequence of its edges, so counting both would double-count.
    for (const e of edges) {
      const { t0, t1 } = clockOf(e, clock);
      if (!t0) continue;
      n += 1;
      const a = Date.parse(t0);
      // An open-ended interval spans to the end of the window: that *is* what
      // "from here onward" means, and truncating it to a single bar would
      // under-report every bare-timestamp binding.
      const b = t1 ? Date.parse(t1) : hi;
      if (!Number.isFinite(a)) continue;
      const from = Math.max(0, Math.min(BUCKETS - 1, Math.floor(((a - lo) / span) * BUCKETS)));
      const to = Math.max(from, Math.min(BUCKETS - 1, Math.floor((((Number.isFinite(b) ? b : hi) - lo) / span) * BUCKETS)));
      for (let i = from; i <= to; i += 1) counts[i] += 1;
    }
    return { bars: counts, timed: n };
  }, [edges, extent, clock]);

  // Playback. Interval-free: each frame advances from the *current* cursor, so
  // a drag mid-playback is picked up rather than fought.
  React.useEffect(() => {
    if (!playing || !extent) return;
    const lo = Date.parse(extent.min), hi = Date.parse(extent.max);
    const step = Math.max(1, (hi - lo) / BUCKETS);
    const id = window.setInterval(() => {
      const now = cursor ? Date.parse(cursor) : lo;
      const next = now + step;
      if (next >= hi) { onCursorChange(new Date(hi).toISOString()); setPlaying(false); }
      else onCursorChange(new Date(next).toISOString());
    }, 120);
    return () => window.clearInterval(id);
  }, [playing, cursor, extent, onCursorChange]);

  // Placement is a wrapper class, so the body below is written once and
  // reads identically in the layout flow or floating on the canvas.
  const placementClass = placement === 'overlay'
    ? 'pointer-events-auto absolute inset-x-2 bottom-2 z-20 rounded-lg border border-border/60 bg-background/85 py-1 backdrop-blur-sm shadow-sm'
    : '';

  if (placement === 'hidden') return null;

  if (!extent) {
    return (
      <div className={cn('flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground', placementClass, className)}>
        <ClockIcon className="h-3 w-3" />
        No time binding — set one under Sources to enable the timeline.
      </div>
    );
  }

  const lo = Date.parse(extent.min), hi = Date.parse(extent.max);
  const max = Math.max(1, ...bars);
  const cursorBucket = cursor
    ? Math.floor((Math.max(0, Math.min(1, (Date.parse(cursor) - lo) / Math.max(1, hi - lo)))) * (BUCKETS - 1))
    : BUCKETS - 1;

  // The bars ARE the track. A slider under a histogram was two controls for one
  // number and twice the height; scrubbing on the bars is the same gesture with
  // the counts as the scale.
  const seekTo = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const u = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    setPlaying(false);
    onCursorChange(new Date(lo + (hi - lo) * u).toISOString());
  };

  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-1.5 px-2', placementClass, className)}>
        <Button
          size="icon" variant="ghost" className="h-5 w-5 shrink-0"
          onClick={() => {
            if (!cursor) onCursorChange(extent.min);
            setPlaying(p => !p);
          }}
          title={playing ? 'Pause' : 'Play through time'}
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>

        <div
          ref={trackRef}
          role="slider"
          aria-label="Time cursor"
          aria-valuemin={lo} aria-valuemax={hi}
          aria-valuenow={cursor ? Date.parse(cursor) : hi}
          aria-valuetext={cursor ? fmt(cursor) : 'all time'}
          tabIndex={0}
          className={cn(
            'relative flex h-5 min-w-0 flex-1 cursor-ew-resize items-end gap-px',
            clock === 'activity' && 'rounded-sm bg-amber-500/5',
          )}
          onPointerDown={e => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            seekTo(e.clientX);
          }}
          onPointerMove={e => { if (e.buttons === 1) seekTo(e.clientX); }}
          onKeyDown={e => {
            const step = (hi - lo) / BUCKETS;
            const at = cursor ? Date.parse(cursor) : hi;
            if (e.key === 'ArrowLeft') { setPlaying(false); onCursorChange(new Date(Math.max(lo, at - step)).toISOString()); }
            if (e.key === 'ArrowRight') { setPlaying(false); onCursorChange(new Date(Math.min(hi, at + step)).toISOString()); }
          }}
        >
          {bars.map((c, i) => (
            <div
              key={i}
              aria-hidden
              className={cn(
                'flex-1 rounded-sm transition-colors',
                i <= cursorBucket
                  ? (clock === 'activity' ? 'bg-amber-500/60' : 'bg-primary/60')
                  : 'bg-muted-foreground/20',
              )}
              // An empty bucket draws nothing. The old 2% floor painted a sliver
              // that read as "a little activity" in a control whose whole claim
              // is that it cannot mislead.
              style={{ height: c > 0 ? `${Math.max(8, (c / max) * 100)}%` : '0%' }}
            />
          ))}
          {cursor && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
              style={{ left: `${((Date.parse(cursor) - lo) / Math.max(1, hi - lo)) * 100}%` }}
            />
          )}
        </div>

        {/* Which clock, on the bar. A reader must be able to see whether they
            are looking at when it happened or the period it is about without
            opening anything — that is the entire point of the fix. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!covered || !onClockChange}
              onClick={() => onClockChange?.(clock === 'time' ? 'activity' : 'time')}
              className={cn(
                'shrink-0 rounded border px-1 text-[9px] font-medium tabular-nums transition-colors',
                clock === 'activity'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'text-muted-foreground hover:bg-muted',
                (!covered || !onClockChange) && 'cursor-default opacity-50',
              )}
            >
              {clock === 'activity' ? 'covers' : 'when'}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[19rem] text-xs">
            {!covered ? (
              <>No second clock bound. Nothing here carries a
                covered period, so there is only <b>when</b>.</>
            ) : (
              <><b>when</b> is the date it happened or was recorded.{' '}
                <b>covers</b> is the period it is <i>about</i> — a deposition
                describing events fifteen years earlier. {covered} item
                {covered === 1 ? '' : 's'} carry one. The bars and the cursor
                always read the same clock.</>
            )}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 cursor-help font-mono text-[10px] tabular-nums">
              {cursor ? fmt(cursor) : 'all time'}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[18rem] text-xs">
            {fmt(extent.min)} — {fmt(extent.max)}. {timed} of {edges.length} edges
            carry a timestamp; items without one are always shown, because the
            scrubber narrows what has time rather than hiding what doesn't.
          </TooltipContent>
        </Tooltip>

        {cursor && (
          <Button
            size="icon" variant="ghost" className="h-5 w-5 shrink-0"
            onClick={() => { setPlaying(false); onCursorChange(null); }}
            title="Show all time"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Re-exported so the scrubber and its filter still read as one instrument.
 *  The function itself lives in `graphTypes` beside `clockOf` — it is pure, and
 *  a pure function inside a `.tsx` cannot be unit-tested without a DOM. */
export { filterByCursor } from '../graphTypes';
