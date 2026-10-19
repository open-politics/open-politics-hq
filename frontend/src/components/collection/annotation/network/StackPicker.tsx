'use client';

/**
 * StackPicker — which one you meant, when a click lands on a pile.
 *
 * Where the graph is dense — a city on the map, a hub deep in time, a group's
 * core — nodes are drawn over one another, and a click would pick whichever
 * happens to be on top. A click there opens this instead, at the pointer:
 * what is under it, a row each, the loudest first. Hovering a row lights its
 * node; a click (or ↵) picks it, ⇧ marks it, Esc or a click elsewhere lets go.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { HUD_GLASS, HUD_LABEL, HUD_NUM, HudOption } from '@/components/ui/chrome';
import type { Network } from '@/components/collection/graph/plane';

const W = 236;

export function StackPicker({
  net, nodes, at, colorOf, onPick, onHover, onClose,
}: {
  net: Network;
  nodes: readonly number[];
  /** Where the click was, px within the panel. */
  at: [number, number];
  colorOf: (i: number) => string;
  onPick: (i: number, how: { shift: boolean }) => void;
  onHover: (i: number | null) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [place, setPlace] = useState<[number, number]>(at);
  // The panel hands fresh callbacks each render: listen once, call the latest.
  const fns = useRef({ onPick, onHover, onClose });
  fns.current = { onPick, onHover, onClose };
  const cur = useRef(0);
  cur.current = cursor;

  // Beside the pointer, kept inside the panel.
  useLayoutEffect(() => {
    const el = box.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const x = Math.min(at[0] + 10, parent.clientWidth - W - 8);
    const y = Math.min(at[1] - 8, parent.clientHeight - el.offsetHeight - 8);
    setPlace([Math.max(8, x), Math.max(8, y)]);
  }, [at, nodes]);

  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) fns.current.onClose(); };
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); fns.current.onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(nodes.length - 1, c + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); fns.current.onPick(nodes[cur.current], { shift: e.shiftKey }); }
    };
    // The click that opened it is still on its way: listen from the next one.
    const t = setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    window.addEventListener('keydown', keys);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', keys);
    };
  }, [nodes]);
  useEffect(() => { setCursor(0); }, [nodes]);
  useEffect(() => { fns.current.onHover(nodes[cursor] ?? null); }, [cursor, nodes]);
  useEffect(() => () => fns.current.onHover(null), []);

  return (
    <div ref={box} role="listbox" aria-label="Nodes here"
         className={cn(HUD_GLASS, 'absolute z-30 py-1')}
         style={{ left: place[0], top: place[1], width: W }}
         onPointerLeave={() => fns.current.onHover(null)}>
      <div className="flex items-baseline justify-between px-3 pb-0.5 pt-0.5">
        <span className={cn(HUD_LABEL, 'text-hud-dim')}>Here</span>
        <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{nodes.length}</span>
      </div>
      <div className="max-h-[264px] overflow-y-auto [scrollbar-width:thin]">
        {nodes.map((i, k) => (
          <div key={i} onPointerEnter={() => setCursor(k)}>
            <HudOption
              active={k === cursor}
              label={(
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colorOf(i) }} />
                  <span className="truncate">{net.name[i]}</span>
                </span>
              )}
              hint={net.types[net.type[i]] || net.kinds[net.kind[i]]}
              trailing={<span className={cn(HUD_NUM, 'text-hud-dimmer')}>{net.frequency[i].toLocaleString()}</span>}
              onClick={(e) => onPick(i, { shift: e.shiftKey })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
