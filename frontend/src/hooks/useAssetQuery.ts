'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { request } from '@/client/core/request';
import { OpenAPI } from '@/client/core/OpenAPI';
import type { AssetRead } from '@/client';
import type { ParsedQueryResponse } from '@/lib/query/asset_query_language';

export interface QueryResult {
  asset: AssetRead;
  score: number | null;
  highlight: string | null;
}

interface QueryResponse {
  query: string;
  parsed: ParsedQueryResponse;
  results: QueryResult[];
  total: number;
  has_more: boolean;
  cursor_next: number | null;
}

interface UseAssetQueryOptions {
  infospaceId: number;
  query: string;
  sort?: string;
  limit?: number;
  enabled?: boolean;
}

export function useAssetQuery(options: UseAssetQueryOptions) {
  const { infospaceId, query, sort = 'relevance', limit = 50, enabled = true } = options;

  const [results, setResults] = useState<QueryResult[]>([]);
  const [parsed, setParsed] = useState<ParsedQueryResponse>({});
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cursorNext, setCursorNext] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the active query to avoid stale responses
  const activeQuery = useRef(query);
  activeQuery.current = query;

  const fetchQuery = useCallback(
    async (q: string, append = false, cursor?: number | null, offset?: number) => {
      if (!q.trim() || !infospaceId) return;
      setIsLoading(true);
      if (!append) setError(null);

      try {
        const body: Record<string, unknown> = { q, limit, sort };
        if (append && sort === 'relevance' && offset) {
          body.offset = offset;
        } else if (append && cursor) {
          body.cursor = cursor;
        }

        const response: QueryResponse = await request(OpenAPI, {
          method: 'POST',
          url: '/api/v1/infospaces/{infospace_id}/query',
          path: { infospace_id: infospaceId },
          body,
          mediaType: 'application/json',
        });

        // Guard against stale responses
        if (activeQuery.current !== q) return;

        if (append) {
          setResults((prev) => [...prev, ...response.results]);
        } else {
          setResults(response.results);
          setParsed(response.parsed);
        }
        setTotal(response.total);
        setHasMore(response.has_more);
        setCursorNext(response.cursor_next);
      } catch (err: unknown) {
        if (activeQuery.current !== q) return;
        const msg = err instanceof Error ? err.message : 'Query failed';
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [infospaceId, limit, sort],
  );

  // Auto-search on query change
  useEffect(() => {
    if (!enabled || !query.trim()) {
      setResults([]);
      setParsed({});
      setTotal(0);
      setHasMore(false);
      setCursorNext(null);
      return;
    }
    fetchQuery(query);
  }, [query, enabled, fetchQuery]);

  const search = useCallback(() => fetchQuery(query), [query, fetchQuery]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading) return;
    fetchQuery(query, true, cursorNext, results.length);
  }, [hasMore, isLoading, query, cursorNext, results.length, fetchQuery]);

  return { results, parsed, total, hasMore, isLoading, error, search, loadMore };
}
