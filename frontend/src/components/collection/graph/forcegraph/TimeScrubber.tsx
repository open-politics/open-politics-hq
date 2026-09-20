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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUD_SURFACE, HudButton, HudChip } from '@/components/ui/chrome';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Clock as ClockIcon, Pause, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  activityCoverage, clockOf, intervalCovers, timeExtent,
  type Clock, type GraphEdge, type GraphNode,
} from '../graphTypes';

/** Target width of one bucket, including its gap. Two pixels of line and two
 *  of space reads as a fingerprint; twenty reads as a bar chart with opinions
 *  it does not have. */
const PX_PER_BUCKET = 4;
const MIN_BUCKETS = 48;
const MAX_BUCKETS = 400;
/** How many participants a bucket names on hover before it stops counting. */
const INSPECT_LIMIT = 8;

interface Props {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  /** ISO cursor, or null when the scrubber is off (everything visible). */
  cursor: string | null;
  onCursorChange: (next: string | null) => void;
  /** Narrow the query to a bucket's window. A click on a bar is a query edit,
   *  not a private viewport state — so it survives reload, travels with a
   *  shared dashboard, and every pane narrows with it. */
  onScopeToWindow?: (from: string, to: string) => void;
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
  nodes, edges, cursor, onCursorChange, onScopeToWindow,
  clock = 'time', onClockChange, placement = 'inline', className,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  // Bucket count is derived from the rendered width, so the strip has the same
  // resolution in a narrow side panel and a full-width dashboard.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const labelOf = useCallback(
    (e: GraphEdge) => byId.get(e.sourceId)?.label ?? '',
    [byId],
  );

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

  // **Bucket count follows the width.** It was a constant 48, and 48 `flex-1`
  // bars across a full-width panel are ~21px each — a row of blocks that reads
  // as a bar chart of nothing in particular and hides every gap narrower than a
  // twelfth of the corpus. At ~4px per bucket the strip becomes what it always
  // meant to be: a fingerprint of when things happened, where a gap is visible
  // because it is actually the width of the gap.
  const buckets = useMemo(
    () => Math.max(MIN_BUCKETS, Math.min(MAX_BUCKETS, Math.floor(width / PX_PER_BUCKET))),
    [width],
  );

  const { bars, timed, members } = useMemo(() => {
    if (!extent) {
      return { bars: [] as number[], timed: 0, members: [] as string[][] };
    }
    const lo = Date.parse(extent.min), hi = Date.parse(extent.max);
    const span = Math.max(1, hi - lo);
    const counts = new Array<number>(buckets).fill(0);
    // Which nodes each bucket contains, so a bar can be inspected rather than
    // only counted. A bar you cannot ask about is a decoration.
    const who: string[][] = Array.from({ length: buckets }, () => []);
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
      const from = Math.max(0, Math.min(buckets - 1, Math.floor(((a - lo) / span) * buckets)));
      const to = Math.max(from, Math.min(buckets - 1, Math.floor((((Number.isFinite(b) ? b : hi) - lo) / span) * buckets)));
      for (let i = from; i <= to; i += 1) {
        counts[i] += 1;
        if (who[i].length < INSPECT_LIMIT) {
          const label = labelOf(e);
          if (label && !who[i].includes(label)) who[i].push(label);
        }
      }
    }
    return { bars: counts, timed: n, members: who };
  }, [edges, extent, clock, buckets, labelOf]);

  // Playback. Interval-free: each frame advances from the *current* cursor, so
  // a drag mid-playback is picked up rather than fought.
  React.useEffect(() => {
    if (!playing || !extent) return;
    const lo = Date.parse(extent.min), hi = Date.parse(extent.max);
    const step = Math.max(1, (hi - lo) / buckets);
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
    ? cn('pointer-events-auto absolute inset-x-2 bottom-2 z-20 py-1', HUD_SURFACE)
    : '';

  if (placement === 'hidden') return null;

  if (!extent) {
    return (
      <div className={cn('flex items-center gap-1.5 px-2 py-1 text-[10px] text-hud-dimmer', placementClass, className)}>
        <ClockIcon className="h-3 w-3" />
        No time binding — set one under Sources to enable the timeline.
      </div>
    );
  }

  const lo = Date.parse(extent.min), hi = Date.parse(extent.max);
  const max = Math.max(1, ...bars);
  const cursorBucket = cursor
    ? Math.floor((Math.max(0, Math.min(1, (Date.parse(cursor) - lo) / Math.max(1, hi - lo)))) * (buckets - 1))
    : buckets - 1;

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
        <HudButton
          size="sm"
          icon={playing ? Pause : Play}
          active={playing}
          onClick={() => {
            if (!cursor) onCursorChange(extent.min);
            setPlaying(p => !p);
          }}
          title={playing ? 'Pause' : 'Play through time'}
        />

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
          onPointerLeave={() => setHover(null)}
          onClick={e => {
            // Alt-click scopes the query to the hovered window; a plain click
            // still scrubs. Two gestures on one strip because they answer two
            // questions — "show me this moment" and "show me only this".
            if (!e.altKey || hover == null || !onScopeToWindow) return;
            e.preventDefault();
            onScopeToWindow(
              new Date(lo + ((hi - lo) * hover) / buckets).toISOString(),
              new Date(lo + ((hi - lo) * (hover + 1)) / buckets).toISOString(),
            );
          }}
          onKeyDown={e => {
            const step = (hi - lo) / buckets;
            const at = cursor ? Date.parse(cursor) : hi;
            if (e.key === 'ArrowLeft') { setPlaying(false); onCursorChange(new Date(Math.max(lo, at - step)).toISOString()); }
            if (e.key === 'ArrowRight') { setPlaying(false); onCursorChange(new Date(Math.min(hi, at + step)).toISOString()); }
          }}
        >
          {bars.map((c, i) => (
            <div
              key={i}
              aria-hidden
              onPointerEnter={() => setHover(i)}
              className={cn(
                'flex-1 min-w-px rounded-none transition-colors',
                i === hover
                  ? 'bg-hud-fg'
                  : i <= cursorBucket
                    // Amber is the second clock, and it is the one hue on this
                    // strip that carries meaning — "you are reading the period
                    // this is ABOUT, not when it happened".
                    ? (clock === 'activity' ? 'bg-amber-500/70' : 'bg-hud-fg/55')
                    : 'bg-hud-line-strong',
              )}
              // An empty bucket draws nothing. The old 2% floor painted a sliver
              // that read as "a little activity" in a control whose whole claim
              // is that it cannot mislead.
              style={{ height: c > 0 ? `${Math.max(8, (c / max) * 100)}%` : '0%' }}
            />
          ))}

          {/* A bar you can ask about. Hover names what is in the bucket and
              how wide it is; clicking narrows the query to that window rather
              than moving a private cursor, so every pane follows. */}
          {hover != null && bars[hover] > 0 && (() => {
            const from = new Date(lo + ((hi - lo) * hover) / buckets).toISOString();
            const to = new Date(lo + ((hi - lo) * (hover + 1)) / buckets).toISOString();
            return (
              <div
                className={cn(HUD_SURFACE,
                  'pointer-events-none absolute bottom-full z-30 mb-1 w-max max-w-[18rem] px-2 py-1 text-[10px]')}
                style={{
                  left: `${(hover / buckets) * 100}%`,
                  transform: hover > buckets / 2 ? 'translateX(-100%)' : undefined,
                }}
              >
                <div className="tabular-nums text-hud-fg">
                  {fmt(from)} – {fmt(to)}
                </div>
                <div className="text-hud-dim">
                  {bars[hover]} {clock === 'activity' ? 'covering' : 'in window'}
                  {onScopeToWindow && ' · click to scope'}
                </div>
                {members[hover]?.length > 0 && (
                  <div className="mt-0.5 truncate text-hud-dimmer">
                    {members[hover].join(' · ')}
                    {bars[hover] > members[hover].length && ' …'}
                  </div>
                )}
              </div>
            );
          })()}
          {cursor && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-hud-fg"
              style={{ left: `${((Date.parse(cursor) - lo) / Math.max(1, hi - lo)) * 100}%` }}
            />
          )}
        </div>

        {/* Which clock, on the bar. A reader must be able to see whether they
            are looking at when it happened or the period it is about without
            opening anything — that is the entire point of the fix. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <HudChip
              disabled={!covered || !onClockChange}
              onClick={() => onClockChange?.(clock === 'time' ? 'activity' : 'time')}
              className={cn(
                clock === 'activity' &&
                  'border-amber-500/45 text-amber-600 dark:text-amber-400 hover:border-amber-500/70',
              )}
            >
              {clock === 'activity' ? 'covers' : 'when'}
            </HudChip>
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
            <span className="shrink-0 cursor-help font-mono text-[10px] tabular-nums text-hud-dim">
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
          <HudButton
            size="sm"
            icon={X}
            onClick={() => { setPlaying(false); onCursorChange(null); }}
            title="Show all time"
          />
        )}
      </div>
    </TooltipProvider>
  );
}

/** Re-exported so the scrubber and its filter still read as one instrument.
 *  The function itself lives in `graphTypes` beside `clockOf` — it is pure, and
 *  a pure function inside a `.tsx` cannot be unit-tested without a DOM. */
export { filterByCursor } from '../graphTypes';
