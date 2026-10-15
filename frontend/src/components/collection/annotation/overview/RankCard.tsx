'use client';

/**
 * A ranked list on glass — the overview's Entities and Places cards.
 *
 * One shape for both because they are one thing: names, ranked by how many
 * assets (or rows) speak of them, with the share drawn as a hairline bar so a
 * column of them reads at a glance. Sized to its content up to a ceiling, then
 * it scrolls inside itself; the map is never pushed around by a long list.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { HUD_LABEL, HUD_NUM, HUD_SURFACE, HudReadout } from '@/components/ui/chrome';

export interface RankItem {
  id: string;
  name: string;
  count: number;
  /** A quiet second line on hover — a type, the spellings that folded in. */
  hint?: string;
  /** Marked as resolved through the run's canon. */
  canon?: boolean;
  /** Dimmed: present, but not drawable (a place nobody located). */
  muted?: boolean;
}

export function RankCard({
  title, total, unit, items, highlighted, onHover, onPick, footer, collapsed,
  onToggle, className,
}: {
  title: string;
  total: number | null;
  unit: string;
  items: RankItem[];
  highlighted?: string | null;
  onHover?: (id: string | null) => void;
  onPick?: (id: string) => void;
  footer?: React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0) || 1;
  return (
    <section className={cn(HUD_SURFACE, 'flex min-h-0 flex-col rounded-lg', className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-baseline justify-between gap-3 px-3 pb-1.5 pt-2.5 text-left"
      >
        <span className={cn(HUD_LABEL, 'text-hud-dim')}>{title}</span>
        <HudReadout>
          {total == null ? '—' : total.toLocaleString()} {unit}
        </HudReadout>
      </button>
      {!collapsed && (
        <>
          <ol className="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5 [scrollbar-width:thin]">
            {items.map((item) => {
              const active = highlighted === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    title={item.hint}
                    onMouseEnter={() => onHover?.(item.id)}
                    onMouseLeave={() => onHover?.(null)}
                    onFocus={() => onHover?.(item.id)}
                    onBlur={() => onHover?.(null)}
                    onClick={() => onPick?.(item.id)}
                    disabled={!onPick}
                    className={cn(
                      'group relative flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left',
                      'transition-colors disabled:cursor-default',
                      active ? 'bg-hud-sunken' : 'hover:bg-hud-sunken',
                    )}
                  >
                    {/* The share, as a hairline under the name — readable down
                        a column without a single number being read. */}
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-1.5 h-px bg-hud-line-strong transition-[width] duration-300"
                      style={{ width: `calc((100% - 0.75rem) * ${item.count / max})` }}
                    />
                    <span className={cn(
                      'min-w-0 flex-1 truncate text-[11.5px] leading-5',
                      item.muted ? 'text-hud-dimmer' : active ? 'text-hud-fg' : 'text-hud-fg/85',
                    )}>
                      {item.name}
                    </span>
                    {item.canon && (
                      <span aria-label="resolved through the canon"
                            className="size-1 shrink-0 rounded-full bg-hud-dim" />
                    )}
                    <span className={cn(HUD_NUM, 'shrink-0 text-hud-dim')}>
                      {item.count.toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
            {items.length === 0 && (
              <li className="px-1.5 py-2 text-[11px] text-hud-dimmer">Nothing yet.</li>
            )}
          </ol>
          {footer && <div className="border-t border-hud-line px-3 py-2">{footer}</div>}
        </>
      )}
    </section>
  );
}
