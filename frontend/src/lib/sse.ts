/**
 * SSE transport primitive.
 *
 * One function: connectSSE. Handles auth headers, fetch + ReadableStream,
 * SSE frame parsing (id/event/data fields), and AbortSignal cleanup.
 *
 * Does NOT reconnect — callers own that policy (useStream adds backoff,
 * usePhasedQuery doesn't reconnect at all). This keeps the transport
 * layer honest: it connects, delivers events, and exits.
 *
 * Extracted from useIntelligenceChat.tsx to eliminate SSE duplication
 * across hooks.
 */

import { OpenAPI } from '@/client/core/OpenAPI';

export interface SSEEvent {
  id?: string;
  type: string;
  data: string;
}

export interface SSEOptions {
  url: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  lastEventId?: string;
  signal?: AbortSignal;
  onEvent: (event: SSEEvent) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

/**
 * Resolve auth headers from the OpenAPI config, matching the pattern
 * used across the app (OpenAPI.HEADERS resolver → localStorage fallback).
 */
export async function resolveAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  try {
    const maybeHeaders = OpenAPI.HEADERS as any;
    const resolved = typeof maybeHeaders === 'function'
      ? await maybeHeaders({} as any)
      : maybeHeaders;
    if (resolved && typeof resolved === 'object') {
      Object.assign(headers, resolved);
    }
    if (!headers['Authorization'] && typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
  } catch { /* resolver failed, proceed without */ }
  return headers;
}

/**
 * Open an SSE connection, parse frames, deliver events via callback.
 *
 * Resolves when the stream ends naturally. Rejects on network error.
 * Swallows AbortError (normal cleanup).
 */
export async function connectSSE(options: SSEOptions): Promise<void> {
  const {
    url,
    method = 'GET',
    body,
    headers: extraHeaders,
    lastEventId,
    signal,
    onEvent,
    onError,
    onDone,
  } = options;

  const authHeaders = await resolveAuthHeaders();
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...authHeaders,
    ...extraHeaders,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (lastEventId) {
    headers['Last-Event-ID'] = lastEventId;
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error);
    throw error;
  }

  if (!resp.ok || !resp.body) {
    const error = new Error(`SSE connection failed: ${resp.status}`);
    onError?.(error);
    throw error;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are delimited by double newlines
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        if (!block.trim()) continue;

        let eventType = 'message';
        let eventData = '';
        let eventId: string | undefined;

        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData += (eventData ? '\n' : '') + line.slice(6);
          } else if (line.startsWith('id: ')) {
            eventId = line.slice(4).trim();
          }
          // Lines starting with ':' are comments (keepalive), ignored
        }

        if (eventType || eventData) {
          onEvent({ id: eventId, type: eventType, data: eventData });
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error);
    throw error;
  }

  onDone?.();
}
