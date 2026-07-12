import { useEffect, useRef, useState } from 'react';
import { IngestionJobsService, IngestionJobRead, IngestionStatus } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

const TERMINAL_STATUSES: IngestionStatus[] = ['completed', 'failed', 'cancelled'];

interface UseIngestionJobStatusOptions {
  /** Skip polling entirely (e.g. the job is already terminal in the snapshot). Default: true */
  enabled?: boolean;
  /** Poll cadence in ms while the job is active. Default: 2500ms */
  pollInterval?: number;
}

/**
 * Observe a single ``IngestionJob`` by id and surface its live state.
 *
 * Built for one-off progress readouts — a chat tool-result card, a toast, an
 * inline badge — where the producer handed back a ``job_id`` and the UI should
 * advance from *queued* to *done/failed* on its own. Unlike ``useIngestionJobs``
 * (which polls the whole list for a dashboard), this targets one job via
 * ``getIngestionJobStatus``: it fetches once on mount (reconciling a stale
 * snapshot — a reloaded old conversation may already be finished), then keeps
 * polling only while the job is non-terminal, and stops the moment it settles.
 * A hard attempt cap backstops against a job that never reaches a terminal
 * state. Returns ``null`` until the first fetch resolves.
 */
export function useIngestionJobStatus(
  jobId: number | null | undefined,
  { enabled = true, pollInterval = 2500 }: UseIngestionJobStatusOptions = {},
): IngestionJobRead | null {
  const infospaceId = useInfospaceStore((s) => s.activeInfospace?.id);
  const [job, setJob] = useState<IngestionJobRead | null>(null);

  useEffect(() => {
    if (!enabled || jobId == null || !infospaceId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // ~10 min at the default cadence — a job still "active" past that is almost
    // certainly wedged; stop polling rather than hammer the endpoint forever.
    const MAX_ATTEMPTS = 240;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const fresh = await IngestionJobsService.getIngestionJobStatus({ infospaceId, jobId });
        if (cancelled) return;
        setJob(fresh);
        if (TERMINAL_STATUSES.includes(fresh.status)) return; // settled — stop
      } catch {
        // Transient (network blip, brief 404 before the row is visible) — keep
        // retrying within the cap rather than giving up on the first failure.
      }
      if (attempts >= MAX_ATTEMPTS) return;
      timer = setTimeout(tick, pollInterval);
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, infospaceId, enabled, pollInterval]);

  return job;
}
