'use client';

/**
 * useNetwork — one run's graph from the network stream, decoded for the GPU.
 *
 * The stream (`routes/network.py`) sends `frame → building… → network →
 * ready`, then a fresh `frame → network` whenever the run commits, and a
 * `deadline` after half an hour. This hook:
 *
 * - decodes each `network` once (`plane/network.decodeNetwork`) and remembers
 *   the last few per query, so reopening a panel paints immediately;
 * - keeps the previous graph on screen, flagged `stale`, while a new query
 *   builds — a big graph takes minutes, and an empty panel for minutes reads
 *   as broken;
 * - reconnects after `deadline` or a dropped connection, with backoff, for as
 *   long as it is mounted.
 */
import { useEffect, useRef, useState } from 'react';
import { connectSSE } from '@/lib/sse';
import type { MergeMap } from '@/client';
import { decodeNetwork, type Network, type NetworkWire } from '@/components/collection/graph/plane/network';

export interface UseNetworkParams {
  infospaceId: number;
  runId: number;
  q?: string | null;
  maxNodes?: number | null;
  mergeMaps?: MergeMap[];
  enabled?: boolean;
}

export type NetworkStatus = 'connecting' | 'building' | 'ready' | 'live' | 'error';

export interface NetworkFrame {
  run: { id: number; status: string; live: boolean; progress: [number, number] };
  totals: { annotations: number; failed: number; assets: number };
  watermark: number;
}

export interface UseNetworkResult {
  network: Network | null;
  frame: NetworkFrame | null;
  status: NetworkStatus;
  /** How long the graph on its way has been building. */
  elapsedMs: number;
  error: string | null;
  /** The graph on screen answers an earlier query; the new one is building. */
  stale: boolean;
  /** Key of the graph on screen — what positions are remembered under. */
  shownKey: string | null;
  refresh: () => void;
}

const BACKOFF = [1000, 2000, 5000, 10000, 30000];
const REMEMBERED = new Map<string, { network: Network; frame: NetworkFrame | null }>();
const MAX_REMEMBERED = 4;

function remember(key: string, value: { network: Network; frame: NetworkFrame | null }) {
  REMEMBERED.delete(key);
  REMEMBERED.set(key, value);
  while (REMEMBERED.size > MAX_REMEMBERED) REMEMBERED.delete(REMEMBERED.keys().next().value!);
}

export function useNetwork({
  infospaceId, runId, q, maxNodes, mergeMaps, enabled = true,
}: UseNetworkParams): UseNetworkResult {
  const body = { q: q || null, max_nodes: maxNodes ?? null, merge_maps: mergeMaps ?? [], follow: true };
  const bodyKey = JSON.stringify(body);
  const key = `${infospaceId}:${runId}:${bodyKey}`;

  const [shown, setShown] = useState<{ key: string; network: Network; frame: NetworkFrame | null } | null>(
    () => {
      const hit = REMEMBERED.get(key);
      return hit ? { key, ...hit } : null;
    },
  );
  const [frame, setFrame] = useState<NetworkFrame | null>(null);
  const [status, setStatus] = useState<NetworkStatus>('connecting');
  const [elapsedMs, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const live = useRef(key);
  live.current = key;

  useEffect(() => {
    if (!enabled || !infospaceId || !runId) return;
    const hit = REMEMBERED.get(key);
    if (hit) setShown({ key, ...hit });
    const controller = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      if (controller.signal.aborted) return;
      setStatus(REMEMBERED.has(key) ? 'ready' : 'connecting');
      setError(null);
      let ended = false;
      let latestFrame: NetworkFrame | null = null;
      try {
        await connectSSE({
          url: `/api/v1/infospaces/${infospaceId}/runs/${runId}/network`,
          method: 'POST',
          body: JSON.parse(bodyKey),
          signal: controller.signal,
          onEvent: (event) => {
            let data: any;
            try { data = JSON.parse(event.data); } catch { return; }
            if (live.current !== key) return;
            switch (event.type) {
              case 'frame':
                latestFrame = data;
                setFrame(data);
                break;
              case 'building':
                setStatus('building');
                setElapsed(data?.elapsed_ms ?? 0);
                break;
              case 'network': {
                const network = decodeNetwork(data as NetworkWire);
                remember(key, { network, frame: latestFrame });
                setShown({ key, network, frame: latestFrame });
                setElapsed(0);
                break;
              }
              case 'ready':
                attempt = 0;
                setStatus('live');
                break;
              case 'deadline':
                ended = true;
                break;
              case 'error':
                setStatus('error');
                setError(data?.detail ?? 'The graph could not be built');
                break;
            }
          },
        });
        // A stream that ends without a deadline belongs to a run that can no
        // longer change: it said everything.
        if (!ended) {
          setStatus((s) => (s === 'live' ? 'ready' : s));
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
      if (controller.signal.aborted) return;
      timer = setTimeout(open, BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    };

    open();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, infospaceId, runId, key, bodyKey, generation]);

  return {
    network: shown?.network ?? null,
    frame: frame ?? shown?.frame ?? null,
    status,
    elapsedMs,
    error,
    stale: !!shown && shown.key !== key,
    shownKey: shown?.key ?? null,
    refresh: () => setGeneration((g) => g + 1),
  };
}
