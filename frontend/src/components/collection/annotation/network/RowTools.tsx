'use client';

/**
 * The tools beside a row — an entity, a group, a type, a stream, a set:
 *
 *   +       into the set being built (or a new one)
 *   links   keep it lit, with everything it links to directly (`plane/light`);
 *           as many rows as you like
 *   gain    turn it up or down (`plane/gain`)
 *
 * Out of the way until the row is hovered or picked; what is switched on —
 * a light, a gain off zero — stays in sight.
 */
import React from 'react';
import { Plus, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudGain } from '@/components/ui/chrome';

const REVEAL = 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100';

export function RowTools({
  active, gain, onGain, lit, onLight, onAdd, addTitle,
}: {
  /** The row is picked — its tools show. */
  active?: boolean;
  gain?: number;
  onGain?: (v: number) => void;
  lit?: boolean;
  onLight?: () => void;
  onAdd?: () => void;
  addTitle?: string;
}) {
  const shown = (on: boolean) => (on || active ? 'opacity-100' : REVEAL);
  return (
    <span className="flex shrink-0 items-center gap-px" onClick={(e) => e.stopPropagation()}>
      {onAdd && (
        <ToolButton title={addTitle ?? 'Into the set being built — or a new set'} onClick={onAdd} className={shown(false)}>
          <Plus className="size-3" />
        </ToolButton>
      )}
      {onLight && (
        <ToolButton title={lit ? 'Let its links go dark' : 'Light it with its direct links — as many as you like'}
                    onClick={onLight} on={lit} className={shown(!!lit)}>
          <Waypoints className="size-3" />
        </ToolButton>
      )}
      {onGain && (
        <HudGain value={gain ?? 0} onChange={onGain}
                 className={cn('transition-[width,opacity] duration-150',
                               gain || active ? 'w-10 opacity-100'
                                 : 'w-0 opacity-0 group-hover/row:w-10 group-hover/row:opacity-100 focus-visible:w-10 focus-visible:opacity-100')} />
      )}
    </span>
  );
}

export function ToolButton({
  title, onClick, on, className, children,
}: { title: string; onClick: () => void; on?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-pressed={on}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={cn('flex size-4 shrink-0 items-center justify-center rounded transition-opacity',
                          on ? 'bg-hud-fg text-background' : 'text-hud-dimmer hover:bg-hud-sunken hover:text-hud-fg',
                          className)}>
      {children}
    </button>
  );
}
