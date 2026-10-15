'use client';

/**
 * The assets behind what you clicked — a place on the map, a name in a list,
 * a node in the network.
 *
 * Wears the home surface's list (`home/HomePanel`): the green asset spine,
 * plain title rows, a quiet time column. Sits on its canvas as a panel, not a
 * rail. Each row says how strongly the asset speaks of the thing on hover —
 * the rows placing it there, the times it names them, the annotations behind
 * a node — and can scope the graph to what that asset produced.
 */
import React, { useEffect, useRef } from 'react';
import { Loader2, Waypoints, X, type LucideIcon } from 'lucide-react';
import type { OverviewAsset } from '@/client';
import { cn } from '@/lib/utils';
import { HUD_GLASS, HUD_LABEL, HUD_NUM, HUD_PROSE, HudButton } from '@/components/ui/chrome';
import { relTime, TONES } from '@/components/collection/home/HomePanel';
import { commandRegistry } from '@/lib/commandRegistry';

/** What the list is the assets *of*. */
export interface DrillSubject {
  icon: LucideIcon;
  name: string;
  /** Under the name: "assets placed here", "assets naming them". */
  caption: string;
  /** What a row's count counts, for its hover title: "mentions". */
  unit: string;
}

const FOUR_WEEKS = 28 * 86_400_000;

/** "2h", "5d" while recent; a date once relative time stops reading as one. */
function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  if (Date.now() - t < FOUR_WEEKS) return relTime(iso);
  const d = new Date(t);
  return d.getFullYear() === new Date().getFullYear()
    ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function AssetListCard({
  subject, context, items, total, loading, stale, error, hasMore, onMore, openId, onOpen, onClose,
  actions, className,
}: {
  subject: DrillSubject;
  /** What else narrows the list — "within Donald Trump", a brushed period. */
  context: string[];
  items: OverviewAsset[];
  total: number | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  hasMore: boolean;
  onMore: () => void;
  openId: number | null;
  onOpen: (id: number) => void;
  onClose: () => void;
  /** Header controls before the close button — expand a group, and so on. */
  actions?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, name, caption, unit } = subject;

  // Page on reaching the end — the sentinel is the last thing in the list.
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && onMore(), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onMore, items.length]);

  return (
    <section
      aria-label={`Assets for ${name}`}
      className={cn(HUD_GLASS, 'relative flex min-h-0 flex-col overflow-hidden', className)}
    >
      <span aria-hidden className={cn('pointer-events-none absolute inset-y-2 left-0 w-[2px] rounded-full', TONES.green.accent)} />

      <header className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
        <span className={cn('flex size-6 shrink-0 items-center justify-center rounded', TONES.green.tile)}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[13px] font-medium tracking-tight text-foreground">{name}</h3>
            <span className="shrink-0 rounded bg-muted px-1 text-[10.5px] font-medium tabular-nums text-muted-foreground">
              {total == null ? '…' : total.toLocaleString()}
            </span>
            {loading && <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />}
          </div>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {[caption, ...context].join(' · ')}
          </p>
        </div>
        {actions}
        <HudButton size="sm" icon={X} onClick={onClose} title="Close" aria-label="Close the list"
                   className="-mr-1.5 border-transparent" />
      </header>

      <ol className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-1.5 transition-opacity [scrollbar-width:thin]',
        stale && 'opacity-50',
      )}>
        {items.map((a) => {
          const open = a.id === openId;
          return (
            <li key={a.id}
                className={cn('group -mx-1 flex items-center rounded transition-colors',
                              open ? 'bg-muted/70' : 'hover:bg-muted/50')}>
              <button type="button" onClick={() => onOpen(a.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-[3px] pl-1 text-left">
                <span className={cn('min-w-0 flex-1 truncate text-[12.5px]',
                                    open ? 'text-foreground' : 'text-foreground/90')}>
                  {a.title || `Asset ${a.id}`}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground group-hover:hidden">
                  {when(a.t ?? a.created_at)}
                </span>
                <span className="hidden shrink-0 text-xs tabular-nums text-foreground group-hover:inline"
                      title={`${a.n.toLocaleString()} ${unit}`}>
                  {a.n.toLocaleString()}
                </span>
              </button>
              <button
                type="button"
                title="Show the sub-graph this document produced"
                aria-label="Show in graph"
                onClick={() => commandRegistry.dispatch('graph:query', { q: `doc.asset_id==${a.id}` })}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Waypoints className="size-3.5" />
              </button>
            </li>
          );
        })}
        {hasMore && <li ref={sentinel} aria-hidden className="h-6" />}
        {!loading && !error && items.length === 0 && total === 0 && (
          <li className="py-2 text-xs text-muted-foreground">
            No assets in this reading — widen the time window or the sections counted.
          </li>
        )}
        {error && <li className={cn(HUD_PROSE, 'py-2 text-rose-600 dark:text-rose-400')}>{error}</li>}
        {total != null && !hasMore && items.length > 12 && (
          <li className={cn(HUD_NUM, HUD_LABEL, 'pt-2 text-center text-hud-dimmer')}>
            {total.toLocaleString()} assets
          </li>
        )}
      </ol>
    </section>
  );
}
