'use client';

import { useState, useCallback, useEffect } from 'react';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import { 
    AnnotationRun,
    AnnotationRunParams,
    AnnotationRunStatus,
    AnnotationSchema,
    FormattedAnnotation, 
    AnnotationSchemaFormData
} from '@/lib/annotations/types';

// Placeholder Types for client models until regenerated
type AnnotationRunRead = any;
type AnnotationRunUpdate = any;
type AnnotationSchemaRead = any;
type AnnotationSchemaCreate = any;
type AnnotationSchemaUpdate = any;
type DataSourceRead = any;
type AssetRead = any;
type AnnotationRead = any;

// --- Placeholder Services ---
const AnnotationSchemasService = {
    listAnnotationSchemas: async (p: any): Promise<AnnotationSchemaRead[]> => { console.log("Placeholder: listAnnotationSchemas"); return []; },
    createAnnotationSchema: async (p: any): Promise<AnnotationSchemaRead> => { console.log("Placeholder: createAnnotationSchema"); return {}; },
    updateAnnotationSchema: async (p: any): Promise<AnnotationSchemaRead> => { console.log("Placeholder: updateAnnotationSchema"); return {}; },
    deleteAnnotationSchema: async (p: any): Promise<void> => { console.log("Placeholder: deleteAnnotationSchema"); },
};
const AnnotationRunsService = {
    getRun: async (p: any): Promise<AnnotationRunRead> => { console.log("Placeholder: getAnnotationRun"); return {}; },
    createRun: async (p: any): Promise<AnnotationRunRead> => { console.log("Placeholder: createAnnotationRun"); return {id: Math.random(), name: p.requestBody.name, status: 'pending', created_at: new Date().toISOString()}; },
    retryFailedAnnotations: async (p: any): Promise<void> => { console.log("Placeholder: retryFailedRunAnnotations"); },
    listRuns: async (p: any): Promise<{data: AnnotationRunRead[]}> => {console.log("Placeholder: listRuns"); return {data:[]};},
    deleteRun: async (p: any): Promise<void> => {console.log("Placeholder: deleteRun");},
    updateRun: async (p: any): Promise<AnnotationRunRead> => { console.log("Placeholder: updateRun"); return {}; },
};
const AnnotationsService = {
    listAnnotations: async (p: any): Promise<AnnotationRead[]> => { console.log("Placeholder: listAnnotations"); return []; },
    retrySingleAnnotationResult: async (p: any): Promise<AnnotationRead> => { console.log("Placeholder: retrySingleAnnotationResult"); return {}; },
};
const SourcesService = {
    listSources: async (p: any): Promise<DataSourceRead[]> => { console.log("Placeholder: listSources"); return []; },
};
const AssetsService = {
    listAssets: async (p: any): Promise<AssetRead[]> => { console.log("Placeholder: listAssets"); return []; },
};
// --- End Placeholder Services ---

export function useAnnotationSystem({ autoLoadRuns = false } = {}) {
  const { activeInfospace } = useInfospaceStore();
  const [runs, setRuns] = useState<AnnotationRunRead[]>([]);
  const [activeRun, setActiveRun] = useState<AnnotationRunRead | null>(null);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [isRetryingRun, setIsRetryingRun] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<AnnotationSchemaRead[]>([]);
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);
  const [isRetryingResultId, setIsRetryingResultId] = useState<number|null>(null);

  const loadSchemas = useCallback(async (force = false) => {
    if (!activeInfospace?.id) return;
    setIsLoadingSchemas(true);
    try {
      const response = await AnnotationSchemasService.listAnnotationSchemas({infospaceId: activeInfospace.id});
      setSchemas(response); // Assuming response is the array of schemas now
    } catch(e: any) {
      toast.error("Failed to load schemas.", { description: e.body?.detail || e.message });
      setError(e.body?.detail || e.message);
    } finally {
      setIsLoadingSchemas(false);
    }
  }, [activeInfospace]);

  const createSchema = useCallback(async (formData: AnnotationSchemaFormData) => {
    if (!activeInfospace?.id) return null;
    try {
      const newSchema = await AnnotationSchemasService.createAnnotationSchema({infospaceId: activeInfospace.id, requestBody: formData });
      setSchemas(prev => [newSchema, ...prev]);
      toast.success("Schema created successfully.");
      return newSchema;
    } catch (e: any) {
        toast.error("Failed to create schema.", { description: e.body?.detail || e.message });
        return null;
    }
  }, [activeInfospace]);

  const deleteSchema = useCallback(async (schemaId: number) => {
    if (!activeInfospace?.id) return;
    try {
      await AnnotationSchemasService.deleteAnnotationSchema({infospaceId: activeInfospace.id, schemaId});
      setSchemas(p => p.filter(s => s.id !== schemaId)); 
    } catch (e: any) {
       toast.error(`Failed to delete schema ${schemaId}.`, { description: e.body?.detail || e.message });
       throw e; // re-throw for component to handle
    }
  }, [activeInfospace]);

  const createRun = useCallback(async (params: AnnotationRunParams): Promise<AnnotationRunRead | null> => {
    if (!activeInfospace?.id) {
        toast.error("An active infospace is required to create a run.");
        return null;
    }
    setIsCreatingRun(true);
    try {
        const newRun = await AnnotationRunsService.createRun({
            infospaceId: activeInfospace.id,
            requestBody: {
                name: params.name,
                schema_ids: params.schemaIds,
                target_asset_ids: params.assetIds,
                configuration: {},
            }
        });
        toast.success(`Run "${newRun.name}" created successfully.`);
        setRuns(prev => [newRun, ...prev]);
        setActiveRun(newRun);
        return newRun;
    } catch (e: any) {
        toast.error("Failed to create run.", { description: e.message });
        return null;
    } finally {
        setIsCreatingRun(false);
    }
  }, [activeInfospace]);
  
  const loadRuns = useCallback(async () => { setIsLoadingRuns(true); await new Promise(r => setTimeout(r, 500)); setIsLoadingRuns(false); }, []);
  const deleteRun = useCallback(async (runId: number) => { setRuns(p => p.filter(r => r.id !== runId)); toast.success(`Run ${runId} deleted.`); }, []);
  const loadRun = useCallback(async (runId: number) => { const run = runs.find(r=>r.id === runId); if(run) setActiveRun(run); }, [runs]);
  
  const retryJobFailures = useCallback(async (runId: number) => { 
    if (!activeInfospace?.id) return;
    setIsRetryingRun(true);
    try {
      await AnnotationRunsService.retryFailedAnnotations({infospaceId: activeInfospace.id, runId});
      toast.info(`Retrying failures for run ${runId}`); 
      // loadRun(runId);
    } catch (e: any) {
      toast.error(`Failed to retry run ${runId}.`, { description: e.body?.detail || e.message });
    } finally {
      setIsRetryingRun(false);
    }
  }, [activeInfospace]);
  
  const retrySingleResult = useCallback(async (resultId: number) => {
      if (!activeInfospace?.id) return null;
      setIsRetryingResultId(resultId);
      try {
        const result = await AnnotationsService.retrySingleAnnotationResult({infospaceId: activeInfospace.id, annotationId: resultId});
        toast.success("Annotation re-processed successfully.");
        return result;
      } catch(e: any) {
        toast.error("Failed to retry annotation.", { description: e.body?.detail || e.message });
        return null;
      } finally {
        setIsRetryingResultId(null);
      }
  }, [activeInfospace]);

  const updateJob = useCallback(async (jobId: number, data: AnnotationRunUpdate) => {
    if(!activeInfospace?.id) return null;
    try {
      const updatedRun = await AnnotationRunsService.updateRun({ infospaceId: activeInfospace.id, runId: jobId, requestBody: data });
      setRuns(prev => prev.map(r => r.id === jobId ? updatedRun : r));
      if (activeRun?.id === jobId) {
        setActiveRun(updatedRun);
      }
      toast.success("Run updated successfully.");
      return updatedRun;
    } catch (e: any) {
      toast.error("Failed to update run.", { description: e.body?.detail || e.message });
      return null;
    }
  }, [activeInfospace, activeRun]);

  return {
    createRun,
    runs,
    loadRuns,
    deleteRun,
    activeRun,
    setActiveRun,
    loadRun,
    isLoadingRuns,
    isCreatingRun,
    isAnnotating,
    retryJobFailures,
    isRetryingRun,
    error,
    schemas,
    isLoadingSchemas,
    loadSchemas,
    createSchema,
    deleteSchema,
    isRetryingResultId,
    retrySingleResult,
    // Aliases for compatibility with old components
    activeJob: activeRun,
    isClassifying: isAnnotating,
    isRetryingJob: isRetryingRun,
    loadJob: loadRun,
    updateJob
  };
}