'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Hash,
  Braces,
  Tag,
  Plus,
  BookOpen,
  Sparkles,
  FolderPlus,
  Crosshair,
  Check,
  SquaresIntersect,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { useDebounce } from '@/hooks/useDebounce';
import { useAssetQuery, type ChildResultGroup } from '@/hooks/useAssetQuery';
import { useQueryFields } from '@/hooks/useQueryFields';
import { useFeedAssets } from '@/components/collection/assets/Feed/useFeedAssets';
import { useAssetDetail } from '@/components/collection/assets/Views/AssetDetailProvider';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useTreeStore } from '@/zustand_stores/storeTree';
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
  setRunInQuery,
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
import type { SchemaInfo, RunInfo } from '@/hooks/useQueryFields';
import AssetSelector from '@/components/collection/assets/AssetSelector';
import type { AssetTreeItem } from '@/components/collection/assets/AssetSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortOption = 'relevance' | 'created_at_desc' | 'created_at_asc' | 'title';
type LayoutMode = 'results' | 'grid' | 'list';

interface ExplorerResult {
  asset: AssetRead;
  score?: number;
  highlight?: string | null;
}

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

const FIELD_TYPE_ICONS: Record<string, React.ReactNode> = {
  string: <Tag className="h-3 w-3" />,
  number: <Hash className="h-3 w-3" />,
  array: <Braces className="h-3 w-3" />,
  object: <Braces className="h-3 w-3" />,
};

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
  const colors = PILL_COLORS[pill.type] || PILL_COLORS.text;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-medium ring-1 transition-all duration-150',
        colors.bg, colors.text, colors.ring,
        pill.negated && 'line-through opacity-60',
      )}
    >
      <span className="opacity-50 font-normal">{pill.label}</span>
      <span className="max-w-[200px] truncate">{pill.value}</span>
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

function AnnotationFieldBrowser({
  schemas,
  onInsertField,
}: {
  schemas: SchemaInfo[];
  onInsertField: (field: string, type: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleSchema = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (schemas.length === 0) {
    return <p className="text-[11px] text-muted-foreground/60 italic pl-1">No annotation schemas configured</p>;
  }

  return (
    <div className="space-y-0.5">
      {schemas.map((schema) => (
        <div key={schema.id}>
          <button
            type="button"
            onClick={() => toggleSchema(schema.id)}
            className="flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded hover:bg-muted/60 transition-colors text-xs"
          >
            <ChevronRight className={cn('h-3 w-3 text-muted-foreground/50 transition-transform duration-150', expanded.has(schema.id) && 'rotate-90')} />
            <BookOpen className="h-3 w-3 text-orange-500/70" />
            <span className="truncate font-medium flex-1">{schema.name}</span>
            <span className="text-[9px] text-muted-foreground/40 tabular-nums">{schema.fields.length}</span>
          </button>
          {expanded.has(schema.id) && (
            <div className="ml-5 mt-0.5 space-y-0">
              {schema.fields.map((field) => (
                <Tooltip key={field.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onInsertField(field.key, field.type)}
                      className="flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded hover:bg-muted/60 transition-colors group"
                    >
                      {FIELD_TYPE_ICONS[field.type] || <Tag className="h-3 w-3" />}
                      <code className="text-[10px] font-mono text-foreground/80 group-hover:text-foreground truncate flex-1">
                        {field.key}
                      </code>
                      <Plus className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity flex-shrink-0" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Insert annotation:{field.key}==</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run picker
// ---------------------------------------------------------------------------

function RunPicker({
  runs,
  onSelectRun,
}: {
  runs: RunInfo[];
  onSelectRun: (runId: string) => void;
}) {
  if (runs.length === 0) {
    return <p className="text-[11px] text-muted-foreground/60 italic pl-1">No annotation runs yet</p>;
  }

  return (
    <Select onValueChange={onSelectRun}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Select a run..." />
      </SelectTrigger>
      <SelectContent>
        {runs.map((run) => (
          <SelectItem key={run.id} value={String(run.id)} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium">{run.name}</span>
              <Badge variant="outline" className="text-[9px] py-0 px-1 h-4">
                {run.status}
              </Badge>
            </div>
            {run.schema_names.length > 0 && (
              <span className="text-[10px] text-muted-foreground block">
                {run.schema_names.join(', ')}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

export default function AssetExplorer() {
  const { activeInfospace } = useInfospaceStore();
  const { openDetailOverlay } = useAssetDetail();
  const infospaceId = activeInfospace?.id ?? 0;

  // Query state
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const isSearching = debouncedQuery.trim().length > 0;
  const inputRef = useRef<HTMLInputElement>(null);

  // UI state
  const [sortOption, setSortOption] = useState<SortOption>('created_at_desc');
  const [layout, setLayout] = useState<LayoutMode>('results');
  const [activeAssetId, setActiveAssetId] = useState<number | null>(null);
  const [showHelpers, setShowHelpers] = useState(true);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<Set<string>>(new Set());
  const pickerItemsRef = useRef<Map<string, AssetTreeItem>>(new Map());
  const lastPickerEnterId = useRef<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Auto-switch sort
  useEffect(() => {
    if (isSearching && sortOption !== 'relevance') setSortOption('relevance');
    else if (!isSearching && sortOption === 'relevance') setSortOption('created_at_desc');
  }, [isSearching]);

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

  const { fields } = useQueryFields(infospaceId);

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

  // Results
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

    // Build parent→children map from backend child_results
    const childMap = new Map<number, ExplorerResult[]>();
    for (const group of childResults) {
      childMap.set(group.parent_asset_id, group.matches.map((m) => ({
        asset: m.asset,
        score: m.score ?? undefined,
        highlight: m.highlight,
      })));
    }

    // Build grouped list: parent row with its children underneath
    type GroupedEntry = { parent: ExplorerResult; children: ExplorerResult[] };
    const grouped: GroupedEntry[] = [];
    const seenParents = new Set<number>();
    for (const r of results) {
      grouped.push({ parent: r, children: childMap.get(r.asset.id) ?? [] });
      seenParents.add(r.asset.id);
    }

    // Parents from child_results not in main results — append as header + children
    for (const group of childResults) {
      if (!seenParents.has(group.parent_asset_id)) {
        grouped.push({
          parent: { asset: { id: group.parent_asset_id, title: group.parent_title } as AssetRead },
          children: childMap.get(group.parent_asset_id) ?? [],
        });
      }
    }

    return grouped;
  }, [results, childResults, query]);

  const isLoading = isSearching ? querySearch.isLoading : feed.isLoading;
  const error = isSearching ? querySearch.error : feed.error;
  const hasMore = isSearching ? querySearch.hasMore : feed.hasMore;
  const loadMore = isSearching ? querySearch.loadMore : feed.loadMore;
  const totalCount = isSearching ? querySearch.total : feed.totalCount;

  // Handlers
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
  const handleRunSelect = useCallback((runId: string) => setQuery((q) => setRunInQuery(q, runId)), []);

  const handleInsertAnnotation = useCallback((field: string, type: string) => {
    const op = type === 'number' ? '>=' : '==';
    setQuery((q) => insertToken(q, `annotation:${field}${op}`));
    inputRef.current?.focus();
  }, []);

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
    if (before.endsWith('bundle:') || before.endsWith('asset:')) {
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

  // Confirm current picker selection → insert grouped tokens into query
  // e.g. bundle:"Emails","Documents" asset:"report.pdf","scan.png"
  const confirmPickerSelection = useCallback(() => {
    const bundleNames: string[] = [];
    const assetNames: string[] = [];
    pickerSelection.forEach((id) => {
      const resolved = resolvePickerItem(id);
      if (!resolved) return;
      if (resolved.isBundle) bundleNames.push(resolved.name);
      else assetNames.push(resolved.name);
    });
    const tokens: string[] = [];
    if (bundleNames.length > 0) {
      tokens.push('bundle:' + bundleNames.map((n) => `"${n}"`).join(','));
    }
    if (assetNames.length > 0) {
      tokens.push('asset:' + assetNames.map((n) => `"${n}"`).join(','));
    }
    if (tokens.length === 0) return;
    setQuery((q) => {
      const cleaned = q.replace(/\s*(bundle|asset):$/, '').trimEnd();
      const joined = tokens.join(' ');
      return cleaned ? `${cleaned} ${joined}` : joined;
    });
    setShowPicker(false);
    inputRef.current?.focus();
  }, [pickerSelection, resolvePickerItem]);

  // Picker: checkbox toggle
  const handlePickerSelectionChange = useCallback((selectedIds: Set<string>) => {
    setPickerSelection(selectedIds);
  }, []);

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

  const hasEntities = (fields?.entity_types.length ?? 0) > 0;

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
          {/* Search input */}
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 group-focus-within:text-foreground/60 transition-colors" />
            <Input
              ref={inputRef}
              value={query}
              onChange={handleQueryChange}
              placeholder='Search assets — kind: entity: after: bundle: ~semantic "phrase"'
              className={cn(
                'pl-10 pr-10 h-11 text-[15px] font-mono bg-muted/30 border-muted-foreground/10',
                'focus:bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary/30',
                'transition-all duration-200 rounded-lg',
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

            {/* Inline asset/bundle picker — triggered by typing bundle: or asset: */}
            {showPicker && (
              <div
                ref={pickerRef}
                className="relative left-0 right-0 top-full mt-1 z-50 flex flex-col border border-border rounded-lg shadow-lg overflow-hidden bg-popover"
              >
                <div className="h-[300px] min-h-0 overflow-hidden">
                  <AssetSelector
                    selectedItems={pickerSelection}
                    onSelectionChange={handlePickerSelectionChange}
                    onItemView={handlePickerItemClick}
                    onItemDoubleClick={handlePickerItemEnter}
                    autoFocusSearch
                    compact
                  />
                </div>
                {pickerSelection.size > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/30">
                    <span className="text-xs text-muted-foreground flex-1">
                      <span className="font-semibold text-foreground">{pickerSelection.size}</span> selected
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      onClick={() => setPickerSelection(new Set())}
                    >
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 text-[11px] px-3 gap-1"
                      onClick={confirmPickerSelection}
                    >
                      <Check className="h-3 w-3" />
                      Apply
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

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
                    className={cn(explorerToolbarBtn, 'shrink-0', showHelpers && explorerToolbarBtnActive)}
                    onClick={() => setShowHelpers(!showHelpers)}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 opacity-70" />
                    Helpers
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-[240px]">
                  Filters and query syntax reference
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(explorerToolbarBtn, 'shrink-0', showPicker && explorerToolbarBtnActive)}
                    onClick={() => setShowPicker((prev) => !prev)}
                  >
                    <SquaresIntersect className="h-3.5 w-3.5 opacity-70" />
                    Scope
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-[260px]">
                  Limit the query to specific bundles or assets
                </TooltipContent>
              </Tooltip>

              <div className="shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        explorerToolbarBtn,
                        'gap-1.5 shrink-0 w-auto max-w-[min(100%,14rem)]',
                        getChildrenFromQuery(query) !== '' && explorerToolbarBtnActive,
                      )}
                    >
                      <Rows3 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="whitespace-nowrap truncate">
                        <span className="text-foreground">Nested</span>
                        <span className="text-muted-foreground/80">
                          {' · '}
                          {nestedResultsTriggerSuffix(query)}
                        </span>
                      </span>
                      <ChevronDown className="h-3 w-3 shrink-0 opacity-40" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 p-1">
                    <div className="px-2.5 py-2 border-b border-border/50 mb-0.5">
                      <p className="text-[11px] font-medium leading-snug text-foreground">Nested results</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
                        Extra hits inside the same parent asset (e.g. PDF pages or sections).
                      </p>
                    </div>
                    {(() => {
                      const cur = getChildrenFromQuery(query) || 'default';
                      const row = (
                        key: string,
                        patch: string,
                        title: string,
                        hint: string,
                        isSelected: boolean,
                      ) => (
                        <DropdownMenuItem
                          key={key}
                          className="cursor-pointer rounded-sm px-2.5 py-2 text-xs focus:bg-muted/80 items-start gap-2"
                          onSelect={() => setQuery((q) => setChildrenInQuery(q, patch))}
                        >
                          <span className="flex-1 min-w-0 space-y-0.5 pr-1">
                            <span className="font-medium text-foreground leading-tight block">{title}</span>
                            <span className="text-[10px] text-muted-foreground leading-snug block">{hint}</span>
                          </span>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" strokeWidth={2.5} />
                          )}
                        </DropdownMenuItem>
                      );
                      return (
                        <>
                          {row('std', '', 'Standard', 'Up to 3 nested hits per parent', cur === 'default')}
                          {row('off', 'none', 'Off', 'Parent rows only', cur === 'none')}
                          <DropdownMenuSeparator className="my-1" />
                          {row('10', '10', 'Up to 10', 'Per parent asset', cur === '10')}
                          {row('30', '30', 'Up to 30', 'Per parent asset', cur === '30')}
                          {row('all', 'all', 'All', 'Every nested match', cur === 'all')}
                        </>
                      );
                    })()}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
              const childHitCount = childResults.reduce((sum, g) => sum + g.matches.length, 0);
              const assetCount = results.length + (groupedResults
                ? childResults.filter((g) => !results.some((r) => r.asset.id === g.parent_asset_id)).length
                : 0);
              const totalHits = results.length + childHitCount;
              return (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {childHitCount > 0 ? (
                    <>
                      <span className="font-semibold text-foreground">{totalHits.toLocaleString()}</span>
                      <span className="text-muted-foreground/60"> hit{totalHits !== 1 ? 's' : ''} in </span>
                      <span className="font-semibold text-foreground">{assetCount.toLocaleString()}</span>
                      <span className="text-muted-foreground/60"> asset{assetCount !== 1 ? 's' : ''}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">{results.length.toLocaleString()}</span>
                      {totalCount != null && totalCount > results.length && (
                        <span className="text-muted-foreground/60"> of {totalCount.toLocaleString()}</span>
                      )}
                      <span className="text-muted-foreground/60"> asset{results.length !== 1 ? 's' : ''}</span>
                    </>
                  )}
                </span>
              );
            })()}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className={cn(explorerToolbarBtn, 'shrink-0')}>
                  <SlidersHorizontal className="h-3.5 w-3.5 opacity-70" />
                  {SORT_OPTIONS.find((o) => o.value === sortOption)?.label || 'Sort'}
                  <ChevronDown className="h-3 w-3 opacity-40 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 p-1">
                <div className="px-2.5 py-1.5 border-b border-border/50 mb-0.5">
                  <p className="text-[11px] font-medium text-foreground">Sort</p>
                </div>
                {SORT_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    className="cursor-pointer rounded-sm px-2.5 py-2 text-xs focus:bg-muted/80 gap-2"
                    onSelect={() => setSortOption(opt.value as SortOption)}
                  >
                    <span className="flex-1">{opt.label}</span>
                    {sortOption === opt.value && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center rounded-md border border-border/30 overflow-hidden bg-muted/20">
              {([['results', Rows3], ['grid', LayoutGrid], ['list', LayoutList]] as [LayoutMode, typeof Rows3][]).map(([mode, ModeIcon]) => (
                <Tooltip key={mode}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'h-7 w-7 p-0 rounded-none border-0 text-muted-foreground hover:text-foreground hover:bg-muted/60',
                        layout === mode && 'bg-muted/80 text-foreground',
                      )}
                      onClick={() => setLayout(mode)}
                    >
                      <ModeIcon className="h-3.5 w-3.5 opacity-80" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{mode.charAt(0).toUpperCase() + mode.slice(1)} view</TooltipContent>
                </Tooltip>
              ))}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(explorerToolbarBtn, 'h-7 w-7 p-0 shrink-0')}
                  onClick={refresh}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5 opacity-70', isLoading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
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

              {/* Annotation run */}
              <Section title="Annotation run" count={fields?.runs.length}>
                <RunPicker runs={fields?.runs ?? []} onSelectRun={handleRunSelect} />
                <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                  Scope annotation: filters to results from a specific run.
                </p>
              </Section>

              {/* Annotation fields */}
              <Section title="Annotation fields" count={fields?.schemas.length} defaultOpen={false}>
                <AnnotationFieldBrowser
                  schemas={fields?.schemas ?? []}
                  onInsertField={handleInsertAnnotation}
                />
                <p className="text-[10px] text-muted-foreground/50 mt-2">
                  Click a field to add an annotation filter to your query.
                </p>
              </Section>

              {/* Entity search — only show when entities exist */}
              {hasEntities && (
                <Section title="Entity types" count={fields?.entity_types.length}>
                  <div className="flex flex-wrap gap-1">
                    {fields!.entity_types.map((et) => (
                      <Badge
                        key={et}
                        variant="outline"
                        className="text-[10px] py-0 px-1.5 font-medium cursor-default"
                      >
                        {et}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                    Use <code className="font-mono bg-muted/80 px-0.5 rounded">entity:&quot;Name&quot;</code> to search by entity.
                  </p>
                </Section>
              )}

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

        {/* Results */}
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
                {groupedResults.map(({ parent, children }) => (
                  <div key={parent.asset.id}>
                    <SearchResultRow
                      result={parent}
                      maxScore={maxScore}
                      onClick={handleAssetClick}
                      isActive={parent.asset.id === activeAssetId}
                    />
                    {children.length > 0 && (
                      <div className="ml-8 mt-1 mb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
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
