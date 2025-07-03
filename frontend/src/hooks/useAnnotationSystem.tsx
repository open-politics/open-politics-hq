'use client';

import { useState, useCallback, useEffect } from 'react';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import { 
    AnnotationRunParams,
    AnnotationSchemaFormData
} from '@/lib/annotations/types';
import { adaptSchemaFormDataToSchemaCreate } from '@/lib/annotations/adapters';
import {
    AnnotationRunRead,
    AnnotationRunUpdate,
    AnnotationSchemaRead,
    AnnotationSchemaCreate,
    AnnotationSchemaUpdate,
    AssetRead,
    AnnotationRead,
    AnnotationRunCreate,
    Message
} from '@/client/models';
import {
    AnnotationSchemasService,
    AnnotationJobsService,
    AnnotationsService,
    AssetsService,
} from '@/client/services';

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

  const loadSchemas = useCallback(async (options: { force?: boolean; includeArchived?: boolean } = {}) => {
    if (!activeInfospace?.id) return;
    
    const { force = false, includeArchived = false } = options;

    setIsLoadingSchemas(true);
    try {
      const response = await AnnotationSchemasService.listAnnotationSchemas({
        infospaceId: activeInfospace.id, 
        limit: 1000,
        includeArchived: includeArchived,
      });
      setSchemas(response.data);
    } catch(e: any) {
      toast.error("Failed to load schemas.", { description: e.body?.detail || e.message });
      setError(e.body?.detail || e.message);
    } finally {
      setIsLoadingSchemas(false);
    }
  }, [activeInfospace]);

  const createSchema = useCallback(async (formData: AnnotationSchemaFormData): Promise<AnnotationSchemaRead | null> => {
    if (!activeInfospace?.id) return null;
    try {
      const requestBody: AnnotationSchemaCreate = adaptSchemaFormDataToSchemaCreate(formData);
      const newSchema = await AnnotationSchemasService.createAnnotationSchema({infospaceId: activeInfospace.id, requestBody });
      setSchemas(prev => [newSchema, ...prev]);
      toast.success("Schema created successfully.");
      return newSchema;
    } catch (e: any) {
        toast.error("Failed to create schema.", { description: e.body?.detail || e.message });
        return null;
    }
  }, [activeInfospace]);

  const archiveSchema = useCallback(async (schemaId: number) => {
    if (!activeInfospace?.id) return;
    try {
      await AnnotationSchemasService.deleteAnnotationSchema({infospaceId: activeInfospace.id, schemaId});
      setSchemas(p => p.map(s => s.id === schemaId ? { ...s, is_active: false } : s)); 
      toast.success("Schema archived successfully.");
    } catch (e: any) {
       toast.error(`Failed to archive schema ${schemaId}.`, { description: e.body?.detail || e.message });
       throw e; // re-throw for component to handle
    }
  }, [activeInfospace]);

  const restoreSchema = useCallback(async (schemaId: number) => {
    if (!activeInfospace?.id) return;
    try {
      const restoredSchema = await AnnotationSchemasService.restoreAnnotationSchema({infospaceId: activeInfospace.id, schemaId: schemaId});
      setSchemas(p => p.map(s => s.id === schemaId ? restoredSchema : s));
      toast.success("Schema restored successfully.");
    } catch (e: any) {
       toast.error(`Failed to restore schema ${schemaId}.`, { description: e.body?.detail || e.message });
       throw e;
    }
  }, [activeInfospace]);

  const updateScheme = useCallback(async (schemeId: number, data: AnnotationSchemaUpdate): Promise<AnnotationSchemaRead | null> => {
    if (!activeInfospace?.id) {
        toast.error("An active infospace is required to update a schema.");
        return null;
    }
    try {
        const updatedSchema = await AnnotationSchemasService.updateAnnotationSchema({
            infospaceId: activeInfospace.id,
            schemaId: schemeId,
            requestBody: data,
        });
        setSchemas(prev => prev.map(s => s.id === schemeId ? updatedSchema : s));
        toast.success("Schema updated successfully.");
        return updatedSchema;
    } catch (e: any) {
        toast.error("Failed to update schema.", { description: e.body?.detail || e.message });
        return null;
    }
  }, [activeInfospace]);

  const createRun = useCallback(async (params: AnnotationRunParams): Promise<AnnotationRunRead | null> => {
    if (!activeInfospace?.id) {
        toast.error("An active infospace is required to create a run.");
        return null;
    }
    setIsCreatingRun(true);
    try {
        const runCreatePayload: AnnotationRunCreate = {
            name: params.name,
            description: params.description,
            schema_ids: params.schemaIds,
            target_asset_ids: params.assetIds,
            target_bundle_id: params.bundleId,
            configuration: params.configuration || {},
        };

        const newRun = await AnnotationJobsService.createRun({
            infospaceId: activeInfospace.id,
            requestBody: runCreatePayload
        });
        toast.success(`Run "${newRun.name}" created successfully and is now processing.`);
        setRuns(prev => [newRun, ...prev]);
        setActiveRun(newRun);
        return newRun;
    } catch (e: any) {
        toast.error("Failed to create run.", { description: e.body?.detail || e.message });
        return null;
    } finally {
        setIsCreatingRun(false);
    }
  }, [activeInfospace]);
  
  const loadRuns = useCallback(async () => {
    if (!activeInfospace?.id) return;
    setIsLoadingRuns(true);
    try {
      const response = await AnnotationJobsService.listRuns({infospaceId: activeInfospace.id, limit: 1000 });
      setRuns(response.data);
    } catch (e: any) {
      toast.error("Failed to load runs.", { description: e.body?.detail || e.message });
      setError(e.body?.detail || e.message);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [activeInfospace]);

  const deleteRun = useCallback(async (runId: number) => {
    if (!activeInfospace?.id) return;
    try {
      await AnnotationJobsService.deleteRun({infospaceId: activeInfospace.id, runId: runId});
      setRuns(p => p.filter(r => r.id !== runId));
      if (activeRun?.id === runId) {
        setActiveRun(null);
      }
      toast.success(`Run ${runId} deleted.`);
    } catch (e: any) {
       toast.error(`Failed to delete run ${runId}.`, { description: e.body?.detail || e.message });
       throw e; // re-throw for component to handle
    }
  }, [activeInfospace, activeRun?.id]);

  const loadRun = useCallback(async (runId: number) => {
    if (!activeInfospace?.id) return;
    const run = runs.find(r => r.id === runId);
    if (run) {
      setActiveRun(run);
    } else {
      try {
        const fetchedRun = await AnnotationJobsService.getRun({infospaceId: activeInfospace.id, runId: runId});
        setActiveRun(fetchedRun);
      } catch (e: any) {
        toast.error(`Failed to load run ${runId}.`, { description: e.body?.detail || e.message });
      }
    }
  }, [runs, activeInfospace]);
  
  const retryJobFailures = useCallback(async (runId: number): Promise<Message | null> => { 
    if (!activeInfospace?.id) return null;
    setIsRetryingRun(true);
    try {
      const response = await AnnotationJobsService.retryFailedAnnotations({infospaceId: activeInfospace.id, runId: runId});
      toast.info(`Retrying failures for run ${runId}`);
      // After triggering, we should probably poll or refresh the run details
      loadRun(runId);
      return response;
    } catch (e: any) {
      toast.error(`Failed to retry run ${runId}.`, { description: e.body?.detail || e.message });
      return null;
    } finally {
      setIsRetryingRun(false);
    }
  }, [activeInfospace, loadRun]);
  
  const retrySingleResult = useCallback(async (resultId: number): Promise<AnnotationRead | null> => {
      if (!activeInfospace?.id) return null;
      setIsRetryingResultId(resultId);
      try {
        const result = await AnnotationsService.retrySingleAnnotation({infospaceId: activeInfospace.id, annotationId: resultId});
        toast.success("Annotation re-processed successfully.");
        return result;
      } catch(e: any) {
        toast.error("Failed to retry annotation.", { description: e.body?.detail || e.message });
        return null;
      } finally {
        setIsRetryingResultId(null);
      }
  }, [activeInfospace]);

  const updateJob = useCallback(async (jobId: number, data: AnnotationRunUpdate): Promise<AnnotationRunRead | null> => {
    if(!activeInfospace?.id) return null;
    try {
      const updatedRun = await AnnotationJobsService.updateRun({ infospaceId: activeInfospace.id, runId: jobId, requestBody: data });
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

  useEffect(() => {
    if (autoLoadRuns && activeInfospace?.id) {
        loadRuns();
    }
  }, [autoLoadRuns, activeInfospace, loadRuns]);

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
    archiveSchema,
    restoreSchema,
    updateScheme,
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