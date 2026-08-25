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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Axis3d, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  HUD_NUM, HUD_PROSE, HUD_SURFACE, HudButton, HudChip, HudMeter,
  HudOption, HudOverline, HudReadout,
} from '@/components/collection/graph/chrome';
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
  return (
    <span className="flex items-center gap-1.5">
      <HudMeter value={pct / 100} />
      <span className={cn(HUD_NUM, 'w-7 text-right text-hud-dimmer')}>{pct}%</span>
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
        <div>
          <HudOption
            active={active}
            disabled={disabled}
            onClick={onPick}
            label={FRAME_LABEL[f]}
            trailing={
              <span className="flex items-center gap-2">
                <HudReadout>{FRAME_COST[f]}ax</HudReadout>
                {cov(f) && <Bar {...cov(f)!} />}
              </span>
            }
          />
        </div>
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
        <HudButton icon={Axis3d} count={`${used}/${AXIS_BUDGET}`}>
          {b.plane ? FRAME_LABEL[b.plane] : '—'}
          {b.up && <span className="text-hud-dimmer">·{FRAME_LABEL[b.up]}</span>}
        </HudButton>
      </PopoverTrigger>

      <PopoverContent align="start" className={cn(HUD_SURFACE, 'w-[22rem] p-0')}>
        <TooltipProvider delayDuration={200}>
          <div className="flex items-baseline gap-2 border-b border-hud-line px-3 py-2">
            <span className="text-[11px] font-medium text-hud-fg">Axes</span>
            <span className={cn(HUD_PROSE, 'text-hud-dimmer')}>
              three axes, four frames
            </span>
          </div>

          <div className="space-y-3 p-2.5">
            <section className="space-y-0.5">
              <HudOverline
                trailing={b.plane === 'geo' ? (
                  <HudChip
                    active={b.pin}
                    onClick={() => onChange({ ...b, pin: !b.pin })}
                    title={b.pin
                      ? 'Pinned — a simulation must not out-vote a latitude'
                      : 'Pulled — the layout may move a geocoded node'}
                  >
                    {b.pin ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                    {b.pin ? 'pinned' : 'pulled'}
                  </HudChip>
                ) : undefined}
              >
                Plane
              </HudOverline>
              {FRAMES.map(f => (
                <Row key={f} f={f} active={b.plane === f}
                     disabled={dead(f) || f === 'event'}
                     onPick={() => slot('plane')(b.plane === f ? null : f)} />
              ))}
            </section>

            <section className="space-y-0.5">
              <HudOverline>Up</HudOverline>
              {FRAMES.map(f => (
                <Row key={f} f={f} active={b.up === f}
                     disabled={dead(f) || f === 'event' || FRAME_COST[f] + (b.plane ? FRAME_COST[b.plane] : 0) > AXIS_BUDGET}
                     onPick={() => slot('up')(b.up === f ? null : f)} />
              ))}
            </section>

            {free.length > 0 && (
              <p className={cn(HUD_PROSE, 'rounded-lg border border-hud-line px-2.5 py-1.5 text-hud-dimmer')}>
                <span className="text-hud-fg">Free: {free.map(f => FRAME_LABEL[f]).join(' · ')}.</span>{' '}
                Not demoted — an unpinned interest drifts to the centre of gravity
                of everything serving it, so where it lands is an answer.
              </p>
            )}

            <section className="space-y-1.5">
              <HudOverline>Camera</HudOverline>
              <div className="flex flex-wrap gap-1">
                {CAMERAS.map(c => {
                  const on = b.plane === c.budget.plane && b.up === c.budget.up;
                  return (
                    <Tooltip key={c.id}>
                      <TooltipTrigger asChild>
                        <HudChip
                          active={on}
                          onClick={() => {
                            onChange({ ...c.budget });
                            onViewModeChange?.(c.view);
                          }}
                        >
                          {c.label}
                        </HudChip>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[15rem] text-xs">
                        {c.hint}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
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
