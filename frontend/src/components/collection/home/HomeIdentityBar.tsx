'use client';

import Link from 'next/link';
import { Database, FileText, Microscope, Settings, ChartScatter, Terminal, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TopbarSlot } from '@/components/layout/TopbarSlot';
import { InvitationInbox } from '@/components/collaboration/InvitationInbox';

/**
 * Home identity bar — claims the app top bar on the HQ home route. Anchors "you
 * are working in X" with the infospace name and a vital-signs strip, plus quick
 * routes to settings and the invitations inbox. Home is the one route that keeps
 * notifications visible, so the bell rides here (other claimed routes drop it).
 */
export function HomeIdentityBar({
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
    <TopbarSlot>
      <div className="flex w-full items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="h-4 w-4 shrink-0 text-foreground/70" />
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
            {name || 'No active infospace'}
          </h1>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-3 text-xs sm:flex">
            <Stat icon={FileText} label="assets" value={fmt(assets)} />
            <Stat icon={Microscope} label="schemas" value={fmt(schemas)} />
            <Stat icon={Terminal} label="runs" value={fmt(runs)} />
            <div className={cn('flex items-center gap-1.5', embeddingsOn ? 'text-blue-700/80 dark:text-blue-300' : 'text-muted-foreground/60')}>
              <ChartScatter className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{embeddingsOn ? 'Embeddings on' : 'Embeddings off'}</span>
            </div>
          </div>
          <Link
            href="/hq/infospaces/infospace-manager"
            aria-label="Infospace settings"
            className="flex h-8 w-8 items-center justify-center rounded-md border bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <InvitationInbox />
        </div>
      </div>
    </TopbarSlot>
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
