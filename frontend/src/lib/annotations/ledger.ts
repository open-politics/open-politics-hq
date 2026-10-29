'use client';

/**
 * The run ledger, client side: where a run's scope stands, as counts, and the
 * annotations of one asset when someone looks at it.
 *
 * The run page used to fetch every annotation of the run (up to 5,000 rows,
 * each with its full value) on every bit of progress, to count them. The
 * ledger asks the backend for the counts instead (`GET /runs/{id}/summary`,
 * aggregates only), and fetches annotations only for the asset in view. The
 * assets themselves are paged per state by whoever lists them
 * (`GET /runs/{id}/assets`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnnotationsService, BundlesService, RunsService, type AnnotationRunRead, type BundleRead, type RunLedgerSummary } from '@/client';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { adaptEnhancedAnnotationToFormattedAnnotation } from './adapters';
import type { FormattedAnnotation } from './types';

/** Progress arrives once per annotation; the summary is re-asked at most
 *  this often while it does. */
const REFRESH_MS = 2000;

export interface RunLedger {
  summary: RunLedgerSummary | null;
  /** Bumps whenever the counts move — the cue for lists of the run's assets
   *  to reload what they show. */
  version: number;
  /** Ask again, soon: trailing, so a burst of progress is one request. */
  refresh: () => void;
  /** Ask again now — a run that just finished. */
  refreshNow: () => void;
}

const signature = (s: RunLedgerSummary) => `${s.in_scope}/${s.queued}/${s.annotated}/${s.failed}/${s.annotations}`;

export function useRunLedger(run: Pick<AnnotationRunRead, 'id' | 'infospace_id'> | null): RunLedger {
  const runId = run?.id ?? null;
  const infospaceId = run?.infospace_id ?? null;
  const [summary, setSummary] = useState<RunLedgerSummary | null>(null);
  const [version, setVersion] = useState(0);
  const last = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  // The run being read: an answer for a run already left is dropped.
  const reading = useRef<number | null>(runId);
  reading.current = runId;

  const fetchNow = useCallback(async () => {
    if (runId == null || infospaceId == null) return;
    try {
      const next = await RunsService.getRunSummary({ infospaceId, runId });
      if (reading.current !== runId) return;
      const sig = signature(next);
      if (sig === last.current) return;
      last.current = sig;
      setSummary(next);
      setVersion((v) => v + 1);
    } catch {
      // Counts are a convenience; the next refresh tries again.
    }
  }, [runId, infospaceId]);

  useEffect(() => {
    last.current = null;
    setSummary(null);
    void fetchNow();
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [fetchNow]);

  const refresh = useCallback(() => {
    if (timer.current != null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void fetchNow();
    }, REFRESH_MS);
  }, [fetchNow]);

  return useMemo(() => ({ summary, version, refresh, refreshNow: fetchNow }), [summary, version, refresh, fetchNow]);
}

/**
 * One asset's annotations in one run — its children's included, so a CSV or a
 * PDF shows what was read from its rows or pages. `null` while not asked for.
 * Asked again, quietly, whenever `stamp` moves (the ledger's version): an
 * asset opened while queued fills in once the run reads it.
 */
export function useAssetRunResults(
  assetId: number | null, runId: number | null | undefined, infospaceId: number | null | undefined, stamp?: unknown,
) {
  const [results, setResults] = useState<FormattedAnnotation[] | null>(null);
  const subject = `${assetId}:${runId}:${infospaceId}`;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (assetId == null || runId == null || infospaceId == null) {
      shown.current = null;
      setResults(null);
      return;
    }
    let current = true;
    // A new asset starts empty; the same one, asked again, keeps what it has.
    if (shown.current !== subject) {
      shown.current = subject;
      setResults(null);
    }
    AnnotationsService.getRunResults({ infospaceId, runId, assetId, limit: 500 })
      .then((rows) => current && setResults(rows.map(adaptEnhancedAnnotationToFormattedAnnotation)))
      .catch(() => current && setResults((prev) => prev ?? []));
    return () => {
      current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, stamp]);

  return results;
}

/**
 * All of a run's annotations, fetched only while `enabled` — for the few
 * places that genuinely need the values themselves (splitting controls).
 */
export function useRunResults(runId: number | null | undefined, infospaceId: number | null | undefined, enabled: boolean) {
  const [results, setResults] = useState<FormattedAnnotation[]>([]);

  useEffect(() => {
    if (!enabled || runId == null || infospaceId == null) return;
    let current = true;
    AnnotationsService.getRunResults({ infospaceId, runId, limit: 5000 })
      .then((rows) => current && setResults(rows.map(adaptEnhancedAnnotationToFormattedAnnotation)))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [enabled, runId, infospaceId]);

  return results;
}

/** The bundles a run reads from: the one it watches, the list it watches,
 *  and a one-off's target — in that order, without repeats. */
export function runBundleIds(run: AnnotationRunRead): number[] {
  const cfg = (run.configuration ?? {}) as Record<string, any>;
  const ids = [run.source_bundle_id, ...(Array.isArray(cfg.source_bundle_ids) ? cfg.source_bundle_ids : []), cfg.target_bundle_id];
  return [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
}

/**
 * The run's bundles, named — from the bundle store when it has them, fetched
 * when it does not (the runner page does not load the store). Read again when
 * `stamp` changes, since a live run's bundles grow.
 */
export function useRunBundles(run: AnnotationRunRead, stamp?: unknown): BundleRead[] {
  const ids = runBundleIds(run);
  const key = ids.join(',');
  const cached = useBundleStore((s) => s.bundles);
  const [fetched, setFetched] = useState<BundleRead[]>([]);

  useEffect(() => {
    if (!key) {
      setFetched([]);
      return;
    }
    let current = true;
    Promise.all(
      key.split(',').map((id) =>
        BundlesService.getBundle({ infospaceId: run.infospace_id, bundleId: Number(id) }).catch(() => null),
      ),
    ).then((bundles) => current && setFetched(bundles.filter((b): b is BundleRead => !!b)));
    return () => {
      current = false;
    };
  }, [key, run.infospace_id, stamp]);

  return useMemo(
    () => ids.map((id) => fetched.find((b) => b.id === id) ?? cached.find((b) => b.id === id)).filter((b): b is BundleRead => !!b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, fetched, cached],
  );
}
