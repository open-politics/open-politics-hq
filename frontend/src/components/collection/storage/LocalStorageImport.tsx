'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { StorageService, IngestionJobsService, SourcesService } from '@/client';
import { useIngestionJobs } from '@/hooks/useIngestionJobs';
import { useWatchStatus } from '@/hooks/useWatchStatus';
import {
  HardDrive, FolderOpen, File, Loader2, ChevronRight, Download,
  Eye, Inbox, CheckCircle2, Clock, Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import type { StorageBrowseEntry, IngestionJobRead } from '@/client';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  downloading: 'bg-blue-100 text-blue-800',
  extracting: 'bg-blue-100 text-blue-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const ACTIVE_STATUSES = ['pending', 'downloading', 'extracting', 'processing'];

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(since).getTime());
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - new Date(since).getTime()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span>{formatDuration(elapsed)}</span>;
}

interface PipelineStats {
  import_started: string | null;
  import_finished: string | null;
  total_assets: number;
  ready: number;
  processing: number;
  pending: number;
  failed: number;
  last_asset_ready: string | null;
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function usePipelineStats(jobId: number | null, poll: boolean = false) {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const stillProcessing = stats ? (stats.processing > 0 || stats.pending > 0) : false;
  const shouldPoll = poll || stillProcessing;
  useEffect(() => {
    if (!jobId) return;
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const doFetch = () =>
      fetch(`${baseUrl}/api/v1/ingestion-jobs/${jobId}/pipeline-stats`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => data && setStats(data))
        .catch(() => {});
    doFetch();
    if (!shouldPoll) return;
    const id = setInterval(doFetch, shouldPoll && !poll ? 5000 : 3000);
    return () => clearInterval(id);
  }, [jobId, shouldPoll, poll]);
  return stats;
}

function JobTimingRow({ job }: { job: IngestionJobRead }) {
  const isActive = ACTIVE_STATUSES.includes(job.status);
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const showStats = (isActive || isCompleted) && job.root_bundle_id;
  const stats = usePipelineStats(showStats ? job.id : null, isActive);

  const duration = (job.started_at && job.completed_at)
    ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
    : null;

  const totalPipelineDuration = (stats?.import_started && stats?.last_asset_ready)
    ? new Date(stats.last_asset_ready).getTime() - new Date(stats.import_started).getTime()
    : null;

  return (
    <div className="space-y-1">
      {isActive && job.progress_pct !== undefined && job.progress_pct > 0 && (
        <Progress value={job.progress_pct} className="h-1" />
      )}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
        {isActive && job.started_at && (
          <span className="flex items-center gap-0.5"><Timer className="h-3 w-3" /><ElapsedTimer since={job.started_at} /></span>
        )}
        {isActive && job.stage_message && <span>{job.stage_message}</span>}
        {(isCompleted || isFailed) && duration !== null && (
          <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />Import: {formatDuration(duration)}</span>
        )}
        {isCompleted && totalPipelineDuration !== null && totalPipelineDuration !== duration && (
          <span className="flex items-center gap-0.5"><Timer className="h-3 w-3" />Pipeline: {formatDuration(totalPipelineDuration)}</span>
        )}
      </div>
      {isCompleted && stats && stats.total_assets > 0 && (
        <div className="space-y-0.5">
          <Progress value={(stats.ready / stats.total_assets) * 100} className="h-1" />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{stats.total_assets} assets</span>
            {stats.ready > 0 && <span className="text-green-600">{stats.ready} ready</span>}
            {stats.processing > 0 && <span className="text-blue-600">{stats.processing} processing</span>}
            {stats.pending > 0 && <span className="text-yellow-600">{stats.pending} pending</span>}
            {stats.failed > 0 && <span className="text-red-600">{stats.failed} failed</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LocalStorageImport() {
  const { activeInfospace } = useInfospaceStore();
  const [browseData, setBrowseData] = useState<{
    current_path: string;
    parent_path: string | null;
    entries: StorageBrowseEntry[];
    allowed_roots: string[];
    path_error?: string | null;
  } | null>(null);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [watchTogglingBundle, setWatchTogglingBundle] = useState<number | null>(null);

  const { jobs, refresh } = useIngestionJobs({ kind: 'directory_local', pollInterval: 2000 });
  const { statuses, refresh: refreshWatchStatus, getStatusByBundle } = useWatchStatus({ pollInterval: 10000 });

  const handleReconcileNow = useCallback(async (sourcePath: string, bundleId: number) => {
    if (!activeInfospace?.id) return;
    setWatchTogglingBundle(bundleId);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${baseUrl}/api/v1/infospaces/${activeInfospace.id}/reconcile-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ source_path: sourcePath, bundle_id: bundleId }),
        credentials: 'include',
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || res.statusText); }
      const data = await res.json();
      toast.success(`Reconcile: ${data.assets_created ?? 0} assets created`);
      refresh();
    } catch {
      toast.error('Failed to reconcile');
    } finally {
      setWatchTogglingBundle(null);
    }
  }, [activeInfospace?.id, refresh]);

  const handleInboxToggle = useCallback(async (
    sourcePath: string, bundleId: number, checked: boolean,
    watchStatus?: { reconcile_source_id?: number | null; inbox_source_id?: number | null; reconcile_active?: boolean }
  ) => {
    if (!activeInfospace?.id) return;
    setWatchTogglingBundle(bundleId);
    try {
      if (checked) {
        await IngestionJobsService.enableDirectoryWatch({
          infospaceId: activeInfospace.id,
          requestBody: { source_path: sourcePath, bundle_id: bundleId, enable_reconcile: false, reconcile_interval_seconds: 3600, enable_inbox: true, inbox_interval_seconds: 900 },
        });
        toast.success('Inbox watch enabled');
      } else if (watchStatus?.inbox_source_id) {
        await SourcesService.pauseStream({ infospaceId: activeInfospace.id, sourceId: watchStatus.inbox_source_id });
        toast.success('Inbox watch paused');
      }
      refreshWatchStatus();
    } catch {
      toast.error('Failed to update watch');
    } finally {
      setWatchTogglingBundle(null);
    }
  }, [activeInfospace?.id, refreshWatchStatus]);

  const loadBrowse = useCallback(async (path?: string | null) => {
    if (!activeInfospace?.id) return;
    setIsLoadingBrowse(true);
    try {
      const res = await StorageService.browseStorage({ infospaceId: activeInfospace.id, path: path ?? undefined, includeCounts: false });
      setBrowseData({ current_path: res.current_path, parent_path: res.parent_path ?? null, entries: res.entries, allowed_roots: res.allowed_roots, path_error: res.path_error ?? null });
    } catch {
      toast.error('Failed to browse storage');
      setBrowseData(null);
    } finally {
      setIsLoadingBrowse(false);
    }
  }, [activeInfospace?.id]);

  useEffect(() => { loadBrowse(); }, [loadBrowse]);

  const handleImportFolder = async (path: string) => {
    if (!activeInfospace?.id) return;
    setImportingPath(path);
    try {
      const job = await IngestionJobsService.createDirectoryImportJob({
        infospaceId: activeInfospace.id,
        requestBody: { source_path: path, copy_mode: false },
      });
      toast.success(`Import started: ${job.id}`);
      refresh();
    } catch {
      toast.error('Failed to start import');
    } finally {
      setImportingPath(null);
    }
  };

  const breadcrumbPath = browseData?.current_path?.split('/').filter(Boolean) ?? [];

  if (!activeInfospace) {
    return <div className="text-xs text-muted-foreground">Select an infospace to browse local storage.</div>;
  }

  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-medium flex items-center gap-1.5">
        <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
        Import from Local Filesystem
      </h3>

      {/* Browse */}
      <div className="space-y-1.5">

        {browseData && (
          <>
            {/* Breadcrumb */}
            <div className="flex flex-wrap items-center gap-0.5 text-xs">
              <button type="button" onClick={() => loadBrowse()} className="text-muted-foreground hover:text-foreground">/</button>
              {breadcrumbPath.map((part, i) => {
                const fullPath = '/' + breadcrumbPath.slice(0, i + 1).join('/');
                return (
                  <span key={fullPath} className="flex items-center gap-0.5">
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <button type="button" onClick={() => loadBrowse(fullPath)} className="text-muted-foreground hover:text-foreground">{part}</button>
                  </span>
                );
              })}
              {browseData.parent_path && (
                <Button variant="ghost" size="sm" className="h-5 text-[10px] ml-1 px-1" onClick={() => loadBrowse(browseData.parent_path!)}>Up</Button>
              )}
            </div>
            {isLoadingBrowse ? (
              <div className="flex items-center gap-1.5 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading...</div>
            ) : (
              <div className="space-y-px max-h-56 overflow-y-auto rounded border">
                {browseData.entries.map((entry) => (
                  <div key={entry.path} className="flex items-center justify-between px-2 py-1.5 hover:bg-muted/50 text-xs">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {entry.is_directory ? (
                        <button type="button" onClick={() => loadBrowse(entry.path)} className="flex items-center gap-1.5 text-left w-full min-w-0">
                          <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          <span className="truncate">{entry.name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                            {entry.file_count ?? 0}{entry.counts_capped ? '+' : ''} files
                            {(entry.size_bytes ?? 0) > 0 && ` · ${formatBytes(entry.size_bytes!)}`}
                          </span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{entry.name}</span>
                          {(entry.size_bytes ?? 0) > 0 && <span className="text-[10px] text-muted-foreground">{formatBytes(entry.size_bytes!)}</span>}
                        </div>
                      )}
                    </div>
                    {entry.is_directory && (
                      <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 ml-2 shrink-0" onClick={(e) => { e.stopPropagation(); handleImportFolder(entry.path); }} disabled={importingPath === entry.path}>
                        {importingPath === entry.path ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Import'}
                      </Button>
                    )}
                  </div>
                ))}
                {browseData.entries.length === 0 && !browseData.path_error && (
                  <p className="text-xs text-muted-foreground py-3 px-2">Empty directory</p>
                )}
              </div>
            )}

            {browseData.path_error && (
              <div className="rounded border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-2 text-xs text-amber-800 dark:text-amber-200">
                {browseData.path_error}
                {browseData.allowed_roots.length > 0 && (
                  <p className="mt-1 text-[10px]">Allowed: {browseData.allowed_roots.join(', ')}</p>
                )}
              </div>
            )}
          </>
        )}

        {!browseData && !isLoadingBrowse && (
          <p className="text-xs text-muted-foreground">Failed to load storage.</p>
        )}
      </div>

      {/* Recent jobs */}
      {jobs.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground">Recent imports</div>
          <div className="space-y-px max-h-64 overflow-y-auto rounded border divide-y">
            {jobs.slice(0, 10).map((job) => {
              const watchStatus = job.root_bundle_id ? getStatusByBundle(job.root_bundle_id) : undefined;
              const isToggling = watchTogglingBundle === job.root_bundle_id;

              return (
                <div key={job.id} className="px-2 py-1.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{job.source_locator}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {job.processed_files}/{job.total_files} files
                        {job.failed_files > 0 && <span className="text-red-600"> ({job.failed_files} failed)</span>}
                      </p>
                    </div>
                    <Badge className={`${statusColors[job.status] ?? 'bg-gray-100'} text-[10px] px-1 py-0`}>
                      {job.status}
                    </Badge>
                    {job.status === 'completed' && job.root_bundle_id && (
                      <Link href="/hq/infospaces/asset-manager">
                        <Button variant="link" size="sm" className="p-0 h-auto text-[10px]">View</Button>
                      </Link>
                    )}
                  </div>
                  <JobTimingRow job={job} />

                  {/* Watch controls for completed jobs */}
                  {job.status === 'completed' && job.root_bundle_id && (
                    <div className="flex items-center gap-3 pt-1 border-t mt-1">
                      <Button
                        size="sm" variant="ghost" className="h-5 text-[10px] px-1"
                        onClick={() => handleReconcileNow(job.source_locator, job.root_bundle_id!)}
                        disabled={isToggling}
                      >
                        {isToggling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                        Reconcile
                      </Button>
                      <div className="flex items-center gap-1">
                        <Switch
                          id={`inbox-${job.id}`}
                          checked={watchStatus?.inbox_active ?? false}
                          onCheckedChange={(checked) => handleInboxToggle(job.source_locator, job.root_bundle_id!, !!checked, watchStatus)}
                          disabled={isToggling}
                          className="scale-75"
                        />
                        <Label htmlFor={`inbox-${job.id}`} className="text-[10px] cursor-pointer">
                          <Inbox className="h-3 w-3 inline mr-0.5" />Inbox
                        </Label>
                      </div>
                      {watchStatus?.inbox_active && watchStatus.inbox_files_pending !== undefined && (
                        <span className="text-[10px] text-muted-foreground">{watchStatus.inbox_files_pending} pending</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
