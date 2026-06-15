'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  FileText, FolderOpen, Globe, Loader2, Pause, Play, Plus, RadioTower, Rss, Search, Settings2, Spline, Trash2, RefreshCcw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import type { SourceRead } from '@/client';
import type { SourceKind } from '@/lib/sourceConfigurationRegistry';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useDock } from '@/zustand_stores/storeDock';
import type { SurfaceContentProps } from '../types';

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rss: Rss, web_search: Search, web: Globe, crawl: Globe, upload: FileText, directory: FolderOpen,
};

type Health = 'active' | 'paused' | 'error' | 'warning';
function healthOf(s: SourceRead): Health {
  // WARNING (e.g. output bundle deleted) is attention-needed but not a poll failure.
  if (s.status?.toLowerCase() === 'warning') return 'warning';
  if ((s.consecutive_failures ?? 0) > 0 || s.error_message) return 'error';
  return s.is_active ? 'active' : 'paused';
}
const DOT: Record<Health, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-muted-foreground/40',
  error: 'bg-red-500',
  warning: 'bg-amber-500',
};

/**
 * Controls for the source→bundle streams overlay. Supplied by AssetManager (which
 * owns the rail, the tree and the SVG overlay); absent everywhere else, so the
 * stream UI simply doesn't render outside that surface.
 */
export interface SourceStreamControls {
  /** True when every source's stream is shown at once. */
  allOn: boolean;
  /** Toggle the global "show all streams" state. */
  onToggleAll: () => void;
  /** Source ids whose stream is currently drawn (all-on union, or the pinned set). */
  activeSourceIds: Set<number>;
  /** Toggle a single source's stream, revealing + scrolling to its output bundle. */
  onTogglePinned: (sourceId: number) => void;
}

export function SourceRow({ source, bundleName, streams }: { source: SourceRead; bundleName?: string; streams?: SourceStreamControls }) {
  const { updateSource, deleteSource, triggerSourceProcessing } = useSourceStore();
  const openSourceForm = useDock((s) => s.openSourceForm);
  const [busy, setBusy] = React.useState(false);
  const Icon = KIND_ICONS[source.kind] ?? RadioTower;
  const health = healthOf(source);
  const isLit = !!streams && streams.activeSourceIds.has(source.id);

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div data-source-id={source.id} className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50">
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[health])} title={health} />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight">{source.name}</div>
        <div className="flex items-center gap-1.5 overflow-hidden text-[11px] leading-tight text-muted-foreground">
          <span className="shrink-0 capitalize">{source.kind.replace('_', ' ')}</span>
          {bundleName && <><FolderOpen className="size-3 shrink-0" /><span className="truncate">{bundleName}</span></>}
          {source.last_poll_at && <span className="shrink-0">· {formatDistanceToNowStrict(new Date(source.last_poll_at))} ago</span>}
          {typeof source.total_items_ingested === 'number' && source.total_items_ingested > 0 && (
            <span className="shrink-0">· {source.total_items_ingested.toLocaleString()} items</span>
          )}
        </div>
      </div>

      {/* Stream toggle: a lit blue indicator while traced (always visible);
          otherwise it joins the hover actions so it reserves no width at rest. */}
      {streams && source.output_bundle_id != null && (
        <Button
          variant="ghost" size="icon"
          className={cn('size-6 shrink-0', isLit ? 'text-blue-500' : 'hidden text-muted-foreground/60 group-hover:inline-flex')}
          title={isLit ? 'Hide stream to output bundle' : 'Show stream to output bundle'}
          onClick={() => streams.onTogglePinned(source.id)}
        >
          <Spline className="size-3.5" />
        </Button>
      )}

      {/* Row actions reserve no space at rest — revealed on hover so the name
          and meta get the full width of the narrow rail. A running action keeps
          its spinner visible regardless of hover. */}
      {busy ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <Button variant="ghost" size="icon" className="size-6" title="Run now" onClick={() => act(() => triggerSourceProcessing(source.id))}>
            <RefreshCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-6"
            title={source.is_active ? 'Pause' : 'Activate'}
            onClick={() => act(() => updateSource(source.id, { is_active: !source.is_active }))}
          >
            {source.is_active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon" className="size-6"
            title="Manage — config, schedule, output bundle"
            onClick={() => openSourceForm({
              init: {
                sourceId: source.id,
                kind: source.kind as SourceKind,
                name: source.name,
                config: source.details ?? {},
                streamEnabled: source.is_active,
                pollInterval: source.poll_interval_seconds,
                bundleId: source.output_bundle_id ?? undefined,
                lockKind: true,
                startStep: 'config',
                layout: 'stepped',
              },
            })}
          >
            <Settings2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-6 text-red-600 hover:text-red-700"
            title="Delete"
            onClick={() => { if (confirm(`Delete source "${source.name}"?`)) act(() => deleteSource(source.id)); }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function SourceList({ mode, streams }: SurfaceContentProps & { streams?: SourceStreamControls }) {
  const { sources, fetchSources, isLoading } = useSourceStore();
  const { bundles } = useBundleStore();
  const { activeInfospace } = useInfospaceStore();
  const openSourceForm = useDock((s) => s.openSourceForm);

  React.useEffect(() => { if (activeInfospace?.id) fetchSources(); }, [activeInfospace?.id, fetchSources]);

  const bundleName = (id?: number | null) => (id ? bundles.find((b) => b.id === id)?.name : undefined);

  return (
    <div className={cn('flex flex-col', mode === 'panel' ? 'h-full' : mode === 'overlay' ? 'max-h-[80vh]' : 'max-h-[30rem]')}>
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5">

        <div className="flex items-center gap-1">
          {streams && (
            <Button
              size="icon" variant="ghost"
              className={cn('size-6', streams.allOn && 'bg-blue-500/15 text-blue-600 hover:text-blue-600 dark:text-blue-400')}
              title="Trace every source to the bundle it streams into"
              onClick={streams.onToggleAll}
            >
              <Spline className="size-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => openSourceForm({})}>
            <Plus className="mr-0.5 size-3.5" /> New
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
        {isLoading && sources.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
            <RadioTower className="size-8 opacity-40" />
            No live sources yet. Create one to ingest content on a schedule.
          </div>
        ) : (
          sources.map((s) => <SourceRow key={s.id} source={s} bundleName={bundleName(s.output_bundle_id)} streams={streams} />)
        )}
      </div>
    </div>
  );
}
