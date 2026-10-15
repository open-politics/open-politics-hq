'use client';

/**
 * The time strip — when the run's rows are, and a window onto them.
 *
 * Bars over the robust extent the server chose (2nd–98th percentile), so one
 * model-written "1900" cannot squash two years into a pixel; what falls
 * outside is counted, not dropped. Drag to set a window — the map recounts
 * client-side, nothing is fetched. A click without a drag clears it.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { HUD_LABEL, HUD_NUM, HUD_SURFACE } from '@/components/ui/chrome';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import type { TimeBin, TimeWindow } from '@/lib/overview/derive';

const FORMAT: Record<string, string> = {
  day: 'd MMM', week: 'd MMM', month: 'MMM yy', quarter: 'QQQ yy', year: 'yyyy',
};
const H = 40;

export function TimeStrip({
  bins, grain, undated, outside, window: win, onWindow, unit, className,
}: {
  bins: TimeBin[];
  grain: string;
  undated: number;
  outside: number;
  window: TimeWindow;
  onWindow: (w: TimeWindow) => void;
  unit: string;
  className?: string;
}) {
  const { ref: measure, width } = useContainerWidth<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);

  const geom = useMemo(() => {
    if (bins.length === 0 || !width) return null;
    const t0 = bins[0].t;
    const t1 = bins[bins.length - 1].t;
    // One cell's span: the smallest gap between neighbouring bins.
    let step = Infinity;
    for (let i = 1; i < bins.length; i++) step = Math.min(step, bins[i].t - bins[i - 1].t);
    if (!Number.isFinite(step) || step <= 0) step = 86_400_000;
    const span = t1 - t0 + step;
    const x = (t: number) => ((t - t0) / span) * width;
    const t = (px: number) => t0 + (Math.max(0, Math.min(width, px)) / width) * span;
    const max = bins.reduce((m, b) => Math.max(m, b.n), 0) || 1;
    return { x, t, step, max, t0, t1, bar: Math.max(1, (step / span) * width - 1) };
  }, [bins, width]);

  const fmt = (t: number) => format(new Date(t), FORMAT[grain] ?? 'MMM yy');
  const total = bins.reduce((s, b) => s + b.n, 0);

  const toT = useCallback((clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    return r && geom ? geom.t(clientX - r.left) : 0;
  }, [geom]);

  const shown: TimeWindow = drag
    ? [Math.min(drag[0], drag[1]), Math.max(drag[0], drag[1])]
    : win;

  return (
    <section className={cn(HUD_SURFACE, 'rounded-lg px-3 pb-2 pt-2', className)}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className={cn(HUD_LABEL, 'text-hud-dim')}>
          {shown ? `${fmt(shown[0])} – ${fmt(shown[1])}` : 'When'}
        </span>
        <span className={cn(HUD_NUM, 'text-hud-dimmer')}>
          {total.toLocaleString()} {unit} · by {grain}
          {undated > 0 && ` · ${undated.toLocaleString()} undated`}
          {outside > 0 && ` · ${outside.toLocaleString()} outside`}
        </span>
      </div>
      <div ref={measure} className="relative">
        {geom ? (
          <svg
            ref={svg}
            width={width ?? 0}
            height={H}
            className="block cursor-crosshair touch-none select-none"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              const t = toT(e.clientX);
              setDrag([t, t]);
            }}
            onPointerMove={(e) => drag && setDrag([drag[0], toT(e.clientX)])}
            onPointerUp={() => {
              if (!drag || !geom) return;
              const [a, b] = drag;
              setDrag(null);
              // Less than half a cell is a click, and a click clears.
              if (Math.abs(b - a) < geom.step / 2) onWindow(null);
              else onWindow([Math.min(a, b), Math.max(a, b) + geom.step - 1]);
            }}
          >
            {bins.map((b) => {
              const h = Math.max(1, (b.n / geom.max) * (H - 2));
              const inside = !shown || (b.t >= shown[0] - geom.step + 1 && b.t <= shown[1]);
              return (
                <rect
                  key={b.t}
                  x={geom.x(b.t)}
                  y={H - h}
                  width={geom.bar}
                  height={h}
                  rx={0.5}
                  className={inside ? 'fill-hud-fg/70' : 'fill-hud-line-strong'}
                >
                  <title>{`${fmt(b.t)} · ${b.n.toLocaleString()} ${unit}`}</title>
                </rect>
              );
            })}
            <line x1={0} x2={width ?? 0} y1={H - 0.5} y2={H - 0.5} className="stroke-hud-line" />
          </svg>
        ) : (
          <div className="flex items-center text-[11px] text-hud-dimmer" style={{ height: H }}>
            {width == null ? '' : 'No dated rows.'}
          </div>
        )}
        {geom && (
          <div className={cn(HUD_NUM, 'mt-1 flex justify-between text-hud-dimmer')}>
            <span>{fmt(geom.t0)}</span>
            <span>{fmt(geom.t1)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
