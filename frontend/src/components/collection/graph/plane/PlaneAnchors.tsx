'use client';

/**
 * PlaneAnchors — the reader's anchors, on whatever surface shows the network.
 *
 * Each anchor is a ring you can drag and a few words you can edit (what it
 * gathers — `anchoring.ts`), with how much it gathered, a gain for how hard it
 * pulls, and a way to remove it. Clicking the count opens what it gathered,
 * like any other selection. On the flat timeline an anchor is a lane — a
 * hairline across the view at its height — and drags only up and down.
 *
 * Works on any `Surface` — the plane, the map under it, the deep-time deck —
 * by projecting space to screen and back, and moving its markers by transform
 * whenever the surface moves.
 */
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HUD_GLASS, HUD_NUM, HudGain } from '@/components/ui/chrome';
import type { Anchor } from './anchoring';

/** Space ↔ screen on whatever draws the network, and when it moves. */
export interface Surface {
  project(p: [number, number]): [number, number];
  unproject(s: [number, number]): [number, number];
  subscribe(fn: () => void): () => void;
}

export function PlaneAnchors({
  surface, anchors, counts, selected, onMove, onText, onGain, onRemove, onPick,
}: {
  surface: Surface;
  anchors: readonly Anchor[];
  /** What each gathered: named + related. */
  counts: ReadonlyMap<string, number>;
  selected: string | null;
  /** `done` once the drag ends — what is worth saving. */
  onMove: (id: string, x: number, y: number, done: boolean) => void;
  onText: (id: string, q: string) => void;
  onGain: (id: string, gain: number) => void;
  onRemove: (id: string) => void;
  onPick: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLDivElement>());
  const latest = useRef(anchors);
  latest.current = anchors;

  const place = () => {
    for (const a of latest.current) {
      const el = markers.current.get(a.id);
      if (!el) continue;
      const [sx, sy] = surface.project([a.x, a.y]);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = a.space === 'time'
        ? `translate(0px, ${Math.round(sy)}px)`
        : `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
    }
  };
  useEffect(() => surface.subscribe(place)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  , [surface]);
  useEffect(place);   // eslint-disable-line react-hooks/exhaustive-deps

  const drag = (a: Anchor) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = box.current!.getBoundingClientRect();
    const to = (ev: PointerEvent | React.PointerEvent) => {
      const [x, y] = surface.unproject([ev.clientX - r.left, ev.clientY - r.top]);
      return a.space === 'time' ? [a.x, y] as const : [x, y] as const;
    };
    let last = [a.x, a.y] as readonly [number, number];
    const move = (ev: PointerEvent) => { last = to(ev); onMove(a.id, last[0], last[1], false); };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onMove(a.id, last[0], last[1], true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden">
      {anchors.map((a) => (
        <div key={a.id}
             ref={(el) => { if (el) markers.current.set(a.id, el); else markers.current.delete(a.id); }}
             className={cn('absolute left-0 top-0', a.space === 'time' && 'right-0')}>
          {a.space === 'time' && (
            <span aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-hud-line-strong" />
          )}
          <div className={cn('pointer-events-auto absolute flex -translate-y-1/2 items-center gap-1',
                             a.space === 'time' ? 'left-2' : '-translate-x-[6px]')}>
            <span
              role="button"
              aria-label="Move the anchor"
              title={a.space === 'time' ? 'Drag up or down' : 'Drag to move'}
              onPointerDown={drag(a)}
              className={cn('size-3 shrink-0 cursor-grab touch-none rounded-full border-2 bg-background active:cursor-grabbing',
                            selected === a.id ? 'border-hud-fg' : 'border-hud-dim')}
            />
            <AnchorLabel anchor={a} count={counts.get(a.id) ?? 0} selected={selected === a.id}
                         onText={onText} onGain={onGain} onRemove={onRemove} onPick={onPick} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AnchorLabel({
  anchor, count, selected, onText, onGain, onRemove, onPick,
}: {
  anchor: Anchor;
  count: number;
  selected: boolean;
  onText: (id: string, q: string) => void;
  onGain: (id: string, gain: number) => void;
  onRemove: (id: string) => void;
  onPick: (id: string) => void;
}) {
  const [draft, setDraft] = useState(anchor.q);
  useEffect(() => { setDraft(anchor.q); }, [anchor.q]);
  const commit = () => { if (draft.trim() !== anchor.q) onText(anchor.id, draft.trim()); };
  return (
    <div className={cn(HUD_GLASS, 'group/anchor flex items-center gap-1 py-0.5 pl-1.5 pr-0.5',
                       selected && 'ring-1 ring-hud-line-strong')}>
      <input
        value={draft}
        autoFocus={!anchor.q}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(anchor.q); (e.target as HTMLInputElement).blur(); }
        }}
        placeholder="gather… e.g. sanctions type:Person"
        spellCheck={false}
        size={Math.max(6, Math.min(28, (draft || 'gather… e.g. sanctions').length + 1))}
        className="bg-transparent text-[11px] font-medium text-hud-fg outline-none placeholder:font-normal placeholder:text-hud-dimmer"
      />
      {anchor.q && (
        <button type="button" onClick={() => onPick(anchor.id)}
                title="What it gathered — the documents behind it"
                className={cn(HUD_NUM, 'rounded px-0.5 text-hud-dim hover:bg-hud-sunken hover:text-hud-fg')}>
          {count.toLocaleString()}
        </button>
      )}
      <HudGain value={anchor.gain ?? 0} onChange={(v) => onGain(anchor.id, v)}
               title="How hard it pulls — right gathers more, firmer"
               className={cn('w-8', !anchor.gain && 'opacity-0 group-hover/anchor:opacity-100 focus-visible:opacity-100')} />
      <button type="button" onClick={() => onRemove(anchor.id)} title="Remove the anchor"
              className="flex size-4 items-center justify-center rounded text-hud-dimmer hover:text-hud-fg">
        <X className="size-3" />
      </button>
    </div>
  );
}
