"use client";

import { useAnnotationRunStore } from "@/zustand_stores/useAnnotationRunStore";
import AnnotationRunner from "@/components/collection/annotation/AnnotationRunner";
import MonitoringDock from "@/components/collection/monitoring/MonitoringDock";
import MonitoringLiveResultsTable from "@/components/collection/monitoring/MonitoringLiveResultsTable";
import AssetDetailProvider from "@/components/collection/assets/Views/AssetDetailProvider";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { AnnotationRunRead, AnnotationRunCreate, AnnotationSchemaRead, AssetRead } from "@/client";
import { toast } from "sonner";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { useAnnotationSystem } from "@/hooks/useAnnotationSystem";
import { useAssetStore } from "@/zustand_stores/storeAssets";
import { AnnotationsService } from "@/client";
import { adaptEnhancedAnnotationToFormattedAnnotation } from "@/lib/annotations/adapters";
import { FormattedAnnotation } from "@/lib/annotations/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface ContinuousRunConfig {
  bundleId: number;
  schemaIds: number[];
  name: string;
  description?: string;
  pollIntervalSeconds?: number;
  targetBundleId?: number;
  filterExpression?: any;
  promoteFragments?: {
    enabled: boolean;
    fields: string[];
    filter?: any;
  };
  configuration: Record<string, any>;
}

export default function MonitoringPage() {
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
    retrySingleResult,
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

  // Filter to only continuous runs (runs with source_bundle_id)
  const continuousRuns = useMemo(() => {
    return runs.filter(run => (run as any).source_bundle_id != null);
  }, [runs]);

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

  // Extract assets from run results
  const runAssets = useMemo<AssetRead[]>(() => {
    if (!runResults || runResults.length === 0) return [];
    
    const uniqueAssets = new Map<number, AssetRead>();
    
    runResults.forEach(annotation => {
      if (annotation.asset_id) {
        const fullAsset = assets.find(a => a.id === annotation.asset_id);
        if (fullAsset) {
          uniqueAssets.set(annotation.asset_id, fullAsset);
        } else if (annotation.asset) {
          const assetFromAnnotation: AssetRead = {
            id: annotation.asset.id,
            uuid: `asset-${annotation.asset.id}`,
            title: annotation.asset.title || `Asset ${annotation.asset.id}`,
            kind: annotation.asset.kind as any,
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
  
  useEffect(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (activeRun && (activeRun.status === 'running' || activeRun.status === 'pending')) {
      const checkStatus = async () => {
        await loadRuns(); 
      };
      pollIntervalRef.current = setInterval(checkStatus, 5000);
    } else {
      if(activeRun?.status === 'completed' || activeRun?.status === 'completed_with_errors' || activeRun?.status === 'failed') {
          fetchRunResults(activeRun.id);
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeRun?.id, activeRun?.status, loadRuns, fetchRunResults]);

  const handleSelectRunFromHistory = (runId: number) => {
    const runToLoad = continuousRuns.find(r => r.id === runId);
    if (runToLoad) {
      setActiveRun(runToLoad);
    }
  };

  const handleCreateContinuousRun = useCallback(async (config: ContinuousRunConfig) => {
    if (!activeInfospace?.id) {
      toast.error("An active infospace is required.");
      return;
    }

    try {
      const runCreatePayload: AnnotationRunCreate = {
        name: config.name,
        description: config.description,
        schema_ids: config.schemaIds,
        source_bundle_id: config.bundleId, // NEW: Use source_bundle_id instead of target_asset_ids
        target_bundle_id: config.targetBundleId,
        configuration: {
          ...config.configuration,
          poll_interval_seconds: config.pollIntervalSeconds || 300,
          promote_fragments: config.promoteFragments,
        },
        trigger_type: "monitor", // Mark as monitor-triggered
      };

      const newRun = await createRun({
        name: config.name,
        description: config.description,
        schemaIds: config.schemaIds,
        bundleId: config.targetBundleId, // Target bundle for routing
        sourceBundleId: config.bundleId, // Source bundle to monitor
        assetIds: [], // Empty for continuous runs
        configuration: runCreatePayload.configuration || {},
      });

      if (newRun) {
        setActiveRun(newRun);
        toast.success(`Continuous run "${newRun.name}" created successfully.`);
      }
    } catch (e: any) {
      toast.error("Failed to create continuous run.", { description: e.body?.detail || e.message });
    }
  }, [activeInfospace?.id, createRun, setActiveRun]);

  const clearActiveRun = () => {
    setActiveRun(null);
  };

  const retrySingleResultWithRefresh = useCallback(async (resultId: number, customPrompt?: string) => {
    const result = await retrySingleResult(resultId, customPrompt);
    if (result && activeRun?.id) {
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

  const isProcessing = isLoadingResults || activeRun?.status === 'running' || activeRun?.status === 'pending';
  const isContinuousRun = activeRun && (activeRun as any).source_bundle_id != null;
  const sourceBundleId = activeRun ? (activeRun as any).source_bundle_id : null;
  const runSchemaIds = activeRun?.schema_ids || undefined; // Extract schema IDs from run
  
  // Find all continuous runs that monitor the same bundle with the same schemas
  // This allows us to aggregate annotations across multiple runs
  const allRelevantRunIds = useMemo(() => {
    if (!activeRun || !sourceBundleId || !runSchemaIds) return [];
    
    // Find all runs that:
    // 1. Monitor the same bundle (source_bundle_id matches)
    // 2. Use the same schemas (schema_ids match)
    const relevantRuns = continuousRuns.filter(run => {
      const runSourceBundleId = (run as any).source_bundle_id;
      const runSchemaIdsArray = run.schema_ids || [];
      
      // Check bundle match
      if (runSourceBundleId !== sourceBundleId) return false;
      
      // Check schema match (same set of schema IDs)
      const activeSchemaSet = new Set(runSchemaIds);
      const runSchemaSet = new Set(runSchemaIdsArray);
      if (activeSchemaSet.size !== runSchemaSet.size) return false;
      for (const id of activeSchemaSet) {
        if (!runSchemaSet.has(id)) return false;
      }
      
      return true;
    });
    
    // Return run IDs sorted by creation date (newest first)
    return relevantRuns
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map(r => r.id);
  }, [activeRun, sourceBundleId, runSchemaIds, continuousRuns]);
  
  const handleResultSelect = useCallback((result: FormattedAnnotation) => {
    // Open result detail view (could integrate with AnnotationRunner's detail view)
    console.log('Selected result:', result);
  }, []);
  
  const handleTriggerAnnotation = useCallback(async (assetIds: number[]) => {
    // Note: assetIds parameter is kept for API compatibility but not used for continuous runs
    // Continuous runs process all assets in the source bundle automatically
    if (!activeRun || !activeInfospace?.id) {
      toast.error("Cannot trigger annotation: missing run or infospace");
      return;
    }
    
    // Check if run is already processing - don't create duplicate runs
    if (activeRun.status === 'running' || activeRun.status === 'pending') {
      toast.info("Run is already processing. Please wait for it to complete.");
      return;
    }
    
    // For continuous runs, we should re-trigger the existing run, not create a new one
    // However, if the run is completed, we can't easily re-trigger it
    // So we'll create a new continuous run with the same configuration to continue monitoring
    const isContinuousRun = (activeRun as any).source_bundle_id != null;
    
    if (isContinuousRun) {
      // For continuous runs, only create a new run if the current one is completed
      // This prevents creating multiple runs for the same bundle unnecessarily
      // The backend delta tracking will ensure only unannotated assets are processed
      if (activeRun.status === 'completed' || activeRun.status === 'completed_with_errors' || activeRun.status === 'failed') {
        try {
          const newRun = await createRun({
            name: activeRun.name, // Keep the same name to maintain continuity
            description: activeRun.description || `Continuous monitoring for bundle ${(activeRun as any).source_bundle_id}`,
            schemaIds: activeRun.schema_ids || [],
            assetIds: [], // Empty for continuous runs - backend will use delta tracking to process only new assets
            bundleId: (activeRun as any).target_bundle_id || null,
            sourceBundleId: (activeRun as any).source_bundle_id, // Keep it continuous
            configuration: activeRun.configuration || {},
            triggerType: "monitor",
          });
          
          if (newRun) {
            // Reload runs to get the latest status and ensure the new run is in the list
            await loadRuns();
            // The newRun from createRun should already be the latest, but refresh to be sure
            setActiveRun(newRun); // Switch to the new continuous run to maintain dashboard continuity
            toast.success(`Continuous monitoring resumed - processing new assets`);
          }
        } catch (e: any) {
          toast.error("Failed to resume continuous monitoring.", { description: e.body?.detail || e.message });
          throw e;
        }
      } else {
        toast.info("Run is still active. No need to create a new one.");
      }
    } else {
      // For non-continuous runs, create a one-off run for the specific assets
      try {
        const newRun = await createRun({
          name: `${activeRun.name} - Manual Trigger (${new Date().toLocaleTimeString()})`,
          description: `Manual trigger for ${assetIds.length} asset(s)`,
          schemaIds: activeRun.schema_ids || [],
          assetIds: assetIds,
          bundleId: (activeRun as any).target_bundle_id || null,
          sourceBundleId: null,
          configuration: activeRun.configuration || {},
          triggerType: "manual",
        });
        
        if (newRun) {
          toast.success(`Annotation triggered for ${assetIds.length} asset(s)`);
        }
      } catch (e: any) {
        toast.error("Failed to trigger annotation.", { description: e.body?.detail || e.message });
        throw e;
      }
    }
  }, [activeRun, activeInfospace?.id, createRun, setActiveRun]);
  
  return (
    <AssetDetailProvider annotationResults={runResults} schemas={schemas}>
      <div className="flex flex-col h-full overflow-auto relative">
        <div className="flex-1 relative z-10">
          {activeRun && isContinuousRun ? (
            // Use live monitoring view for continuous runs
            <Tabs defaultValue="live" className="h-full flex flex-col">
              <TabsList className="mx-4 mt-4">
                <TabsTrigger value="live">Live View</TabsTrigger>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              </TabsList>
              <TabsContent value="live" className="flex-1 mt-0">
                <MonitoringLiveResultsTable
                  runId={activeRun.id}
                  sourceBundleId={sourceBundleId}
                  schemas={schemas}
                  runSchemaIds={runSchemaIds}
                  allContinuousRunIds={allRelevantRunIds}
                  onResultSelect={handleResultSelect}
                  pollIntervalMs={10000}
                  onTriggerAnnotation={handleTriggerAnnotation}
                />
              </TabsContent>
              <TabsContent value="dashboard" className="flex-1 mt-0">
                <AnnotationRunner
                  allRuns={continuousRuns}
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
              </TabsContent>
            </Tabs>
          ) : (
            // Use standard view for non-continuous runs or no active run
            <AnnotationRunner
              allRuns={continuousRuns}
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
          )}
          {runError && <p className="text-red-500 mt-4 text-center">{runError}</p>}
        </div>
        
        <MonitoringDock 
          allSchemes={schemas}
          allRuns={runs}
          onCreateContinuousRun={handleCreateContinuousRun}
          onSelectRun={handleSelectRunFromHistory}
          activeRunId={activeRun?.id || null}
          isCreatingRun={isCreatingRun}
          onClearRun={clearActiveRun}
        />
      </div>
    </AssetDetailProvider>
  );
}

