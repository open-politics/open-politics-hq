'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared visual vocabulary for the HQ home surface.
 *
 * Every home module is a `HomePanel` — one chrome, consistent accents — so the
 * page reads as a composed whole rather than a pile of bespoke cards. The look
 * mirrors the AssetManager/AssetSelector: minimal — low radius, no blur, no
 * drop shadow, tight rows. Tone maps a semantic colour onto the icon tile /
 * accent spine / hover border (green=assets, sky=schemas, blue=analysis,
 * teal=graphs, orange=packages). `emphasis` lifts the foundation tier.
 */

export type Tone = 'green' | 'sky' | 'blue' | 'teal' | 'orange';

export const TONES: Record<Tone, { tile: string; accent: string; ring: string }> = {
  green:  { tile: 'bg-green-500/10 text-green-600 dark:text-green-400',   accent: 'bg-green-500/60',  ring: 'hover:border-green-400/40' },
  sky:    { tile: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',         accent: 'bg-sky-500/60',    ring: 'hover:border-sky-400/40' },
  blue:   { tile: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',      accent: 'bg-blue-500/60',   ring: 'hover:border-blue-400/40' },
  teal:   { tile: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',      accent: 'bg-teal-500/60',   ring: 'hover:border-teal-400/40' },
  orange: { tile: 'bg-orange-500/10 text-orange-600 dark:text-orange-400', accent: 'bg-orange-500/60', ring: 'hover:border-orange-400/40' },
};

/** Compact relative time — "2h", "3d" — tuned for tight metadata columns. */
export function relTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

export function HomePanel({
  icon: Icon,
  title,
  subtitle,
  tone,
  href,
  count,
  action,
  emphasis = false,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tone: Tone;
  href?: string;
  count?: number | null;
  action?: { label: string; href: string };
  emphasis?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];

  const header = (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className={cn('flex shrink-0 items-center justify-center rounded-md', t.tile, emphasis ? 'h-8 w-8' : 'h-7 w-7')}>
        <Icon className={emphasis ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium tracking-tight text-foreground">{title}</h3>
          {typeof count === 'number' && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {count.toLocaleString()}
            </span>
          )}
        </div>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-card/40 transition-colors',
        t.ring,
        emphasis ? 'p-4' : 'p-3',
        className,
      )}
    >
      {emphasis && <span className={cn('pointer-events-none absolute inset-y-2.5 left-0 w-[2px] rounded-full', t.accent)} />}
      <div className="flex items-center justify-between gap-3">
        {href ? (
          <Link href={href} className="min-w-0 flex-1">{header}</Link>
        ) : (
          <div className="min-w-0 flex-1">{header}</div>
        )}
        {action && (
          <Link
            href={action.href}
            className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {action.label}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className={emphasis ? 'mt-3' : 'mt-2.5'}>{children}</div>
    </div>
  );
}

/**
 * A single clickable list row inside a panel. Renders a `<Link>` when given an
 * `href`, or a `<button>` when given `onClick` (e.g. assets/schemas that open
 * in place rather than navigating).
 */
export function HomeRow({
  href,
  onClick,
  leading,
  label,
  meta,
}: {
  href?: string;
  onClick?: () => void;
  leading?: React.ReactNode;
  label: string;
  meta?: React.ReactNode;
}) {
  const className = '-mx-1.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/50';
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{label}</span>
      {meta != null && meta !== '' && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
    </>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} className={className}>{inner}</button>;
  }
  return <Link href={href ?? '#'} className={className}>{inner}</Link>;
}

/** Muted empty state with an optional call-to-action. */
export function HomeEmpty({ children, action }: { children: React.ReactNode; action?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-start gap-1 py-1.5">
      <p className="text-xs text-muted-foreground">{children}</p>
      {action && (
        <Link href={action.href} className="text-xs font-medium text-foreground/80 transition-colors hover:text-foreground">
          {action.label} →
        </Link>
      )}
    </div>
  );
}
