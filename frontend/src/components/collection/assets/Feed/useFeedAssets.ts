'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { AssetRead, AssetNode, AssetKind } from '@/client';
import type {
  UseFeedAssetsOptions,
  UseFeedAssetsReturn,
  AssetFeedItem
} from './types';
import { connectSSE } from '@/lib/sse';

// AssetNode ids arrive prefixed ("asset-91350"); strip to numeric for AssetRead.id.
const nodeToAsset = (node: AssetNode, infospaceId: number): AssetRead => {
  const numericId = Number(String(node.id).split('-').pop()) || 0;
  return {
    id: numericId,
    uuid: '',
    title: node.name,
    kind: (node.kind ?? 'unknown') as AssetKind,
    stub: node.stub ?? false,
    parent_asset_id: node.parent_asset_id ?? null,
    part_index: node.part_index ?? null,
    infospace_id: infospaceId,
    source_id: null,
    created_at: node.created_at ?? node.updated_at,
    updated_at: node.updated_at,
    processing_status: node.processing_status ?? undefined,
    tags: node.tags ?? [],
    facets: node.facets ?? null,
    is_container: Boolean(node.has_children),
  } as AssetRead;
};

/**
 * useFeedAssets - Hook for fetching feed assets
 *
 * Subscribes to /tree/feed/stream (native SSE). render_feed emits:
 *   skeleton → section(role="primary") → count → done
 * We map section.items (AssetNode[]) into AssetFeedItem[] and clear loading
 * on section/count/done as they arrive.
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

    const url = `/api/v1/infospaces/${infospaceId}/tree/feed/stream?${params.toString()}`;
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

          // `section` (role="primary") carries the AssetNode items. total=-1
          // is a sentinel meaning "count still pending"; the CountEvent
          // that follows resolves it.
          if (event.type === 'section' && phase?.role === 'primary') {
            const section = phase.section ?? {};
            const nodes: AssetNode[] = Array.isArray(section.items) ? section.items : [];
            const feedItems = applyCompoundSort(
              nodes
                .filter(n => n.type === 'asset')
                .map(n => ({ asset: nodeToAsset(n, infospaceId), childAssets: undefined }))
            );
            if (append) {
              setItems(prev => [...prev, ...feedItems]);
            } else {
              setItems(feedItems);
            }
            setCurrentOffset(offset + feedItems.length);
            setIsLoading(false);
            if (typeof section.has_more === 'boolean') setHasMore(section.has_more);
            if (typeof section.total === 'number' && section.total >= 0) {
              setTotalCount(section.total);
              setIsCounting(false);
            }
          }

          if (event.type === 'count' && typeof phase?.total === 'number') {
            setTotalCount(phase.total);
            setIsCounting(false);
          }

          if (event.type === 'done') {
            setIsLoading(false);
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
