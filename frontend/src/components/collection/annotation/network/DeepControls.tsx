'use client';

/**
 * Deep time's viewpoint — where the depth converges, how deep the slices
 * stack, how far ahead stays in the light (`plane/TimeDeck`).
 *
 * The vanishing point is set where it is seen: a small frame standing for the
 * view, with a dot to drag. Depth and look-ahead are three steps each — the
 * difference between them is visible at once, and a fine slider would only
 * ask for fiddling.
 */
import React, { useRef, useState } from 'react';
import { Telescope } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { VANISH_REACH as REACH } from '@/components/collection/graph/plane';
import { HUD_LABEL, HUD_PROSE, HUD_SURFACE, HudButton, HudOverline, HudSegmented } from '@/components/ui/chrome';

export interface DeepView {
  depth: number;
  ahead: number;
  vanish: [number, number];
}

const DEPTHS = [
  { value: '0.18', label: 'Shallow', title: 'Slices close together — more of the future at once' },
  { value: '0.32', label: 'Even', title: 'The default' },
  { value: '0.55', label: 'Deep', title: 'Slices far apart — each step a clear distance' },
];
const AHEADS = [
  { value: '1.5', label: 'Near', title: 'Only the next few slices come through' },
  { value: '3', label: 'Mid', title: 'The default' },
  { value: '6', label: 'Far', title: 'Far into the future stays faintly visible' },
];
const nearest = (v: number, options: { value: string }[]) =>
  options.reduce((best, o) => (Math.abs(Number(o.value) - v) < Math.abs(Number(best.value) - v) ? o : best)).value;


export function DeepControls({
  value, onChange, onReset,
}: {
  value: DeepView;
  onChange: (v: DeepView) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pad = useRef<HTMLDivElement>(null);
  const setVanish = (clientX: number, clientY: number) => {
    const r = pad.current?.getBoundingClientRect();
    if (!r) return;
    const clamp = (v: number) => Math.max(-REACH, Math.min(REACH, v));
    const x = clamp((clientX - r.left) / r.width - 0.5);
    const y = clamp((clientY - r.top) / r.height - 0.5);
    onChange({ ...value, vanish: [Math.round(x * 100) / 100, Math.round(y * 100) / 100] });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HudButton icon={Telescope} active={open} title="Viewpoint — where the depth converges, how deep, how far ahead" />
      </PopoverTrigger>
      <PopoverContent side="left" align="end" sideOffset={8} className={cn(HUD_SURFACE, 'w-[236px] space-y-2.5 rounded-lg p-2.5')}>
        <HudOverline>Viewpoint</HudOverline>
        <div>
          <span className={cn(HUD_LABEL, 'text-hud-dim')}>Vanishing point</span>
          <div
            ref={pad}
            className="relative mt-1 h-[84px] w-full cursor-crosshair touch-none rounded bg-hud-sunken"
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setVanish(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) setVanish(e.clientX, e.clientY);
            }}
          >
            {/* The present, centred — and the lines the depth runs along. */}
            <span aria-hidden className="absolute left-1/2 top-1/2 h-6 w-9 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-hud-line-strong" />
            <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none"
                 className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => (
                <line key={`${sx}${sy}`}
                      x1={50 + sx * 8.5} y1={50 + sy * 14.3}
                      x2={(0.5 + value.vanish[0]) * 100} y2={(0.5 + value.vanish[1]) * 100}
                      vectorEffect="non-scaling-stroke"
                      className="stroke-hud-line-strong" strokeWidth={1} />
              ))}
            </svg>
            <span aria-hidden className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hud-fg"
                  style={{ left: `${(0.5 + value.vanish[0]) * 100}%`, top: `${(0.5 + value.vanish[1]) * 100}%` }} />
          </div>
          <p className={cn(HUD_PROSE, 'mt-1 text-hud-dimmer')}>Drag where the future recedes to — or ⌘-drag on the deck.</p>
        </div>
        <div className="space-y-1">
          <span className={cn(HUD_LABEL, 'text-hud-dim')}>Depth</span>
          <HudSegmented size="sm" className="w-full" value={nearest(value.depth, DEPTHS)}
                        onChange={(v) => onChange({ ...value, depth: Number(v) })} options={DEPTHS} />
        </div>
        <div className="space-y-1">
          <span className={cn(HUD_LABEL, 'text-hud-dim')}>Ahead</span>
          <HudSegmented size="sm" className="w-full" value={nearest(value.ahead, AHEADS)}
                        onChange={(v) => onChange({ ...value, ahead: Number(v) })} options={AHEADS} />
        </div>
        <div className="flex justify-end">
          <HudButton size="sm" onClick={onReset}>Reset</HudButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}
