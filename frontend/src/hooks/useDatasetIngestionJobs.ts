import { useState, useEffect, useCallback, useRef } from 'react';
import { DatasetJobsService, DatasetIngestionJobRead, IngestionStatus } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface UseDatasetIngestionJobsOptions {
  /** Polling interval in milliseconds. Default: 2000ms */
  pollInterval?: number;
  /** Only poll for active jobs (not completed/failed/cancelled). Default: true */
  activeOnly?: boolean;
  /** Callback when a job completes */
  onJobComplete?: (job: DatasetIngestionJobRead) => void;
}

const ACTIVE_STATUSES: IngestionStatus[] = ['pending', 'downloading', 'extracting', 'processing'];

export function useDatasetIngestionJobs(options: UseDatasetIngestionJobsOptions = {}) {
  const { pollInterval = 2000, activeOnly = true, onJobComplete } = options;
  const { activeInfospace } = useInfospaceStore();
  
  const [jobs, setJobs] = useState<Map<number, DatasetIngestionJobRead>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const previousJobsRef = useRef<Map<number, DatasetIngestionJobRead>>(new Map());
  const onJobCompleteRef = useRef(onJobComplete);
  
  // Update callback ref when it changes
  useEffect(() => {
    onJobCompleteRef.current = onJobComplete;
  }, [onJobComplete]);

  const fetchJobs = useCallback(async () => {
    if (!activeInfospace?.id) {
      setJobs(new Map());
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      // Always fetch all jobs so we can detect completions
      // The activeOnly flag only affects what we return, not what we fetch
      const response = await DatasetJobsService.listDatasetJobs({
        infospaceId: activeInfospace.id,
        status: undefined, // undefined means all statuses
        limit: 100,
      });
      
      const jobsMap = new Map<number, DatasetIngestionJobRead>();
      
      // Process jobs and detect completions
      response.forEach(job => {
        jobsMap.set(job.id, job);
        
        // Check if job just completed
        const previousJob = previousJobsRef.current.get(job.id);
        if (previousJob && 
            ACTIVE_STATUSES.includes(previousJob.status) && 
            !ACTIVE_STATUSES.includes(job.status)) {
          // Job just completed/failed/cancelled
          onJobCompleteRef.current?.(job);
        }
      });
      
      previousJobsRef.current = new Map(jobsMap);
      setJobs(jobsMap);
    } catch (err: any) {
      console.error('[useDatasetIngestionJobs] Error fetching jobs:', err);
      setError(err.message || 'Failed to fetch dataset ingestion jobs');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace?.id, activeOnly]);

  // Start polling
  useEffect(() => {
    if (!activeInfospace?.id) {
      return;
    }

    // Initial fetch
    fetchJobs();

    // Set up polling
    pollingRef.current = setInterval(() => {
      fetchJobs();
    }, pollInterval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeInfospace?.id, pollInterval, fetchJobs]);

  // Get active jobs only
  const activeJobs = Array.from(jobs.values()).filter(job => 
    ACTIVE_STATUSES.includes(job.status)
  );

  // Get job by ID
  const getJob = useCallback((jobId: number): DatasetIngestionJobRead | undefined => {
    return jobs.get(jobId);
  }, [jobs]);

  // Get job by UUID
  const getJobByUuid = useCallback((jobUuid: string): DatasetIngestionJobRead | undefined => {
    return Array.from(jobs.values()).find(job => job.uuid === jobUuid);
  }, [jobs]);

  // Manually refresh jobs
  const refresh = useCallback(() => {
    fetchJobs();
  }, [fetchJobs]);

  return {
    jobs: Array.from(jobs.values()),
    activeJobs,
    isLoading,
    error,
    getJob,
    getJobByUuid,
    refresh,
  };
}
