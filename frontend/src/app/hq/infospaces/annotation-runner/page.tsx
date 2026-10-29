"use client";

import { useAnnotationRunStore } from "@/zustand_stores/useAnnotationRunStore";
import AnnotationRunner from "@/components/collection/annotation/AnnotationRunner";
import AnnotationRunnerDock from "@/components/collection/annotation/AnnotationRunnerDock";
import { useEffect, useCallback, useRef } from "react";
import { AnnotationRunRead } from "@/client";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useAnnotationSystem } from "@/hooks/useAnnotationSystem";
import { useStream } from "@/hooks/useStream";
import { useAssetStore } from "@/zustand_stores/storeAssets";
import { RunsService } from "@/client";
import { useSurfaceCommands } from "@/hooks/useSurfaceCommands";
import { AnnotationRunParams } from "@/lib/annotations/types";
import { useRunLedger } from "@/lib/annotations/ledger";
import { runPollIntervalMs } from "@/lib/annotations/pollIntervals";
import { Surface } from '@/components/layout/Surface';

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
    refreshActiveRun,
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

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingProgress = useRef<{ run_id: number; progress_current?: number; progress_total?: number; status?: string } | null>(null);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (progressTimer.current) clearTimeout(progressTimer.current); }, []);

  useEffect(() => {
    if (activeInfospace?.id) {
      loadSchemas();
      fetchAllAssets();
    }
  }, [activeInfospace?.id, loadSchemas, fetchAllAssets]);

  // Where the run's scope stands, as counts — fetched once per run, then
  // re-asked (throttled) as progress arrives. Nothing on this page needs
  // the run's annotations themselves; whatever shows one asset's fetches
  // that asset's.
  const ledger = useRunLedger(activeRun);

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
        // Coalesced: a fast run sends a progress event per annotation, and
        // each new run object re-renders the page — four a second is plenty.
        pendingProgress.current = event.data;
        if (progressTimer.current == null) {
          progressTimer.current = setTimeout(() => {
            progressTimer.current = null;
            const p = pendingProgress.current;
            pendingProgress.current = null;
            if (!p) return;
            setActiveRun((prev) =>
              prev && prev.id === p.run_id
                ? {
                    ...prev,
                    progress_current: p.progress_current ?? prev.progress_current,
                    progress_total: p.progress_total ?? prev.progress_total,
                    status: (p.status as AnnotationRunRead['status']) ?? prev.status,
                  }
                : prev,
            );
          }, 250);
        }
        ledger.refresh();
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
        void ledger.refreshNow();
      }
    },
  });

  // Polling baseline while the run is active, whatever the stream does: SSE
  // is the low-latency path, this the always-works fallback. Both asks are
  // small — the one run, and the ledger's counts — and a poll that finds
  // nothing changed changes nothing on screen.
  useEffect(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (isRunActive && activeRun?.id) {
      // Fast while processing; slow for a caught-up "watching" live run.
      pollIntervalRef.current = setInterval(() => {
        void refreshActiveRun();
        ledger.refresh();
      }, runPollIntervalMs({ status: activeRun?.status }));
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeRun?.id, activeRun?.status, isRunActive, refreshActiveRun, ledger.refresh]);

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

  // A retried result moves the counts.
  const { refreshNow: refreshLedger } = ledger;
  const retrySingleResultWithRefresh = useCallback(async (resultId: number, customPrompt?: string) => {
    const result = await retrySingleResult(resultId, customPrompt);
    if (result) void refreshLedger();
    return result;
  }, [retrySingleResult, refreshLedger]);

  // A change made in the runner — live, a rename, an extension, a retry —
  // read back at once: the run's state decides whether it is watched.
  const onRunChanged = useCallback(() => {
    void refreshActiveRun();
    void refreshLedger();
  }, [refreshActiveRun, refreshLedger]);

  const isProcessing = activeRun?.status === 'running' || activeRun?.status === 'pending';
  
  return (
    // A sideways swipe here scrolls the runner's columns or pans a canvas —
    // never the browser's history, even past the first column.
    <Surface className="overscroll-x-none">
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <AnnotationRunner
            allRuns={runs}
            isLoadingRuns={isLoadingRuns}
            onSelectRun={handleSelectRunFromHistory}
            allSchemas={schemas}
            activeRun={activeRun}
            isProcessing={isProcessing}
            ledger={ledger}
            onClearRun={clearActiveRun}
            onRunWithNewAssets={(template) => { /* Logic to be implemented if needed */ }}
            onRetrySingleResult={retrySingleResultWithRefresh}
            onRunChanged={onRunChanged}
        />
        {runError && <p className="text-red-500 mt-4 text-center">{runError}</p>}
      </div>
      
      {/* Always mounted (except focus mode) so shortcuts keep working while a
          run is open. The dock self-hides by default when a run is selected. */}
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
    </Surface>
  );
} 