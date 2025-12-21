'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { AssetRead, AssetKind } from '@/client';
import type { 
  UseFeedAssetsOptions, 
  UseFeedAssetsReturn, 
  AssetFeedItem 
} from './types';
import { TreeNavigationService } from '@/client';

/**
 * useFeedAssets - Hook for fetching feed assets
 * 
 * Uses the /tree/feed API endpoint which:
 * 1. Returns ALL displayable assets regardless of bundle expansion
 * 2. Supports sorting by date (created_at, updated_at)
 * 3. Supports filtering by asset kinds
 * 4. Includes source_metadata for image extraction
 * 
 * This solves the problem of assets in unexpanded bundles not appearing.
 */

const DEFAULT_LIMIT = 20;

export function useFeedAssets(options: UseFeedAssetsOptions): UseFeedAssetsReturn {
  const {
    infospaceId,
    limit = DEFAULT_LIMIT,
    kinds,
    sortBy = 'name',
    sortOrder = 'desc',
  } = options;

  const [items, setItems] = useState<AssetFeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);
  
  const initialLoadDone = useRef(false);
  const currentInfospaceId = useRef<number | null>(null);

  // Convert compound sort (kind-updated_at) to simple sort for API
  const apiSortBy = useMemo(() => {
    if (sortBy === 'kind-updated_at' || sortBy === 'kind-created_at') {
      // For compound sort, we'll sort client-side after fetching
      return sortBy.includes('created_at') ? 'created_at' : 'updated_at';
    }
    return sortBy;
  }, [sortBy]);

  // Fetch feed assets from API
  const fetchFeed = useCallback(async (offset: number = 0, append: boolean = false) => {
    if (!infospaceId || infospaceId <= 0) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await TreeNavigationService.getFeedAssets({
        infospaceId,
        skip: offset,
        limit,
        kinds: kinds as string[] | undefined,
        sortBy: apiSortBy,
        sortOrder,
      });
      
      const feedItems: AssetFeedItem[] = response.assets.map(asset => ({
        asset,
        childAssets: undefined, // Images come from source_metadata
      }));
      
      // If compound sorting by kind, sort client-side
      if (sortBy === 'kind-updated_at' || sortBy === 'kind-created_at') {
        feedItems.sort((a, b) => {
          // Primary: sort by kind
          const kindA = a.asset.kind || '';
          const kindB = b.asset.kind || '';
          if (kindA < kindB) return -1;
          if (kindA > kindB) return 1;
          
          // Secondary: sort by date within same kind
          const dateA = new Date(sortBy.includes('created_at') ? a.asset.created_at : a.asset.updated_at);
          const dateB = new Date(sortBy.includes('created_at') ? b.asset.created_at : b.asset.updated_at);
          return sortOrder === 'desc' 
            ? dateB.getTime() - dateA.getTime()
            : dateA.getTime() - dateB.getTime();
        });
      }
      
      if (append) {
        setItems(prev => [...prev, ...feedItems]);
      } else {
        setItems(feedItems);
      }
      
      setHasMore(response.has_more);
      setTotalCount(response.total);
      setCurrentOffset(offset + feedItems.length);
      
    } catch (err: any) {
      console.error('[useFeedAssets] Error fetching feed:', err);
      setError(err.message || 'Failed to load feed');
    } finally {
      setIsLoading(false);
    }
  }, [infospaceId, limit, kinds, apiSortBy, sortBy, sortOrder]);

  // Initial load
  useEffect(() => {
    // Reset and refetch when infospace changes
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
  }, [kinds, sortBy, sortOrder, fetchFeed]);

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
