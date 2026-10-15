'use client';

/**
 * A ranked list on glass — the overview's Entities and Places cards, and the
 * network panel's groups, entities and places.
 *
 * One shape for both because they are one thing: names, ranked by how many
 * assets (or rows) speak of them, with the share drawn as a hairline bar so a
 * column of them reads at a glance. Sized to its content up to a ceiling, then
 * it scrolls inside itself; the map is never pushed around by a long list.
 *
 * Rows can be *marked* as well as picked — the network marks with a shift-click
 * to gather labels for a merge. `head` sits between the title and the rows
 * (filters, the type chips); `footer` under them; `trailing` beside a row —
 * the network's gain slider.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { HUD_GLASS, HUD_LABEL, HUD_NUM, HudReadout } from '@/components/ui/chrome';

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
  /** The colour it is drawn in, when the canvas colours by it (a group). */
  swatch?: string;
}

export function RankCard({
  title, total, unit, items, highlighted, marked, onHover, onPick, head, actions, footer, trailing, collapsed,
  onToggle, className,
}: {
  title: string;
  total: number | null;
  unit: string;
  items: RankItem[];
  highlighted?: string | null;
  /** Rows gathered for something — drawn with a mark beside the name. */
  marked?: ReadonlySet<string>;
  onHover?: (id: string | null) => void;
  /** The event says how: a shift-click marks rather than picks. */
  onPick?: (id: string, event: React.MouseEvent) => void;
  head?: React.ReactNode;
  /** Beside the count in the title row. */
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** Beside a row, outside its button — a control of its own. */
  trailing?: (item: RankItem, active: boolean) => React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0) || 1;
  return (
    <section className={cn(HUD_GLASS, 'flex min-h-0 flex-col', className)}>
      <div className="flex items-baseline gap-2 px-2 pb-1 pt-1.5">
        <button type="button" onClick={onToggle} disabled={!onToggle}
                className={cn(HUD_LABEL, 'min-w-0 flex-1 truncate text-left text-hud-dim disabled:cursor-default')}>
          {title}
        </button>
        <HudReadout>
          {total == null ? '—' : total.toLocaleString()} {unit}
        </HudReadout>
        {actions}
      </div>
      {!collapsed && (
        <>
          {head}
          <ol className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-1 [scrollbar-width:thin]">
            {items.map((item) => {
              const active = highlighted === item.id;
              const isMarked = marked?.has(item.id) ?? false;
              return (
                <li key={item.id} className="group/row flex items-center gap-1">
                  <button
                    type="button"
                    title={item.hint}
                    onMouseEnter={() => onHover?.(item.id)}
                    onMouseLeave={() => onHover?.(null)}
                    onFocus={() => onHover?.(item.id)}
                    onBlur={() => onHover?.(null)}
                    onClick={(e) => onPick?.(item.id, e)}
                    disabled={!onPick}
                    className={cn(
                      'group relative flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-[2px] text-left',
                      'select-none transition-colors disabled:cursor-default',
                      active || isMarked ? 'bg-hud-sunken' : 'hover:bg-hud-sunken',
                    )}
                  >
                    {/* The share, as a hairline under the name — readable down
                        a column without a single number being read. */}
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-1 h-px bg-hud-line-strong transition-[width] duration-300"
                      style={{ width: `calc((100% - 0.5rem) * ${item.count / max})` }}
                    />
                    {isMarked && (
                      <span aria-label="marked" className="h-3 w-[2px] shrink-0 rounded-full bg-hud-fg" />
                    )}
                    {item.swatch && (
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: item.swatch }} />
                    )}
                    <span className={cn(
                      'min-w-0 flex-1 truncate text-[11.5px] leading-5',
                      item.muted ? 'text-hud-dimmer' : active || isMarked ? 'text-hud-fg' : 'text-hud-fg/85',
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
                  {trailing?.(item, active || isMarked)}
                </li>
              );
            })}
            {items.length === 0 && (
              <li className="px-1 py-1.5 text-[11px] text-hud-dimmer">Nothing yet.</li>
            )}
          </ol>
          {footer && <div className="border-t border-hud-line px-2 py-1.5">{footer}</div>}
        </>
      )}
    </section>
  );
}
