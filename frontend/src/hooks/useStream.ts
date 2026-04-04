'use client';

/**
 * useStream — presence subscription hook.
 *
 * Subscribes to a backend presence stream via SSE. Delivers events
 * to the caller via lastEvent and an optional onEvent callback.
 * Reconnects with exponential backoff on disconnect. Tracks
 * Last-Event-ID for lossless reconnection.
 *
 * Named useStream (raw subscription), not useView (which would imply
 * hydration — deferred until graph windowing and GQL are designed).
 *
 * Usage:
 *   const { lastEvent, isConnected } = useStream<ProgressEvent>({
 *     infospaceId: 5,
 *     topic: 'annotation_run',
 *     resourceId: runId,
 *     enabled: run.status === 'running',
 *     onEvent: (e) => {
 *       if (e.type === 'completed') refetchResults();
 *     },
 *   });
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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

interface UseStreamResult<T> {
  lastEvent: StreamEvent<T> | null;
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

export function useStream<T = unknown>(options: UseStreamOptions<T>): UseStreamResult<T> {
  const {
    infospaceId,
    topic,
    resourceId,
    params,
    enabled = true,
    onEvent,
  } = options;

  const [lastEvent, setLastEvent] = useState<StreamEvent<T> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastEventIdRef = useRef<string | undefined>(undefined);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const attemptRef = useRef(0);

  // Stable identity for the stream — reconnects when these change
  const streamIdentity = `${infospaceId}/${topic}/${resourceId}/${JSON.stringify(params ?? null)}`;

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function connect() {
      while (!cancelled) {
        setError(null);

        const paramStr = params ? `?params=${encodeURIComponent(JSON.stringify(params))}` : '';
        const url = `/api/v1/infospaces/${infospaceId}/stream/${topic}/${resourceId}${paramStr}`;

        try {
          setIsConnected(true);
          attemptRef.current = 0;

          await connectSSE({
            url,
            lastEventId: lastEventIdRef.current,
            signal: controller.signal,
            onEvent: (raw: SSEEvent) => {
              if (raw.id) {
                lastEventIdRef.current = raw.id;
              }
              // Deadline event: server closing connection, reconnect
              if (raw.type === 'deadline') return;

              let parsed: T;
              try {
                parsed = JSON.parse(raw.data) as T;
              } catch {
                return; // malformed JSON, skip
              }

              const event: StreamEvent<T> = {
                id: raw.id,
                type: raw.type,
                data: parsed,
              };
              setLastEvent(event);
              onEventRef.current?.(event);
            },
          });
        } catch {
          // connectSSE handles AbortError internally — if we're here,
          // it's a real error (network, auth, server error)
        }

        if (cancelled) return;

        // Stream ended or errored — reconnect with backoff
        setIsConnected(false);
        const delay = backoffDelay(attemptRef.current);
        attemptRef.current++;
        setError(`Disconnected, reconnecting in ${Math.round(delay / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));

        if (cancelled) return;
      }
    }

    connect();

    return () => {
      cancelled = true;
      controller.abort();
      setIsConnected(false);
    };
  }, [streamIdentity, enabled]);

  return { lastEvent, isConnected, error };
}
