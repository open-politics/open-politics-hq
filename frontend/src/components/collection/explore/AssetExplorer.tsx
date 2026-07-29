'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { TopbarSlot } from '@/components/layout/TopbarSlot';
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  X,
  SlidersHorizontal,
  LayoutGrid,
  LayoutList,
  Rows3,
  FolderTree,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Image,
  Table2,
  Rss,
  File,
  Sparkles,
  FolderPlus,
  Crosshair,
  Check,
  FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { useDebounce } from '@/hooks/useDebounce';
import { useAssetQuery, type ChildResultGroup } from '@/hooks/useAssetQuery';
import { useFeedAssets } from '@/components/collection/assets/Feed/useFeedAssets';
import { useAssetDetail } from '@/components/collection/assets/Views/AssetDetailProvider';
import { useSurfaceCommands } from '@/hooks/useSurfaceCommands';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useExploreState } from '@/zustand_stores/storeExplore';
import { AssetCard } from '@/components/collection/assets/Cards';
import {
  getAssetKindConfig,
  formatAssetKind,
} from '@/components/collection/assets/assetKindConfig';
import {
  parseQueryToPills,
  pillsToQuery,
  parsedResponseToPills,
  toggleKindInQuery,
  isKindActive,
  setDateInQuery,
  getDateFromQuery,
  setChildrenInQuery,
  getChildrenFromQuery,
  insertToken,
  QUERY_EXAMPLES,
  SORT_OPTIONS,
  type QueryPill,
} from '@/lib/query/asset_query_language';
import { request } from '@/client/core/request';
import { OpenAPI } from '@/client/core/OpenAPI';
import type { AssetRead } from '@/client';
import AssetSelector from '@/components/collection/assets/AssetSelector';
import type { AssetTreeItem } from '@/components/collection/assets/AssetSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortOption = 'relevance' | 'created_at_desc' | 'created_at_asc' | 'title';
type LayoutMode = 'results' | 'grid' | 'list' | 'tree';

interface ExplorerResult {
  asset: AssetRead;
  score?: number;
  highlight?: string | null;
}

// Stable no-op selection for the read-only tree view (viewing, not picking).
const EMPTY_TREE_SELECTION = new Set<string>();
const noopSelection = () => {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_BUTTONS: { kind: string; label: string; icon: React.ReactNode }[] = [
  { kind: 'pdf', label: 'PDF', icon: <FileText className="h-3.5 w-3.5" /> },
  { kind: 'web', label: 'Web', icon: <Globe className="h-3.5 w-3.5" /> },
  { kind: 'article', label: 'Article', icon: <FileText className="h-3.5 w-3.5" /> },
  { kind: 'image', label: 'Image', icon: <Image className="h-3.5 w-3.5" /> },
  { kind: 'csv', label: 'CSV', icon: <Table2 className="h-3.5 w-3.5" /> },
  { kind: 'text', label: 'Text', icon: <File className="h-3.5 w-3.5" /> },
  { kind: 'rss_feed', label: 'RSS', icon: <Rss className="h-3.5 w-3.5" /> },
];

/** Short label for the nested-results (children:) control trigger */
function nestedResultsTriggerSuffix(query: string): string {
  const v = getChildrenFromQuery(query);
  if (!v) return 'Standard';
  if (v === 'none') return 'Off';
  if (v === 'all') return 'All';
  return v;
}

const explorerToolbarBtn =
  'h-7 gap-1.5 text-xs font-normal rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40';
const explorerToolbarBtnActive = 'bg-muted/60 text-foreground';

// ---------------------------------------------------------------------------
// Pill rendering
// ---------------------------------------------------------------------------

const PILL_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  text: { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-700 dark:text-zinc-300', ring: 'ring-zinc-300/50 dark:ring-zinc-600/50' },
  semantic: { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-300', ring: 'ring-violet-300/50 dark:ring-violet-600/50' },
  kind: { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', ring: 'ring-blue-300/50 dark:ring-blue-600/50' },
  date: { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-300/50 dark:ring-amber-600/50' },
  bundle: { bg: 'bg-green-50 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', ring: 'ring-green-300/50 dark:ring-green-600/50' },
  asset: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-300/50 dark:ring-emerald-600/50' },
  entity: { bg: 'bg-cyan-50 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-300', ring: 'ring-cyan-300/50 dark:ring-cyan-600/50' },
  entity_semantic: { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300', ring: 'ring-teal-300/50 dark:ring-teal-600/50' },
  annotation: { bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', ring: 'ring-orange-300/50 dark:ring-orange-600/50' },
  children: { bg: 'bg-pink-50 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300', ring: 'ring-pink-300/50 dark:ring-pink-600/50' },
  run: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', ring: 'ring-slate-300/50 dark:ring-slate-600/50' },
};

function QueryPillChip({ pill, onRemove }: { pill: QueryPill; onRemove: () => void }) {
  // OR operator — a compact divider between union groups, not a filter chip.
  if (pill.type === 'or') {
    return (
      <button
        type="button"
        onClick={onRemove}
        title="Remove OR"
        className="inline-flex items-center px-1.5 py-1 text-[10px] font-bold tracking-wide text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        OR
      </button>
    );
  }
  const colors = PILL_COLORS[pill.type] || PILL_COLORS.text;
  const bundles = useBundleStore((s) => s.bundles);
  // Bundle pills scope by id (bundle:<id>); show the folder name instead of the
  // raw id. Handles a comma list and falls back to the id / a legacy name value.
  const display = pill.type === 'bundle'
    ? pill.value.split(',').map((v) => {
        const t = v.trim();
        if (!/^\d+$/.test(t)) return t;
        return bundles.find((b) => b.id === parseInt(t, 10))?.name ?? t;
      }).join(', ')
    : pill.value;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-medium ring-1 transition-all duration-150',
        colors.bg, colors.text, colors.ring,
        pill.negated && 'line-through opacity-60',
      )}
    >
      <span className="opacity-50 font-normal">{pill.label}</span>
      <span className="max-w-[200px] truncate">{display}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 p-0.5 rounded-full opacity-40 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-opacity"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

function sanitizeHighlight(html: string): string {
  return html.replace(/<(?!\/?mark\b)[^>]*>/gi, '');
}

function ServerHighlight({ html }: { html: string }) {
  return (
    <span
      className="[&_mark]:bg-yellow-200/80 [&_mark]:dark:bg-blue-300/90 [&_mark]:rounded-xs [&_mark]:px-0.5 [&_mark]:py-[1px]"
      dangerouslySetInnerHTML={{ __html: sanitizeHighlight(html) }}
    />
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function scoreColor(pct: number): string {
  if (pct >= 75) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-amber-500';
  if (pct >= 25) return 'bg-orange-500';
  return 'bg-red-400';
}

// ---------------------------------------------------------------------------
// Search result row
// ---------------------------------------------------------------------------

function SearchResultRow({
  result,
  maxScore,
  onClick,
  isActive,
}: {
  result: ExplorerResult;
  maxScore: number;
  onClick: (asset: AssetRead) => void;
  isActive: boolean;
}) {
  const { asset, score, highlight } = result;
  const config = getAssetKindConfig(asset.kind);
  const Icon = config.icon;
  const size = (asset.file_info as any)?.size as number | undefined;
  const date = asset.event_timestamp || asset.created_at;
  const hasScore = score != null && score > 0;
  const pct = hasScore && maxScore > 0 ? Math.round((score! / maxScore) * 100) : null;
  const preview = highlight || asset.text_content?.slice(0, 300) || null;

  return (
    <button
      type="button"
      onClick={() => onClick(asset)}
      className={cn(
        'w-full text-left group px-4 py-3 rounded-lg transition-all duration-150',
        'border border-transparent',
        isActive
          ? 'bg-accent/60 border-border/50 shadow-sm'
          : 'hover:bg-muted/50 hover:border-border/30',
      )}
    >
      <div className="flex items-start gap-2.5 mb-1">
        <div className="mt-0.5 p-1 rounded bg-muted/50">
          <Icon className={cn('h-3.5 w-3.5', config.iconColor)} />
        </div>
        <span className="font-medium text-sm leading-snug flex-1 line-clamp-2">
          {asset.title || 'Untitled'}
        </span>
        {pct != null && (
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', scoreColor(pct))}
                style={{ width: `${Math.max(6, pct)}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground font-medium w-7 text-right">
              {pct}%
            </span>
          </div>
        )}
      </div>

      {preview && (
        <div className="text-[13px] leading-relaxed text-muted-foreground line-clamp-2 ml-8 mb-1.5">
          {highlight ? <ServerHighlight html={highlight} /> : preview.slice(0, 220)}
        </div>
      )}

      <div className="flex items-center gap-1.5 ml-8 flex-wrap">
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium', config.textColor, 'bg-muted/60')}>
          {formatAssetKind(asset.kind)}
        </span>
        {size != null && size > 0 && (
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">{formatBytes(size)}</span>
        )}
        {date && (
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">
            {formatDistanceToNowStrict(new Date(date), { addSuffix: true })}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  defaultOpen = true,
  count,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pb-3 mb-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-2 hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('h-3 w-3 text-muted-foreground/50 transition-transform duration-200', open && 'rotate-90')} />
        <span className="flex-1 text-left">{title}</span>
        {count != null && count > 0 && (
          <span className="text-[9px] tabular-nums opacity-50 font-normal">{count}</span>
        )}
      </button>
      <div className={cn('overflow-hidden transition-all duration-200', open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0')}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Annotation field browser
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Create bundle dialog
// ---------------------------------------------------------------------------

function CreateBundleDialog({
  open,
  onOpenChange,
  infospaceId,
  sourceQuery,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  infospaceId: number;
  sourceQuery: string;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      await request(OpenAPI, {
        method: 'POST',
        url: '/api/v1/infospaces/{infospace_id}/bundles',
        path: { infospace_id: infospaceId },
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          bundle_metadata: sourceQuery.trim() ? { source_query: sourceQuery.trim() } : undefined,
        },
        mediaType: 'application/json',
      });
      onCreated(name.trim());
      setName('');
      setDescription('');
      setError(null);
      onOpenChange(false);
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || 'Failed to create bundle';
      setError(typeof detail === 'string' ? detail : 'Failed to create bundle');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create bundle</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Leaked Documents Q1"
              className="h-9"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description (optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this bundle is about..."
              className="h-9"
            />
          </div>
        </div>
        {sourceQuery.trim() && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            Matching assets will be added in the background from: <code className="font-mono text-foreground/70">{sourceQuery.trim()}</code>
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={!name.trim() || isCreating}>
            {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FolderPlus className="h-3.5 w-3.5 mr-1.5" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AssetExplorer({ initialQuery = '' }: { initialQuery?: string } = {}) {
  const { activeInfospace } = useInfospaceStore();
  const { openDetailOverlay, openBundleDetail } = useAssetDetail();
  const infospaceId = activeInfospace?.id ?? 0;

  // Keep the flat bundle list warm so bundle:<id> scope pills resolve to names.
  const fetchBundles = useBundleStore((s) => s.fetchBundles);
  useEffect(() => {
    if (infospaceId) fetchBundles(infospaceId);
  }, [infospaceId, fetchBundles]);

  // Query state — seeded from initialQuery so a query handed in via the URL
  // (e.g. from the home inquiry bar) auto-streams on landing.
  const [query, setQuery] = useState(initialQuery);
  const debouncedQuery = useDebounce(query, 300);
  const isSearching = debouncedQuery.trim().length > 0;
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed when the URL `?q=` changes — the operator can navigate here with a new
  // query while the explorer is already mounted, and `useState` only captured the
  // first value. Non-empty guard so a plain visit doesn't wipe a typed query.
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  // Mirror the live query so the operator (focus context) can read what's in the bar —
  // to drive the query bar when the explorer is open, and to bundle the current results.
  const setExploreQuery = useExploreState((s) => s.setQuery);
  useEffect(() => { setExploreQuery(query); }, [query, setExploreQuery]);

  // UI state
  // Sort is derived, not state-switched: a null userSort tracks the sensible
  // default (relevance while searching, recency while browsing). Deriving it in
  // the same render as `isSearching` avoids the state→effect→refetch round-trip
  // that fired a stale second query on every search start (the "0 results then
  // dump" flash). An explicit pick from the dropdown sticks.
  const [userSort, setUserSort] = useState<SortOption | null>(null);
  const sortOption: SortOption = userSort ?? (isSearching ? 'relevance' : 'created_at_desc');
  const [layout, setLayout] = useState<LayoutMode>('results');
  const [activeAssetId, setActiveAssetId] = useState<number | null>(null);
  const [showHelpers, setShowHelpers] = useState(false);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Which trigger opened the picker — `bundle:` scopes to bundle entities (only
  // bundles shown), `asset:`/`@` scopes to assets.
  const [pickerMode, setPickerMode] = useState<'bundle' | 'asset'>('bundle');
  const [pickerSelection, setPickerSelection] = useState<Set<string>>(new Set());
  const pickerItemsRef = useRef<Map<string, AssetTreeItem>>(new Map());
  const lastPickerEnterId = useRef<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Data
  const querySearch = useAssetQuery({
    infospaceId,
    query: debouncedQuery,
    sort: sortOption,
    limit: 50,
    enabled: isSearching,
  });

  const feed = useFeedAssets({
    infospaceId,
    limit: 50,
    sortBy: sortOption === 'title' ? 'name' : 'created_at',
    sortOrder: sortOption === 'created_at_asc' ? 'asc' : 'desc',
  });

  // Pills
  const pills: QueryPill[] = useMemo(() => {
    if (Object.keys(querySearch.parsed).length > 0) return parsedResponseToPills(querySearch.parsed);
    if (query.trim()) return parseQueryToPills(query);
    return [];
  }, [query, querySearch.parsed]);

  const removePill = useCallback(
    (index: number) => {
      const updated = [...pills];
      updated.splice(index, 1);
      setQuery(pillsToQuery(updated));
    },
    [pills],
  );

  // Results — assets. Explore explores assets; bundle scoping is the picker's
  // job (bundle:<id>), so folder hits don't belong in the results list.
  const results: ExplorerResult[] = useMemo(() => {
    if (isSearching) {
      return querySearch.results.map((r) => ({
        asset: r.asset,
        score: r.score ?? undefined,
        highlight: r.highlight,
      }));
    }
    return feed.items.map((item) => ({ asset: item.asset }));
  }, [isSearching, querySearch.results, feed.items]);

  const maxScore = useMemo(() => {
    let max = 0;
    for (const r of results) if (r.score != null && r.score > max) max = r.score;
    return max;
  }, [results]);

  const childResults: ChildResultGroup[] = isSearching ? querySearch.childResults : [];

  // Group child/page-level hits under their parent rows.
  // On by default. Suppressed with children:none.
  const groupedResults = useMemo(() => {
    if (childResults.length === 0) return null;

    // Build parent→children + total_matches maps from backend child_results
    const childMap = new Map<number, ExplorerResult[]>();
    const totalMap = new Map<number, number>();
    for (const group of childResults) {
      childMap.set(group.parent_asset_id, group.matches.map((m) => ({
        asset: m.asset,
        score: m.score ?? undefined,
        highlight: m.highlight,
      })));
      totalMap.set(group.parent_asset_id, group.total_matches);
    }

    // Build grouped list: parent row with its children underneath
    type GroupedEntry = { parent: ExplorerResult; children: ExplorerResult[]; totalMatches: number };
    const grouped: GroupedEntry[] = [];
    const seenParents = new Set<number>();
    for (const r of results) {
      grouped.push({
        parent: r,
        children: childMap.get(r.asset.id) ?? [],
        totalMatches: totalMap.get(r.asset.id) ?? 0,
      });
      seenParents.add(r.asset.id);
    }

    return grouped;
  }, [results, childResults, query]);

  const isLoading = isSearching ? querySearch.isLoading : feed.isLoading;
  const error = isSearching ? querySearch.error : feed.error;
  const hasMore = isSearching ? querySearch.hasMore : feed.hasMore;
  const loadMore = isSearching ? querySearch.loadMore : feed.loadMore;
  const totalCount = isSearching ? querySearch.total : feed.totalCount;
  const isCounting = isSearching ? querySearch.isCounting : false;

  // Handlers
  // The operator's `explore:open` verb — open a result in THIS page's overlay (the
  // AssetDetail context), not the global dock. That's why open is a surface verb here.
  useSurfaceCommands('explore', {
    open: (p) => {
      if (p?.bundle_id != null) openBundleDetail(Number(p.bundle_id));
      else if (p?.asset_id != null) { setActiveAssetId(Number(p.asset_id)); openDetailOverlay(Number(p.asset_id)); }
    },
  });

  const handleAssetClick = useCallback(
    (asset: AssetRead) => { setActiveAssetId(asset.id); openDetailOverlay(asset.id); },
    [openDetailOverlay],
  );

  const refresh = useCallback(() => {
    if (isSearching) querySearch.search();
    else feed.refresh();
  }, [isSearching, querySearch, feed]);

  // Helper panel
  const handleKindToggle = useCallback((kind: string) => setQuery((q) => toggleKindInQuery(q, kind)), []);
  const handleDateChange = useCallback((which: 'after' | 'before', value: string) => setQuery((q) => setDateInQuery(q, which, value)), []);

  const handleBundleCreated = useCallback((name: string) => {
    setQuery((q) => insertToken(q, `bundle:"${name}"`));
  }, []);

  // Inline picker: close on click outside
  useEffect(() => {
    if (!showPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (pickerRef.current && !pickerRef.current.contains(target)
          && inputRef.current && !inputRef.current.contains(target)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPicker]);

  // Reset picker state when closed
  useEffect(() => {
    if (!showPicker) {
      setPickerSelection(new Set());
      pickerItemsRef.current.clear();
      lastPickerEnterId.current = null;
    }
  }, [showPicker]);

  // Inline picker: detect bundle:/asset: trigger on query input
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    const cursorPos = e.target.selectionStart ?? value.length;
    const before = value.slice(0, cursorPos);
    if (before.endsWith('bundle:')) {
      setPickerMode('bundle');
      setShowPicker(true);
    } else if (before.endsWith('asset:') || before.endsWith('@')) {
      setPickerMode('asset');
      setShowPicker(true);
    }
  }, []);

  // Resolve a picker item ID to { name, isBundle }
  const resolvePickerItem = useCallback((id: string): { name: string; isBundle: boolean } | null => {
    const item = pickerItemsRef.current.get(id);
    if (item) {
      const name = (item.type === 'folder' ? item.bundle?.name : item.asset?.title) || item.name;
      return { name, isBundle: item.type === 'folder' };
    }
    const { rootNodes, childrenCache } = useTreeStore.getState();
    const allNodes = [...rootNodes];
    childrenCache.forEach((children) => allNodes.push(...children));
    const node = allNodes.find((n) => n.id === id);
    if (!node) return null;
    return { name: node.name, isBundle: node.type === 'bundle' || node.type === 'virtual_folder' };
  }, []);

  // Confirm current picker selection → insert scope tokens into the query.
  // Bundles scope by id (bundle:<id>) — unambiguous for nested/same-named
  // folders, where bundle:"name" resolves arbitrarily or not at all. The pill
  // resolves the id back to a name for display. Assets keep title-scoping.
  // e.g. bundle:42 bundle:71 asset:"report.pdf","scan.png"
  const confirmPickerSelection = useCallback(async () => {
    const bundleIds: number[] = [];
    const assetNames: string[] = [];
    for (const id of pickerSelection) {
      if (id.startsWith('bundle-')) {
        const bid = parseInt(id.slice(7), 10);
        if (!Number.isNaN(bid)) bundleIds.push(bid);
        continue;
      }
      // Assets scope by title — resolve from the picked item, or fetch by id for
      // picks made in search results (never cached in the browsed tree).
      let resolved = resolvePickerItem(id);
      if (!resolved && id.startsWith('asset-')) {
        try {
          const a = await useTreeStore.getState().getFullAsset(parseInt(id.slice(6), 10));
          if (a?.title) resolved = { name: a.title, isBundle: false };
        } catch { /* skip unresolved */ }
      }
      if (resolved && !resolved.isBundle) assetNames.push(resolved.name);
    }
    const tokens: string[] = [];
    for (const bid of bundleIds) tokens.push(`bundle:${bid}`);
    if (assetNames.length > 0) {
      tokens.push('asset:' + assetNames.map((n) => `"${n}"`).join(','));
    }
    if (tokens.length === 0) return;
    setQuery((q) => {
      const cleaned = q.replace(/\s*(bundle:|asset:|@)$/, '').trimEnd();
      const joined = tokens.join(' ');
      return cleaned ? `${cleaned} ${joined}` : joined;
    });
    setShowPicker(false);
    inputRef.current?.focus();
  }, [pickerSelection, resolvePickerItem]);

  // Picker: checkbox toggle. Scope wants the entity itself, so in bundle mode we
  // keep only bundle ids — AssetSelector also cascades a bundle's descendant
  // asset ids into the set (the AssetManager/Dock bulk-select behaviour), which
  // we don't want here. Asset mode keeps asset ids (so picking a bundle there
  // scopes to its assets, which is the wanted behaviour for `asset:`).
  const handlePickerSelectionChange = useCallback((selectedIds: Set<string>) => {
    const wanted = pickerMode === 'bundle' ? 'bundle-' : 'asset-';
    setPickerSelection(new Set([...selectedIds].filter((id) => id.startsWith(wanted))));
  }, [pickerMode]);

  // Picker: single-click on asset → toggle selection
  const handlePickerItemClick = useCallback((item: AssetTreeItem) => {
    pickerItemsRef.current.set(item.id, item);
    setPickerSelection((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  }, []);

  // Picker: keyboard Enter / double-click → toggle, or confirm on double-enter
  const confirmRef = useRef(confirmPickerSelection);
  confirmRef.current = confirmPickerSelection;
  const handlePickerItemEnter = useCallback((item: AssetTreeItem) => {
    pickerItemsRef.current.set(item.id, item);
    setPickerSelection((prev) => {
      // Double-enter on the same item that's already selected → confirm
      if (lastPickerEnterId.current === item.id && prev.has(item.id)) {
        lastPickerEnterId.current = null;
        // Defer confirm to after this state update
        queueMicrotask(() => confirmRef.current());
        return prev;
      }
      lastPickerEnterId.current = item.id;
      // Toggle selection
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  }, []);

  const dateAfterValue = useMemo(() => getDateFromQuery(query, 'after'), [query]);
  const dateBeforeValue = useMemo(() => getDateFromQuery(query, 'before'), [query]);

  // Infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || isLoading) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { threshold: 0.1 },
    );
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  // Keyboard
  const [focusIndex, setFocusIndex] = useState(-1);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // When the picker is open, only handle Escape — let the picker own arrow/enter
      if (showPicker) {
        if (e.key === 'Escape') { setShowPicker(false); e.preventDefault(); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex((i) => Math.min(i + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < results.length) { e.preventDefault(); handleAssetClick(results[focusIndex].asset); }
      else if (e.key === 'Escape') { inputRef.current?.focus(); setFocusIndex(-1); }
    },
    [results, focusIndex, handleAssetClick, showPicker],
  );
  useEffect(() => setFocusIndex(-1), [results.length, debouncedQuery]);
  const resultListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusIndex < 0 || !resultListRef.current) return;
    (resultListRef.current.children[focusIndex] as HTMLElement)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex]);

  if (!activeInfospace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select an infospace to explore assets.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" onKeyDown={handleKeyDown}>
      {/* ── Search header ── */}
      <div className="flex-none border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
        <div className="px-4 pt-4 pb-2.5 space-y-2">
          {/* Search input → app top bar. The key handler rides on the wrapper so
              arrow/enter still drive the in-page result list (state is shared). */}
          <TopbarSlot>
          <div className="flex w-full items-center gap-2">
            <Popover open={showPicker} onOpenChange={setShowPicker}>
              <PopoverAnchor asChild>
              <div className="relative group flex-1 min-w-0" onKeyDown={handleKeyDown}>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 group-focus-within:text-foreground/60 transition-colors" />
            <Input
              ref={inputRef}
              value={query}
              onChange={handleQueryChange}
              placeholder='Search assets — kind: entity: after: bundle: ~semantic "phrase"'
              className={cn(
                "pl-10 pr-4 h-9 bg-background/70 backdrop-blur-sm border border-blue-200/60 focus:border-blue-400",
                "outline-none rounded-md font-mono text-base placeholder:text-muted-foreground/70",
                "transition-all duration-150",
                "focus:bg-background/80"
              )}
         
         
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setShowPicker(false); inputRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}

              </div>
              </PopoverAnchor>
              <PopoverContent
                align="start"
                sideOffset={6}
                onInteractOutside={(e) => { if (inputRef.current?.contains(e.target as Node)) e.preventDefault(); }}
                className="w-[min(680px,calc(100vw-1.5rem))] p-0 overflow-hidden"
              >
                <div ref={pickerRef} className="flex flex-col">
                  <div className="h-[300px] min-h-0 overflow-hidden">
                    <AssetSelector
                      selectedItems={pickerSelection}
                      onSelectionChange={handlePickerSelectionChange}
                      onItemView={handlePickerItemClick}
                      onItemDoubleClick={handlePickerItemEnter}
                      bundlesOnly={pickerMode === 'bundle'}
                      autoFocusSearch
                      compact
                    />
                  </div>
                  {pickerSelection.size > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/30">
                      <span className="text-xs text-muted-foreground flex-1">
                        <span className="font-semibold text-foreground">{pickerSelection.size}</span> selected
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={() => setPickerSelection(new Set())}>
                        Clear
                      </Button>
                      <Button size="sm" className="h-6 text-[11px] px-3 gap-1" onClick={confirmPickerSelection}>
                        <Check className="h-3 w-3" />
                        Apply
                      </Button>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={refresh} disabled={isLoading}>
                  <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>

            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 opacity-70" />
                  <span className="hidden sm:inline">Settings</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
                <div className="px-1 pb-2">
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">View</p>
                  <div className="flex items-center overflow-hidden rounded-md border border-border/40 bg-muted/20">
                    {([['results', Rows3], ['tree', FolderTree], ['grid', LayoutGrid], ['list', LayoutList]] as [LayoutMode, typeof Rows3][]).map(([mode, ModeIcon]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setLayout(mode)}
                        className={cn(
                          'flex h-7 flex-1 items-center justify-center gap-1.5 text-[11px] capitalize text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground',
                          layout === mode && 'bg-muted/80 text-foreground',
                        )}
                      >
                        <ModeIcon className="h-3.5 w-3.5" />
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="my-1 border-t border-border/40" />

                <div className="px-1 py-1">
                  <p className="mb-1 px-1.5 text-[11px] font-medium text-muted-foreground">Sort</p>
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setUserSort(opt.value as SortOption)}
                      className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs transition-colors hover:bg-muted/60"
                    >
                      <span className="flex-1 text-left">{opt.label}</span>
                      {sortOption === opt.value && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />}
                    </button>
                  ))}
                </div>

                <div className="my-1 border-t border-border/40" />

                <div className="px-1 py-1">
                  <p className="mb-1 px-1.5 text-[11px] font-medium text-muted-foreground">Nested results</p>
                  {(() => {
                    const cur = getChildrenFromQuery(query) || 'default';
                    const row = (key: string, patch: string, title: string, isSelected: boolean) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setQuery((q) => setChildrenInQuery(q, patch))}
                        className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs transition-colors hover:bg-muted/60"
                      >
                        <span className="flex-1 text-left">{title}</span>
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />}
                      </button>
                    );
                    return (
                      <>
                        {row('std', '', 'Standard', cur === 'default')}
                        {row('off', 'none', 'Off', cur === 'none')}
                        {row('10', '10', 'Up to 10', cur === '10')}
                        {row('30', '30', 'Up to 30', cur === '30')}
                        {row('all', 'all', 'All', cur === 'all')}
                      </>
                    );
                  })()}
                </div>

                <div className="my-1 border-t border-border/40" />

                <button
                  type="button"
                  onClick={() => setShowHelpers(!showHelpers)}
                  className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs transition-colors hover:bg-muted/60"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 opacity-70" />
                  <span className="flex-1 text-left">Filters &amp; syntax</span>
                  {showHelpers && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />}
                </button>
              </PopoverContent>
            </Popover>
          </div>
          </TopbarSlot>

          {/* Pills */}
          {pills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-0.5">
              {pills.map((pill, i) => (
                <QueryPillChip key={`${pill.raw}-${i}`} pill={pill} onRemove={() => removePill(i)} />
              ))}
            </div>
          )}

          {/* Controls: left (scoping) · centered create bundle · right (stats & view) */}
          <div className="flex items-center gap-1.5 w-full min-w-0">
            <div className="flex flex-1 items-center justify-start gap-1 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(explorerToolbarBtn, 'h-7 w-7 p-0 shrink-0', showPicker && explorerToolbarBtnActive)}
                    onClick={() => setShowPicker((prev) => !prev)}
                  >
                    <FolderOpen className="h-3.5 w-3.5 opacity-70" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-[260px]">
                  Scope to specific bundles or assets
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex shrink-0 justify-center px-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(explorerToolbarBtn, 'whitespace-nowrap shrink-0')}
                onClick={() => setBundleDialogOpen(true)}
              >
                <FolderPlus className="h-3.5 w-3.5 opacity-70" />
                New bundle from results
              </Button>
            </div>

            <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
            {(() => {
              if (isLoading && results.length === 0) {
                return (
                  <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="text-muted-foreground/60">Searching...</span>
                  </span>
                );
              }
              const childHitCount = childResults.reduce((sum, g) => sum + g.total_matches, 0);
              const assetCount = results.length;
              const totalHits = results.length + childHitCount;
              return (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {childHitCount > 0 ? (
                    <>
                      <span className="font-semibold text-foreground">{totalHits.toLocaleString()}</span>
                      <span className="text-muted-foreground/60"> hit{totalHits !== 1 ? 's' : ''} in </span>
                      <span className="font-semibold text-foreground">{assetCount.toLocaleString()}</span>
                      {isCounting ? (
                        <span className="text-muted-foreground/60 animate-pulse"> of ...</span>
                      ) : totalCount != null && totalCount > assetCount ? (
                        <span className="text-muted-foreground/60"> of {totalCount.toLocaleString()}</span>
                      ) : null}
                      <span className="text-muted-foreground/60"> asset{assetCount !== 1 ? 's' : ''}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">{results.length.toLocaleString()}</span>
                      {isCounting ? (
                        <span className="text-muted-foreground/60 animate-pulse"> of ...</span>
                      ) : totalCount != null && totalCount > results.length ? (
                        <span className="text-muted-foreground/60"> of {totalCount.toLocaleString()}</span>
                      ) : null}
                      <span className="text-muted-foreground/60"> asset{results.length !== 1 ? 's' : ''}</span>
                    </>
                  )}
                </span>
              );
            })()}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Helper panel */}
        {showHelpers && (
          <ScrollArea className="h-full min-h-0 w-80 flex-shrink-0 self-stretch border-r bg-muted/10">
            <div className="p-4 space-y-0">
              {/* Kind */}
              <Section title="Kind">
                <div className="flex flex-wrap gap-1">
                  {KIND_BUTTONS.map(({ kind, label, icon }) => {
                    const active = isKindActive(query, kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => handleKindToggle(kind)}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150',
                          active
                            ? 'bg-primary/10 text-primary ring-1 ring-primary/25 shadow-sm'
                            : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
                        )}
                      >
                        {icon}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Date range */}
              <Section title="Date range">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium mb-0.5 block">After</label>
                    <Input
                      type="date"
                      value={dateAfterValue}
                      onChange={(e) => handleDateChange('after', e.target.value)}
                      className="h-7 text-xs bg-muted/30 border-muted-foreground/10"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium mb-0.5 block">Before</label>
                    <Input
                      type="date"
                      value={dateBeforeValue}
                      onChange={(e) => handleDateChange('before', e.target.value)}
                      className="h-7 text-xs bg-muted/30 border-muted-foreground/10"
                    />
                  </div>
                </div>
              </Section>

              {/* Syntax */}
              <Section title="Syntax" defaultOpen={false}>
                <div className="space-y-1.5 text-[11px]">
                  <div className="space-y-1">
                    <SyntaxRow code='kind:pdf' hint="Filter by asset type" />
                    <SyntaxRow code='after:2019-01' hint="Assets from date" />
                    <SyntaxRow code='before:2022-12' hint="Assets until date" />
                    <SyntaxRow code='bundle:"a","b"' hint="Scope to bundle(s)" />
                    <SyntaxRow code='asset:"title"' hint="Scope to asset(s)" />
                    <SyntaxRow code='entity:"Name"' hint="Search by entity" />
                    <SyntaxRow code='annotation:field>=0.8' hint="Filter annotation values" />
                    <SyntaxRow code='run:42' hint="Scope to annotation run" />
                    <SyntaxRow code='children:none' hint="Hide child/page matches" />
                    <SyntaxRow code='children:10' hint="Up to 10 children per parent" />
                    <SyntaxRow code='children:all' hint="Show all child matches" />
                  </div>
                  <div className="border-t border-border/30 pt-1.5 mt-1 space-y-1">
                    <SyntaxRow code='~' hint="Semantic similarity" accent="violet" />
                    <SyntaxRow code='-' hint="Exclude / negate" accent="red" />
                    <SyntaxRow code='"..."' hint="Exact phrase match" />
                    <SyntaxRow code='>0.7' hint="Similarity threshold" />
                    <SyntaxRow code=',' hint="OR within a filter" />
                  </div>
                </div>
              </Section>

              {/* Examples */}
              <Section title="Examples" defaultOpen={false}>
                <div className="space-y-0.5">
                  {QUERY_EXAMPLES.slice(0, 12).map((ex) => (
                    <button
                      key={ex.q}
                      type="button"
                      onClick={() => { setQuery(ex.q); inputRef.current?.focus(); }}
                      className="block w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors group"
                    >
                      <code className="text-[10px] font-mono text-foreground/80 group-hover:text-foreground block truncate">{ex.q}</code>
                      <span className="text-[9px] text-muted-foreground/50">{ex.desc}</span>
                    </button>
                  ))}
                </div>
              </Section>
            </div>
          </ScrollArea>
        )}

        {/* Results — the tree layout hands off to AssetSelector (the shared result-tree
            renderer), driven by the same query; other layouts render the flat results. */}
        {layout === 'tree' ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <AssetSelector
              query={debouncedQuery}
              selectedItems={EMPTY_TREE_SELECTION}
              onSelectionChange={noopSelection}
              onItemView={(item) => { if (item.asset) handleAssetClick(item.asset); }}
              compact
            />
          </div>
        ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            {/* Loading */}
            {isLoading && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50 mb-4" />
                <p className="text-sm font-medium">{isSearching ? 'Searching...' : 'Loading assets...'}</p>
              </div>
            )}

            {/* Error */}
            {error && results.length === 0 && (
              <div className="flex flex-col items-center py-24 text-center">
                <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                  <X className="h-6 w-6 text-red-500/70" />
                </div>
                <p className="text-sm font-medium mb-1">Query failed</p>
                <p className="text-xs text-muted-foreground max-w-sm mb-4">{error}</p>
                <Button onClick={refresh} variant="outline" size="sm">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
                </Button>
              </div>
            )}

            {/* Empty */}
            {!isLoading && !error && results.length === 0 && !groupedResults?.length && (
              <div className="flex flex-col items-center py-24 text-center">
                <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-5">
                  <Search className="h-8 w-8 text-muted-foreground/25" />
                </div>
                <h3 className="font-semibold text-base mb-1.5">
                  {isSearching ? 'No results found' : 'No assets yet'}
                </h3>
                <p className="text-sm text-muted-foreground/60 max-w-md mb-6">
                  {isSearching
                    ? 'Try different keywords, broaden your filters, or use ~semantic search for conceptual matching.'
                    : 'Import documents, web pages, or data to start exploring.'}
                </p>
                {!isSearching && (
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                    {QUERY_EXAMPLES.slice(0, 4).map((ex) => (
                      <button
                        key={ex.q}
                        type="button"
                        onClick={() => { setQuery(ex.q); inputRef.current?.focus(); }}
                        className="px-3 py-1.5 rounded-lg bg-muted/50 hover:bg-muted text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {ex.q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Row results */}
            {results.length > 0 && layout === 'results' && !groupedResults && (
              <div ref={resultListRef} className="space-y-0.5">
                {results.map((r, i) => (
                  <SearchResultRow
                    key={r.asset.id}
                    result={r}
                    maxScore={maxScore}
                    onClick={handleAssetClick}
                    isActive={i === focusIndex || r.asset.id === activeAssetId}
                  />
                ))}
              </div>
            )}

            {/* Grouped results — parents as rows, child matches as tiles underneath */}
            {groupedResults && groupedResults.length > 0 && layout === 'results' && (
              <div ref={resultListRef} className="space-y-1">
                {groupedResults.map(({ parent, children, totalMatches }) => (
                  <div key={parent.asset.id}>
                    <SearchResultRow
                      result={parent}
                      maxScore={maxScore}
                      onClick={handleAssetClick}
                      isActive={parent.asset.id === activeAssetId}
                    />
                    {(children.length > 0 || totalMatches > 0) && (
                      <div className="ml-8 mt-1 mb-3">
                        {children.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {children.map((c) => {
                              const config = getAssetKindConfig(c.asset.kind);
                              const Icon = config.icon;
                              const preview = c.highlight || c.asset.text_content?.slice(0, 200) || null;
                              const pct = c.score != null && maxScore > 0 ? Math.round((c.score / maxScore) * 100) : null;
                              return (
                                <button
                                  key={c.asset.id}
                                  type="button"
                                  onClick={() => handleAssetClick(c.asset)}
                                  className={cn(
                                    'flex flex-col gap-1 p-3 rounded-lg border text-left transition-all duration-150',
                                    c.asset.id === activeAssetId
                                      ? 'bg-accent/60 border-border/50 shadow-sm'
                                      : 'bg-muted/20 border-border/20 hover:bg-muted/50 hover:border-border/40',
                                  )}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <Icon className={cn('h-3.5 w-3.5 shrink-0', config.iconColor)} />
                                    <span className="text-xs font-medium truncate flex-1">{c.asset.title || 'Untitled'}</span>
                                    {pct != null && (
                                      <span className={cn('text-[10px] tabular-nums font-medium shrink-0', pct >= 60 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60')}>
                                        {pct}%
                                      </span>
                                    )}
                                  </div>
                                  {preview && (
                                    <div className="text-[11px] leading-relaxed text-muted-foreground line-clamp-3">
                                      {c.highlight ? <ServerHighlight html={c.highlight} /> : preview}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {totalMatches > children.length && (
                          <button
                            type="button"
                            onClick={() => handleAssetClick(parent.asset)}
                            className="mt-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                          >
                            + {totalMatches - children.length} more page {totalMatches - children.length === 1 ? 'match' : 'matches'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Grid */}
            {results.length > 0 && layout === 'grid' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {results.map((r) => (
                  <AssetCard
                    key={r.asset.id}
                    asset={r.asset}
                    score={r.score != null && maxScore > 0 ? Math.round((r.score / maxScore) * 100) : undefined}
                    onClick={handleAssetClick}
                    size="md"
                    orientation="vertical"
                  />
                ))}
              </div>
            )}

            {/* List */}
            {results.length > 0 && layout === 'list' && (
              <div className="space-y-2">
                {results.map((r) => (
                  <AssetCard
                    key={r.asset.id}
                    asset={r.asset}
                    score={r.score != null && maxScore > 0 ? Math.round((r.score / maxScore) * 100) : undefined}
                    onClick={handleAssetClick}
                    size="md"
                    orientation="horizontal"
                  />
                ))}
              </div>
            )}


            {/* Load more */}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-8">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading more...
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={loadMore} className="gap-1.5">
                    <ChevronDown className="h-3.5 w-3.5" /> Load more
                  </Button>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
        )}
      </div>

      {/* Bundle creation dialog */}
      <CreateBundleDialog
        open={bundleDialogOpen}
        onOpenChange={setBundleDialogOpen}
        infospaceId={infospaceId}
        sourceQuery={query}
        onCreated={handleBundleCreated}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function SyntaxRow({ code, hint, accent }: { code: string; hint: string; accent?: string }) {
  const accentClass = accent === 'violet'
    ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
    : accent === 'red'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : 'bg-muted/80 text-foreground/70';
  return (
    <div className="flex items-start gap-2">
      <code className={cn('px-1 py-0.5 rounded text-[10px] font-mono whitespace-nowrap shrink-0', accentClass)}>
        {code}
      </code>
      <span className="text-[10px] text-muted-foreground/70 leading-relaxed">{hint}</span>
    </div>
  );
}
