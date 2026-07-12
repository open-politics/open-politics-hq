/**
 * Search Web Renderer
 * 
 * Renders web search results with rich previews, selection, and ingestion capabilities
 */

import React, { useState } from 'react';
import { ToolResultRenderProps } from '../shared/types';
import { useSelection } from '../shared/hooks';
import { resolveMarkdownUrls, formatPercentage, formatCount } from '../shared/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
// NOTE: intentionally NOT using Radix ScrollArea here — its viewport inserts an
// inner `display: table` wrapper that sizes to content width, defeating any
// `min-w-0` chain above and overflowing the card. Plain `overflow-y-auto` div
// is bounded by parent width as expected.
import {
  Globe,
  Calendar,
  Image as ImageIcon,
  Eye,
  Download,
  Check,
  Search,
  Sparkles,
  ExternalLink,
  Link as LinkIcon,
  XCircle,
  Repeat,
  Loader2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { SourceForm } from '@/components/collection/intake/sources/SourceForm';
import { SearchResultViewer, SearchResultData } from '@/components/collection/intake/shared/ResultViewer';
import { SearchResultIngestor } from '@/components/collection/intake/shared/ResultIngestor';
import { useIngestionJobStatus } from '@/hooks/useIngestionJobStatus';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

export interface SearchWebResult {
  query: string;
  provider: string;
  results: SearchResultData[];
  total_found: number;
  message: string;
}

/**
 * The current ``web_research`` MCP tool nests its search payload under
 * ``result.search`` (and may also carry ``result.ingestion``). The legacy
 * ``search_web`` returned the search fields at the top level. Unwrap so the
 * same renderer handles every shape — alias-registered for both tool names:
 *   • nested search (+ optional ingestion)  → web_research with a query
 *   • flat search                           → legacy search_web
 *   • ingestion only, no search             → web_research(ingest_urls=…)
 */
function _unwrap(result: any): { search: any; ingestion: any | null } {
  if (!result || typeof result !== 'object') return { search: null, ingestion: null };
  const ingestion = (result.ingestion && typeof result.ingestion === 'object') ? result.ingestion : null;
  // Nested shape (web_research with a search).
  if (result.search && typeof result.search === 'object' && Array.isArray(result.search.results)) {
    return { search: result.search, ingestion };
  }
  // Legacy flat shape (search_web): results at the top level.
  if (Array.isArray(result.results)) {
    return { search: result, ingestion };
  }
  // No search payload — e.g. ingest-only web_research. Keep ``search`` null so the
  // renderer shows just the ingestion indicator instead of an empty search header.
  return { search: null, ingestion };
}

/**
 * Live, status-aware ingestion summary.
 *
 * The async-intake rework means a ``web_research`` ingestion returns
 * ``{status:"queued", job_id, urls_processed, bundle_id}`` — work is *minted*,
 * not finished. The stored tool result is a frozen snapshot, so on its own it
 * would read "queued" forever. We therefore attach to the ``IngestionJob`` by
 * id (``useIngestionJobStatus``) and let the indicator advance on its own:
 * queued → processing (with progress) → ingested / failed. Polling stops the
 * moment the job settles. Older synchronous shapes (``ingested`` /
 * ``assets_created`` / ``asset_ids``) and snapshots with no ``job_id`` render
 * statically from whatever the payload carried. The destination bundle is
 * clickable so the user can jump straight to where the documents land.
 */
function IngestionIndicator({
  ingestion,
  onBundleClick,
}: {
  ingestion: any;
  onBundleClick?: (bundleId: number) => void;
}) {
  const obj = (ingestion && typeof ingestion === 'object') ? ingestion : null;
  const snapshotStatus = String(obj?.status ?? '').toLowerCase();
  const jobId: number | undefined =
    typeof obj?.job_id === 'number'
      ? obj.job_id
      : (Array.isArray(obj?.ingestion_job_ids) && typeof obj.ingestion_job_ids[0] === 'number'
          ? obj.ingestion_job_ids[0]
          : undefined);

  // Only poll while the snapshot says the work isn't finished — a terminal
  // snapshot (or one with no job to follow) renders statically. Hook is called
  // unconditionally (rules-of-hooks) and no-ops when disabled / jobId is null.
  const observe =
    !!obj &&
    snapshotStatus !== 'noop' &&
    !['completed', 'failed', 'cancelled'].includes(snapshotStatus);
  const liveJob = useIngestionJobStatus(jobId ?? null, { enabled: observe });

  if (!obj || snapshotStatus === 'noop') return null;

  // Effective state: prefer the live job once we have it, else the snapshot.
  // The snapshot's synthetic "queued" maps onto the active band below.
  const effStatus = (liveJob?.status ?? snapshotStatus) as string;
  const isFailed = ['failed', 'cancelled'].includes(effStatus);
  const isDone = effStatus === 'completed';
  const isActive = !isFailed && !isDone;

  const total =
    liveJob?.total_files ??
    obj.urls_processed ??
    obj.ingested ??
    obj.assets_created ??
    (Array.isArray(obj.assets) ? obj.assets.length : undefined) ??
    (Array.isArray(obj.asset_ids) ? obj.asset_ids.length : undefined) ??
    0;
  const processed =
    liveJob?.processed_files ??
    obj.ingested ??
    obj.assets_created ??
    (isDone ? total : 0);
  const failed = liveJob?.failed_files ?? obj.failed ?? obj.urls_failed ?? 0;
  const bundleId: number | null = obj.bundle_id ?? liveJob?.root_bundle_id ?? null;
  const hasFailures = failed > 0;

  const noun = (n: number) => (n === 1 ? 'URL' : 'URLs');

  // Icon + tone per phase. Done-with-failures and outright failure both warn.
  const Icon = isActive ? Loader2 : isFailed ? AlertCircle : hasFailures ? AlertCircle : CheckCircle2;
  const tone = isActive
    ? 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/70 dark:border-blue-900/50'
    : isFailed
      ? 'bg-red-50/60 dark:bg-red-950/20 border-red-200/70 dark:border-red-900/50'
      : hasFailures
        ? 'bg-yellow-50/60 dark:bg-yellow-950/20 border-yellow-200/70 dark:border-yellow-900/50'
        : 'bg-green-50/60 dark:bg-green-950/20 border-green-200/70 dark:border-green-900/50';
  const iconTone = isActive
    ? 'text-blue-600 dark:text-blue-400 animate-spin'
    : isFailed
      ? 'text-red-600 dark:text-red-400'
      : hasFailures
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-green-600 dark:text-green-400';

  // Lead text per phase.
  let lead: React.ReactNode;
  if (isFailed) {
    lead = <>Ingestion {effStatus === 'cancelled' ? 'cancelled' : 'failed'}</>;
  } else if (isDone) {
    lead = <>Ingested <span className="font-medium">{processed}</span> {noun(processed)}</>;
  } else if (liveJob && processed > 0 && total > 0) {
    // Mid-flight with progress.
    lead = <>Ingesting <span className="font-medium">{processed}/{total}</span> {noun(total)}</>;
  } else {
    lead = <>Queued <span className="font-medium">{total}</span> {noun(total)}</>;
  }

  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] min-w-0", tone)}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", iconTone)} />
      <span className="min-w-0 flex-1 truncate text-foreground/90">
        {lead}
        {bundleId != null && !isFailed && (
          <>
            {' '}into{' '}
            {onBundleClick ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onBundleClick(bundleId); }}
                className="font-medium text-primary hover:underline"
              >
                bundle #{bundleId}
              </button>
            ) : (
              <span className="font-medium">bundle #{bundleId}</span>
            )}
          </>
        )}
        {hasFailures && !isFailed && <span className="text-red-500"> · {failed} failed</span>}
        {isFailed && liveJob?.error_message && (
          <span className="text-red-500/90"> · {liveJob.error_message}</span>
        )}
      </span>
      {jobId != null && (
        <span className="shrink-0 text-muted-foreground tabular-nums">job #{jobId}</span>
      )}
    </div>
  );
}

export const SearchWebRenderer = {
  toolName: 'search_web',

  canHandle: (result: any): boolean => {
    if (!result || typeof result !== 'object') return false;
    // Direct shape (legacy search_web)
    if (Array.isArray(result.results) && 'provider' in result) return true;
    // Nested shape (web_research)
    if (result.search && typeof result.search === 'object' && Array.isArray(result.search.results)) return true;
    // Ingest-only / search+ingest — claim it so the ingestion indicator renders
    // instead of the result falling back to a raw-JSON "Operation completed" card.
    if (result.ingestion && typeof result.ingestion === 'object') return true;
    // Error / noop status pings from web_research
    if (result.status === 'failed' || result.status === 'noop' || result.error) return true;
    return false;
  },

  getSummary: (result: any): string => {
    const { search } = _unwrap(result);
    if (!search || !Array.isArray(search.results)) return 'Web research';
    return `Found ${search.total_found ?? search.results.length} results from ${search.provider ?? 'web'}`;
  },

  render: function Render({ result, compact, onBundleClick }: ToolResultRenderProps) {
    const { search, ingestion } = _unwrap(result);
    const searchResult = (search ?? {}) as SearchWebResult;
    const hasSearch = !!search && Array.isArray((search as any).results);
    const selection = useSelection();
    const [viewingResult, setViewingResult] = useState<SearchResultData | null>(null);
    const [showIngestor, setShowIngestor] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    // Turn this search into a recurring source — confirmed inline, right here.
    const [showRecurrent, setShowRecurrent] = useState(false);

    // Handle error cases — error metadata lives at the top of the original result,
    // not the unwrapped search object, so check the raw payload too.
    const rawResult = result as any;
    if (rawResult?.status === 'failed' || rawResult?.error || (searchResult as any).status === 'failed' || (searchResult as any).error) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-red-600 dark:text-red-400">
            <XCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="font-medium">Search failed</span>
          </div>
          <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded text-[10px] sm:text-xs text-red-700 dark:text-red-400">
            <strong>Error:</strong> {rawResult?.error || (searchResult as any).error || 'Unknown error occurred'}
          </div>
          {(rawResult?.message || (searchResult as any).message) && (
            <div className="text-[10px] sm:text-xs text-muted-foreground">
              {rawResult?.message || (searchResult as any).message}
            </div>
          )}
        </div>
      );
    }
    
    // Ingest-only web_research (no query) — there's no search payload to show,
    // just the ingestion indicator. Same in compact and full so it stays tidy
    // wherever it renders (inline card or side panel).
    if (!hasSearch && ingestion) {
      return (
        <div className="p-3 min-w-0 overflow-hidden">
          <IngestionIndicator ingestion={ingestion} onBundleClick={onBundleClick} />
        </div>
      );
    }

    const results = searchResult.results || [];
    const hasResults = results.length > 0;

    // Filter results based on search
    const filteredResults = results.filter(r => 
      !searchTerm || 
      r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.content && r.content.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    
    if (compact) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <Globe className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
            <span className="font-medium">{searchResult.message}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px] sm:text-xs">
              {searchResult.provider}
            </Badge>
            <span>•</span>
            <span>{searchResult.total_found} results</span>
          </div>
        </div>
      );
    }
    
    return (
      <>
        {/* Outer padding + min-w-0 + overflow-hidden so the card sits inside its
            parent rather than bleeding pixel-on-pixel against the chat bubble.
            ToolResultCard intentionally has p-0, so the renderer owns its own
            spacing here. */}
        <div className="p-3 space-y-2 min-w-0 overflow-hidden">
          {/* Header with search query info */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b min-w-0">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {searchResult.provider}
              </Badge>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {searchResult.total_found}
              </Badge>
              {searchResult.query && (
                <span className="text-[10px] text-muted-foreground truncate min-w-0">
                  "{searchResult.query}"
                </span>
              )}
            </div>
          </div>

          {/* Top-level images strip — Tavily returns these in structured_payload.search.images.
              Horizontal scroll so the strip can't widen the card. Each thumb is bounded. */}
          {Array.isArray((searchResult as any).images) && (searchResult as any).images.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {(searchResult as any).images.slice(0, 12).map((img: any, i: number) => {
                const src = typeof img === 'string' ? img : (img?.url || img?.image_url);
                const description = typeof img === 'object' ? (img?.description || img?.alt) : undefined;
                if (!src) return null;
                return (
                  <a
                    key={i}
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={description || src}
                    className="shrink-0 block w-20 h-14 rounded overflow-hidden border bg-muted hover:opacity-80 transition"
                  >
                    <img src={src} alt={description || ''} loading="lazy" className="w-full h-full object-cover" />
                  </a>
                );
              })}
            </div>
          )}

          {/* Search and actions bar */}
          {hasResults && (
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Filter..."
                  className="pl-7 h-7 text-[11px]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px] shrink-0"
                onClick={() => selection.toggleAll(results.length)}
              >
                <Check className="h-3 w-3 mr-1" />
                {selection.isAllSelected(results.length) ? 'None' : 'All'}
              </Button>
              {searchResult.query && (
                <Button
                  variant={showRecurrent ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-[10px] shrink-0"
                  title="Turn this search into a recurring source"
                  onClick={() => setShowRecurrent((s) => !s)}
                >
                  <Repeat className="h-3 w-3 mr-1" />
                  Recurrent
                </Button>
              )}
              {selection.selected.size > 0 && (
                <Button
                  size="sm"
                  className="h-7 px-2 text-[10px] shrink-0"
                  onClick={() => setShowIngestor(true)}
                >
                  <Download className="h-3 w-3 mr-1" />
                  Ingest ({selection.selected.size})
                </Button>
              )}
            </div>
          )}

          {/* Recurrent source — confirmed inline, no dock detour. Seeded from this
              search; kind locked to web_search. */}
          {showRecurrent && searchResult.query && (
            <SourceForm
              init={{
                kind: 'web_search',
                name: searchResult.query,
                config: { query: searchResult.query },
                streamEnabled: true,
                lockKind: true,
              }}
              mode="inline"
              fullscreen={false}
              escalate={() => {}}
              close={() => setShowRecurrent(false)}
              onSuccess={() => setShowRecurrent(false)}
            />
          )}

          {/* Results list — plain overflow-y-auto so the scroll container is
              bounded by its parent width (Radix ScrollArea breaks min-w-0 via
              its internal display:table viewport child, see import comment). */}
          {hasResults ? (
            <div className="h-[300px] overflow-y-auto overflow-x-hidden min-w-0">
              <div className="space-y-1.5 pr-2 min-w-0">
                {filteredResults.map((searchResult, index) => {
                  // Find original index for selection state
                  const originalIndex = results.findIndex(r => r.url === searchResult.url);
                  const isSelected = selection.selected.has(originalIndex);
                  
                  return (
                    <div
                      key={index}
                      className={cn(
                        "p-2 border rounded transition-all min-w-0",
                        isSelected
                          ? "bg-primary/5 border-primary/50"
                          : "hover:bg-accent/30"
                      )}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {/* Selection Checkbox */}
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => selection.toggle(originalIndex)}
                          className="mt-0.5 shrink-0"
                        />
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0 space-y-1">
                          {/* Title and URL */}
                          <div>
                            <h4 className="text-xs font-semibold leading-tight mb-0.5">
                              {searchResult.title}
                            </h4>
                            <a 
                              href={searchResult.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] text-muted-foreground hover:text-primary hover:underline flex items-center gap-0.5 truncate"
                            >
                              <Globe className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{searchResult.url}</span>
                              <ExternalLink className="h-2 w-2 shrink-0" />
                            </a>
                          </div>
                          
                          {/* Content preview — break-words + overflow-hidden so long
                              unbroken strings (URLs, hashes) wrap inside the row instead
                              of pushing the card wider than the chat bubble. The img
                              override is the load-bearing fix for the overflow: Tavily
                              embeds ![alt](url) markdown which ReactMarkdown otherwise
                              renders at the source image's intrinsic width. */}
                          {searchResult.content && (
                            <div className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed break-words overflow-hidden [overflow-wrap:anywhere]">
                              <ReactMarkdown
                                components={{
                                  a: ({ node, children, ...props }) => (
                                    <a
                                      {...props}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 dark:text-blue-400 font-semibold underline hover:no-underline break-all"
                                    >
                                      {children}
                                    </a>
                                  ),
                                  p: ({ node, children, ...props }) => (
                                    <span {...props}>{children}</span>
                                  ),
                                  img: ({ node, ...props }) => (
                                    <img
                                      {...props}
                                      className="max-w-full h-auto rounded inline-block align-middle my-1"
                                      loading="lazy"
                                      alt={(props as any).alt || ''}
                                    />
                                  ),
                                }}
                              >
                                {resolveMarkdownUrls(searchResult.content.slice(0, 300), searchResult.url)}
                              </ReactMarkdown>
                            </div>
                          )}
                          
                          {/* Metadata badges */}
                          <div className="flex items-center gap-1 flex-wrap">
                            {searchResult.score && (
                              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                {formatPercentage(searchResult.score)}
                              </Badge>
                            )}
                            {searchResult.source_metadata?.published_date && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">
                                {new Date(searchResult.source_metadata.published_date).toLocaleDateString()}
                              </Badge>
                            )}
                            {searchResult.source_metadata?.image_count && searchResult.source_metadata.image_count > 0 && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">
                                <ImageIcon className="h-2 w-2 mr-0.5" />
                                {searchResult.source_metadata?.image_count}
                              </Badge>
                            )}
                            {searchResult.stub && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">
                                Ref
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5 text-[9px] ml-auto"
                              onClick={() => setViewingResult(searchResult)}
                            >
                              <Eye className="h-2.5 w-2.5 mr-0.5" />
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {filteredResults.length === 0 && searchTerm && (
                  <div className="text-center py-6 text-muted-foreground">
                    <Search className="h-6 w-6 mx-auto mb-1 opacity-50" />
                    <p className="text-[10px]">No results match your filter</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Globe className="h-6 w-6 mx-auto mb-1 opacity-50" />
              <p className="text-[10px]">No search results found</p>
            </div>
          )}

          {/* Ingestion indicator — present when web_research auto-ingested alongside
              the search. Status-aware (queued vs done), see IngestionIndicator. */}
          {ingestion && (
            <div className="pt-2 mt-2 border-t">
              <IngestionIndicator ingestion={ingestion} onBundleClick={onBundleClick} />
            </div>
          )}
        </div>

        {/* Search Result Viewer Modal */}
        <SearchResultViewer
          result={viewingResult}
          open={viewingResult !== null}
          onClose={() => setViewingResult(null)}
          onIngest={(result) => {
            setViewingResult(null);
            const index = results.findIndex((r: any) => r.url === result.url);
            if (index !== -1) {
              selection.setSelected(new Set([index]));
              setShowIngestor(true);
            }
          }}
        />
        
        {/* Search Result Ingestor Modal */}
        <SearchResultIngestor
          results={selection.getSelected(results)}
          open={showIngestor}
          onClose={() => setShowIngestor(false)}
          onSuccess={() => {
            selection.clear();
            setShowIngestor(false);
          }}
        />
      </>
    );
  }
};
