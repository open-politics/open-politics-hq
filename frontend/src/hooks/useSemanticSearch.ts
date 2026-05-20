/**
 * useSemanticSearch — vector asset search via the Phase 5 unified endpoint.
 *
 * Pre-Phase 5 this hook hit ``POST /embeddings/search`` which was deleted
 * alongside the embedding services. The hook now delegates to
 * ``POST /search/assets`` with ``mode="vector"``; the backend ``AssetQuery``
 * runs pgvector under the hood. BYOK keys still flow through so cloud
 * embedding providers work.
 *
 * Hook signature preserved for the two consumers (AssetManager,
 * AssetDetailView) — they keep reading ``{ results, isLoading, error,
 * isAvailable, search }`` with ``ScoredAssetItem`` items.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchService } from '@/client';
import type {
  AssetRead,
  AssetKind,
  AssetSearch,
  AssetSearchRequest,
} from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { useTreeStore } from '@/zustand_stores/storeTree';
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
  isAvailable: boolean;
  search: () => Promise<void>;
}


function isSemanticSearchAvailable(
  infospace: { enrichment_config?: { embedding?: { model_name?: string | null } | null } | null } | null,
): boolean {
  return !!(infospace?.enrichment_config as any)?.embedding?.model_name;
}


function similarityToPercentage(score: number | null | undefined): number {
  if (typeof score !== 'number') return 0;
  // AssetQuery returns relevance/similarity scores in [0, 1] for vector mode.
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}


function parseAssetNodeId(id: string): number | null {
  const m = id.match(/^asset-(\d+)$/);
  return m ? Number(m[1]) : null;
}


export function useSemanticSearch(options: UseSemanticSearchOptions): UseSemanticSearchReturn {
  const { query, enabled = true, limit = 20, bundleId, parentAssetId, assetKinds } = options;

  const { activeInfospace } = useInfospaceStore();
  const { selections } = useProvidersStore();

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
      const request: AssetSearchRequest = {
        q: query.trim(),
        mode: 'vector',
        limit,
        sort: 'relevance',
        scope_hints: {
          bundle_ids: bundleId ? [bundleId] : [],
          asset_ids: [],
          kinds: (assetKinds as any) ?? [],
          facets: {},
          parent_asset_id: parentAssetId ?? null,
        },
      } as unknown as AssetSearchRequest;

      const envelope: AssetSearch = await SearchService.assetSearch({
        infospaceId: activeInfospace.id,
        requestBody: request,
      });

      // Pull numeric ids from AssetNode, fetch AssetRead batch for full fields
      const scored: { assetId: number; score: number; snippet?: string }[] = [];
      for (const item of envelope.primary.items ?? []) {
        const assetId = parseAssetNodeId(item.id);
        if (assetId === null) continue;
        const score = similarityToPercentage(item.score);
        const snippet = item.matches?.find((m) => m.snippet)?.snippet ?? undefined;
        scored.push({ assetId, score, snippet: snippet ?? undefined });
      }

      if (scored.length === 0) {
        setResults([]);
        return;
      }

      // Batch fetch full AssetRead via the store — it chunks around the
      // backend's 100-id per-request cap and primes the shared cache.
      const assets: AssetRead[] = await useTreeStore
        .getState()
        .batchGetAssets(scored.map((s) => s.assetId));

      const byId = new Map(assets.map((a) => [a.id, a]));
      const merged: ScoredAssetItem[] = [];
      for (const s of scored) {
        const asset = byId.get(s.assetId);
        if (!asset) continue;
        merged.push({ asset, score: s.score, chunkPreview: s.snippet });
      }
      merged.sort((a, b) => b.score - a.score);
      setResults(merged);
    } catch (err) {
      console.error('Semantic search error:', err);
      let errorMessage = 'Semantic search failed';

      if (err instanceof Error) {
        const errMsg = err.message.toLowerCase();
        if (errMsg.includes('not found in database') || errMsg.includes('run embedding generation')) {
          if (!hasShownNoEmbeddingsToast.current && query.trim().length > 0) {
            toast.info('No embeddings found. Generate embeddings first to enable semantic search.', { duration: 5000 });
            hasShownNoEmbeddingsToast.current = true;
          }
          setError(null);
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

      setError(errorMessage);
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
    selections.embedding?.providerId,
  ]);

  useEffect(() => {
    if (!query.trim()) hasShownNoEmbeddingsToast.current = false;
  }, [query]);

  const lastSearchedQueryRef = useRef<string>('');
  useEffect(() => {
    const trimmedQuery = query.trim();
    if (enabled && trimmedQuery && isAvailable && trimmedQuery !== lastSearchedQueryRef.current) {
      lastSearchedQueryRef.current = trimmedQuery;
      search();
    } else if (!enabled || !trimmedQuery || !isAvailable) {
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
