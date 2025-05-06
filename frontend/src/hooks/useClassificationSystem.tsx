import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import { useToast } from '@/components/ui/use-toast';
import { toast as sonnerToast } from 'sonner';
import { useDataSourceStore } from '@/zustand_stores/storeDataSources';
import { useClassificationJobsStore, useClassificationJobsActions } from '@/zustand_stores/storeClassificationJobs';
import {
  ClassificationSchemeRead,
  ClassificationSchemeCreate,
  ClassificationSchemeUpdate,
  ClassificationJobRead,
  ClassificationJobCreate,
  ClassificationJobUpdate,
  DataSourceRead,
  EnhancedClassificationResultRead,
  ClassificationJobStatus as ClassificationJobStatusType,
  WorkspaceRead,
  DataRecordRead,
} from '@/client/models';
import { FormattedClassificationResult, SchemeFormData, ClassificationJobParams, ClassificationScheme } from '@/lib/classification/types';
import { useClassificationSettingsStore } from '@/zustand_stores/storeClassificationSettings';
import {
  ClassificationSchemesService,
  ClassificationJobsService,
  ClassificationResultsService,
  DatasourcesService,
  DatarecordsService,
} from '@/client/services';
import {
  adaptEnhancedResultReadToFormattedResult,
  adaptSchemeReadToSchemeFormData,
  adaptSchemeFormDataToSchemeCreate,
  adaptSchemeReadToScheme,
} from '@/lib/classification/adapters';
import { AxiosError } from 'axios';
import { shallow } from 'zustand/shallow';

// Global cache for schemes to prevent redundant API calls
const schemesCache = new Map<number, {
  timestamp: number;
  schemes: ClassificationSchemeRead[];
}>();

// Cache expiration time (5 minutes)
const SCHEMES_CACHE_EXPIRATION = 5 * 60 * 1000;

// Define the options for the hook
interface UseClassificationSystemOptions {
  autoLoadSchemes?: boolean;
  autoLoadDataSources?: boolean;
  autoLoadJobs?: boolean;
  dataSourceId?: number;
  jobId?: number;
  useCache?: boolean;
}

// Define the return type for the hook
interface UseClassificationSystemResult {
  // Schemes
  schemes: ClassificationSchemeRead[];
  isLoadingSchemes: boolean;
  loadSchemes: (forceRefresh?: boolean) => Promise<void>;
  createScheme: (schemeData: SchemeFormData) => Promise<ClassificationSchemeRead | null>;
  updateScheme: (schemeId: number, schemeData: SchemeFormData) => Promise<ClassificationSchemeRead | null>;
  deleteScheme: (schemeId: number) => Promise<boolean>;

  // DataSources
  dataSources: DataSourceRead[];
  selectedDataSource: DataSourceRead | null;
  isLoadingDataSources: boolean;
  loadDataSources: () => Promise<void>;
  loadDataSource: (dataSourceId: number) => Promise<DataSourceRead | null>;
  setSelectedDataSource: (dataSource: DataSourceRead | null) => void;

  // Results
  results: FormattedClassificationResult[];
  isLoadingResults: boolean;
  loadResults: (options?: { datarecordId?: number; schemeId?: number; jobId?: number; useCache?: boolean }) => Promise<void>;
  loadResultsByJob: (jobId: number, workspaceId?: number) => Promise<FormattedClassificationResult[]>;
  clearResultsCache: (key: string) => void;
  loadResultsByScheme: (schemeId: number) => Promise<FormattedClassificationResult[]>;

  // Classification
  isClassifying: boolean;
  startClassificationJob: (jobId: number) => Promise<boolean>;
  pollJobStatus: (jobId: number, workspaceId: number) => void;

  // Jobs
  jobs: ClassificationJobRead[];
  activeJob: ClassificationJobRead | null;
  activeJobDataRecords: DataRecordRead[];
  isLoadingJobs: boolean;
  isCreatingJob: boolean;
  loadJobs: () => Promise<void>;
  loadJob: (jobId: number) => Promise<void>;
  createJob: (params: ClassificationJobParams) => Promise<ClassificationJobRead | null>;
  setActiveJob: (job: ClassificationJobRead | null) => void;
  updateJob: (jobId: number, data: ClassificationJobUpdate) => Promise<ClassificationJobRead | null>;
  deleteJob: (jobId: number) => Promise<boolean>;

  // Default scheme management
  getDefaultSchemeId: () => number | null;
  setDefaultSchemeId: (schemeId: number) => void;

  // Error handling
  error: string | null;
  setError: (error: string | null) => void;

  // Classification Progress State
  classificationProgress: { current: number; total: number } | null;

  // *** ADD isLoadingJobData to the interface ***
  isLoadingJobData: boolean;

  // --- NEW: Retry Exports ---
  isRetryingJob: boolean; // Derived state for general job retry loading
  isRetryingResultId: number | null; // Expose the specific result ID being retried
  retryJobFailures: (jobId: number) => Promise<boolean>;
  retrySingleResult: (resultId: number) => Promise<EnhancedClassificationResultRead | null>;
  // --- END NEW ---
}

// Define enum values as constants for comparison
const ClassificationJobStatus = {
  PENDING: 'pending' as ClassificationJobStatusType,
  RUNNING: 'running' as ClassificationJobStatusType,
  PAUSED: 'paused' as ClassificationJobStatusType,
  COMPLETED: 'completed' as ClassificationJobStatusType,
  COMPLETED_WITH_ERRORS: 'completed_with_errors' as ClassificationJobStatusType,
  FAILED: 'failed' as ClassificationJobStatusType,
};

/**
 * A consolidated hook for all classification operations
 */
export function useClassificationSystem(options: UseClassificationSystemOptions = {}): UseClassificationSystemResult {
  const { activeWorkspace } = useWorkspaceStore();
  const { apiKeys, selectedProvider, selectedModel } = useApiKeysStore();
  const {
    dataSources,
    fetchDataSources: loadStoreDataSources,
    isLoading: isLoadingDataSourcesStore,
  } = useDataSourceStore();
  const {
    classificationJobs,
    isLoading: isLoadingJobsStore,
    error: jobsError,
  } = useClassificationJobsStore();
  const {
    fetchClassificationJobs: loadStoreJobs,
    addClassificationJob: createStoreJob,
    updateClassificationJob: updateStoreJob,
    deleteClassificationJob: deleteStoreJob,
    getClassificationJobById: getJobById,
  } = useClassificationJobsActions();
  const { toast } = useToast();
  const classificationSettings = useClassificationSettingsStore();

  // State for schemes
  const [schemes, setSchemes] = useState<ClassificationSchemeRead[]>([]);
  const [isLoadingSchemes, setIsLoadingSchemes] = useState(false);

  // State for DataSources
  const [selectedDataSource, setSelectedDataSourceState] = useState<DataSourceRead | null>(null);

  // State for Jobs
  const [activeJobState, setActiveJobState] = useState<ClassificationJobRead | null>(null);
  const [isLoadingJobsState, setIsLoadingJobsState] = useState(false);
  const [isLoadingJobDataState, setIsLoadingJobDataState] = useState(false);
  const [activeJobDataRecords, setActiveJobDataRecords] = useState<DataRecordRead[]>([]);

  // State for results
  const [results, setResults] = useState<FormattedClassificationResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);

  // State for operations
  const [isClassifyingState, setIsClassifyingState] = useState(false);
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- NEW: Retry Loading States ---
  const [isRetryingJobId, setIsRetryingJobId] = useState<number | null>(null);
  const [retryingResultId, setRetryingResultId] = useState<number | null>(null);
  // --- END NEW ---

  // Classification Progress State
  const [classificationProgress, setClassificationProgress] = useState<{ current: number; total: number } | null>(null);

  // Polling state
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activePollingJobIdRef = useRef<number | null>(null);

  // Get workspace ID as a number
  const getWorkspaceId = useCallback(() => {
    if (!activeWorkspace?.id) {
      throw new Error('No active workspace');
    }

    return activeWorkspace.id;
  }, [activeWorkspace?.id]);

  // --- Polling Logic ---
  // *** Declare stopPolling BEFORE pollJobStatus ***
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      activePollingJobIdRef.current = null;
      setIsClassifyingState(false);
      console.log("[Polling] Polling stopped.");
    }
  }, []); // Empty dependency array as it doesn't depend on component state

  // *** Declare loadResultsByJob BEFORE pollJobStatus ***
  const loadResultsByJob = useCallback(async (jobId: number, workspaceId?: number): Promise<FormattedClassificationResult[]> => {
    const targetWorkspaceId = workspaceId ?? activeWorkspace?.id;
    if (!targetWorkspaceId) {
      setError("Workspace ID needed to load job results.");
      return [];
    }
    setIsLoadingResults(true);
    setError(null);
    try {
      const apiResults: EnhancedClassificationResultRead[] = await ClassificationResultsService.listClassificationResults({
        workspaceId: targetWorkspaceId,
        jobId,
        limit: 5000
      });
      const formatted = apiResults.map(adaptEnhancedResultReadToFormattedResult);
      setResults(formatted); // Update main results state
      return formatted;
    } catch (err: any) {
      console.error(`Error loading results for job ${jobId}:`, err);
      const detail = err.body?.detail || 'Failed to load job results.';
      setError(detail);
      toast({ title: 'Error Loading Job Results', description: detail, variant: 'destructive' });
      return [];
    } finally {
      setIsLoadingResults(false);
    }
  }, [activeWorkspace?.id, toast, setError]); // Keep activeWorkspace?.id dependency, add setError

  const pollJobStatus = useCallback((jobId: number, workspaceId: number) => {
    // Prevent multiple polls
    if (pollingIntervalRef.current && activePollingJobIdRef.current === jobId) {
      console.log(`[Polling] Polling already active for job ${jobId}`);
      return;
    }

    // Stop any existing poll before starting a new one
    stopPolling(); // Now declared above

    console.log(`[Polling] Starting polling for job ${jobId} in workspace ${workspaceId}...`);
    activePollingJobIdRef.current = jobId;
    setIsClassifyingState(true); // Indicate polling is active

    const poll = async () => {
      try {
        console.log(`[Polling] Fetching status for job ${jobId}...`);
        // Use getClassificationJob from the service to get the latest status
        const currentJob = await ClassificationJobsService.getClassificationJob({ workspaceId, jobId });

        // Update job in the zustand store AND local activeJobState
        updateStoreJob(workspaceId, jobId, currentJob);
        setActiveJobState(currentJob); // Keep local state in sync

        // Check status and stop polling if terminal state reached
        const status = currentJob.status; // Use local variable for comparison
        if (status === 'completed' || status === 'failed' || status === 'completed_with_errors')
        {
          console.log(`[Polling] Job ${jobId} reached terminal state: ${status}. Stopping poll.`);
          stopPolling();
          // Load results for completed jobs
          if (status === 'completed' || status === 'completed_with_errors') {
             await loadResultsByJob(jobId, workspaceId);
          }
          // Show toast based on final status
          if (status === 'completed') {
            sonnerToast.success(`Job "${currentJob.name}" completed successfully.`);
          } else if (status === 'failed') {
            sonnerToast.error(`Job "${currentJob.name}" failed.`, { description: currentJob.error_message });
          } else if (status === 'completed_with_errors') {
            sonnerToast.warning(`Job "${currentJob.name}" completed with errors.`, { description: currentJob.error_message || "Some classifications may have failed." });
          }
        } else {
          console.log(`[Polling] Job ${jobId} status is ${status}. Continuing poll...`);
        }
      } catch (err: any) {
        console.error(`[Polling] Error polling job ${jobId}:`, err);
        const detail = err.body?.detail || err.message || 'Polling failed';
        setError(detail); // Set error state
        // Stop polling on error to prevent repeated failures
        stopPolling();
        sonnerToast.error('Polling Error', { description: `Could not fetch job status: ${detail}` });
      }
    };

    // Initial poll immediately, then set interval
    poll();
    pollingIntervalRef.current = setInterval(poll, 5000); // Poll every 5 seconds

  }, [stopPolling, updateStoreJob, sonnerToast, loadResultsByJob, setError]); // Add setError to dependencies

  // Ensure polling stops on unmount or workspace change
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling, activeWorkspace?.id]);
  // --- End Polling Logic ---

  // Load classification schemes
  const loadSchemes = useCallback(async (forceRefresh = false) => {
    if (!activeWorkspace?.id) return;

    const workspaceId = getWorkspaceId();

    // *** START EDIT: Add check for existing schemes in local state ***
    // If not forcing refresh and schemes for this workspace are already loaded, return early.
    if (!forceRefresh && schemes.length > 0) {
        // Optional: Add a check here to ensure the loaded schemes actually belong
        // to the current workspace if that becomes an issue, but for now,
        // assume the state is correctly tied to the activeWorkspace.
        // console.log('Schemes already loaded in state for workspace:', workspaceId);
        return;
    }
    // *** END EDIT ***

    // Cache check
    if (!forceRefresh && options.useCache !== false) {
      const cachedData = schemesCache.get(workspaceId);

      if (cachedData && (Date.now() - cachedData.timestamp < SCHEMES_CACHE_EXPIRATION)) {
        console.log('Using cached schemes for workspace:', workspaceId);
        setSchemes(cachedData.schemes);
        return;
      }
    }

    setIsLoadingSchemes(true);
    setError(null);

    try {
      const loadedSchemes = await ClassificationSchemesService.readClassificationSchemes({
        workspaceId,
        limit: 1000
      });
      setSchemes(loadedSchemes);

      // Cache the schemes for future use
      if (options.useCache !== false) {
        schemesCache.set(workspaceId, {
          timestamp: Date.now(),
          schemes: loadedSchemes
        });
      }
    } catch (err: any) {
      console.error('Error loading schemes:', err);
      const detail = err.body?.detail || 'Failed to load classification schemes';
      setError(detail);
      toast({ title: 'Error Loading Schemes', description: detail, variant: 'destructive' });
    } finally {
      setIsLoadingSchemes(false);
    }
  }, [activeWorkspace?.id, getWorkspaceId, toast, options.useCache, schemes]);

  // Clear schemes cache
  const clearSchemesCache = useCallback((workspaceId?: number) => {
    const idToClear = workspaceId ?? activeWorkspace?.id;
    if (idToClear) {
      schemesCache.delete(idToClear);
    } else {
      schemesCache.clear();
    }
  }, [activeWorkspace?.id]);

  // Load DataSources
  const loadDataSources = useCallback(async () => {
    if (!activeWorkspace?.id) return;

    try {
      await loadStoreDataSources();
    } catch (err) {
      console.error("Error loading data sources via store:", err);
      setError("Failed to load data sources");
    }
  }, [activeWorkspace?.id, loadStoreDataSources]);

  // Load a specific DataSource
  const loadDataSource = useCallback(async (dataSourceId: number): Promise<DataSourceRead | null> => {
    const dataSource = dataSources.find(ds => ds.id === dataSourceId);
    if (dataSource) {
        setSelectedDataSourceState(dataSource);
        return dataSource;
    } else {
        console.warn(`DataSource ${dataSourceId} not found in store. Triggering store load.`);
        await loadDataSources();
        const reloadedDataSource = useDataSourceStore.getState().dataSources.find(ds => ds.id === dataSourceId);
        if(reloadedDataSource) {
            setSelectedDataSourceState(reloadedDataSource);
            return reloadedDataSource;
        } else {
            setError(`Data Source ${dataSourceId} not found.`);
            setSelectedDataSourceState(null);
            return null;
        }
    }
  }, [dataSources, loadDataSources]);

  // === Define all callback functions here ===

  const loadJobs = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setIsLoadingJobsState(true);
    setError(null);
    try {
      await loadStoreJobs(activeWorkspace.id);
    } catch (err: any) {
      console.error('Error loading classification jobs:', err);
      setError('Failed to load classification jobs');
    } finally {
      setIsLoadingJobsState(false);
    }
  }, [activeWorkspace?.id, loadStoreJobs]);

  const createScheme = useCallback(async (schemeData: SchemeFormData): Promise<ClassificationSchemeRead | null> => {
    if (!activeWorkspace?.id) {
      setError('No active workspace selected');
      return null;
    }
    setIsLoadingSchemes(true);
    setError(null);
    try {
      const workspaceId = getWorkspaceId();
      const apiData: ClassificationSchemeCreate = adaptSchemeFormDataToSchemeCreate(schemeData);
      const newScheme = await ClassificationSchemesService.createClassificationScheme({
        workspaceId,
        requestBody: apiData,
      });
      setSchemes((prev) => [...prev, newScheme]);
      clearSchemesCache(workspaceId);
      sonnerToast.success(`Scheme \"${newScheme.name}\" created.`);
      return newScheme;
    } catch (err: any) {
      console.error('Error creating scheme:', err);
      const errorMsg = err.body?.detail || 'Failed to create scheme';
      setError(errorMsg);
      sonnerToast.error('Error Creating Scheme', { description: errorMsg });
      return null;
    } finally {
      setIsLoadingSchemes(false);
    }
  }, [activeWorkspace?.id, getWorkspaceId, sonnerToast, clearSchemesCache]);

  const updateScheme = useCallback(async (schemeId: number, schemeData: SchemeFormData): Promise<ClassificationSchemeRead | null> => {
    if (!activeWorkspace?.id) {
      setError('No active workspace selected');
      return null;
    }
    setIsLoadingSchemes(true);
    setError(null);
    try {
      const workspaceId = getWorkspaceId();
      // Adapt the form data to the format expected by the API update endpoint
      const apiData: ClassificationSchemeUpdate = adaptSchemeFormDataToSchemeCreate(schemeData); // Still using create adapter, but target type is now ClassificationSchemeUpdate
      const updatedScheme = await ClassificationSchemesService.updateClassificationScheme({
        workspaceId,
        schemeId,
        requestBody: apiData, // Send the adapted data
      });
      setSchemes((prev) => prev.map(s => s.id === schemeId ? updatedScheme : s));
      clearSchemesCache(workspaceId);
      sonnerToast.success(`Scheme \"${updatedScheme.name}\" updated.`);
      return updatedScheme;
    } catch (err: any) {
      console.error(`Error updating scheme ${schemeId}:`, err);
      const errorMsg = err.body?.detail || 'Failed to update scheme';
      setError(errorMsg);
      sonnerToast.error('Error Updating Scheme', { description: errorMsg });
      return null;
    } finally {
      setIsLoadingSchemes(false);
    }
  }, [activeWorkspace?.id, getWorkspaceId, sonnerToast, clearSchemesCache]);

  const deleteScheme = useCallback(async (schemeId: number): Promise<boolean> => {
    if (!activeWorkspace?.id) {
      setError('No active workspace selected');
      return false;
    }
    const schemeToDelete = schemes.find(s => s.id === schemeId);
    const schemeName = schemeToDelete?.name || `ID ${schemeId}`;

    setIsLoadingSchemes(true);
    setError(null);
    try {
      const workspaceId = getWorkspaceId();
      await ClassificationSchemesService.deleteClassificationScheme({
        workspaceId,
        schemeId,
      });
      setSchemes((prev) => prev.filter(s => s.id !== schemeId));
      clearSchemesCache(workspaceId);
      sonnerToast.success(`Scheme \"${schemeName}\" deleted.`);
      return true;
    } catch (err: any) {
      console.error(`Error deleting scheme ${schemeId}:`, err);
      const errorMsg = err.body?.detail || 'Failed to delete scheme';
      setError(errorMsg);
      sonnerToast.error('Error Deleting Scheme', { description: errorMsg });
      return false;
    } finally {
      setIsLoadingSchemes(false);
    }
  }, [activeWorkspace?.id, getWorkspaceId, sonnerToast, clearSchemesCache, schemes]);

  const loadResultsByScheme = useCallback(async (schemeId: number): Promise<FormattedClassificationResult[]> => {
      if (!activeWorkspace?.id) {
         setError("Workspace ID needed to load scheme results.");
         return [];
      }
      setIsLoadingResults(true);
      setError(null);
      try {
         const apiResults: EnhancedClassificationResultRead[] = await ClassificationResultsService.listClassificationResults({
           workspaceId: activeWorkspace.id,
           schemeIds: [schemeId],
           limit: 5000
         });
         const formatted = apiResults.map(adaptEnhancedResultReadToFormattedResult);
         setResults(formatted);
         return formatted;
      } catch (err: any) {
        console.error(`Error loading results for scheme ${schemeId}:`, err);
        const detail = err.body?.detail || 'Failed to load scheme results.';
        setError(detail);
        toast({ title: 'Error Loading Scheme Results', description: detail, variant: 'destructive' });
        return [];
      } finally {
         setIsLoadingResults(false);
      }
  }, [activeWorkspace?.id, toast, getWorkspaceId, setError]);

  const startClassificationJob = useCallback(async (jobId: number): Promise<boolean> => {
    const workspaceId = getWorkspaceId();
    // Find the job in the store to get its current status
    const job = getJobById(jobId);

    if (!job) {
      setError(`Job ${jobId} not found.`);
      toast({ title: 'Error', description: `Job ${jobId} not found.`, variant: 'destructive' });
      return false;
    }

    // Prevent starting if already running or completed
    if (job.status === 'running') {
      toast({ title: 'Job Already Running', description: `Job \"${job.name}\" is already processing.`, variant: 'default' });
      return false;
    }
    if (job.status === 'completed' || job.status === 'completed_with_errors') {
      toast({ title: 'Job Already Completed', description: `Job \"${job.name}\" has already finished. Create a new job to re-run.`, variant: 'default' });
      return false;
    }

    setIsClassifyingState(true);
    setClassificationProgress(null);
    setError(null);

    try {
      console.log(`Attempting to update job ${jobId} status to PENDING before polling...`);
      // Ensure the job is marked as pending (or trigger logic if needed)
      // You might need a specific API endpoint to \"retry\" or \"start\" a job if it's not automatic on creation
      const updatedJob = await updateStoreJob(workspaceId, jobId, { status: 'pending' });
      if (!updatedJob) {
        throw new Error("Failed to mark job as pending.");
      }
      console.log(`Job ${jobId} status set to PENDING.`);

      // Start polling for status changes
      pollJobStatus(jobId, workspaceId);
      return true;
    } catch (err: any) {
      console.error(`Error starting classification for job ${jobId}:`, err);
      const detail = err.message || err.body?.detail || 'Failed to start classification job';
      setError(detail);
      toast({ title: 'Error Starting Job', description: detail, variant: 'destructive' });
      return false;
    } finally {
      setIsClassifyingState(false);
    }
  }, [getWorkspaceId, getJobById, updateStoreJob, pollJobStatus, toast]);

  const setSelectedDataSource = useCallback((dataSource: DataSourceRead | null) => {
    setSelectedDataSourceState(dataSource);
  }, []);

  // Load classification results
  const loadResults = useCallback(async (options: { datarecordId?: number; schemeId?: number; jobId?: number; useCache?: boolean } = {}) => {
    if (!activeWorkspace?.id) return;

    setIsLoadingResults(true);
    setError(null);

    const workspaceId = getWorkspaceId();
    const { datarecordId, schemeId, jobId, useCache = true } = options;

    const cacheKey = `ws${workspaceId}-dr${datarecordId ?? 'all'}-sc${schemeId ?? 'all'}-job${jobId ?? 'all'}`;

    if (useCache && resultsCache.current.has(cacheKey)) {
      setResults(resultsCache.current.get(cacheKey)!);
      setIsLoadingResults(false);
      return;
    }

    try {
      const loadedApiResults: EnhancedClassificationResultRead[] = await ClassificationResultsService.listClassificationResults({
        workspaceId,
        datarecordIds: datarecordId ? [datarecordId] : undefined,
        schemeIds: schemeId ? [schemeId] : undefined,
        jobId: jobId,
        limit: 2000
      });

      const formattedResults: FormattedClassificationResult[] = loadedApiResults.map(adaptEnhancedResultReadToFormattedResult);

      setResults(formattedResults);
      if (useCache) resultsCache.current.set(cacheKey, formattedResults);

    } catch (err: any) {
      console.error('Error loading results:', err);
      const detail = err.body?.detail || 'Failed to load results';
      setError(detail);
      toast({ title: 'Error Loading Results', description: detail, variant: 'destructive' });
    } finally {
      setIsLoadingResults(false);
    }
  }, [activeWorkspace?.id, getWorkspaceId, toast]);

  // Clear cache for a specific content
  const clearResultsCache = useCallback((key: string) => {
    resultsCache.current.delete(key);
    console.log('Cleared results cache for key:', key);
  }, []);

  // Load Job
  const loadJob = useCallback(async (jobId: number): Promise<void> => {
    const workspaceId = getWorkspaceId();
    console.log(`[loadJob] Starting for Job ID: ${jobId}`);
    stopPolling(); // Stop any previous polling
    setIsLoadingJobDataState(true); // Start loading indicator for job data
    setActiveJobDataRecords([]);
    setError(null);
    setActiveJobState(null);
    setResults([]);

    try {
      let job = getJobById(jobId);
      if (!job) {
        console.log(`[loadJob] Job ${jobId} not in store, fetching from API...`);
        job = await ClassificationJobsService.getClassificationJob({ workspaceId, jobId });
        if (!job) throw new Error(`Job with ID ${jobId} not found.`);
        // Add/update job in the store after fetching
        updateStoreJob(workspaceId, jobId, job);
      }
      console.log(`[loadJob] Fetched/found job: ${job.name} (Status: ${job.status})`);
      setActiveJobState(job);

      // Load associated data (results, schemes, sources, records) in parallel
      const [jobResults, /*schemesLoaded*/, /*sourcesLoaded*/, dataRecords] = await Promise.all([
         loadResultsByJob(jobId, workspaceId),
         loadSchemes(false), // Ensure schemes are loaded (uses cache/state check)
         loadDataSources(), // Ensure data sources are loaded (uses store)
         (async () => { // Fetch data records
            let jobDataSourceIds: number[] = [];
            if (job?.configuration && typeof job.configuration === 'object' && job.configuration !== null) {
                // Check if datasource_ids exists and is an array
                const dsIds = job.configuration.datasource_ids;
                if (Array.isArray(dsIds)) {
                    // Further check if elements are numbers (optional but safer)
                    jobDataSourceIds = dsIds.filter((id): id is number => typeof id === 'number');
                }
            }

            if (jobDataSourceIds.length > 0) {
                console.log("[loadJob] Fetching data records for data source IDs:", jobDataSourceIds);
                try {
                    const recordFetchPromises = jobDataSourceIds.map(dsId =>
                        DatarecordsService.listDatarecords({ workspaceId, datasourceId: dsId, limit: 5000 }) // Adjust limit
                    );
                    const resultsArrays = await Promise.all(recordFetchPromises);
                    const allDataRecords = resultsArrays.flat();
                    console.log(`[loadJob] Fetched ${allDataRecords.length} total data records.`);
                    setActiveJobDataRecords(allDataRecords); // Update state
                    return allDataRecords;
                } catch (recordErr: any) {
                    console.error("[loadJob] Error fetching data records:", recordErr);
                    const detail = recordErr.body?.detail || 'Failed to load data records for the job.';
                    setError((prev) => prev ? `${prev}; ${detail}` : detail);
                    toast({ title: 'Warning', description: 'Could not load all data records for the job.', variant: 'default' });
                    setActiveJobDataRecords([]);
                    return [];
                }
            }
            return [];
         })()
      ]);

       console.log(`[loadJob] Associated data loaded (Results: ${jobResults.length}, Records: ${dataRecords.length})`);

      // IMPORTANT: Check job status and start polling if necessary
      if (job.status === 'pending' || job.status === 'running') {
        console.log(`[loadJob] Job ${jobId} is ${job.status}. Starting polling.`);
        pollJobStatus(jobId, workspaceId);
      } else {
         console.log(`[loadJob] Job ${jobId} is in terminal state (${job.status}). Not starting polling.`);
         setIsClassifyingState(false); // Ensure classifying state is false if job is terminal
      }

    } catch (err: any) {
      console.error(`[loadJob] Error loading job ${jobId}:`, err);
      const detail = err.body?.detail || err.message || `Failed to load job ${jobId}`;
      setError(detail);
      toast({ title: 'Error Loading Job', description: detail, variant: 'destructive' });
      setActiveJobState(null);
      setResults([]);
      setActiveJobDataRecords([]);
      stopPolling(); // Ensure polling is stopped on error
    } finally {
      setIsLoadingJobDataState(false); // Stop loading indicator for job data
      console.log(`[loadJob] Finished for Job ID: ${jobId}`);
    }
  }, [
    getWorkspaceId,
    getJobById,
    updateStoreJob,
    loadResultsByJob,
    loadSchemes,
    loadDataSources,
    toast,
    stopPolling,
    pollJobStatus,
  ]);

  // Create Job
  const createJob = useCallback(async (params: ClassificationJobParams): Promise<ClassificationJobRead | null> => {
    const workspaceId = getWorkspaceId();
    setIsCreatingJob(true);
    setError(null);
    stopPolling(); // Stop any polling from previous job

    try {
      const timestamp = new Date().toISOString();
      const jobRequestBody: ClassificationJobCreate = {
        name: params.name || `Classification Job ${timestamp}`,
        description: params.description || `Created on ${timestamp}`,
        configuration: {
          datasource_ids: params.datasourceIds,
          scheme_ids: params.schemeIds,
        },
      };

      // Use the API service directly, as the store might not immediately trigger polling
      const newJob = await ClassificationJobsService.createClassificationJob({ workspaceId, requestBody: jobRequestBody });

      if (newJob) {
        // Add to store AFTER successful API call
        updateStoreJob(workspaceId, newJob.id, newJob); // Add/update in store

        setActiveJobState(newJob); // Set as active immediately
        setResults([]); // Clear previous results
        setActiveJobDataRecords([]); // Clear previous records
        sonnerToast.success(`Job \"${newJob.name}\" created and started.`);

        // Start polling for the new job
        pollJobStatus(newJob.id, workspaceId);
      } else {
        throw new Error("API did not return the created job.");
      }
      return newJob;
    } catch (err: any) {
      console.error('Error creating classification job:', err);
      const detail = err.body?.detail || `Failed to create job: ${err.message || 'Unknown error'}`;
      setError(detail);
      sonnerToast.error('Error Creating Job', { description: detail });
      return null;
    } finally {
      setIsCreatingJob(false);
    }
  }, [getWorkspaceId, updateStoreJob, stopPolling, pollJobStatus, sonnerToast]); // Removed createStoreJob

  // Set Active Job
  const setActiveJob = useCallback((job: ClassificationJobRead | null) => {
    // This is now mostly used to CLEAR the active job or handle initial loading effects
    if (job === null) {
        stopPolling();
        setActiveJobState(null);
        setResults([]);
        setActiveJobDataRecords([]);
        setError(null);
        console.log("[setActiveJob] Active job cleared.");
    } else {
        // Setting an active job *object* directly should be rare.
        // Prefer using loadJob(job.id) to ensure all data is loaded and polling starts.
        // However, we might set it during loadJob itself.
        setActiveJobState(job);
        console.log(`[setActiveJob] Active job set programmatically to ${job.id}`);
    }
  }, [stopPolling]);

  // Update Job
  const updateJob = useCallback(async (jobId: number, data: ClassificationJobUpdate): Promise<ClassificationJobRead | null> => {
    const workspaceId = getWorkspaceId();
    setError(null);
    try {
      // Call the store action which should call the API
      const updatedJob = await updateStoreJob(workspaceId, jobId, data);

      if (updatedJob) {
        // Keep local active job state in sync if it's the one being updated
        if (activeJobState?.id === jobId) {
          setActiveJobState(updatedJob);
        }
        // Avoid noisy toasts for frequent status updates from polling
        // Only show toast for explicit user actions or significant changes if needed
        // sonnerToast.info('Classification job updated.');
      } else {
        throw new Error("Store did not return the updated job after update.");
      }
      return updatedJob;
    } catch (err: any) {
      console.error('Error updating job:', err);
      const detail = err.body?.detail || `Failed to update job: ${err.message || 'Unknown error'}`;
      setError(detail);
      sonnerToast.error('Error Updating Job', { description: detail });
      return null;
    }
  }, [getWorkspaceId, activeJobState, updateStoreJob, sonnerToast]);

  // Delete Job
  const deleteJob = useCallback(async (jobId: number): Promise<boolean> => {
    const workspaceId = getWorkspaceId();
    setError(null);
    const jobToDelete = getJobById(jobId); // Get name before deleting
    const jobName = jobToDelete?.name || `ID ${jobId}`;
    try {
      if (activeJobState?.id === jobId) {
        stopPolling(); // Stop polling if deleting the active job
        setActiveJobState(null);
        setResults([]);
        setActiveJobDataRecords([]);
      }
      await deleteStoreJob(workspaceId, jobId); // Calls API via store action
      sonnerToast.success(`Classification job \"${jobName}\" deleted.`);
      return true;
    } catch (err: any) {
      console.error('Error deleting job:', err);
      const detail = err.body?.detail || `Failed to delete job: ${err.message || 'Unknown error'}`;
      setError(detail);
      sonnerToast.error('Error Deleting Job', { description: detail });
      return false;
    }
  }, [getWorkspaceId, activeJobState, deleteStoreJob, stopPolling, getJobById, sonnerToast]);

  // Default scheme management
  const getDefaultSchemeId = useCallback(() => {
    if (!activeWorkspace?.id || schemes.length === 0) return null;
    return classificationSettings.getDefaultSchemeId(activeWorkspace.id, schemes);
  }, [activeWorkspace?.id, schemes, classificationSettings]);

  const setDefaultSchemeId = useCallback((schemeId: number) => {
    if (!activeWorkspace?.id) return;
    classificationSettings.setDefaultSchemeId(activeWorkspace.id, schemeId);
    const scheme = schemes.find(s => s.id === schemeId);
    if (scheme) {
      sonnerToast.info(`Set \"${scheme.name}\" as the default scheme.`);
    }
  }, [activeWorkspace?.id, schemes, classificationSettings, sonnerToast]);

  // Placeholder for results cache (may need adjustment based on final data structure)
  const resultsCache = useRef<Map<string, FormattedClassificationResult[]>>(new Map());

  // Load initial data based on options
  useEffect(() => {
    if (activeWorkspace?.id) {
      if (options.autoLoadSchemes) loadSchemes();
      if (options.autoLoadDataSources) loadDataSources();
      if (options.autoLoadJobs) loadJobs();
      if (options.dataSourceId) loadDataSource(options.dataSourceId);
      if (options.jobId) loadJob(options.jobId);
    }
  }, [
    activeWorkspace?.id,
    options.autoLoadSchemes,
    options.autoLoadDataSources,
    options.autoLoadJobs,
    options.dataSourceId,
    options.jobId,
    loadSchemes,
    loadDataSources,
    loadJobs,
    loadDataSource,
    loadJob
  ]);

  // --- NEW: Retry Job Failures Function ---
  const retryJobFailures = useCallback(async (jobId: number): Promise<boolean> => {
    const workspaceId = getWorkspaceId();
    const job = getJobById(jobId);
    if (!job) {
      setError(`Job ${jobId} not found for retry.`);
      sonnerToast.error('Retry Failed', { description: `Job ${jobId} not found.` });
      return false;
    }
    if (job.status !== ClassificationJobStatus.COMPLETED_WITH_ERRORS) {
      setError(`Job ${jobId} is not in COMPLETED_WITH_ERRORS state.`);
      sonnerToast.warning('Cannot Retry', { description: `Job must be 'Completed with Errors' to retry failed items. Current: ${job.status}` });
      return false;
    }

    setIsRetryingJobId(jobId);
    setError(null);
    sonnerToast.info(`Starting retry for failed items in Job "${job.name}"...`);

    try {
      // Call the new API endpoint
      await ClassificationJobsService.retryFailedJobClassifications({ workspaceId, jobId });
      // The backend returns 202 Accepted and queues the task.
      // We need to start polling again to track the job's progress from RUNNING.
      pollJobStatus(jobId, workspaceId);
      sonnerToast.success('Retry Started', { description: `Job "${job.name}" is now processing retries.` });
      return true;
    } catch (err: any) {
      console.error(`Error triggering retry for job ${jobId}:`, err);
      const detail = err.body?.detail || `Failed to start retry for job ${jobId}.`;
      setError(detail);
      sonnerToast.error('Retry Failed', { description: detail });
      return false;
    } finally {
      setIsRetryingJobId(null);
    }
  }, [getWorkspaceId, getJobById, pollJobStatus, sonnerToast, setError]);
  // --- END NEW ---

  // --- NEW: Retry Single Result Function ---
  const retrySingleResult = useCallback(async (resultId: number): Promise<EnhancedClassificationResultRead | null> => {
    const workspaceId = getWorkspaceId();
    setRetryingResultId(resultId);
    setError(null);
    sonnerToast.info(`Retrying classification for result ID ${resultId}...`);

    try {
      // Call the new API endpoint
      const updatedResult = await ClassificationResultsService.retrySingleClassificationResult({ workspaceId, resultId });

      // Update the local results state optimistically or reload
      // For simplicity, let's update the specific result in the local state
      setResults(prevResults =>
        prevResults.map(r =>
          r.id === resultId
            ? { ...adaptEnhancedResultReadToFormattedResult(updatedResult as EnhancedClassificationResultRead), isOptimistic: false } // Adapt the raw result read
            : r
        )
      );

      sonnerToast.success('Retry Successful', { description: `Classification for result ID ${resultId} completed.` });
      return updatedResult;
    } catch (err: any) {
      console.error(`Error retrying result ${resultId}:`, err);
      const detail = err.body?.detail || `Failed to retry classification for result ID ${resultId}.`;
      setError(detail);
      sonnerToast.error('Retry Failed', { description: detail });

      // Optionally: Update the result in local state to show the retry failed error?
      setResults(prevResults =>
        prevResults.map(r =>
          r.id === resultId
            ? { ...r, status: 'failed', error_message: `Retry Failed: ${detail}`.substring(0, 500) } // Mark as failed again with error
            : r
        )
      );

      return null;
    } finally {
      setRetryingResultId(null);
    }
  // Add `adaptEnhancedResultReadToFormattedResult` to dependencies if it's not stable
  }, [getWorkspaceId, sonnerToast, setError, adaptEnhancedResultReadToFormattedResult]);
  // --- END NEW ---

  // Return all the state and functions
  return {
    // Schemes
    schemes,
    isLoadingSchemes,
    loadSchemes,
    createScheme,
    updateScheme,
    deleteScheme,

    // DataSources
    dataSources,
    selectedDataSource,
    isLoadingDataSources: isLoadingDataSourcesStore,
    loadDataSources,
    loadDataSource,
    setSelectedDataSource,

    // Results
    results,
    isLoadingResults,
    loadResults,
    loadResultsByJob,
    clearResultsCache,
    loadResultsByScheme,

    // Classification
    isClassifying: isClassifyingState,
    startClassificationJob,
    pollJobStatus,

    // Jobs
    jobs: Object.values(classificationJobs),
    activeJob: activeJobState,
    activeJobDataRecords,
    isLoadingJobs: isLoadingJobsState,
    isCreatingJob,
    loadJobs,
    loadJob,
    createJob,
    setActiveJob,
    updateJob,
    deleteJob,

    // Default scheme management
    getDefaultSchemeId,
    setDefaultSchemeId,

    // Error handling
    error,
    setError,

    // Classification Progress State
    classificationProgress,

    // *** ADD isLoadingJobData to the returned object ***
    isLoadingJobData: isLoadingJobDataState,

    // --- NEW: Retry Exports ---
    isRetryingJob: isRetryingJobId !== null, // Derived boolean state
    isRetryingResultId: retryingResultId,
    retryJobFailures,
    retrySingleResult,
    // --- END NEW ---
  };
}