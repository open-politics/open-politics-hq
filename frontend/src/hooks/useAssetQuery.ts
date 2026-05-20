'use client';

/**
 * useAssetQuery — thin adapter over the Phase 5 ``/search/assets`` endpoint.
 *
 * The hook signature stays stable for existing consumers (AssetExplorer,
 * AssetManager, AssetSelector, ChannelFeedView, AssetDetailView). Under the
 * hood it now targets ``POST /search/infospaces/{iid}/assets/stream`` and
 * projects ``AssetNode`` items into the legacy ``QueryResult`` shape.
 *
 * Event protocol: ``skeleton → section(role='primary') → count → done``.
 * Empty-query semantics preserved — empty without parent/filter short-circuits
 * to zeros locally.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { connectSSE } from '@/lib/sse';
import type { AssetRead, BundleRead, AssetNode, AssetKind, ProcessingStatus } from '@/client';

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

interface UseAssetQueryOptions {
  infospaceId: number;
  query: string;
  parentAssetId?: number;
  sort?: string;
  limit?: number;
  enabled?: boolean;
}

const EMPTY_NAME_MATCHES: NameMatches = { bundles: [], assets: [] };


/**
 * Project a polymorphic ``AssetNode`` into the legacy partial-``AssetRead``
 * shape consumed by the search UI. Display-only fields; consumers that need
 * ``text_content`` / ``blob_path`` still call ``useTreeStore.getFullAsset``.
 */
function projectAssetNodeToAssetRead(node: AssetNode): AssetRead {
  const numericId = (() => {
    const m = node.id.match(/^(?:asset|bundle|vfolder)-(\d+)/);
    return m ? Number(m[1]) : 0;
  })();
  return {
    id: numericId,
    uuid: node.id,
    title: node.name,
    kind: (node.kind ?? 'text') as AssetKind,
    stub: node.stub ?? false,
    parent_asset_id: node.parent_asset_id ?? null,
    part_index: node.part_index ?? null,
    infospace_id: 0, // not carried on AssetNode; caller knows its context
    source_id: null,
    created_at: node.created_at ?? node.updated_at,
    text_content: null,
    blob_path: null,
    logical_path: null,
    source_identifier: null,
    facets: (node.facets as any) ?? null,
    processing_status: (node.processing_status ?? undefined) as ProcessingStatus | undefined,
    bundle_ids: node.bundle_ids ?? undefined,
    tags: (node.tags ?? undefined) as any,
  } as unknown as AssetRead;
}


function toQueryResult(node: AssetNode): QueryResult {
  const headline = node.matches?.find((m) => m.snippet)?.snippet ?? null;
  return {
    asset: projectAssetNodeToAssetRead(node),
    score: node.score ?? null,
    highlight: headline,
  };
}


export function useAssetQuery(options: UseAssetQueryOptions) {
  const { infospaceId, query, parentAssetId, sort = 'relevance', limit = 50, enabled = true } = options;

  const [nameMatches] = useState<NameMatches>(EMPTY_NAME_MATCHES);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [childResults, setChildResults] = useState<ChildResultGroup[]>([]);
  const [parsed] = useState<Record<string, unknown>>({});
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cursorNext, setCursorNext] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeQuery = useRef(query);
  activeQuery.current = query;

  const fetchQuery = useCallback(
    async (q: string, append = false, cursor?: string | null) => {
      if (!infospaceId) return;
      const isEmpty = !q.trim() && !parentAssetId && sort === 'relevance';
      if (isEmpty) return;

      setIsLoading(true);
      if (!append) setError(null);

      const body: Record<string, unknown> = { q, mode: 'text', limit, sort };
      if (cursor) body.cursor = cursor;
      if (parentAssetId) body.scope_hints = { parent_asset_id: parentAssetId };

      const url = `/api/v1/search/infospaces/${infospaceId}/assets/stream`;
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

            let payload: any;
            try { payload = JSON.parse(event.data); } catch { return; }

            if (event.type === 'section' && payload.role === 'primary') {
              const section = payload.section ?? {};
              const items: AssetNode[] = section.items ?? [];
              const mapped = items.map(toQueryResult);
              if (append) {
                setResults((prev) => [...prev, ...mapped]);
              } else {
                setResults(mapped);
              }
              if (typeof section.total === 'number' && section.total >= 0) {
                setTotal(section.total);
              }
              setHasMore(!!section.has_more);
              setCursorNext(section.cursor_next ?? null);
            }

            if (event.type === 'section' && payload.role === 'grouped') {
              const section = payload.section ?? {};
              const parentId = Number(
                (section.at_parent ?? '').replace(/^asset-/, '')
              );
              if (!Number.isFinite(parentId) || parentId <= 0) return;
              const childItems: AssetNode[] = section.items ?? [];
              const group: ChildResultGroup = {
                parent_asset_id: parentId,
                parent_title: section.at_parent ?? `Asset #${parentId}`,
                matches: childItems.map(toQueryResult),
                total_matches: section.total ?? childItems.length,
              };
              setChildResults((prev) => {
                const next = prev.filter((g) => g.parent_asset_id !== parentId);
                next.push(group);
                return next;
              });
            }

            if (event.type === 'count') {
              if (typeof payload.total === 'number') setTotal(payload.total);
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

  useEffect(() => {
    const isEmpty = !query.trim() && !parentAssetId && sort === 'relevance';
    if (!enabled || isEmpty) {
      setResults([]);
      setChildResults([]);
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
    fetchQuery(query, true, cursorNext);
  }, [hasMore, isLoading, query, cursorNext, fetchQuery]);

  const isCounting = total === -1;
  const resolvedTotal = isCounting ? null : total;

  return { nameMatches, results, childResults, parsed, total: resolvedTotal, isCounting, hasMore, isLoading, error, search, loadMore };
}
