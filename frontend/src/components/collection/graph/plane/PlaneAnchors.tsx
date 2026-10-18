'use client';

/**
 * PlaneAnchors — the placed sets, on whatever surface shows the network.
 *
 * Each anchor is a ring in its set's hue you can drag, and a label: the set
 * in a few words (a click picks it — the builder then edits it), how many it
 * holds, its light and gain, and a way to take it off the canvas. On the flat
 * timeline an anchor is a lane — a hairline across the view at its height —
 * with its handle where it was dropped; dragging moves the lane up and down
 * and the handle along it.
 *
 * Never out of reach: an anchor whose point is off screen, or under the
 * panel's own cards, is held at the edge of the open canvas, dimmed, until
 * the camera brings it back.
 *
 * Works on any `Surface` — the plane, the map under it, the deep-time deck —
 * by projecting space to screen and back, and moving its markers by transform
 * whenever the surface moves.
 */
import React, { useEffect, useRef } from 'react';
import { Waypoints, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HUD_GLASS, HUD_NUM, HudGain } from '@/components/ui/chrome';
import type { AnchorSpace } from './anchoring';

/** Space ↔ screen on whatever draws the network, and when it moves. */
export interface Surface {
  project(p: [number, number]): [number, number];
  unproject(s: [number, number]): [number, number];
  subscribe(fn: () => void): () => void;
}

export interface AnchorMark {
  id: string;
  label: string;
  hue: string;
  count: number;
  gain: number;
  lit: boolean;
  space: AnchorSpace;
  x: number;
  y: number;
}

/** The canvas the panel's cards leave open, in px from each edge. */
export interface Inset { left: number; right: number; top: number; bottom: number }

const EDGE = 10;

export function PlaneAnchors({
  surface, anchors, selected, inset, onMove, onPick, onGain, onLight, onRemove,
}: {
  surface: Surface;
  anchors: readonly AnchorMark[];
  selected: string | null;
  inset: Inset;
  /** `done` once the drag ends — what is worth saving. */
  onMove: (id: string, x: number, y: number, done: boolean) => void;
  onPick: (id: string) => void;
  onGain: (id: string, gain: number) => void;
  onLight: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLDivElement>());
  const latest = useRef({ anchors, inset });
  latest.current = { anchors, inset };

  const place = () => {
    const el0 = box.current;
    if (!el0) return;
    const w = el0.clientWidth, h = el0.clientHeight;
    const { anchors, inset } = latest.current;
    const lo = [inset.left + EDGE, inset.top + EDGE], hi = [w - inset.right - EDGE, h - inset.bottom - EDGE];
    for (const a of anchors) {
      const el = markers.current.get(a.id);
      if (!el) continue;
      const [sx, sy] = surface.project([a.x, a.y]);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const cx = Math.max(lo[0], Math.min(hi[0], sx));
      const cy = Math.max(lo[1], Math.min(hi[1], sy));
      const out = a.space === 'time' ? cy !== sy : cx !== sx || cy !== sy;
      el.dataset.out = out ? '1' : '0';
      if (a.space === 'time') {
        el.style.transform = `translate(0px, ${Math.round(cy)}px)`;
        const handle = el.querySelector<HTMLElement>('[data-handle]');
        if (handle) handle.style.transform = `translate(${Math.round(cx)}px, 0px)`;
      } else {
        el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
      }
    }
  };
  useEffect(() => surface.subscribe(place)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  , [surface]);
  useEffect(place);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drag = (a: AnchorMark) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = box.current!.getBoundingClientRect();
    const to = (ev: PointerEvent) => surface.unproject([ev.clientX - r.left, ev.clientY - r.top]);
    let last: [number, number] = [a.x, a.y];
    const move = (ev: PointerEvent) => {
      const p = to(ev);
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
      last = p;
      onMove(a.id, p[0], p[1], false);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onMove(a.id, last[0], last[1], true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden">
      {anchors.map((a) => {
        const lane = a.space === 'time';
        const label = (
          <div className="pointer-events-auto flex -translate-x-[6px] -translate-y-1/2 items-center gap-1">
            <span
              role="button"
              aria-label="Move the anchor"
              title={lane ? 'Drag — up and down moves the lane' : 'Drag to move'}
              onPointerDown={drag(a)}
              className={cn('size-3 shrink-0 cursor-grab touch-none rounded-full border-2 bg-background active:cursor-grabbing',
                            selected === a.id && 'ring-2 ring-hud-line-strong')}
              style={{ borderColor: a.hue }}
            />
            <div className={cn(HUD_GLASS, 'group/anchor flex items-center gap-1 py-0.5 pl-1.5 pr-0.5',
                               selected === a.id && 'ring-1 ring-hud-line-strong')}>
              <button type="button" onClick={() => onPick(a.id)}
                      title="Pick the set — the builder edits it, its documents open"
                      className="max-w-[180px] truncate text-left text-[11px] font-medium text-hud-fg hover:underline">
                {a.label}
              </button>
              <span className={cn(HUD_NUM, 'text-hud-dim')}>{a.count.toLocaleString()}</span>
              <button type="button" onClick={() => onLight(a.id)} aria-pressed={a.lit}
                      title={a.lit ? 'Let its links go dark' : 'Light it with its direct links'}
                      className={cn('flex size-4 items-center justify-center rounded',
                                    a.lit ? 'bg-hud-fg text-background'
                                      : 'text-hud-dimmer opacity-0 hover:text-hud-fg group-hover/anchor:opacity-100')}>
                <Waypoints className="size-3" />
              </button>
              <HudGain value={a.gain} onChange={(v) => onGain(a.id, v)}
                       title="How loud, and how hard it pulls — right for more"
                       className={cn('w-8', !a.gain && 'opacity-0 group-hover/anchor:opacity-100 focus-visible:opacity-100')} />
              <button type="button" onClick={() => onRemove(a.id)} title="Take the anchor off the canvas — the set stays"
                      className="flex size-4 items-center justify-center rounded text-hud-dimmer hover:text-hud-fg">
                <X className="size-3" />
              </button>
            </div>
          </div>
        );
        return (
          <div key={a.id}
               ref={(el) => { if (el) markers.current.set(a.id, el); else markers.current.delete(a.id); }}
               className={cn('absolute left-0 top-0 transition-opacity data-[out=1]:opacity-60', lane && 'right-0')}>
            {lane ? (
              <>
                <span aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed opacity-70"
                      style={{ borderColor: a.hue }} />
                <div data-handle className="absolute left-0 top-0">{label}</div>
              </>
            ) : label}
          </div>
        );
      })}
    </div>
  );
}
