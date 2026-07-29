'use client';

import { useMemo } from 'react';
import type { AssetNode } from '@/client';
import { useTreeStore } from '@/zustand_stores/storeTree';

/**
 * useAssetTree — one tree source, two modes.
 *
 * Returns exactly the structure interface AssetSelector reads from the tree store
 * ({ rootNodes, childrenCache, … , fetchRootTree, fetchChildren }), so the selector's
 * rendering, lazy-expand, and load-more are identical whether it's browsing or
 * searching. With a `query` it routes to the isolated result-tree slice
 * (`/tree(/children)?q=`); without one it delegates to the shared browse cache
 * verbatim, so every other consumer of the store is untouched.
 *
 * The mutation / full-asset caches (getFullAsset, clearCache, …) are
 * query-independent and stay on `useTreeStore` directly — this hook only owns the
 * structure + its fetchers.
 */

const EMPTY_NODES: AssetNode[] = [];
const EMPTY_MAP = new Map<string, AssetNode[]>();
const EMPTY_BOOL_MAP = new Map<string, boolean>();
const EMPTY_SET = new Set<string>();

export interface AssetTreeSource {
  rootNodes: AssetNode[];
  childrenCache: Map<string, AssetNode[]>;
  hasMoreChildren: Map<string, boolean>;
  isLoadingRoot: boolean;
  isLoadingChildren: Set<string>;
  fetchRootTree: () => Promise<void> | void;
  fetchChildren: (parentId: string, skip?: number, limit?: number) => Promise<unknown>;
}

export function useAssetTree(query?: string): AssetTreeSource {
  const q = (query ?? '').trim();

  // Subscribe to both slices; pick per render. Browse fields are read whether or
  // not we use them (hooks can't be conditional), which is fine — they're cheap.
  const browseRoot = useTreeStore((s) => s.rootNodes);
  const browseChildren = useTreeStore((s) => s.childrenCache);
  const browseHasMore = useTreeStore((s) => s.hasMoreChildren);
  const browseLoadingRoot = useTreeStore((s) => s.isLoadingRoot);
  const browseLoadingChildren = useTreeStore((s) => s.isLoadingChildren);
  const search = useTreeStore((s) => s.search);

  // Only honour the search slice once it actually belongs to the active query,
  // so a stale slice from the previous keystroke never flashes.
  const active = q && search && search.query === q ? search : null;

  // Fetchers depend ONLY on the query — stable across data changes, so an effect
  // keyed on them fires on query change, not on every tree update.
  const fetchers = useMemo(
    () =>
      q
        ? {
            fetchRootTree: () => useTreeStore.getState().fetchSearchTree(q),
            fetchChildren: (parentId: string, skip = 0) =>
              useTreeStore.getState().fetchSearchChildren(parentId, q, skip),
          }
        : {
            fetchRootTree: () => useTreeStore.getState().fetchRootTree(),
            fetchChildren: (parentId: string, skip = 0, limit = 50) =>
              useTreeStore.getState().fetchChildren(parentId, skip, limit),
          },
    [q],
  );

  if (q) {
    return {
      rootNodes: active?.rootNodes ?? EMPTY_NODES,
      childrenCache: active?.childrenCache ?? EMPTY_MAP,
      hasMoreChildren: active?.hasMoreChildren ?? EMPTY_BOOL_MAP,
      // No slice yet for this query → treat as loading so we show a spinner, not "empty".
      isLoadingRoot: active ? active.isLoadingRoot : true,
      isLoadingChildren: active?.isLoadingChildren ?? EMPTY_SET,
      ...fetchers,
    };
  }
  return {
    rootNodes: browseRoot,
    childrenCache: browseChildren,
    hasMoreChildren: browseHasMore,
    isLoadingRoot: browseLoadingRoot,
    isLoadingChildren: browseLoadingChildren,
    ...fetchers,
  };
}
