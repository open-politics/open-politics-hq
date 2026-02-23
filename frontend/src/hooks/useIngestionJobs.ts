import { useState, useEffect, useCallback, useRef } from 'react';
import { IngestionJobsService, IngestionJobRead, IngestionStatus } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface UseIngestionJobsOptions {
  /** Polling interval in milliseconds when there are active jobs. Default: 2000ms */
  pollInterval?: number;
  /** Polling interval when no active jobs (idle check). Default: 30000ms */
  idlePollInterval?: number;
  /** Only poll for active jobs (not completed/failed/cancelled). Default: true */
  activeOnly?: boolean;
  /** Filter by job kind (e.g. directory_local, zip, tar.gz) */
  kind?: string | null;
  /** Filter by source ID (jobs created by this source poll) */
  sourceId?: number | null;
  /** Callback when a job completes */
  onJobComplete?: (job: IngestionJobRead) => void;
}

const ACTIVE_STATUSES: IngestionStatus[] = ['pending', 'downloading', 'extracting', 'processing'];

export function useIngestionJobs(options: UseIngestionJobsOptions = {}) {
  const { pollInterval = 2000, idlePollInterval = 30000, activeOnly = true, kind, sourceId, onJobComplete } = options;
  const { activeInfospace } = useInfospaceStore();

  const [jobs, setJobs] = useState<Map<number, IngestionJobRead>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const previousJobsRef = useRef<Map<number, IngestionJobRead>>(new Map());
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
      const response = await IngestionJobsService.listIngestionJobs({
        infospaceId: activeInfospace.id,
        kind: kind ?? undefined,
        sourceId: sourceId ?? undefined,
        status: undefined, // undefined means all statuses
        limit: 100,
      });

      const jobsMap = new Map<number, IngestionJobRead>();

      // Process jobs and detect completions
      response.forEach((job) => {
        jobsMap.set(job.id, job);

        // Check if job just completed
        const previousJob = previousJobsRef.current.get(job.id);
        if (
          previousJob &&
          ACTIVE_STATUSES.includes(previousJob.status) &&
          !ACTIVE_STATUSES.includes(job.status)
        ) {
          // Job just completed/failed/cancelled
          onJobCompleteRef.current?.(job);
        }
      });

      previousJobsRef.current = new Map(jobsMap);
      setJobs(jobsMap);
    } catch (err: unknown) {
      console.error('[useIngestionJobs] Error fetching jobs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch ingestion jobs');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace?.id, kind, sourceId]);

  // Compute active jobs for adaptive polling
  const activeJobsList = Array.from(jobs.values()).filter((job) =>
    ACTIVE_STATUSES.includes(job.status)
  );
  const hasActiveJobs = activeJobsList.length > 0;

  // Adaptive polling: fast when there are active jobs, slow when idle
  useEffect(() => {
    if (!activeInfospace?.id) {
      return;
    }

    // Initial fetch
    fetchJobs();

    const interval = hasActiveJobs ? pollInterval : idlePollInterval;

    // Set up polling
    pollingRef.current = setInterval(() => {
      fetchJobs();
    }, interval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeInfospace?.id, pollInterval, idlePollInterval, hasActiveJobs, fetchJobs]);

  // Get job by ID
  const getJob = useCallback(
    (jobId: number): IngestionJobRead | undefined => {
      return jobs.get(jobId);
    },
    [jobs]
  );

  // Get job by UUID
  const getJobByUuid = useCallback(
    (jobUuid: string): IngestionJobRead | undefined => {
      return Array.from(jobs.values()).find((job) => job.uuid === jobUuid);
    },
    [jobs]
  );

  // Manually refresh jobs
  const refresh = useCallback(() => {
    fetchJobs();
  }, [fetchJobs]);

  return {
    jobs: Array.from(jobs.values()),
    activeJobs: activeJobsList,
    isLoading,
    error,
    getJob,
    getJobByUuid,
    refresh,
  };
}
