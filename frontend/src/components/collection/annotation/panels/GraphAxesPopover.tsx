'use client';

/**
 * The axis budget — the graph panel's primary control.
 *
 * It replaces a question the panel used to ask and an investigator never has
 * ("which field is the graph source"). The real one is **how are you spending
 * three axes across four frames**, and it fits in two dropdowns.
 *
 * Coverage is shown per frame, and that is not decoration. Choosing a plane
 * with 5% fill and discovering it afterwards is the exact failure `anchors.ts`
 * warns about — "a mostly-empty map with a blob over the ocean" — so the counts
 * come down on the wire with the graph and a frame that cannot position
 * anything is disabled rather than merely disappointing.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Axis3d, Check, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AXIS_BUDGET, CAMERAS, FRAME_COST, FRAME_HINT, FRAME_LABEL,
  canAfford, defaultAxisBudget, freeFrames, spent,
  type AxisBudget, type Frame,
} from '@/components/collection/graph/forcegraph/axes';

export interface FrameCoverage {
  [frame: string]: { have: number; of: number };
}

interface Props {
  budget: AxisBudget;
  onChange: (next: AxisBudget) => void;
  /** From the graph phase's `meta.frames`. Absent until the first response. */
  coverage?: FrameCoverage;
  /** Switching to the block needs 3D; the camera presets carry it. */
  viewMode?: '2d' | '3d';
  onViewModeChange?: (next: '2d' | '3d') => void;
}

const FRAMES: Frame[] = ['geo', 'time', 'interest', 'event'];

function Bar({ have, of }: { have: number; of: number }) {
  const pct = of > 0 ? Math.round((100 * have) / of) : 0;
  const filled = Math.round(pct / 10);
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <span className="font-mono text-[9px] tracking-tighter text-muted-foreground">
        {'●'.repeat(filled)}{'○'.repeat(10 - filled)}
      </span>
      <span className="w-8 text-right text-[10px] text-muted-foreground">{pct}%</span>
    </span>
  );
}

export function GraphAxesPopover({
  budget, onChange, coverage, viewMode, onViewModeChange,
}: Props) {
  const b = { ...defaultAxisBudget, ...budget };
  const used = spent(b);
  const free = freeFrames(b);

  const cov = (f: Frame) => coverage?.[f];
  const dead = (f: Frame) => {
    const c = cov(f);
    return c ? c.have === 0 : false;
  };

  const slot = (which: 'plane' | 'up') => (f: Frame | null) => {
    if (f === null) return onChange({ ...b, [which]: null });
    if (!canAfford(b, which, f)) {
      // Taking a frame that is already in the other slot MOVES it rather than
      // refusing — refusing would make the two dropdowns feel stuck.
      const other = which === 'plane' ? 'up' : 'plane';
      return onChange({ ...b, [which]: f, [other]: null });
    }
    onChange({ ...b, [which]: f });
  };

  const Row = ({ f, active, onPick, disabled }: {
    f: Frame; active: boolean; onPick: () => void; disabled: boolean;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className={cn(
            'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px]',
            'transition-colors hover:bg-accent disabled:opacity-40',
            'disabled:hover:bg-transparent',
          )}
        >
          <Check className={cn('h-3 w-3 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
          <span className="min-w-0 flex-1 truncate font-medium">{FRAME_LABEL[f]}</span>
          <span className="shrink-0 text-[9px] text-muted-foreground">
            {FRAME_COST[f]} {FRAME_COST[f] === 1 ? 'axis' : 'axes'}
          </span>
          {cov(f) && <Bar {...cov(f)!} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[17rem] text-xs">
        {FRAME_HINT[f]}
        {dead(f) && (
          <p className="mt-1 text-amber-600 dark:text-amber-400">
            Nothing in this run can be positioned by it.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 gap-1 px-1.5 text-[11px]">
          <Axis3d className="h-3 w-3" />
          {b.plane ? FRAME_LABEL[b.plane] : '—'}
          {b.up && <span className="text-muted-foreground">· {FRAME_LABEL[b.up]}</span>}
          <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
            {used}/{AXIS_BUDGET}
          </Badge>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[22rem] p-3">
        <TooltipProvider delayDuration={200}>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-medium">Axes</span>
            <span className="text-[10px] text-muted-foreground">
              three axes, four frames
            </span>
          </div>

          <div className="space-y-2">
            <section>
              <div className="mb-0.5 flex items-center justify-between px-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">
                  PLANE
                </span>
                {b.plane === 'geo' && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...b, pin: !b.pin })}
                    className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground"
                    title={b.pin
                      ? 'Pinned — a simulation must not out-vote a latitude'
                      : 'Pulled — the layout may move a geocoded node'}
                  >
                    {b.pin ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                    {b.pin ? 'pinned' : 'pulled'}
                  </button>
                )}
              </div>
              {FRAMES.map(f => (
                <Row key={f} f={f} active={b.plane === f}
                     disabled={dead(f) || f === 'event'}
                     onPick={() => slot('plane')(b.plane === f ? null : f)} />
              ))}
            </section>

            <section className="border-t pt-1.5">
              <div className="mb-0.5 px-1.5 text-[10px] font-medium text-muted-foreground">
                UP
              </div>
              {FRAMES.map(f => (
                <Row key={f} f={f} active={b.up === f}
                     disabled={dead(f) || f === 'event' || FRAME_COST[f] + (b.plane ? FRAME_COST[b.plane] : 0) > AXIS_BUDGET}
                     onPick={() => slot('up')(b.up === f ? null : f)} />
              ))}
            </section>

            {free.length > 0 && (
              <p className="rounded-md border border-dashed px-2 py-1.5 text-[10px] leading-tight text-muted-foreground">
                <span className="font-medium">Free: {free.map(f => FRAME_LABEL[f]).join(' · ')}.</span>{' '}
                Not demoted — an unpinned interest drifts to the centre of gravity
                of everything serving it, so where it lands is an answer.
              </p>
            )}

            <section className="border-t pt-2">
              <div className="mb-1 px-1.5 text-[10px] font-medium text-muted-foreground">
                CAMERA
              </div>
              <div className="grid grid-cols-2 gap-1">
                {CAMERAS.map(c => {
                  const on = b.plane === c.budget.plane && b.up === c.budget.up;
                  return (
                    <Tooltip key={c.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            onChange({ ...c.budget });
                            onViewModeChange?.(c.view);
                          }}
                          className={cn(
                            'rounded border px-2 py-1 text-[11px] transition-colors',
                            on ? 'border-primary bg-accent font-medium'
                               : 'hover:bg-accent',
                          )}
                        >
                          {c.label}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[15rem] text-xs">
                        {c.hint}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <p className="mt-1.5 px-1.5 text-[10px] leading-tight text-muted-foreground">
                Each is a viewing angle on one arrangement, not a different
                chart — which is why the map, the lanes and the canvas cannot
                disagree about what is on screen.
              </p>
            </section>
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
