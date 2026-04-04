'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { connectSSE } from '@/lib/sse';
import type { AssetRead, BundleRead } from '@/client';
import type { ParsedQueryResponse } from '@/lib/query/asset_query_language';

export interface QueryResult {
  asset: AssetRead;
  score: number | null;
  highlight: string | null;
}

export interface NameMatches {
  bundles: BundleRead[];
  assets: QueryResult[];
}

export interface ChildResultGroup {
  parent_asset_id: number;
  parent_title: string;
  matches: QueryResult[];
  total_matches: number;
}

interface QueryResponse {
  query: string;
  parsed: ParsedQueryResponse;
  name_matches: NameMatches;
  results: QueryResult[];
  child_results: ChildResultGroup[];
  total: number;
  has_more: boolean;
  cursor_next: number | null;
}

interface UseAssetQueryOptions {
  infospaceId: number;
  query: string;
  parentAssetId?: number;
  sort?: string;
  limit?: number;
  enabled?: boolean;
}

const EMPTY_NAME_MATCHES: NameMatches = { bundles: [], assets: [] };

export function useAssetQuery(options: UseAssetQueryOptions) {
  const { infospaceId, query, parentAssetId, sort = 'relevance', limit = 50, enabled = true } = options;

  const [nameMatches, setNameMatches] = useState<NameMatches>(EMPTY_NAME_MATCHES);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [childResults, setChildResults] = useState<ChildResultGroup[]>([]);
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
      if (!infospaceId) return;
      if (!q.trim() && !parentAssetId && sort === 'relevance') return;
      setIsLoading(true);
      if (!append) setError(null);

      const body: Record<string, unknown> = { q, limit, sort };
      if (parentAssetId) body.parent_asset_id = parentAssetId;
      if (append && sort === 'relevance' && offset) {
        body.offset = offset;
      } else if (append && cursor) {
        body.cursor = cursor;
      }

      const url = `/api/v1/infospaces/${infospaceId}/query`;
      const controller = new AbortController();

      try {
        await connectSSE({
          url,
          method: 'POST',
          body,
          signal: controller.signal,
          onEvent: (event) => {
            if (activeQuery.current !== q) {
              controller.abort();
              return;
            }

            if (event.type === 'error') {
              try {
                const err = JSON.parse(event.data);
                setError(err.detail ?? 'Query failed');
              } catch {
                setError('Query failed');
              }
              return;
            }

            let phase: Partial<QueryResponse>;
            try {
              phase = JSON.parse(event.data);
            } catch {
              return;
            }

            if (event.type === 'results') {
              if (append) {
                setResults((prev) => [...prev, ...(phase.results ?? [])]);
              } else {
                setNameMatches(phase.name_matches ?? EMPTY_NAME_MATCHES);
                setResults(phase.results ?? []);
                setChildResults(phase.child_results ?? []);
                setParsed(phase.parsed ?? {});
              }
              if (phase.total !== undefined && phase.total >= 0) {
                setTotal(phase.total);
              }
              if (phase.has_more !== undefined) setHasMore(phase.has_more);
              if (phase.cursor_next !== undefined) setCursorNext(phase.cursor_next);
            }

            if (event.type === 'count') {
              if (phase.total !== undefined) setTotal(phase.total);
              if (phase.has_more !== undefined) setHasMore(phase.has_more);
              if (phase.cursor_next !== undefined) setCursorNext(phase.cursor_next);
            }

            if (event.type === 'children') {
              if (phase.child_results) setChildResults(phase.child_results);
            }
          },
          onError: (err) => {
            if (activeQuery.current !== q) return;
            setError(err.message);
          },
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (activeQuery.current !== q) return;
        setError(err instanceof Error ? err.message : 'Query failed');
      } finally {
        setIsLoading(false);
      }
    },
    [infospaceId, parentAssetId, limit, sort],
  );

  // Auto-search on query change
  useEffect(() => {
    const isEmpty = !query.trim() && !parentAssetId && sort === 'relevance';
    if (!enabled || isEmpty) {
      setNameMatches(EMPTY_NAME_MATCHES);
      setResults([]);
      setChildResults([]);
      setParsed({});
      setTotal(0);
      setHasMore(false);
      setCursorNext(null);
      return;
    }
    fetchQuery(query);
  }, [query, parentAssetId, sort, enabled, fetchQuery]);

  const search = useCallback(() => fetchQuery(query), [query, fetchQuery]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoading) return;
    fetchQuery(query, true, cursorNext, results.length);
  }, [hasMore, isLoading, query, cursorNext, results.length, fetchQuery]);

  // total === -1 is the sentinel meaning "count still running".
  const isCounting = total === -1;
  const resolvedTotal = isCounting ? null : total;

  return { nameMatches, results, childResults, parsed, total: resolvedTotal, isCounting, hasMore, isLoading, error, search, loadMore };
}
