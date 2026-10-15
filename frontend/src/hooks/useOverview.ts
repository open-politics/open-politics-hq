'use client';

/**
 * useOverview — one run's overview stream, stage by stage, into the shared
 * cache (`lib/overview/store`).
 *
 * The stream (`routes/overview.py`) sends `frame → plan → buckets → entities
 * → ready`, then keeps sending full replacements while the run can change,
 * and a `deadline` after half an hour. This hook:
 *
 * - paints from cache immediately when the reading was seen before;
 * - reconnects after `deadline` or a dropped connection, with backoff, for as
 *   long as it is mounted;
 * - keeps the PREVIOUS reading on screen while a new one (a changed pick)
 *   loads, flagged `stale` — so a reader never watches the panel empty out.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { connectSSE } from '@/lib/sse';
import { EMPTY_ENTRY, useOverviewStore, type OverviewEntry } from '@/lib/overview/store';
import type { BindingPick } from '@/lib/overview/types';
import type { MergeMap } from '@/client';

export interface UseOverviewParams {
  infospaceId: number;
  runId: number;
  bindings?: Record<string, BindingPick>;
  mergeMaps?: MergeMap[];
  /** An entity identity: read only the assets that name it. */
  within?: string | null;
  enabled?: boolean;
}

export interface UseOverviewResult extends OverviewEntry {
  /** The entry on screen belongs to an earlier reading; a new one is loading. */
  stale: boolean;
  /** Drop the connection and read again from scratch. */
  refresh: () => void;
}

const BACKOFF = [1000, 2000, 5000, 10000, 30000];

function stableKey(value: unknown): string {
  const sort = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(sort);
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
  };
  return JSON.stringify(sort(value));
}

export function useOverview({
  infospaceId, runId, bindings, mergeMaps, within, enabled = true,
}: UseOverviewParams): UseOverviewResult {
  const body = useMemo(
    () => ({ bindings: bindings ?? {}, merge_maps: mergeMaps ?? [], within: within ?? null, follow: true }),
    [bindings, mergeMaps, within],
  );
  const bodyKey = stableKey(body);
  const key = `${infospaceId}:${runId}:${bodyKey}`;

  const entry = useOverviewStore((s) => s.entries[key]);
  const patch = useOverviewStore((s) => s.patch);
  const [generation, setGeneration] = useState(0);

  // The last key that reached `ready` — what stays on screen while a new
  // reading loads.
  const shownKey = useRef<string | null>(null);
  if (entry?.buckets && shownKey.current !== key) shownKey.current = key;
  const previous = useOverviewStore((s) =>
    shownKey.current && shownKey.current !== key ? s.entries[shownKey.current] : undefined);

  useEffect(() => {
    if (!enabled || !infospaceId || !runId) return;
    const controller = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      if (controller.signal.aborted) return;
      const hasData = !!useOverviewStore.getState().entries[key]?.buckets;
      patch(key, { status: hasData ? 'ready' : 'connecting', error: null });
      let ended = false;
      try {
        await connectSSE({
          url: `/api/v1/infospaces/${infospaceId}/runs/${runId}/overview`,
          method: 'POST',
          body: JSON.parse(bodyKey),
          signal: controller.signal,
          onEvent: (event) => {
            let data: any;
            try { data = JSON.parse(event.data); } catch { return; }
            switch (event.type) {
              case 'frame': patch(key, { frame: data, status: hasData ? 'ready' : 'loading' }); break;
              case 'plan': patch(key, { plan: data }); break;
              case 'buckets': patch(key, { buckets: data }); break;
              case 'entities': patch(key, { entities: data }); break;
              case 'ready':
                attempt = 0;
                patch(key, { status: 'live', loadMs: data?.ms ?? null });
                break;
              case 'deadline': ended = true; break;
              case 'error': patch(key, { status: 'error', error: data?.detail ?? 'Overview failed' }); break;
            }
          },
        });
        // A stream that finished without a deadline belongs to a run that can
        // no longer change: it said everything, so stay put.
        if (!ended) {
          const cur = useOverviewStore.getState().entries[key];
          if (cur?.status === 'live') patch(key, { status: 'ready' });
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        patch(key, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
      if (controller.signal.aborted) return;
      timer = setTimeout(open, BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    };

    open();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, infospaceId, runId, key, bodyKey, patch, generation]);

  const shown = entry?.buckets ? entry : previous ?? entry ?? EMPTY_ENTRY;
  return {
    ...shown,
    status: entry?.status ?? 'connecting',
    error: entry?.error ?? null,
    stale: shown !== entry && !!previous,
    refresh: () => setGeneration((g) => g + 1),
  };
}
