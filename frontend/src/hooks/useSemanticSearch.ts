/**
 * useSemanticSearch - Reusable hook for semantic search
 * 
 * Wraps EmbeddingsService.semanticSearch and handles:
 * - Runtime API keys from provider store
 * - Converting similarity scores to percentages
 * - Fetching full asset data from search results
 * - Auto-detecting if semantic search is available
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { EmbeddingsService, AssetsService, TreeNavigationService } from '@/client';
import type { AssetRead, AssetKind, SemanticSearchRequest, SemanticSearchResponse } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { toast } from 'sonner';

export interface ScoredAssetItem {
  asset: AssetRead;
  score: number; // 0-100 percentage
  chunkPreview?: string;
}

export interface UseSemanticSearchOptions {
  query: string;
  enabled?: boolean;
  limit?: number;
  bundleId?: number;
  parentAssetId?: number;
  assetKinds?: AssetKind[];
  distanceThreshold?: number;
}

export interface UseSemanticSearchReturn {
  results: ScoredAssetItem[];
  isLoading: boolean;
  error: string | null;
  isAvailable: boolean; // Whether semantic search is available for current infospace
  search: () => Promise<void>;
}

/**
 * Check if semantic search is available for the current infospace
 */
function isSemanticSearchAvailable(infospace: { embedding_model?: string | null } | null): boolean {
  return !!infospace?.embedding_model;
}

/**
 * Map frontend provider ID to backend provider name
 * Frontend uses IDs like "openai_embeddings", backend expects "openai"
 */
function mapProviderIdToName(providerId: string): string {
  // Handle common mappings
  if (providerId === 'openai_embeddings') return 'openai';
  if (providerId === 'ollama_embeddings') return 'ollama';
  // These are already correct
  if (providerId === 'voyage') return 'voyage';
  if (providerId === 'jina') return 'jina';
  // Fallback: try to infer from ID
  if (providerId.includes('openai')) return 'openai';
  if (providerId.includes('ollama')) return 'ollama';
  if (providerId.includes('voyage')) return 'voyage';
  if (providerId.includes('jina')) return 'jina';
  // Default: return as-is
  return providerId;
}

/**
 * Convert similarity score (0-1) to percentage (0-100)
 */
function similarityToPercentage(similarity: number): number {
  return Math.round(similarity * 100);
}

/**
 * Extract similarity from search result
 */
function extractSimilarity(result: Record<string, unknown>): number {
  // Backend returns similarity as a number (0-1 range)
  const similarity = result.similarity as number | undefined;
  if (typeof similarity === 'number') {
    return similarity;
  }
  // Fallback: if only distance is available, convert it
  const distance = result.distance as number | undefined;
  if (typeof distance === 'number') {
    // For cosine distance: similarity = 1 - distance
    return Math.max(0, Math.min(1, 1 - distance));
  }
  return 0;
}

export function useSemanticSearch(options: UseSemanticSearchOptions): UseSemanticSearchReturn {
  const { query, enabled = true, limit = 20, bundleId, parentAssetId, assetKinds, distanceThreshold } = options;
  
  const { activeInfospace } = useInfospaceStore();
  const { getApiKey, selections } = useProvidersStore();
  
  const [results, setResults] = useState<ScoredAssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasShownNoEmbeddingsToast = useRef(false);
  
  const isAvailable = isSemanticSearchAvailable(activeInfospace);
  
  const search = useCallback(async () => {
    if (!enabled || !query.trim() || !isAvailable || !activeInfospace?.id) {
      setResults([]);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Get runtime API keys for embedding provider
      const embeddingProviderId = selections.embedding?.providerId;
      const apiKeys: Record<string, string> = {};
      
      if (embeddingProviderId) {
        const apiKey = getApiKey(embeddingProviderId);
        if (apiKey) {
          // Map provider ID to backend provider name
          const providerName = mapProviderIdToName(embeddingProviderId);
          apiKeys[providerName] = apiKey;
        }
      }
      
      // Also try to infer provider from model name and include API key if available
      // This helps when the model name doesn't match the selected provider
      if (activeInfospace?.embedding_model) {
        const modelName = activeInfospace.embedding_model.toLowerCase();
        
        // Infer provider from model name patterns
        if (modelName.includes('text-embedding') && !apiKeys['openai']) {
          const openaiKey = getApiKey('openai_embeddings');
          if (openaiKey) apiKeys['openai'] = openaiKey;
        }
        if (modelName.includes('voyage') && !apiKeys['voyage']) {
          const voyageKey = getApiKey('voyage');
          if (voyageKey) apiKeys['voyage'] = voyageKey;
        }
        if (modelName.includes('jina') && !apiKeys['jina']) {
          const jinaKey = getApiKey('jina');
          if (jinaKey) apiKeys['jina'] = jinaKey;
        }
      }
      
      // Build search request
      const request: SemanticSearchRequest = {
        query: query.trim(),
        limit,
        asset_kinds: assetKinds?.map(k => k as string) || null,
        bundle_id: bundleId || null,
        distance_threshold: distanceThreshold || null,
        distance_function: 'cosine',
        api_keys: Object.keys(apiKeys).length > 0 ? apiKeys : null,
      };
      
      // Perform semantic search
      const response: SemanticSearchResponse = await EmbeddingsService.semanticSearch({
        infospaceId: activeInfospace.id,
        requestBody: request,
      });
      
      // Extract asset IDs and scores from results
      const assetIdToScore = new Map<number, number>();
      const assetIdToChunkPreview = new Map<number, string>();
      
      for (const result of response.results) {
        const assetId = result.asset_id as number | undefined;
        if (!assetId) continue;
        
        const similarity = extractSimilarity(result);
        const score = similarityToPercentage(similarity);
        
        // Keep highest score per asset (multiple chunks can match)
        const currentScore = assetIdToScore.get(assetId);
        if (!currentScore || score > currentScore) {
          assetIdToScore.set(assetId, score);
          
          // Store chunk preview text
          const chunkText = result.chunk_text as string | undefined;
          if (chunkText) {
            assetIdToChunkPreview.set(assetId, chunkText.slice(0, 200));
          }
        }
      }
      
      // Fetch full asset data for unique asset IDs using batch endpoint (single API call!)
      const assetIds = Array.from(assetIdToScore.keys());
      if (assetIds.length === 0) {
        setResults([]);
        return;
      }
      
      // Use TreeNavigationService.batchGetAssets for efficient batch fetching
      // Split into chunks of 100 (API limit) if needed
      const scoredAssets: ScoredAssetItem[] = [];
      const batchSize = 100; // API limit
      
      for (let i = 0; i < assetIds.length; i += batchSize) {
        const batch = assetIds.slice(i, i + batchSize);
        
        try {
          // Single API call for batch of assets using TreeNavigationService
          const assets = await TreeNavigationService.batchGetAssets({
            infospaceId: activeInfospace.id,
            requestBody: { asset_ids: batch },
          });
          
          // Process batch results
          for (const asset of assets) {
            // Apply parent_asset_id filter if specified
            if (parentAssetId !== undefined && asset.parent_asset_id !== parentAssetId) {
              continue;
            }
            
            const score = assetIdToScore.get(asset.id) || 0;
            const chunkPreview = assetIdToChunkPreview.get(asset.id);
            
            scoredAssets.push({
              asset,
              score,
              chunkPreview,
            });
          }
        } catch (err) {
          console.warn(`Failed to batch fetch assets:`, err);
          // Fallback: try individual fetches for this batch (shouldn't happen normally)
          for (const assetId of batch) {
            try {
              const asset = await AssetsService.getAsset({
                infospaceId: activeInfospace.id,
                assetId,
              });
              
              if (parentAssetId !== undefined && asset.parent_asset_id !== parentAssetId) {
                continue;
              }
              
              const score = assetIdToScore.get(assetId) || 0;
              const chunkPreview = assetIdToChunkPreview.get(assetId);
              
              scoredAssets.push({
                asset,
                score,
                chunkPreview,
              });
            } catch (individualErr) {
              console.warn(`Failed to fetch asset ${assetId}:`, individualErr);
            }
          }
        }
      }
      
      // Sort by score descending
      scoredAssets.sort((a, b) => b.score - a.score);
      
      setResults(scoredAssets);
    } catch (err) {
      console.error('Semantic search error:', err);
      
      // Provide helpful error messages
      let errorMessage = 'Semantic search failed';
      let shouldShowError = true;
      
      if (err instanceof Error) {
        const errMsg = err.message.toLowerCase();
        if (errMsg.includes('not found in database') || errMsg.includes('run embedding generation')) {
          // This is expected if embeddings haven't been generated yet
          // Show a helpful toast once, then silently fall back to empty results
          if (!hasShownNoEmbeddingsToast.current && query.trim().length > 0) {
            toast.info('No embeddings found. Generate embeddings first to enable semantic search.', {
              duration: 5000,
            });
            hasShownNoEmbeddingsToast.current = true;
          }
          errorMessage = '';
          shouldShowError = false;
          setResults([]);
          setIsLoading(false);
          return;
        } else if (errMsg.includes('no provider found') || errMsg.includes('provider not found')) {
          errorMessage = 'Embedding provider not configured. Please check your API keys and embedding model settings.';
        } else if (errMsg.includes('api key') || errMsg.includes('authentication')) {
          errorMessage = 'API key required for semantic search. Please configure your embedding provider API key.';
        } else if (errMsg.includes('embedding model')) {
          errorMessage = 'No embedding model configured for this infospace.';
        } else {
          errorMessage = err.message;
        }
      }
      
      if (shouldShowError) {
        setError(errorMessage);
      } else {
        setError(null);
      }
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    enabled,
    query,
    isAvailable,
    activeInfospace?.id,
    limit,
    bundleId,
    parentAssetId,
    assetKinds,
    distanceThreshold,
    getApiKey,
    selections.embedding?.providerId,
  ]);
  
  // Reset toast flag when query changes significantly
  useEffect(() => {
    if (!query.trim()) {
      hasShownNoEmbeddingsToast.current = false;
    }
  }, [query]);
  
  // Auto-search when query changes (debounced by caller)
  // Use a ref to track the last searched query to avoid infinite loops
  const lastSearchedQueryRef = useRef<string>('');
  
  useEffect(() => {
    const trimmedQuery = query.trim();
    
    // Only search if query actually changed and conditions are met
    if (enabled && trimmedQuery && isAvailable && trimmedQuery !== lastSearchedQueryRef.current) {
      lastSearchedQueryRef.current = trimmedQuery;
      search();
    } else if (!enabled || !trimmedQuery || !isAvailable) {
      // Clear results and reset ref when disabled or query is empty
      if (lastSearchedQueryRef.current) {
        lastSearchedQueryRef.current = '';
        setResults([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query, isAvailable]);
  
  return {
    results,
    isLoading,
    error,
    isAvailable,
    search,
  };
}
