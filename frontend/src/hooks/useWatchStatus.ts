import { useState, useEffect, useCallback } from 'react';
import { IngestionJobsService } from '@/client';
import type { WatchStatusResponse } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface UseWatchStatusOptions {
  /** Optional bundle ID to filter statuses */
  bundleId?: number | null;
  /** Polling interval when there are active watches. Default: 10000ms */
  pollInterval?: number;
  /** Whether polling is enabled. Default: true */
  enabled?: boolean;
}

export function useWatchStatus(options: UseWatchStatusOptions = {}) {
  const { bundleId, pollInterval = 10000, enabled = true } = options;
  const { activeInfospace } = useInfospaceStore();

  const [statuses, setStatuses] = useState<WatchStatusResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    if (!activeInfospace?.id || !enabled) {
      setStatuses([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await IngestionJobsService.getWatchStatus({
        infospaceId: activeInfospace.id,
        bundleId: bundleId ?? undefined,
      });
      setStatuses(response);
    } catch (err) {
      console.error('[useWatchStatus] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch watch status');
      setStatuses([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace?.id, bundleId, enabled]);

  useEffect(() => {
    if (!activeInfospace?.id || !enabled) return;

    fetchStatuses();

    const interval = setInterval(fetchStatuses, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatuses, pollInterval, enabled, activeInfospace?.id]);

  const getStatusByBundle = useCallback(
    (bundleId: number): WatchStatusResponse | undefined => {
      return statuses.find((s) => s.bundle_id === bundleId);
    },
    [statuses]
  );

  return {
    statuses,
    isLoading,
    error,
    refresh: fetchStatuses,
    getStatusByBundle,
  };
}
