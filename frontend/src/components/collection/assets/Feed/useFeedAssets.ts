'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { AssetRead } from '@/client';
import type {
  UseFeedAssetsOptions,
  UseFeedAssetsReturn,
  AssetFeedItem
} from './types';
import { connectSSE } from '@/lib/sse';

/**
 * useFeedAssets - Hook for fetching feed assets
 *
 * Uses the /tree/feed API endpoint with native SSE progressive delivery:
 * - Assets stream first, count arrives later (keepalive pings keep connection alive)
 * - All loads (initial + pagination) use SSE
 */

const DEFAULT_LIMIT = 20;

export function useFeedAssets(options: UseFeedAssetsOptions): UseFeedAssetsReturn {
  const {
    infospaceId,
    limit = DEFAULT_LIMIT,
    kinds,
    sortBy = 'name',
    sortOrder = 'desc',
    bundleId,
    pathFilter,
  } = options;

  const [items, setItems] = useState<AssetFeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);

  const initialLoadDone = useRef(false);
  const currentInfospaceId = useRef<number | null>(null);

  // Convert compound sort to simple sort for API
  const apiSortBy = useMemo(() => {
    if (sortBy === 'kind-updated_at' || sortBy === 'kind-created_at') {
      return sortBy.includes('created_at') ? 'created_at' : 'updated_at';
    }
    return sortBy;
  }, [sortBy]);

  // Client-side compound sort helper
  const applyCompoundSort = useCallback((feedItems: AssetFeedItem[]) => {
    if (sortBy !== 'kind-updated_at' && sortBy !== 'kind-created_at') return feedItems;
    return [...feedItems].sort((a, b) => {
      const kindA = a.asset.kind || '';
      const kindB = b.asset.kind || '';
      if (kindA < kindB) return -1;
      if (kindA > kindB) return 1;
      const dateA = new Date(sortBy.includes('created_at') ? a.asset.created_at : a.asset.updated_at);
      const dateB = new Date(sortBy.includes('created_at') ? b.asset.created_at : b.asset.updated_at);
      return sortOrder === 'desc'
        ? dateB.getTime() - dateA.getTime()
        : dateA.getTime() - dateB.getTime();
    });
  }, [sortBy, sortOrder]);

  const fetchFeed = useCallback(async (offset: number = 0, append: boolean = false) => {
    if (!infospaceId || infospaceId <= 0) return;

    setIsLoading(true);
    setError(null);
    if (!append) setIsCounting(true);

    const params = new URLSearchParams();
    params.set('skip', String(offset));
    params.set('limit', String(limit));
    if (kinds?.length) kinds.forEach(k => params.append('kinds', k));
    if (apiSortBy) params.set('sort_by', apiSortBy);
    if (sortOrder) params.set('sort_order', sortOrder);
    if (bundleId != null) params.set('bundle_id', String(bundleId));
    if (pathFilter) params.set('path_filter', pathFilter);

    const url = `/api/v1/infospaces/${infospaceId}/tree/feed?${params.toString()}`;
    const controller = new AbortController();

    try {
      await connectSSE({
        url,
        method: 'GET',
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'error') {
            try {
              const err = JSON.parse(event.data);
              setError(err.detail ?? 'Failed to load feed');
            } catch {
              setError('Failed to load feed');
            }
            setIsLoading(false);
            setIsCounting(false);
            return;
          }

          let phase: any;
          try { phase = JSON.parse(event.data); } catch { return; }

          if (event.type === 'feed') {
            const feedItems = applyCompoundSort(
              (phase.assets || []).map((asset: AssetRead) => ({ asset, childAssets: undefined }))
            );
            if (append) {
              setItems(prev => [...prev, ...feedItems]);
            } else {
              setItems(feedItems);
            }
            setCurrentOffset(offset + feedItems.length);
            setIsLoading(false);
            if (phase.total >= 0) {
              setTotalCount(phase.total);
              setHasMore(phase.has_more);
              setIsCounting(false);
            }
          }

          if (event.type === 'count') {
            setTotalCount(phase.total);
            setHasMore(phase.has_more);
            setIsCounting(false);
          }
        },
        onError: (err) => {
          setError(err.message);
          setIsLoading(false);
          setIsCounting(false);
        },
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load feed');
      setIsLoading(false);
      setIsCounting(false);
    }
  }, [infospaceId, limit, kinds, apiSortBy, sortBy, sortOrder, bundleId, pathFilter, applyCompoundSort]);

  // Initial load
  useEffect(() => {
    if (infospaceId && infospaceId > 0 && currentInfospaceId.current !== infospaceId) {
      currentInfospaceId.current = infospaceId;
      initialLoadDone.current = false;
      setItems([]);
      setCurrentOffset(0);
    }

    if (!initialLoadDone.current && infospaceId && infospaceId > 0) {
      initialLoadDone.current = true;
      fetchFeed(0, false);
    }
  }, [infospaceId, fetchFeed]);

  // Refetch when sort/filter options change
  useEffect(() => {
    if (initialLoadDone.current && infospaceId && infospaceId > 0) {
      setCurrentOffset(0);
      fetchFeed(0, false);
    }
  }, [kinds, sortBy, sortOrder, bundleId, pathFilter, fetchFeed]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchFeed(currentOffset, true);
    }
  }, [isLoading, hasMore, currentOffset, fetchFeed]);

  const refresh = useCallback(() => {
    setCurrentOffset(0);
    fetchFeed(0, false);
  }, [fetchFeed]);

  return {
    items,
    isLoading,
    error,
    hasMore,
    totalCount,
    loadMore,
    refresh,
  };
}
