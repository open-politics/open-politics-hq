'use client';

import Link from 'next/link';
import { Hexagon, Network, Package, Star } from 'lucide-react';
import { HomePanel, HomeRow, HomeEmpty, relTime } from './HomePanel';
import { cn } from '@/lib/utils';
import type { AnnotationRunRead, KnowledgeGraphRead } from '@/client';
import type { PackageRead } from '@/zustand_stores/storePackages';

/**
 * Work tier — your living outputs. Lighter than the foundation panels: the
 * things you've made and are watching, not the materials you build from.
 */

const RUNNER_HREF = '/hq/infospaces/annotation-runner';

export function HomeAnalysisModule({ favorites, isLoading }: { favorites: AnnotationRunRead[]; isLoading: boolean }) {
  return (
    <HomePanel icon={Star} tone="blue" title="Analysis Results" subtitle="Your favorited runs" action={{ label: 'all', href: RUNNER_HREF }}>
      <div className="space-y-0.5">
        {favorites.slice(0, 4).map((r) => (
          <HomeRow
            key={r.id}
            href={`${RUNNER_HREF}?runId=${r.id}`}
            leading={<RunStatusDot status={r.status as string} />}
            label={r.name || `Run ${r.id}`}
            meta={r.annotation_count != null ? r.annotation_count.toLocaleString() : undefined}
          />
        ))}
        {!isLoading && favorites.length === 0 && (
          <HomeEmpty action={{ label: 'Open Analysis', href: RUNNER_HREF }}>No favorited runs yet — star a run to pin it here.</HomeEmpty>
        )}
      </div>
    </HomePanel>
  );
}

export function HomeGraphsModule({ items, isLoading }: { items: KnowledgeGraphRead[]; isLoading: boolean }) {
  return (
    <HomePanel icon={Network} tone="teal" title="Graphs" subtitle="Knowledge & entities" action={{ label: 'all', href: '/hq/infospaces/graphs?tab=graphs' }}>
      <div className="space-y-0.5">
        {items.slice(0, 3).map((g) => (
          <HomeRow
            key={g.id}
            href={`/hq/infospaces/graphs?tab=view&graph_id=${g.id}`}
            leading={<Hexagon className="h-3.5 w-3.5 shrink-0 text-teal-500" />}
            label={g.name}
            meta={relTime(g.created_at)}
          />
        ))}
        {!isLoading && items.length === 0 && <HomeEmpty action={{ label: 'Open Graphs', href: '/hq/infospaces/graphs' }}>No graphs yet.</HomeEmpty>}
      </div>
      <div className="mt-2 flex items-center gap-3 border-t pt-2 text-xs text-muted-foreground">
        <Link href="/hq/infospaces/graphs?tab=canons" className="transition-colors hover:text-foreground">Canons</Link>
        <span className="text-border">·</span>
        <Link href="/hq/infospaces/graphs?tab=connections" className="transition-colors hover:text-foreground">Connections</Link>
      </div>
    </HomePanel>
  );
}

export function HomePackagesModule({ items, isLoading }: { items: PackageRead[]; isLoading: boolean }) {
  const visibility = (v: PackageRead['visibility']) => (v === 'public' ? 'public' : v === 'internal' ? 'shared' : 'link');
  return (
    <HomePanel icon={Package} tone="orange" title="Packages" subtitle="Share & export" action={{ label: 'all', href: '/hq/infospaces/packages' }}>
      <div className="space-y-0.5">
        {items.slice(0, 3).map((p) => (
          <HomeRow
            key={p.id}
            href="/hq/infospaces/packages"
            leading={<Package className="h-3.5 w-3.5 shrink-0 text-orange-500" />}
            label={p.name}
            meta={visibility(p.visibility)}
          />
        ))}
        {!isLoading && items.length === 0 && <HomeEmpty action={{ label: 'Open Packages', href: '/hq/infospaces/packages' }}>No packages yet.</HomeEmpty>}
      </div>
    </HomePanel>
  );
}

/** Status indicator following the app's idioms: green=done, red=failed, amber=mixed, pulsing blue=in-flight. */
function RunStatusDot({ status }: { status?: string }) {
  const s = (status ?? '').toLowerCase();
  const cls =
    s === 'completed' ? 'bg-green-500'
    : s === 'failed' ? 'bg-red-500'
    : s === 'completed_with_errors' ? 'bg-amber-500'
    : s === 'running' || s === 'pending' || s === 'waiting' ? 'bg-blue-500 animate-pulse'
    : 'bg-muted-foreground/40';
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cls)} />;
}
