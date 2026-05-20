'use client';

/**
 * useActionWatch — subscribe to the ``/stream`` endpoint returned by a
 * user-initiated action (geocode, etc.).
 *
 * Every action endpoint returns ``ActionAcceptedResponse(task_id, watch_url)``.
 * The watch_url points at the generic ``/infospaces/{iid}/stream/{topic}/{resource_id}``
 * endpoint; subscribe via SSE and receive live progress events.
 *
 * Usage:
 * ```tsx
 * const { events, isOpen, error, close } = useActionWatch<GeocodeResolvedEvent>(
 *   watchUrl,
 *   {
 *     enabled: !!watchUrl,
 *     onEvent: (event) => {
 *       if (event.type === 'resolved') pushMarker(event.data);
 *     },
 *   },
 * );
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectSSE, type SSEEvent } from '@/lib/sse';
import { OpenAPI } from '@/client/core/OpenAPI';

export interface ActionWatchOptions<T = unknown> {
  /** Disable to defer connection (e.g., until a task id arrives). */
  enabled?: boolean;
  /** Called for every event. Payload is ``JSON.parse(event.data)``. */
  onEvent?: (event: { type: string; data: T; id?: string }) => void;
  /** Called on connection error. */
  onError?: (err: Error) => void;
  /** Called once the stream closes naturally. */
  onDone?: () => void;
}

export interface ActionWatchResult<T = unknown> {
  /** All events received so far, newest last. */
  events: Array<{ type: string; data: T; id?: string }>;
  /** True while the connection is active. */
  isOpen: boolean;
  /** Last error, if any. */
  error: Error | null;
  /** Close the stream early. */
  close: () => void;
}


/**
 * Subscribe to an ``ActionAcceptedResponse.watch_url`` SSE stream.
 *
 * ``watch_url`` is a path like ``/infospaces/3/stream/annotation.geocoding/5:abc``.
 * We prepend ``API_V1_STR`` (``/api/v1``) for the frontend fetch.
 */
export function useActionWatch<T = unknown>(
  watchUrl: string | null | undefined,
  options: ActionWatchOptions<T> = {},
): ActionWatchResult<T> {
  const { enabled = true, onEvent, onError, onDone } = options;

  const [events, setEvents] = useState<Array<{ type: string; data: T; id?: string }>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  // Stable refs for callbacks so re-renders don't reconnect
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  const onDoneRef = useRef(onDone);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;
  onDoneRef.current = onDone;

  const close = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!enabled || !watchUrl) return;

    const url = `${OpenAPI.BASE ?? ''}/api/v1${watchUrl}`;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsOpen(true);
    setError(null);

    connectSSE({
      url,
      method: 'GET',
      signal: controller.signal,
      onEvent: (raw: SSEEvent) => {
        let parsed: T;
        try {
          parsed = JSON.parse(raw.data) as T;
        } catch {
          parsed = raw.data as unknown as T;
        }
        const entry = { type: raw.type, data: parsed, id: raw.id };
        setEvents((prev) => [...prev, entry]);
        onEventRef.current?.(entry);
      },
      onError: (err) => {
        setError(err);
        setIsOpen(false);
        onErrorRef.current?.(err);
      },
      onDone: () => {
        setIsOpen(false);
        onDoneRef.current?.();
      },
    }).catch(() => {
      // Handled in onError; swallow here.
    });

    return () => {
      controller.abort();
    };
  }, [enabled, watchUrl]);

  return { events, isOpen, error, close };
}
