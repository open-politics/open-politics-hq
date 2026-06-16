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
  /** Which clause matched — drives the AssetSelector title/content tiers. */
  field?: 'title' | 'body';
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
 * Append ``incoming`` to ``prev`` while keeping the list duplicate-free by
 * asset id. Streaming is idempotent at the item level: the same node can
 * legitimately arrive twice (a ``rank DESC`` cursor page overlapping its
 * predecessor, an SSE re-delivery, a dev StrictMode double-mount), and the
 * render keys rows by ``asset.id`` — so a repeat would crash React with a
 * duplicate-key warning. Merge-by-id makes the result set correct by
 * construction regardless of how the batches arrive.
 */
function mergeResultsById(prev: QueryResult[], incoming: QueryResult[]): QueryResult[] {
  if (incoming.length === 0) return prev;
  if (prev.length === 0) return incoming;
  const seen = new Set(prev.map((r) => r.asset.id));
  const fresh = incoming.filter((r) => !seen.has(r.asset.id));
  return fresh.length === 0 ? prev : [...prev, ...fresh];
}


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
    source_identifier: null,
    facets: (node.facets as any) ?? null,
    processing_status: (node.processing_status ?? undefined) as ProcessingStatus | undefined,
    bundle_ids: node.bundle_ids ?? undefined,
    tags: (node.tags ?? undefined) as any,
  } as unknown as AssetRead;
}


function toQueryResult(node: AssetNode): QueryResult {
  const headline = node.matches?.find((m) => m.snippet)?.snippet ?? null;
  const field = node.matches?.[0]?.field === 'title' ? 'title' : 'body';
  return {
    asset: projectAssetNodeToAssetRead(node),
    score: node.score ?? null,
    highlight: headline,
    field,
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
  // Tracks the stream currently in flight so a new fetch (or unmount) can abort
  // it. Without this, two streams for the *same* query — e.g. a dev StrictMode
  // double-mount, which the activeQuery guard can't tell apart — run at once and
  // interleave their appends into duplicate rows.
  const controllerRef = useRef<AbortController | null>(null);

  const fetchQuery = useCallback(
    async (q: string, append = false, cursor?: string | null) => {
      if (!infospaceId) return;
      const isEmpty = !q.trim() && !parentAssetId && sort === 'relevance';
      if (isEmpty) return;

      // Cancel whatever is still streaming before opening a new connection.
      controllerRef.current?.abort();

      setIsLoading(true);
      if (!append) setError(null);

      const body: Record<string, unknown> = { q, mode: 'text', limit, sort };
      if (cursor) body.cursor = cursor;
      if (parentAssetId) body.scope_hints = { parent_asset_id: parentAssetId };

      const url = `/api/v1/search/infospaces/${infospaceId}/assets/stream`;
      const controller = new AbortController();
      controllerRef.current = controller;
      // Primary now streams as several batches per request. The first batch of a
      // fresh query replaces; every later batch (this stream or a loadMore page)
      // appends — so the list fills in progressively instead of the last small
      // batch clobbering the page.
      let primaryReceived = false;

      try {
        await connectSSE({
          url,
          method: 'POST',
          body,
          signal: controller.signal,
          onEvent: (event) => {
            if (controller.signal.aborted) return;
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
              if (append || primaryReceived) {
                setResults((prev) => mergeResultsById(prev, mapped));
              } else {
                setResults(mapped);
              }
              primaryReceived = true;
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
            if (controller.signal.aborted || activeQuery.current !== q) return;
            setError(err.message);
          },
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (controller.signal.aborted || activeQuery.current !== q) return;
        setError(err instanceof Error ? err.message : 'Query failed');
      } finally {
        // Only the stream that still owns the slot clears the spinner — an
        // aborted predecessor must not flip loading off under its successor.
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [infospaceId, parentAssetId, limit, sort],
  );

  useEffect(() => {
    const isEmpty = !query.trim() && !parentAssetId && sort === 'relevance';
    if (!enabled || isEmpty) {
      controllerRef.current?.abort();
      setResults([]);
      setChildResults([]);
      setTotal(0);
      setHasMore(false);
      setCursorNext(null);
      return;
    }
    fetchQuery(query);
    return () => controllerRef.current?.abort();
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
