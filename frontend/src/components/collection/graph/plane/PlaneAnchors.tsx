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
 * A room is a box (`rooms.ts`): dashed while it reads what is inside it,
 * solid while it holds what it gathers, with what it is about over it and
 * the loudest inside under that. The ring moves it, its corner sizes it, the
 * pin turns reading into holding and back. With another set picked, any mark
 * can light the paths between the two.
 *
 * Never out of reach: an anchor whose point is off screen, or under the
 * panel's own cards, is held at the edge of the open canvas, dimmed, until
 * the camera brings it back.
 *
 * Works on any `Surface` — the plane, the map under it, the deep-time deck —
 * by projecting space to screen and back, and moving its markers by transform
 * whenever the surface moves.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pin, PinOff, Route, Waypoints, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HUD_GLASS, HUD_NUM, HUD_PROSE, HudGain } from '@/components/ui/chrome';
import type { AnchorSpace } from './anchoring';
import { roomBetween, type Room } from './rooms';

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
  /** A room: its width and height in space, around x y. */
  room?: [number, number];
  /** A room reading what is inside it — else it holds. */
  reads?: boolean;
  /** What a room is about, once read, and the loudest inside it. */
  about?: string;
  inside?: readonly string[];
  /** The paths to the picked set are lit, or not; unset while no other set
   *  is picked. */
  between?: boolean;
}

/** The canvas the panel's cards leave open, in px from each edge. */
export interface Inset { left: number; right: number; top: number; bottom: number }

const EDGE = 10;
/** A label's height, px — a room's stands over its box. */
const LABEL_H = 24;

export function PlaneAnchors({
  surface, anchors, selected, inset, onMove, onSize, onPick, onGain, onLight, onPin, onBetween, onRemove,
}: {
  surface: Surface;
  anchors: readonly AnchorMark[];
  selected: string | null;
  inset: Inset;
  /** `done` once the drag ends — what is worth saving. */
  onMove: (id: string, x: number, y: number, done: boolean) => void;
  /** A room sized from its corner. */
  onSize: (id: string, room: Room, done: boolean) => void;
  onPick: (id: string) => void;
  onGain: (id: string, gain: number) => void;
  onLight: (id: string) => void;
  /** A room: hold what it reads, or read again. */
  onPin: (id: string) => void;
  /** The paths between this set and the picked one. */
  onBetween: (id: string) => void;
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
      if (a.room) {
        // The box where its corners fall; its label over it, kept in reach.
        const [w, h] = a.room;
        const [ax, ay] = surface.project([a.x - w / 2, a.y - h / 2]);
        const [bx, by] = surface.project([a.x + w / 2, a.y + h / 2]);
        if (![ax, ay, bx, by].every(Number.isFinite)) { el.style.display = 'none'; continue; }
        el.style.display = '';
        const left = Math.min(ax, bx), top = Math.min(ay, by);
        const boxEl = el.querySelector<HTMLElement>('[data-box]');
        if (boxEl) {
          boxEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
          boxEl.style.width = `${Math.round(Math.abs(bx - ax))}px`;
          boxEl.style.height = `${Math.round(Math.abs(by - ay))}px`;
        }
        // The label stands over the box: room for it above the canvas's top.
        const cx = Math.max(lo[0], Math.min(hi[0], left)), cy = Math.max(lo[1] + LABEL_H, Math.min(hi[1], top));
        const labelEl = el.querySelector<HTMLElement>('[data-label]');
        if (labelEl) {
          labelEl.dataset.out = cx !== left || cy !== top ? '1' : '0';
          labelEl.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
        }
        continue;
      }
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
    // A room is held where it was grabbed, not by its centre.
    const start = to(e.nativeEvent);
    const off = a.room && Number.isFinite(start[0]) ? [a.x - start[0], a.y - start[1]] : [0, 0];
    const move = (ev: PointerEvent) => {
      const p = to(ev);
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
      last = [p[0] + off[0], p[1] + off[1]];
      onMove(a.id, last[0], last[1], false);
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

  /** A room's corner, dragged: the opposite corner stays where it is. */
  const size = (a: AnchorMark) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !a.room) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = box.current!.getBoundingClientRect();
    const to = (ev: PointerEvent) => surface.unproject([ev.clientX - r.left, ev.clientY - r.top]);
    const grabbed = to(e.nativeEvent);
    const fixed: [number, number] = [2 * a.x - grabbed[0], 2 * a.y - grabbed[1]];
    let last: Room = [a.x, a.y, a.room[0], a.room[1]];
    const move = (ev: PointerEvent) => {
      const p = to(ev);
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
      last = roomBetween(fixed, p);
      onSize(a.id, last, false);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onSize(a.id, last, true);
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
          <div className={cn('pointer-events-auto flex items-center gap-1', !a.room && '-translate-x-[6px] -translate-y-1/2')}>
            <span
              role="button"
              aria-label={a.room ? 'Move the room' : 'Move the anchor'}
              title={lane ? 'Drag — up and down moves the lane' : 'Drag to move'}
              onPointerDown={drag(a)}
              className={cn('size-3 shrink-0 cursor-grab touch-none rounded-full border-2 bg-background active:cursor-grabbing',
                            selected === a.id && 'ring-2 ring-hud-line-strong')}
              style={{ borderColor: a.hue }}
            />
            <div className={cn(HUD_GLASS, 'group/anchor flex items-center gap-1 py-0.5 pl-1.5 pr-0.5',
                               selected === a.id && 'ring-1 ring-hud-line-strong')}>
              <button type="button" onClick={() => onPick(a.id)}
                      title={a.room ? 'Pick the room — what it is about, and its documents' : 'Pick the set — the builder edits it, its documents open'}
                      className="max-w-[180px] truncate text-left text-[11px] font-medium text-hud-fg hover:underline">
                {a.about ?? a.label}
              </button>
              <span className={cn(HUD_NUM, 'text-hud-dim')}>{a.count.toLocaleString()}</span>
              {a.room && (
                <button type="button" onClick={() => onPin(a.id)}
                        title={a.reads
                          ? 'Hold what is here — the room then gathers what is like it, wherever it is drawn'
                          : 'Read what is inside instead of holding'}
                        className={cn('flex size-4 items-center justify-center rounded',
                                      a.reads ? 'text-hud-dimmer hover:text-hud-fg' : 'bg-hud-fg text-background')}>
                  {a.reads ? <Pin className="size-3" /> : <PinOff className="size-3" />}
                </button>
              )}
              {a.between !== undefined && (
                <button type="button" onClick={() => onBetween(a.id)} aria-pressed={a.between}
                        title={a.between ? 'Let the paths to the picked set go dark' : 'Light the paths between this and the picked set'}
                        className={cn('flex size-4 items-center justify-center rounded',
                                      a.between ? 'bg-hud-fg text-background' : 'text-hud-dimmer hover:text-hud-fg')}>
                  <Route className="size-3" />
                </button>
              )}
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
        if (a.room) {
          return (
            <div key={a.id}
                 ref={(el) => { if (el) markers.current.set(a.id, el); else markers.current.delete(a.id); }}
                 className="group/room absolute left-0 top-0">
              <div data-box className={cn('absolute left-0 top-0 rounded-md border-[1.5px]', a.reads && 'border-dashed')}
                   style={{ borderColor: a.hue, background: `${a.hue}${a.reads ? '0a' : '14'}` }}>
                {a.inside && a.inside.length > 0 && (
                  <p className="pointer-events-none max-w-full truncate px-1.5 pt-1 text-[10px] text-hud-dim">
                    {a.inside.join(' · ')}
                  </p>
                )}
                <span role="button" aria-label="Size the room" title="Drag to size the room"
                      onPointerDown={size(a)}
                      className="pointer-events-auto absolute -bottom-1 -right-1 size-2.5 cursor-nwse-resize touch-none rounded-sm border-[1.5px] bg-background"
                      style={{ borderColor: a.hue }} />
              </div>
              <div data-label className="absolute left-0 top-0 transition-opacity data-[out=1]:opacity-60">
                <div className="-translate-y-[calc(100%+3px)]">{label}</div>
              </div>
            </div>
          );
        }
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

/** A drag shorter than this, px, is a click. */
const CLICK = 6;
/** A room a click makes, px around the pointer. */
const CLICKED_ROOM: [number, number] = [260, 180];

/**
 * Drawing a room: drag over what to read — or click, for a room of a usual
 * size around the pointer. The room lands in the surface's space, so it
 * stays over what it was drawn on as the camera moves.
 */
export function DrawRoom({ surface, hint, onDraw }: {
  surface: Surface;
  hint: string;
  onDraw: (room: Room) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const at = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    let { a } = drag;
    let b = at(e);
    if (Math.abs(b[0] - a[0]) < CLICK && Math.abs(b[1] - a[1]) < CLICK) {
      a = [b[0] - CLICKED_ROOM[0] / 2, b[1] - CLICKED_ROOM[1] / 2];
      b = [a[0] + CLICKED_ROOM[0], a[1] + CLICKED_ROOM[1]];
    }
    setDrag(null);
    const p = surface.unproject(a), q = surface.unproject(b);
    if ([...p, ...q].every(Number.isFinite)) onDraw(roomBetween(p, q));
  };
  return (
    <div ref={box} className="absolute inset-0 z-[5] cursor-crosshair touch-none"
         onPointerDown={(e) => {
           if (e.button !== 0) return;
           e.currentTarget.setPointerCapture(e.pointerId);
           const p = at(e);
           setDrag({ a: p, b: p });
         }}
         onPointerMove={(e) => { if (drag) setDrag({ ...drag, b: at(e) }); }}
         onPointerUp={end}
         onPointerCancel={() => setDrag(null)}>
      {drag && (
        <div className="pointer-events-none absolute rounded-md border-[1.5px] border-dashed border-hud-fg/70 bg-hud-fg/5"
             style={{
               left: Math.min(drag.a[0], drag.b[0]), top: Math.min(drag.a[1], drag.b[1]),
               width: Math.abs(drag.b[0] - drag.a[0]), height: Math.abs(drag.b[1] - drag.a[1]),
             }} />
      )}
      <span className={cn(HUD_GLASS, HUD_PROSE, 'pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 px-2 py-1 text-hud-dim')}>
        {hint}
      </span>
    </div>
  );
}
