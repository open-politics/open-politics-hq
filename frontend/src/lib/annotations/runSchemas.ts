'use client';

/**
 * A run's schemas as it reads them (`GET /runs/{id}/schemas`): the revision
 * each is read through, whether the run is pinned behind the head, how many of
 * its annotations were made under another revision, its draft — and the trial
 * run that reads chosen assets through the drafts (`annotation/drafts.py`).
 *
 * Asked once per run, again whenever someone changes something here, and
 * every couple of seconds while the trial is reading, so its progress shows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RunsService, type AnnotationRunRead, type RunSchemas } from '@/client';

const READING_MS = 2000;

export interface RunSchemasHandle {
  data: RunSchemas | null;
  /** The trial run is reading. */
  trying: boolean;
  refresh: () => Promise<void>;
}

export const isReading = (run: AnnotationRunRead | null | undefined) =>
  run?.status === 'pending' || run?.status === 'running';

export function useRunSchemas(run: Pick<AnnotationRunRead, 'id' | 'infospace_id' | 'schema_ids'> | null): RunSchemasHandle {
  const runId = run?.id ?? null;
  const infospaceId = run?.infospace_id ?? null;
  const [data, setData] = useState<RunSchemas | null>(null);

  const refresh = useCallback(async () => {
    if (runId == null || infospaceId == null) return;
    try {
      const next = await RunsService.runSchemas({ infospaceId, runId });
      setData((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch {
      // What the run reads is shown when it can be asked; the next ask tries again.
    }
  }, [runId, infospaceId]);

  // A new run starts from nothing; a run given another schema asks again.
  const schemaKey = (run?.schema_ids ?? []).join(',');
  useEffect(() => {
    setData(null);
    void refresh();
  }, [refresh, schemaKey]);

  const trying = isReading(data?.trial);
  useEffect(() => {
    if (!trying) return;
    const timer = window.setInterval(() => void refresh(), READING_MS);
    return () => window.clearInterval(timer);
  }, [trying, refresh]);

  return useMemo(() => ({ data, trying, refresh }), [data, trying, refresh]);
}
