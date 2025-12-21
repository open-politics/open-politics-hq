/**
 * useTextSearch - Reusable hook for comprehensive text search
 * 
 * Wraps TreeNavigationService.textSearchAssets and handles:
 * - Title, bundle, and fulltext content search
 * - Converting backend results to frontend format
 * - Fetching full asset data from search results
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TreeNavigationService } from '@/client';
import type { AssetRead, AssetKind } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export interface TextSearchResult {
  asset: AssetRead;
  score: number; // 0-1 (will be converted to 0-100)
  match_type: 'title' | 'content' | 'bundle';
  match_context?: string;
}

export interface ScoredAssetItem {
  asset: AssetRead;
  score: number; // 0-100 percentage
  matchType: 'title' | 'content' | 'bundle';
  matchContext?: string;
}

export interface UseTextSearchOptions {
  query: string;
  enabled?: boolean;
  limit?: number;
  bundleId?: number;
  assetKinds?: AssetKind[];
}

export interface UseTextSearchReturn {
  results: ScoredAssetItem[];
  isLoading: boolean;
  error: string | null;
  search: () => Promise<void>;
}

/**
 * Convert score (0-1) to percentage (0-100)
 */
function scoreToPercentage(score: number): number {
  return Math.round(score * 100);
}

export function useTextSearch(options: UseTextSearchOptions): UseTextSearchReturn {
  const { query, enabled = true, limit = 100, bundleId, assetKinds } = options;
  
  const { activeInfospace } = useInfospaceStore();
  
  const [results, setResults] = useState<ScoredAssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const search = useCallback(async () => {
    if (!enabled || !query.trim() || !activeInfospace?.id) {
      setResults([]);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Perform text search
      const response = await TreeNavigationService.textSearchAssets({
        infospaceId: activeInfospace.id,
        query: query.trim(),
        limit,
        assetKinds: assetKinds as any || undefined,
        bundleId: bundleId || undefined,
      });
      
      // Convert results to frontend format
      const scoredAssets: ScoredAssetItem[] = response.results.map((result: TextSearchResult) => ({
        asset: result.asset,
        score: scoreToPercentage(result.score),
        matchType: result.match_type,
        matchContext: result.match_context,
      }));
      
      // Sort by score descending (should already be sorted, but ensure it)
      scoredAssets.sort((a, b) => b.score - a.score);
      
      setResults(scoredAssets);
    } catch (err) {
      console.error('Text search error:', err);
      
      let errorMessage = 'Text search failed';
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    enabled,
    query,
    activeInfospace?.id,
    limit,
    bundleId,
    assetKinds,
  ]);
  
  // Auto-search when query changes (debounced by caller)
  const lastSearchedQueryRef = useRef<string>('');
  
  useEffect(() => {
    const trimmedQuery = query.trim();
    
    // Only search if query actually changed and conditions are met
    if (enabled && trimmedQuery && trimmedQuery !== lastSearchedQueryRef.current) {
      lastSearchedQueryRef.current = trimmedQuery;
      search();
    } else if (!enabled || !trimmedQuery) {
      // Clear results and reset ref when disabled or query is empty
      if (lastSearchedQueryRef.current) {
        lastSearchedQueryRef.current = '';
        setResults([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query]);
  
  return {
    results,
    isLoading,
    error,
    search,
  };
}



