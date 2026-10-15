'use client';

/**
 * useAssetPages — a paged list of assets behind something you clicked.
 *
 * The drill column's data, whatever opened it: a place or an entity in the
 * overview (`useOverviewAssets`), a node or a selection in the network panel.
 * Each caller says what it is asking with a `key` and how to fetch one page;
 * the paging, the memory and the hand-over between readings live here once.
 *
 * - The previous list stays on screen while the next one loads (`stale`), so
 *   brushing time, switching mode or clicking the next node never empties the
 *   panel.
 * - First pages are remembered for the session: reopening something you looked
 *   at a moment ago costs nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OverviewAsset } from '@/client';

export interface AssetPage {
  items: OverviewAsset[];
  total: number;
}

export interface AssetPages {
  items: OverviewAsset[];
  total: number | null;
  loading: boolean;
  error: string | null;
  /** What is on screen belongs to an earlier question; the new one is loading. */
  stale: boolean;
  hasMore: boolean;
  more: () => void;
}

export const PAGE_SIZE = 50;
const FIRST_PAGES = new Map<string, AssetPage>();
const MAX_REMEMBERED = 64;

function remember(key: string, page: AssetPage) {
  FIRST_PAGES.delete(key);
  FIRST_PAGES.set(key, page);
  while (FIRST_PAGES.size > MAX_REMEMBERED) FIRST_PAGES.delete(FIRST_PAGES.keys().next().value!);
}

const message = (err: any, fallback: string) => err?.body?.detail ?? err?.message ?? fallback;

/**
 * @param key   What is being asked — null when nothing is open. Must change
 *              exactly when the answer would.
 * @param fetch One page at `offset`. Read at call time, so it may close over
 *              the latest request without being a dependency.
 */
export function useAssetPages(
  key: string | null,
  fetch: (offset: number, limit: number) => Promise<AssetPage>,
): AssetPages {
  const [page, setPage] = useState<AssetPage | null>(() => (key ? FIRST_PAGES.get(key) ?? null : null));
  const [shownKey, setShownKey] = useState<string | null>(key && FIRST_PAGES.has(key) ? key : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(key);
  live.current = key;
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  useEffect(() => {
    if (!key) { setPage(null); setShownKey(null); setError(null); setLoading(false); return; }
    const cached = FIRST_PAGES.get(key);
    if (cached) { setPage(cached); setShownKey(key); setError(null); return; }
    let current = true;
    setLoading(true);
    setError(null);
    fetchRef.current(0, PAGE_SIZE)
      .then((res) => {
        if (!current) return;
        const first = { items: res.items, total: res.total };
        remember(key, first);
        setPage(first);
        setShownKey(key);
      })
      .catch((err) => current && setError(message(err, 'Could not load assets')))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [key]);

  const more = useCallback(async () => {
    if (!key || !page || loading || page.items.length >= page.total || shownKey !== key) return;
    setLoading(true);
    try {
      const res = await fetchRef.current(page.items.length, PAGE_SIZE);
      if (live.current === key) {
        setPage((p) => (p ? { items: [...p.items, ...res.items], total: res.total } : p));
      }
    } catch (err) {
      if (live.current === key) setError(message(err, 'Could not load more'));
    } finally {
      if (live.current === key) setLoading(false);
    }
  }, [key, page, loading, shownKey]);

  return {
    items: page?.items ?? [],
    total: page?.total ?? null,
    loading,
    error,
    stale: !!page && shownKey !== key,
    hasMore: !!page && shownKey === key && page.items.length < page.total,
    more,
  };
}
