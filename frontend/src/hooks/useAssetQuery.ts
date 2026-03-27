'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { request } from '@/client/core/request';
import { OpenAPI } from '@/client/core/OpenAPI';
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
      // Allow empty queries in browse mode (non-relevance sort) for feed/channel usage
      if (!q.trim() && !parentAssetId && sort === 'relevance') return;
      setIsLoading(true);
      if (!append) setError(null);

      try {
        const body: Record<string, unknown> = { q, limit, sort };
        if (parentAssetId) body.parent_asset_id = parentAssetId;
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
          setNameMatches(response.name_matches ?? EMPTY_NAME_MATCHES);
          setResults(response.results);
          setChildResults(response.child_results ?? []);
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
    [infospaceId, parentAssetId, limit, sort],
  );

  // Auto-search on query change
  useEffect(() => {
    // Allow empty queries in browse mode (non-relevance sort) for feed/channel usage
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

  return { nameMatches, results, childResults, parsed, total, hasMore, isLoading, error, search, loadMore };
}
