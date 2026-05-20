'use client';

/**
 * useGeocodeAction — kick the geocode @task on a run and track the
 * ActionAcceptedResponse watch_url for useActionWatch.
 *
 * Returns `watchUrl` which the caller wires into `useActionWatch` to receive
 * `resolved` events as each location's coords land on Entity.
 */

import { useCallback, useState } from 'react';
import { RunsService, type GeocodeActionRequest } from '@/client';

export interface UseGeocodeActionResult {
  watchUrl: string | null;
  taskId: string | null;
  isPending: boolean;
  error: Error | null;
  kick: (args: {
    infospaceId: number;
    runId: number;
    fieldPath: string;
    annotationIds?: number[] | null;
  }) => Promise<void>;
  reset: () => void;
}

export function useGeocodeAction(): UseGeocodeActionResult {
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const kick = useCallback(async ({
    infospaceId,
    runId,
    fieldPath,
    annotationIds,
  }: { infospaceId: number; runId: number; fieldPath: string; annotationIds?: number[] | null }) => {
    setIsPending(true);
    setError(null);
    try {
      const body: GeocodeActionRequest = {
        field_path: fieldPath,
        annotation_ids: annotationIds ?? null,
      };
      const res = await RunsService.kickGeocode({
        infospaceId,
        runId,
        requestBody: body,
      });
      setTaskId(res.task_id ?? null);
      setWatchUrl(res.watch_url ?? null);
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setWatchUrl(null);
    setTaskId(null);
    setError(null);
  }, []);

  return { watchUrl, taskId, isPending, error, kick, reset };
}
