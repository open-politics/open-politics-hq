'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { StorageService, IngestionJobsService, SourcesService } from '@/client';
import { useIngestionJobs } from '@/hooks/useIngestionJobs';
import { useWatchStatus } from '@/hooks/useWatchStatus';
import {
  HardDrive, FolderOpen, File, Loader2, ChevronRight, Download,
  Eye, Inbox, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import type { StorageBrowseEntry } from '@/client';

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

  const { jobs, refresh } = useIngestionJobs({
    kind: 'directory_local',
    pollInterval: 2000,
  });

  const { statuses, refresh: refreshWatchStatus, getStatusByBundle } = useWatchStatus({
    pollInterval: 10000,
  });

  const handleReconcileNow = useCallback(
    async (sourcePath: string, bundleId: number) => {
      if (!activeInfospace?.id) return;
      setWatchTogglingBundle(bundleId);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const res = await fetch(`${baseUrl}/api/v1/infospaces/${activeInfospace.id}/reconcile-directory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_path: sourcePath, bundle_id: bundleId }),
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || res.statusText);
        }
        const data = await res.json();
        toast.success(`Reconcile completed: ${data.assets_created ?? 0} assets created`);
        refresh();
      } catch (e) {
        console.error('[LocalStorageImport] Reconcile error:', e);
        toast.error('Failed to reconcile');
      } finally {
        setWatchTogglingBundle(null);
      }
    },
    [activeInfospace?.id, refresh]
  );

  const handleInboxToggle = useCallback(
    async (
      sourcePath: string,
      bundleId: number,
      checked: boolean,
      watchStatus?: { reconcile_source_id?: number | null; inbox_source_id?: number | null; reconcile_active?: boolean }
    ) => {
      if (!activeInfospace?.id) return;
      setWatchTogglingBundle(bundleId);
      try {
        if (checked) {
          await IngestionJobsService.enableDirectoryWatch({
            infospaceId: activeInfospace.id,
            requestBody: {
              source_path: sourcePath,
              bundle_id: bundleId,
              enable_reconcile: false,
              reconcile_interval_seconds: 3600,
              enable_inbox: true,
              inbox_interval_seconds: 900,  // 15 min per plan
            },
          });
          toast.success('Inbox watch enabled');
        } else if (watchStatus?.inbox_source_id) {
          await SourcesService.pauseStream({
            infospaceId: activeInfospace.id,
            sourceId: watchStatus.inbox_source_id,
          });
          toast.success('Inbox watch paused');
        }
        refreshWatchStatus();
      } catch (e) {
        console.error('[LocalStorageImport] Inbox toggle error:', e);
        toast.error('Failed to update watch');
      } finally {
        setWatchTogglingBundle(null);
      }
    },
    [activeInfospace?.id, refreshWatchStatus]
  );

  const loadBrowse = useCallback(
    async (path?: string | null) => {
      if (!activeInfospace?.id) return;
      setIsLoadingBrowse(true);
      try {
        const res = await StorageService.browseStorage({
          infospaceId: activeInfospace.id,
          path: path ?? undefined,
          includeCounts: false,
        });
        setBrowseData({
          current_path: res.current_path,
          parent_path: res.parent_path ?? null,
          entries: res.entries,
          allowed_roots: res.allowed_roots,
          path_error: res.path_error ?? null,
        });
      } catch (e) {
        console.error('[LocalStorageImport] Browse error:', e);
        toast.error('Failed to browse storage');
        setBrowseData(null);
      } finally {
        setIsLoadingBrowse(false);
      }
    },
    [activeInfospace?.id]
  );

  useEffect(() => {
    loadBrowse();
  }, [loadBrowse]);

  const handleNavigate = (path: string) => {
    loadBrowse(path);
  };

  const handleImportFolder = async (path: string) => {
    if (!activeInfospace?.id) return;
    setImportingPath(path);
    try {
      const job = await IngestionJobsService.createDirectoryImportJob({
        infospaceId: activeInfospace.id,
        requestBody: {
          source_path: path,
          copy_mode: false,
        },
      });
      toast.success(`Import started: ${job.id}`);
      refresh();
    } catch (e) {
      console.error('[LocalStorageImport] Import error:', e);
      toast.error('Failed to start import');
    } finally {
      setImportingPath(null);
    }
  };

  const breadcrumbPath = browseData?.current_path
    ? browseData.current_path.split('/').filter(Boolean)
    : [];
  const roots = browseData?.allowed_roots ?? [];

  if (!activeInfospace) {
    return (
      <div className="p-6 text-muted-foreground">
        Select an infospace to browse and import from local storage.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Local Storage
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Browse allowed import paths and import directories into your infospace. Paths must be
          under ALLOWED_IMPORT_PATHS (typically mounted volumes).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Browse Storage</CardTitle>
          <CardDescription>
            Navigate directories under allowed import paths. Click a folder to drill down, or use
            the breadcrumb to go back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {browseData && (
            <>
              {/* Breadcrumb */}
              <div className="flex flex-wrap items-center gap-1 text-sm">
                <button
                  type="button"
                  onClick={() => loadBrowse()}
                  className="text-muted-foreground hover:text-foreground"
                >
                  /
                </button>
                {breadcrumbPath.map((part, i) => {
                  const fullPath = '/' + breadcrumbPath.slice(0, i + 1).join('/');
                  return (
                    <span key={fullPath} className="flex items-center gap-1">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => handleNavigate(fullPath)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {part}
                      </button>
                    </span>
                  );
                })}
                {browseData.parent_path && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleNavigate(browseData.parent_path!)}
                    className="ml-2"
                  >
                    ← Up
                  </Button>
                )}
              </div>

              {isLoadingBrowse ? (
                <div className="flex items-center gap-2 py-4 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading…
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {browseData.entries.map((entry) => (
                    <div
                      key={entry.path}
                      className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {entry.is_directory ? (
                          <button
                            type="button"
                            onClick={() => handleNavigate(entry.path)}
                            className="flex items-center gap-2 text-left w-full"
                          >
                            <FolderOpen className="h-5 w-5 text-amber-500 flex-shrink-0" />
                            <span className="truncate">{entry.name}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {`${entry.file_count ?? 0}${entry.counts_capped ? '+' : ''} files`}
                              {(entry.importable_count ?? 0) > 0 &&
                                ` (${entry.importable_count} importable)`}
                              {(entry.size_bytes ?? 0) > 0 && ` • ${formatBytes(entry.size_bytes!)}`}
                            </span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <File className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{entry.name}</span>
                            {(entry.size_bytes ?? 0) > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {formatBytes(entry.size_bytes!)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {entry.is_directory && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleImportFolder(entry.path);
                          }}
                          disabled={importingPath === entry.path}
                        >
                          {importingPath === entry.path ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          Import
                        </Button>
                      )}
                    </div>
                  ))}
                  {browseData.entries.length === 0 && !browseData.path_error && (
                    <p className="text-sm text-muted-foreground py-4">Empty directory</p>
                  )}
                </div>
              )}
            </>
          )}
          {!browseData && !isLoadingBrowse && (
            <p className="text-sm text-muted-foreground">Failed to load storage. Check backend is running and config.</p>
          )}
          {browseData?.path_error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">
              {browseData.path_error}
              {browseData.allowed_roots.length > 0 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Allowed roots: {browseData.allowed_roots.join(', ')}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Import Jobs</CardTitle>
          <CardDescription>
            Local directory imports for this infospace. Completed jobs show a link to the bundle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent local import jobs</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {jobs.slice(0, 10).map((job) => {
                const watchStatus = job.root_bundle_id ? getStatusByBundle(job.root_bundle_id) : undefined;
                const isToggling = watchTogglingBundle === job.root_bundle_id;

                return (
                  <div key={job.id} className="rounded border overflow-hidden">
                    <div className="flex items-center justify-between gap-2 p-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{job.source_locator}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.processed_files}/{job.total_files} • {job.status}
                        </p>
                      </div>
                      <Badge className={statusColors[job.status] ?? 'bg-gray-100'}>
                        {job.status}
                      </Badge>
                      {job.status === 'completed' && job.root_bundle_id && (
                        <Link href="/hq/infospaces/asset-manager">
                          <Button variant="link" size="sm" className="p-0 h-auto">
                            View bundle
                          </Button>
                        </Link>
                      )}
                    </div>
                    {job.status === 'completed' && job.root_bundle_id && (
                      <div className="border-t bg-muted/30 px-3 py-2 text-sm space-y-3">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                          <Eye className="h-3.5 w-3.5" />
                          Directory Watch
                        </p>
                        <div className="flex flex-wrap gap-4">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReconcileNow(job.source_locator, job.root_bundle_id!)}
                              disabled={isToggling}
                            >
                              {isToggling ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                              Reconcile now
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              Detect replaced files in directory
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`inbox-${job.id}`}
                              checked={watchStatus?.inbox_active ?? false}
                              onCheckedChange={(checked) =>
                                handleInboxToggle(
                                  job.source_locator,
                                  job.root_bundle_id!,
                                  !!checked,
                                  watchStatus
                                )
                              }
                              disabled={isToggling}
                            />
                            <Label htmlFor={`inbox-${job.id}`} className="text-xs cursor-pointer">
                              <Inbox className="h-3.5 w-3.5 inline mr-1" />
                              Version inbox (_inbox/)
                            </Label>
                          </div>
                        </div>
                        {(watchStatus?.inbox_active) && (
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {watchStatus.inbox_path && watchStatus.inbox_files_pending !== undefined && (
                              <span>
                                {watchStatus.inbox_files_pending} file(s) pending in inbox
                              </span>
                            )}
                          </div>
                        )}
                        {isToggling && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
