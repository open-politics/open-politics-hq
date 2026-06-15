'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Loader2, Search, Rss, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDiscover, DISCOVER_PROVIDERS, type DiscoverInit } from './useDiscover';
import { DiscoverResults } from './DiscoverResults';
import { SearchResultIngestor as ResultIngestor } from '../shared/ResultIngestor';
import { SearchResultViewer, type SearchResultData } from '../shared/ResultViewer';
import { useDock } from '@/zustand_stores/storeDock';
import { DockBack, DockClose } from '../DockNav';
import type { SurfaceContentProps } from '../types';

/**
 * Discover content, container-agnostic. Ingestion + single-result viewing reuse
 * the shared ResultIngestor / ResultViewer (lifted from chat), so destination-
 * bundle routing, inline+scrape split, and job progress come for free.
 */
export function DiscoverPanel({ init, mode, close, back }: SurfaceContentProps<DiscoverInit>) {
  const d = useDiscover(init);
  const openSourceForm = useDock((s) => s.openSourceForm);
  const roomy = mode === 'panel' || mode === 'overlay';
  const docked = mode === 'panel';
  const [showIngestor, setShowIngestor] = React.useState(false);
  const [viewing, setViewing] = React.useState<SearchResultData | null>(null);

  return (
    <div className={cn('flex flex-col', mode === 'panel' ? 'h-full' : mode === 'overlay' ? 'h-[70vh]' : 'max-h-[28rem]')}>
      {/* One inline bar: query · RSS toggle · settings · run. Search and RSS are
          the same flow, only the locator differs (query vs feed URL). */}
      <div className="flex items-center gap-1.5 border-b p-2">
        {docked && back && <DockBack onClick={back} />}
        <Input
          autoFocus
          value={d.query}
          onChange={(e) => d.setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !d.isSearching) d.run(); }}
          placeholder={d.method === 'feed' ? 'https://example.com/feed.xml' : 'Search the web…'}
          className="h-8 flex-1"
        />
        <Button
          variant="ghost" size="icon"
          className={cn('h-8 w-8 shrink-0', d.method === 'feed' && 'bg-muted text-foreground')}
          title={d.method === 'feed' ? 'RSS feed mode — switch to web search' : 'Switch to RSS feed'}
          onClick={() => d.setMethod(d.method === 'feed' ? 'search' : 'feed')}
        >
          <Rss className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Search settings">
              <SlidersHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {d.method === 'search' && (
              <>
                <DropdownMenuLabel className="text-xs">Provider</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={d.provider} onValueChange={d.setProvider}>
                  {DISCOVER_PROVIDERS.map((p) => (
                    <DropdownMenuRadioItem key={p.value} value={p.value} className="text-xs">{p.label}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-xs">{d.method === 'feed' ? 'Max items' : 'Max results'}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(d.maxResults)} onValueChange={(v) => d.setMaxResults(parseInt(v))}>
              {[5, 10, 20, 30].map((n) => (
                <DropdownMenuRadioItem key={n} value={String(n)} className="text-xs">{n}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" className="h-8 shrink-0 px-2.5" onClick={d.run} disabled={d.isSearching || !d.query.trim()}>
          {d.isSearching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        </Button>
        {docked && <DockClose onClick={close} />}
      </div>

      <div className="min-h-0 flex-1 p-2">
        {d.results.length > 0 ? (
          <DiscoverResults
            results={d.results}
            selected={d.selected}
            onToggle={d.toggle}
            onSelectAll={d.selectAll}
            onIngest={() => setShowIngestor(true)}
            onView={setViewing}
            onPromote={d.canPromote ? () => openSourceForm({ init: d.promoteInit() }) : undefined}
            dense={!roomy}
            className="h-full"
          />
        ) : (
          <div className="flex h-full min-h-[8rem] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {d.isSearching
              ? (d.method === 'feed' ? 'Loading feed…' : 'Searching…')
              : d.hasRun
                ? 'No results — try another query or feed URL.'
                : d.method === 'feed'
                  ? 'Paste an RSS feed URL, then pick articles to ingest — or make it a recurrent source.'
                  : 'Search the web, then pick results to ingest — or make it a recurrent source.'}
          </div>
        )}
      </div>

      {/* Shared modals — bundle-aware ingest + full-result viewer (from intake/shared). */}
      <ResultIngestor
        results={d.selectedResults}
        open={showIngestor}
        onClose={() => setShowIngestor(false)}
        onSuccess={() => { d.clearSelection(); setShowIngestor(false); }}
      />
      <SearchResultViewer
        result={viewing}
        open={viewing !== null}
        onClose={() => setViewing(null)}
        onIngest={(r) => {
          const i = d.results.findIndex((x) => x.url === r.url);
          if (i !== -1) d.selectOnly(i);
          setViewing(null);
          setShowIngestor(true);
        }}
      />
    </div>
  );
}
