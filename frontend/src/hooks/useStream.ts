'use client';

/**
 * useStream — presence subscription hook.
 *
 * Subscribes to a backend presence stream via SSE and delivers its events to
 * `onEvent`. Reconnects with exponential backoff on disconnect, and tracks
 * Last-Event-ID for lossless reconnection.
 *
 * One connection per stream, however many subscribe: a run page, each of its
 * panels and the run dock all listening to the same run share one
 * EventSource, opened by the first and closed with the last. Events reach
 * the callback only — nothing is held in state per event, so a busy stream
 * re-renders nothing on its own.
 *
 * Named useStream (raw subscription), not useView (which would imply
 * hydration — deferred until graph windowing and GQL are designed).
 *
 * Usage:
 *   const { isConnected } = useStream<ProgressEvent>({
 *     infospaceId: 5,
 *     topic: 'annotation_run',
 *     resourceId: runId,
 *     enabled: run.status === 'running',
 *     onEvent: (e) => {
 *       if (e.type === 'completed') refetchResults();
 *     },
 *   });
 */

import { useState, useEffect, useRef } from 'react';
import { connectSSE, type SSEEvent } from '@/lib/sse';

export interface StreamEvent<T = unknown> {
  id?: string;
  type: string;
  data: T;
}

interface UseStreamOptions<T> {
  infospaceId: number;
  topic: string;
  resourceId: string | number;
  params?: Record<string, unknown>;
  enabled?: boolean;
  onEvent?: (event: StreamEvent<T>) => void;
}

interface UseStreamResult {
  isConnected: boolean;
  error: string | null;
}

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;
const BACKOFF_JITTER = 0.3;

function backoffDelay(attempt: number): number {
  const base = Math.min(BACKOFF_BASE * Math.pow(2, attempt), BACKOFF_MAX);
  const jitter = base * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.max(0, base + jitter);
}

// ─── Shared connections ──────────────────────────────────────────────────────

interface Listener {
  onEvent: (event: StreamEvent<any>) => void;
  onStatus: (connected: boolean, error: string | null) => void;
}

interface Channel {
  listeners: Set<Listener>;
  connected: boolean;
  error: string | null;
  close: () => void;
}

const channels = new Map<string, Channel>();

/** Open a stream and keep it open — reconnecting, resuming from the last
 *  event id — until `close`. Every event goes to every listener. */
function openChannel(url: string): Channel {
  const channel: Channel = { listeners: new Set(), connected: false, error: null, close: () => {} };
  const controller = new AbortController();
  let cancelled = false;
  let lastEventId: string | undefined;
  let attempt = 0;

  const status = (connected: boolean, error: string | null) => {
    channel.connected = connected;
    channel.error = error;
    channel.listeners.forEach((l) => l.onStatus(connected, error));
  };

  (async () => {
    while (!cancelled) {
      status(true, null);
      attempt = 0;
      try {
        await connectSSE({
          url,
          lastEventId,
          signal: controller.signal,
          onEvent: (raw: SSEEvent) => {
            if (raw.id) lastEventId = raw.id;
            // Deadline event: server closing connection, reconnect
            if (raw.type === 'deadline') return;
            // Bare events without a body — keepalives, lifecycle pings, or
            // the FastAPI SSE pipeline's `event:` markers emitted with no
            // `data:` line. Nothing to parse; nothing to deliver.
            if (!raw.data) return;
            let data: unknown;
            try {
              data = JSON.parse(raw.data);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[useStream] JSON.parse failed on data=', raw.data, err);
              return; // malformed JSON, skip
            }
            const event: StreamEvent = { id: raw.id, type: raw.type, data };
            channel.listeners.forEach((l) => l.onEvent(event));
          },
        });
      } catch {
        // connectSSE handles AbortError internally — if we're here,
        // it's a real error (network, auth, server error)
      }
      if (cancelled) return;

      // Stream ended or errored — reconnect with backoff
      const delay = backoffDelay(attempt);
      attempt++;
      status(false, `Disconnected, reconnecting in ${Math.round(delay / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  })();

  channel.close = () => {
    cancelled = true;
    controller.abort();
  };
  return channel;
}

export function useStream<T = unknown>(options: UseStreamOptions<T>): UseStreamResult {
  const { infospaceId, topic, resourceId, params, enabled = true, onEvent } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const paramStr = params ? `?params=${encodeURIComponent(JSON.stringify(params))}` : '';
  const url = `/api/v1/infospaces/${infospaceId}/stream/${topic}/${resourceId}${paramStr}`;

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      setError(null);
      return;
    }

    let channel = channels.get(url);
    if (!channel) {
      channel = openChannel(url);
      channels.set(url, channel);
    }
    const listener: Listener = {
      onEvent: (event) => onEventRef.current?.(event as StreamEvent<T>),
      onStatus: (connected, err) => {
        setIsConnected(connected);
        setError(err);
      },
    };
    channel.listeners.add(listener);
    setIsConnected(channel.connected);
    setError(channel.error);

    return () => {
      const ch = channels.get(url);
      if (!ch) return;
      ch.listeners.delete(listener);
      if (ch.listeners.size === 0) {
        ch.close();
        channels.delete(url);
      }
      setIsConnected(false);
    };
  }, [url, enabled]);

  return { isConnected, error };
}
