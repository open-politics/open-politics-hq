"use client";

import { useAnnotationRunStore } from "@/zustand_stores/useAnnotationRunStore";
import AnnotationRunner from "@/components/collection/infospaces/annotation/AnnotationRunner";
import AnnotationRunnerDock from "@/components/collection/infospaces/annotation/AnnotationRunnerDock";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { AnnotationRunRead, AnnotationRunCreate, AnnotationSchemaRead, AssetRead, AnnotationRead } from "@/client/models";
import { toast } from "sonner";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useAnnotationSystem } from "@/hooks/useAnnotationSystem";
import { useAssetStore } from "@/zustand_stores/storeAssets";
import { AnnotationsService } from "@/client/services";
import { adaptEnhancedAnnotationToFormattedAnnotation } from "@/lib/annotations/adapters";
import { FormattedAnnotation, AnnotationRunParams } from "@/lib/annotations/types";
import { motion } from "framer-motion";

export default function AnnotationRunnerPage() {
  const { activeInfospace } = useInfospaceStore();
  
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
  } = useAnnotationSystem({ autoLoadRuns: true });

  const { assets, fetchAssets: fetchAllAssets } = useAssetStore();

  const [runResults, setRunResults] = useState<FormattedAnnotation[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (activeInfospace?.id) {
      loadSchemas();
      fetchAllAssets();
    }
  }, [activeInfospace?.id, loadSchemas, fetchAllAssets]);

  const fetchRunResults = useCallback(async (runId: number) => {
    if (!activeInfospace?.id) return;
    setIsLoadingResults(true);
    try {
        const response = await AnnotationsService.getRunResults({
            infospaceId: activeInfospace.id,
            runId: runId,
            limit: 5000,
        });
        const formatted = response.map(r => adaptEnhancedAnnotationToFormattedAnnotation(r));
        setRunResults(formatted);
    } catch (e: any) {
        toast.error("Failed to load run results.", { description: e.body?.detail || e.message });
    } finally {
        setIsLoadingResults(false);
    }
  }, [activeInfospace?.id]);

  useEffect(() => {
    if (activeRun?.id) {
      fetchRunResults(activeRun.id);
    } else {
      setRunResults([]);
    }
  }, [activeRun?.id, fetchRunResults]);
  
  useEffect(() => {
    const checkStatus = async () => {
      if (activeRun && (activeRun.status === 'running' || activeRun.status === 'pending')) {
        console.log(`Polling status for run ${activeRun.id}... Status: ${activeRun.status}`);
        // We need to reload the run object itself to get status updates
        loadRuns(); 
      } else {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if(activeRun?.status === 'completed' || activeRun?.status === 'completed_with_errors' || activeRun?.status === 'failed') {
            fetchRunResults(activeRun.id);
        }
      }
    };

    if (activeRun && (activeRun.status === 'running' || activeRun.status === 'pending')) {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(checkStatus, 5000);
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [activeRun, fetchRunResults, loadRuns]);

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
  
  const allSources = useMemo(() => {
    const sourcesMap = new Map();
    assets.forEach(asset => {
        if(asset.source_id && !sourcesMap.has(asset.source_id)) {
            sourcesMap.set(asset.source_id, {id: asset.source_id, name: `Source ${asset.source_id}`})
        }
    });
    return Array.from(sourcesMap.values());
  }, [assets]);
  
  return (
    <div className="flex flex-col h-full bg-background overflow-auto bg-primary-950 relative">
      {/* Blurred green rectangle background */}
      <motion.div
        className="fixed rounded-lg blur-[150px] opacity-30 dark:opacity-15"
        style={{
          backgroundColor: 'var(--dot-color-2)',
          width: '60vw',
          height: '40vh',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />
      
      <div className="flex-1 pb-40 relative z-10">
        <AnnotationRunner
            allRuns={runs}
            isLoadingRuns={isLoadingRuns}
            onSelectRun={handleSelectRunFromHistory}
            allSchemas={schemas}
            allSources={allSources}
            activeRun={activeRun}
            isProcessing={isLoadingResults || activeRun?.status === 'running' || activeRun?.status === 'pending'}
            results={runResults}
            assets={assets}
            onClearRun={clearActiveRun}
            onRunWithNewAssets={(template) => { /* Logic to be implemented if needed */ }}
        />
        {runError && <p className="text-red-500 mt-4 text-center">{runError}</p>}
      </div>
      
      <AnnotationRunnerDock 
        allAssets={assets}
        allSchemes={schemas}
        onCreateRun={handleCreateRun}
        activeRunId={activeRun?.id || null}
        isCreatingRun={isCreatingRun}
        onClearRun={clearActiveRun}
      />
    </div>
  );
} 