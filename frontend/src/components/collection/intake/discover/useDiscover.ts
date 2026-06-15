'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SearchService, AssetsService } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import type { SearchResultData } from '../shared/ResultViewer';

/**
 * Headless logic for the Discover flow (web search now; RSS feed folds in as a
 * second `method` — same results → ingest → promote pipeline). Results are the
 * canonical `SearchResultData` so the shared ResultViewer/ResultIngestor (lifted
 * out of chat) consume them directly. State lives here so the surface can re-host
 * popover↔overlay without resetting a draft.
 */

export type DiscoverMethod = 'search' | 'feed';

export interface DiscoverInit {
  method?: DiscoverMethod;
  query?: string;
}

export const DISCOVER_PROVIDERS = [
  { value: 'tavily', label: 'Tavily', description: 'AI-powered web search' },
  { value: 'searxng', label: 'SearXNG', description: 'Privacy-focused metasearch' },
  { value: 'exa', label: 'Exa', description: 'Neural search engine' },
];

/** Normalize a raw web-search hit into the canonical result shape. */
function toResult(r: any, provider: string, query: string): SearchResultData {
  return {
    title: r.title || 'Untitled',
    url: r.url,
    content: r.content || '',
    text_content: r.raw_content || undefined,
    score: r.score,
    provider,
    source_metadata: {
      search_query: query,
      search_provider: provider,
      favicon: r.favicon,
      tavily_images: r.raw?.tavily_images,
    },
  };
}

/** Normalize an RSS feed item into the same canonical shape. */
function toFeedResult(item: any, feedUrl: string): SearchResultData {
  return {
    title: item.title || 'Untitled',
    url: item.link,
    content: item.summary || '',
    provider: 'rss',
    source_metadata: {
      search_query: feedUrl,
      search_provider: 'rss',
      published_date: item.published,
    },
  };
}

export function useDiscover(init?: DiscoverInit) {
  const { activeInfospace } = useInfospaceStore();
  const { apiKeys, selections, setSelection } = useProvidersStore();

  const [method, setMethod] = useState<DiscoverMethod>(init?.method ?? 'search');
  const [query, setQuery] = useState(init?.query ?? '');
  // Provider is the saved web-search default (providers store / profile
  // provider_defaults) — never a hardcoded literal or env. Picking one in the
  // bar's settings dropdown updates that saved selection. The out-of-box default
  // is seeded in the store's `selections`.
  const provider = selections.web_search.providerId;
  const setProvider = (providerId: string) => setSelection('web_search', { providerId });
  const [maxResults, setMaxResults] = useState(10);
  const [results, setResults] = useState<SearchResultData[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const run = useCallback(async () => {
    if (!query.trim()) { toast.error(method === 'feed' ? 'Enter a feed URL' : 'Enter a search query'); return; }
    if (!activeInfospace) { toast.error('Select an active infospace'); return; }
    setIsSearching(true);
    setResults([]);
    setSelected(new Set());
    try {
      if (method === 'feed') {
        // Feed and search are the same flow — only the locator differs (feed URL
        // vs query). Items normalize into the same shape and ingest identically.
        const response: any = await AssetsService.previewRssFeed({
          infospaceId: activeInfospace.id,
          feedUrl: query.trim(),
          maxItems: maxResults,
        });
        const items = response?.items || [];
        setResults(items.map((it: any) => toFeedResult(it, query.trim())));
        setHasRun(true);
        toast.success(`Found ${items.length} article${items.length === 1 ? '' : 's'}`);
      } else {
        const response = await SearchService.webSearchAndIngest({
          requestBody: {
            query,
            provider,
            limit: maxResults,
            infospace_id: activeInfospace.id,
            scrape_content: false,
            create_assets: false,
            api_key: apiKeys[provider] || undefined,
          },
        });
        setResults((response.results || []).map((r: any) => toResult(r, provider, query)));
        setHasRun(true);
        toast.success(`Found ${response.results_found || 0} results`);
      }
    } catch (e) {
      toast.error(`${method === 'feed' ? 'Feed preview' : 'Search'} failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsSearching(false);
    }
  }, [method, query, provider, maxResults, activeInfospace, apiKeys]);

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected((prev) => (prev.size === results.length ? new Set() : new Set(results.map((_, i) => i))));
  }, [results]);

  const selectOnly = useCallback((i: number) => setSelected(new Set([i])), []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectedResults = useMemo(
    () => Array.from(selected).map((i) => results[i]).filter(Boolean),
    [selected, results],
  );

  /** Init payload that promotes this query/feed into a recurrent source via SourceForm. */
  const promoteInit = useCallback(() => (
    method === 'feed'
      ? { kind: 'rss' as const, name: query, config: { feed_url: query }, startStep: 'stream' as const, lockKind: true }
      : { kind: 'web_search' as const, name: query, config: { query, max_results: maxResults }, startStep: 'stream' as const, lockKind: true }
  ), [method, query, maxResults]);

  return {
    method, setMethod,
    query, setQuery,
    provider, setProvider,
    maxResults, setMaxResults,
    results, selected, toggle, selectAll, selectOnly, clearSelection, selectedResults,
    isSearching, hasRun,
    run, promoteInit,
    canPromote: query.trim().length > 0,
  };
}
