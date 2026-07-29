"use client";

import { useAnnotationRunStore } from "@/zustand_stores/useAnnotationRunStore";
import AnnotationRunner from "@/components/collection/annotation/AnnotationRunner";
import AnnotationRunnerDock from "@/components/collection/annotation/AnnotationRunnerDock";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { AnnotationRunRead, AnnotationRunCreate, AnnotationSchemaRead, AssetRead, AnnotationRead } from "@/client";
import { toast } from "sonner";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useAnnotationSystem } from "@/hooks/useAnnotationSystem";
import { useStream, type StreamEvent } from "@/hooks/useStream";
import { useAssetStore } from "@/zustand_stores/storeAssets";
import { AnnotationsService, RunsService } from "@/client";
import { useSurfaceCommands } from "@/hooks/useSurfaceCommands";
import { adaptEnhancedAnnotationToFormattedAnnotation } from "@/lib/annotations/adapters";
import { FormattedAnnotation, AnnotationRunParams } from "@/lib/annotations/types";
import { runPollIntervalMs } from "@/lib/annotations/pollIntervals";
import { motion } from "framer-motion";

export default function AnnotationRunnerPage() {
  const { activeInfospace } = useInfospaceStore();
  // Focus mode hides all chrome — including the runner dock — for a clean canvas.
  const focusMode = useAnnotationRunStore((s) => s.focusMode);
  
  const {
    runs,
    loadRuns,
    deleteRun,
    activeRun,
    setActiveRun,
    isLoadingRuns,
    createRun,
    isCreatingRun,
    error: runError,
    schemas,
    loadSchemas,
    retrySingleResult,
  } = useAnnotationSystem({ autoLoadRuns: true });

  const { assets, fetchAssets: fetchAllAssets } = useAssetStore();

  // Deep-link: open a specific run when arrived via ?runId= (e.g. the favorited
  // runs on the HQ home). Read from window.location (client-only) so we don't
  // need a Suspense boundary; apply once the matching run has loaded.
  const pendingRunIdRef = useRef<number | null>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('runId');
    pendingRunIdRef.current = raw ? parseInt(raw, 10) : null;
  }, []);
  useEffect(() => {
    const id = pendingRunIdRef.current;
    if (id == null || Number.isNaN(id)) return;
    const run = runs.find((r) => r.id === id);
    if (run) {
      pendingRunIdRef.current = null;
      setActiveRun(run);
    }
  }, [runs, setActiveRun]);

  // The operator's `runner:open` verb — select a run to open its dashboard, whether
  // or not it's in the loaded list yet (fetches it), and even when we're already on
  // the runner (the ?runId deep-link above only fires on first mount). This is what
  // lets the operator open an EXISTING run and then build its dashboard on it.
  useSurfaceCommands('runner', {
    open: async (p) => {
      const id = Number(p?.run_id ?? p?.runId);
      if (!Number.isFinite(id)) return;
      let run = runs.find((r) => r.id === id) ?? null;
      if (!run && activeInfospace?.id) {
        try { run = await RunsService.getRun({ infospaceId: activeInfospace.id, runId: id }); }
        catch { /* not found / no access — leave selection unchanged */ }
      }
      if (run) setActiveRun(run);
    },
  });

  const [runResults, setRunResults] = useState<FormattedAnnotation[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (activeInfospace?.id) {
      loadSchemas();
      fetchAllAssets();
    }
  }, [activeInfospace?.id, loadSchemas, fetchAllAssets]);

  const fetchRunResults = useCallback(async (runId: number, silent = false) => {
    if (!activeInfospace?.id) return;
    if (!silent) setIsLoadingResults(true);
    try {
        const response = await AnnotationsService.getRunResults({
            infospaceId: activeInfospace.id,
            runId: runId,
            limit: 5000,
        });
        const formatted = response.map(r => adaptEnhancedAnnotationToFormattedAnnotation(r));
        setRunResults(formatted);
    } catch (e: any) {
        if (!silent) toast.error("Failed to load run results.", { description: e.body?.detail || e.message });
    } finally {
        if (!silent) setIsLoadingResults(false);
    }
  }, [activeInfospace?.id]);

  // Extract assets from run results to ensure we only show assets that have annotations
  const runAssets = useMemo<AssetRead[]>(() => {
    if (!runResults || runResults.length === 0) return [];
    
    const uniqueAssets = new Map<number, AssetRead>();
    
    runResults.forEach(annotation => {
      if (annotation.asset_id) {
        // Try to find the asset in the full assets list first
        const fullAsset = assets.find(a => a.id === annotation.asset_id);
        if (fullAsset) {
          uniqueAssets.set(annotation.asset_id, fullAsset);
        } else if (annotation.asset) {
          // If not found in full assets, use the asset data from the annotation
          const assetFromAnnotation: AssetRead = {
            id: annotation.asset.id,
            uuid: `asset-${annotation.asset.id}`, // FormattedAnnotation.asset doesn't have uuid
            title: annotation.asset.title || `Asset ${annotation.asset.id}`,
            kind: annotation.asset.kind as any, // Should be AssetKind from client models
            text_content: annotation.asset.text_content || '',
            created_at: annotation.asset.created_at,
            updated_at: annotation.asset.created_at,
            infospace_id: activeInfospace?.id || 0,
            user_id: 0,
            source_id: annotation.asset.source_id || 0,
            parent_asset_id: annotation.asset.parent_asset_id || null,
            part_index: null,
            is_container: false,
          };
          uniqueAssets.set(annotation.asset_id, assetFromAnnotation);
        } else {
          // If no asset data available, create a minimal asset
          const minimalAsset: AssetRead = {
            id: annotation.asset_id,
            uuid: `asset-${annotation.asset_id}`,
            title: `Asset ${annotation.asset_id}`,
            kind: 'text',
            text_content: '',
            created_at: annotation.timestamp || new Date().toISOString(),
            updated_at: annotation.timestamp || new Date().toISOString(),
            infospace_id: activeInfospace?.id || 0,
            user_id: 0,
            source_id: 0,
            parent_asset_id: null,
            part_index: null,
            is_container: false,
          };
          uniqueAssets.set(annotation.asset_id, minimalAsset);
        }
      }
    });
    
    return Array.from(uniqueAssets.values());
  }, [runResults, assets, activeInfospace?.id]);

  useEffect(() => {
    if (activeRun?.id) {
      fetchRunResults(activeRun.id);
    } else {
      setRunResults([]);
    }
  }, [activeRun?.id, fetchRunResults]);

  // Presence: subscribe to annotation run stream for live progress.
  // A *live* run is never really "done" — when it's completed it's watching,
  // and the reconciler can flip it back to PENDING as new content lands. So we
  // keep SSE + polling alive for a live run too, to catch the next cycle.
  const isRunActive =
    activeRun?.status === 'running' ||
    activeRun?.status === 'pending' ||
    !!(activeRun as any)?.live;
  const { isConnected: streamConnected } = useStream<{
    run_id: number;
    progress_current?: number;
    progress_total?: number;
    status?: string;
    error?: string;
  }>({
    infospaceId: activeInfospace?.id ?? 0,
    topic: 'annotation_run',
    resourceId: activeRun?.id ?? 0,
    enabled: !!activeInfospace?.id && !!activeRun?.id && !!isRunActive,
    onEvent: (event) => {
      if (event.type === 'progress') {
        // Apply progress directly from the event (no full refetch) so the
        // header's progress bar updates per-annotation without hammering
        // /runs. Also silently refresh row results so the table fills in.
        setActiveRun((prev) =>
          prev && prev.id === event.data.run_id
            ? {
                ...prev,
                progress_current: event.data.progress_current ?? prev.progress_current,
                progress_total: event.data.progress_total ?? prev.progress_total,
                status: (event.data.status as AnnotationRunRead['status']) ?? prev.status,
              }
            : prev,
        );
        if (event.data.run_id) {
          fetchRunResults(event.data.run_id, true);
        }
      }
      if (event.type === 'completed' || event.type === 'completed_with_errors' || event.type === 'failed') {
        // Terminal event: apply status immediately so isRunning flips off
        // without waiting for /runs to round-trip. Then refresh everything
        // (picks up final error_message, aggregates, progress totals).
        const terminalStatus =
          event.type === 'failed' ? 'failed'
          : event.type === 'completed_with_errors' ? 'completed_with_errors'
          : 'completed';
        setActiveRun((prev) =>
          prev && prev.id === event.data.run_id
            ? { ...prev, status: terminalStatus as AnnotationRunRead['status'] }
            : prev,
        );
        loadRuns();
        if (event.data.run_id) fetchRunResults(event.data.run_id);
      }
    },
  });

  // Polling baseline: every 3s while the run is active, regardless of SSE.
  // SSE is the low-latency path; this is the always-works fallback so the UI
  // updates even if the stream silently drops events. The small duplicate
  // cost is worth the reliability — loadRuns + results are already cached by
  // the server and both requests are cheap.
  useEffect(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (isRunActive && activeRun?.id) {
      const runId = activeRun.id;
      // Fast while processing; slow for a caught-up "watching" live run.
      pollIntervalRef.current = setInterval(async () => {
        await loadRuns();
        await fetchRunResults(runId, true);
      }, runPollIntervalMs({ status: activeRun?.status }));
    } else if (activeRun?.status === 'completed' || activeRun?.status === 'completed_with_errors' || activeRun?.status === 'failed') {
      fetchRunResults(activeRun.id);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeRun?.id, activeRun?.status, isRunActive, loadRuns, fetchRunResults]);

  const handleSelectRunFromHistory = (runId: number) => {
    const runToLoad = runs.find(r => r.id === runId);
    if (runToLoad) {
      setActiveRun(runToLoad);
    }
  };

  const handleCreateRun = async (params: AnnotationRunParams) => {
    const newRun = await createRun(params);
    if (newRun) {
      setActiveRun(newRun);
    }
  };

  const clearActiveRun = () => {
    setActiveRun(null);
  };

  // Enhanced retry function that refreshes results after success
  const retrySingleResultWithRefresh = useCallback(async (resultId: number, customPrompt?: string) => {
    const result = await retrySingleResult(resultId, customPrompt);
    if (result && activeRun?.id) {
      // Refresh the current run results after successful retry
      await fetchRunResults(activeRun.id);
    }
    return result;
  }, [retrySingleResult, activeRun?.id, fetchRunResults]);
  
  const allSources = useMemo(() => {
    const sourcesMap = new Map();
    assets.forEach(asset => {
        if(asset.source_id && !sourcesMap.has(asset.source_id)) {
            sourcesMap.set(asset.source_id, {id: asset.source_id, name: `Source ${asset.source_id}`})
        }
    });
    return Array.from(sourcesMap.values());
  }, [assets]);

  // Calculate the isProcessing state
  const isProcessing = isLoadingResults || activeRun?.status === 'running' || activeRun?.status === 'pending';
  
  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
      
      <div className="flex-1 relative z-10">
        <AnnotationRunner
            allRuns={runs}
            isLoadingRuns={isLoadingRuns}
            onSelectRun={handleSelectRunFromHistory}
            allSchemas={schemas}
            allSources={allSources}
            activeRun={activeRun}
            isProcessing={isProcessing}
            results={runResults}
            assets={runAssets}
            onClearRun={clearActiveRun}
            onRunWithNewAssets={(template) => { /* Logic to be implemented if needed */ }}
            onRetrySingleResult={retrySingleResultWithRefresh}
        />
        {runError && <p className="text-red-500 mt-4 text-center">{runError}</p>}
      </div>
      
      {!focusMode && (
        <AnnotationRunnerDock
          allAssets={assets}
          allSchemes={schemas}
          allRuns={runs}
          onCreateRun={handleCreateRun}
          onSelectRun={handleSelectRunFromHistory}
          activeRunId={activeRun?.id || null}
          isCreatingRun={isCreatingRun}
          isLoadingRuns={isLoadingRuns}
          onClearRun={clearActiveRun}
        />
      )}
    </div>
  );
} 