'use client';

import Link from 'next/link';
import { Database, FileText, Microscope, Settings, Sparkles, Terminal, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Ambient identity band — replaces the old top-right mini-card. Anchors "you
 * are working in X" with the infospace name, a vital-signs strip, and a quick
 * route to settings. The brand gradient (`--gradient-primary-*`) washes the
 * background so it reads alive rather than as a grey box.
 */
export function HomeIdentityRibbon({
  name,
  assets,
  schemas,
  runs,
  embeddingsOn,
}: {
  name: string;
  assets: number | null;
  schemas: number;
  runs: number;
  embeddingsOn: boolean;
}) {
  const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString());

  return (
    <div className="relative overflow-hidden rounded-lg border">
      <div className="pointer-events-none absolute inset-0 opacity-[0.16] dark:hidden" style={{ backgroundImage: 'var(--gradient-primary-light)' }} />
      <div className="pointer-events-none absolute inset-0 hidden dark:block" style={{ backgroundImage: 'var(--gradient-primary-dark)' }} />

      <div className="relative flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-background/70 ring-1 ring-border">
            <Database className="h-5 w-5 text-foreground/70" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{name || 'No active infospace'}</h1>
            <p className="text-xs text-muted-foreground">Working infospace</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-4 text-xs sm:flex">
            <Stat icon={FileText} label="assets" value={fmt(assets)} />
            <Stat icon={Microscope} label="schemas" value={fmt(schemas)} />
            <Stat icon={Terminal} label="runs" value={fmt(runs)} />
            <div className={cn('flex items-center gap-1.5', embeddingsOn ? 'text-foreground/80' : 'text-muted-foreground/60')}>
              <Sparkles className="h-3.5 w-3.5" />
              <span>{embeddingsOn ? 'Embeddings on' : 'Embeddings off'}</span>
            </div>
          </div>
          <Link
            href="/hq/infospaces/infospace-manager"
            aria-label="Infospace settings"
            className="flex h-8 w-8 items-center justify-center rounded-md border bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium tabular-nums text-foreground/80">{value}</span>
      <span>{label}</span>
    </div>
  );
}
