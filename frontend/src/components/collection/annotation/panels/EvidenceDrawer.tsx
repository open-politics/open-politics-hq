"use client";

/**
 * EvidenceDrawer — click-through drill-down surface.
 *
 * Clicking any rendered unit in a panel (bar, slice, graph node, map marker)
 * opens this drawer. It fetches the underlying annotations that contributed
 * to that unit and groups them by asset, so the viewer sees:
 *
 *   <asset title + kind>              [n annotations]
 *     ┣ AnnotationResultDisplay (schema A)
 *     ┗ AnnotationResultDisplay (schema B)
 *
 * Each asset header is clickable — opens the shared ``AssetDetailOverlay``
 * via ``useAssetDetail()`` so users get the same split content/results view
 * the table panel uses for row clicks. A per-asset chevron toggles the
 * expanded body so dense buckets stay scannable.
 *
 * Scaling controls (small, composable):
 *   1. Load-more     — uses ``cursor_next`` to append another page.
 *   2. Search        — client-side filter over asset titles + annotation
 *                      value JSON; cheap over what's already loaded.
 *   3. Collapse      — asset groups collapse by default when a bucket has
 *                      many assets; expand individually or in bulk.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ExternalLink, ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { FilterSet, MergeMap, AnnotationSchemaRead } from '@/client';
import type {
  Scope,
  FormattedAnnotation,
  AnnotationResultStatus,
  AnnotationResultRow,
  AssetSummary,
} from '@/lib/annotations/types';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { mergeFiltersAndScopes } from '@/lib/annotations/scopes';
import { useAssetDetail } from '@/components/collection/assets/Views/AssetDetailProvider';
import AnnotationResultDisplay from '../AnnotationResultDisplay';
import { getTargetKeysForScheme } from '@/lib/annotations/utils';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 100;
const AUTO_EXPAND_THRESHOLD = 5;

export interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  infospaceId: number;
  runId: number;
  /** The scope describing which annotations are being drilled into. */
  scope: Scope | null;
  /** Base filters to apply (panel-local filters). */
  baseFilters?: FilterSet;
  /** Merge maps to apply (run-wide aliases etc.). */
  mergeMaps?: MergeMap[];
  /** Schemas available in the run — needed to render annotation values. */
  schemas: AnnotationSchemaRead[];
  /** Display-side title, e.g. "party = FDP". */
  title?: string;
}

export function EvidenceDrawer({
  open,
  onOpenChange,
  infospaceId,
  runId,
  scope,
  baseFilters,
  mergeMaps,
  schemas,
  title,
}: EvidenceDrawerProps) {
  const { openDetailOverlay } = useAssetDetail();

  // Merge base filters with the drilled-into scope.
  const mergedFilters = useMemo(() => {
    const localBase = baseFilters ?? { logic: 'and' as const, conditions: [] };
    return scope ? mergeFiltersAndScopes(localBase, [scope]) : localBase;
  }, [baseFilters, scope]);

  // Pagination state — the hook returns one page at a time; we accumulate
  // across pages so load-more appends instead of replacing.
  // Cursor is opaque to the drawer — backend returns an encoded string,
  // frontend types still say number; typing it as union avoids a noisy cast.
  const [cursor, setCursor] = useState<string | number | null>(null);
  const [accumulated, setAccumulated] = useState<{
    items: AnnotationResultRow[];
    assets: Record<number, AssetSummary>;
  }>({ items: [], assets: {} });
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());
  const [autoExpanded, setAutoExpanded] = useState(false);

  // Reset everything whenever the drill target changes (new scope / new run).
  // Scope identity is used as the reset key — a fresh gesture produces a new
  // scope object from ``createScopeFromSelection``.
  const scopeKey = scope?.id ?? null;
  const prevScopeKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevScopeKey.current !== scopeKey) {
      prevScopeKey.current = scopeKey;
      setCursor(null);
      setAccumulated({ items: [], assets: {} });
      setSearchTerm('');
      setExpandedAssets(new Set());
      setAutoExpanded(false);
    }
  }, [scopeKey]);

  const { data, isLoading, error } = useAnnotationView({
    infospaceId,
    runId,
    rows: { limit: PAGE_SIZE, cursor },
    filters: mergedFilters,
    merge_maps: mergeMaps,
    enabled: open && !!scope,
  });

  // Merge each newly-arrived page into the accumulated set, deduping by
  // ``annotation_id`` so any overlap from an edge-case requeue can't
  // double-render the same row.
  useEffect(() => {
    const page = data?.rows;
    if (!page || !page.items) return;
    setAccumulated((prev) => {
      const seen = new Set(prev.items.map((r) => r.annotation_id));
      const appended = page.items.filter((r: AnnotationResultRow) => !seen.has(r.annotation_id));
      if (appended.length === 0 && Object.keys(page.assets ?? {}).length === 0) {
        return prev;
      }
      return {
        items: [...prev.items, ...appended],
        assets: { ...prev.assets, ...(page.assets ?? {}) },
      };
    });
  }, [data]);

  const items = accumulated.items;
  const assets = accumulated.assets;
  const total = data?.rows?.total ?? items.length;
  const cursorNext = data?.rows?.cursor_next ?? null;

  // Group annotations by asset — the primary drill-down unit. Assets appear
  // in the order their first annotation shows up in the paginated result.
  const grouped = useMemo(() => {
    const byAsset = new Map<number, AnnotationResultRow[]>();
    for (const row of items) {
      const bucket = byAsset.get(row.asset_id) ?? [];
      bucket.push(row);
      byAsset.set(row.asset_id, bucket);
    }
    return Array.from(byAsset.entries()).map(([assetId, rows]) => ({
      assetId,
      asset: assets[assetId],
      rows,
    }));
  }, [items, assets]);

  // Auto-expand the first asset groups exactly once, when the first page
  // arrives and the bucket is small. Past that point the user drives
  // expansion — we don't reset their choices on every page load.
  useEffect(() => {
    if (autoExpanded || grouped.length === 0) return;
    setAutoExpanded(true);
    if (grouped.length <= AUTO_EXPAND_THRESHOLD) {
      setExpandedAssets(new Set(grouped.map((g) => g.assetId)));
    }
  }, [grouped, autoExpanded]);

  const schemaById = useMemo(() => {
    const map = new Map<number, AnnotationSchemaRead>();
    for (const s of schemas) map.set(s.id, s);
    return map;
  }, [schemas]);

  // Pre-compute every schema's field keys so the annotation cards render
  // all fields — not just the first one. ``AnnotationResultDisplay`` in
  // compact mode defaults to ``fields.slice(0, 1)``; passing explicit
  // ``selectedFieldKeys`` overrides that, giving us a compact *multi-field*
  // card, which is what users actually want to see in a drilldown.
  const fieldKeysBySchemaId = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const s of schemas) {
      const keys = getTargetKeysForScheme(s.id, schemas).map((tk) => tk.key);
      map.set(s.id, keys);
    }
    return map;
  }, [schemas]);

  // Union of field keys across every schema that appears in the loaded
  // items. Shown as toggle chips so the user can concentrate on one or a
  // few fields when a schema has many. When empty (default), all fields
  // render — so "no chips selected" never blanks the view by accident.
  const availableFieldKeys = useMemo(() => {
    const schemaIdsInUse = new Set<number>();
    for (const r of items) schemaIdsInUse.add(r.schema_id);
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const sid of schemaIdsInUse) {
      for (const k of fieldKeysBySchemaId.get(sid) ?? []) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
    return keys;
  }, [items, fieldKeysBySchemaId]);

  // User's active subset. Empty set = "no filter, show all".
  const [activeFieldKeys, setActiveFieldKeys] = useState<Set<string>>(new Set());

  // Reset the filter when the drill target or the loaded field universe
  // changes — keeping a stale filter would hide fields that don't exist
  // anymore or leave a confusing carry-over between clicks.
  useEffect(() => {
    setActiveFieldKeys(new Set());
  }, [scopeKey, availableFieldKeys.join('|')]);

  const toggleFieldKey = (key: string) => {
    setActiveFieldKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const effectiveFieldKeysFor = (schemaId: number): string[] | null => {
    const all = fieldKeysBySchemaId.get(schemaId) ?? [];
    if (activeFieldKeys.size === 0) return all;
    const filtered = all.filter((k) => activeFieldKeys.has(k));
    // If the user's active set excludes every field this schema has, fall
    // back to all — otherwise the card renders an empty block with no
    // explanation, which reads as broken.
    return filtered.length > 0 ? filtered : all;
  };

  // Client-side search over what's loaded. A group matches if the asset
  // title contains the term OR any of its annotations' serialized value
  // does. The whole matching group is kept — we don't partially filter
  // annotations, since context inside a group matters for interpretation.
  const filteredGroups = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return grouped;
    return grouped.filter(({ asset, rows }) => {
      if (asset?.title && asset.title.toLowerCase().includes(term)) return true;
      for (const row of rows) {
        try {
          if (JSON.stringify(row.value).toLowerCase().includes(term)) return true;
        } catch {
          // non-serializable value — ignore
        }
      }
      return false;
    });
  }, [grouped, searchTerm]);

  const handleOpenAsset = (assetId: number) => {
    openDetailOverlay(assetId);
    onOpenChange(false);
  };

  const toggleExpanded = (assetId: number) => {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const allExpanded = filteredGroups.length > 0 &&
    filteredGroups.every((g) => expandedAssets.has(g.assetId));
  const toggleAll = () => {
    if (allExpanded) setExpandedAssets(new Set());
    else setExpandedAssets(new Set(filteredGroups.map((g) => g.assetId)));
  };

  const handleLoadMore = () => {
    if (cursorNext) setCursor(cursorNext);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl flex flex-col px-2">
        <SheetHeader>
          <SheetTitle>Evidence</SheetTitle>
          <SheetDescription>
            {title ?? scope?.label ?? 'Underlying annotations for this selection.'}
            {total > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {items.length} of {total.toLocaleString()} annotations across {grouped.length}{' '}
                {grouped.length === 1 ? 'asset' : 'assets'}
                {searchTerm && ` · ${filteredGroups.length} match search`}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Search + expand/collapse-all controls. Hidden until a page has
            arrived so the chrome doesn't flash on first open. */}
        {grouped.length > 0 && (
          <div className="space-y-2 pb-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filter by asset title or annotation value…"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs flex-shrink-0"
                onClick={toggleAll}
                disabled={filteredGroups.length === 0}
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </Button>
            </div>
            {availableFieldKeys.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Fields
                </span>
                {activeFieldKeys.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveFieldKeys(new Set())}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    show all
                  </button>
                )}
                {availableFieldKeys.map((key) => {
                  const active = activeFieldKeys.size === 0 || activeFieldKeys.has(key);
                  // Show only the last segment of the path so the chip row
                  // stays readable on crowded schemas.
                  const short = key.split('.').pop() || key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleFieldKey(key)}
                      title={key}
                      className={cn(
                        'text-[10px] rounded px-1.5 py-0.5 border transition-colors',
                        active
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'bg-muted/40 border-transparent text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading && items.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive py-4">
              Failed to load evidence: {error.message}
            </div>
          )}

          {!isLoading && !error && grouped.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No annotations match this selection.
            </div>
          )}

          {grouped.length > 0 && filteredGroups.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No loaded annotations match &ldquo;{searchTerm}&rdquo;.
              {cursorNext && ' Try Load more below for additional pages.'}
            </div>
          )}

          <ul className="space-y-3 py-2">
            {filteredGroups.map(({ assetId, asset, rows }) => {
              const isExpanded = expandedAssets.has(assetId);
              return (
                <li
                  key={assetId}
                  className="border rounded-md overflow-hidden bg-card"
                >
                  {/* Header row: chevron toggles expansion, title opens the
                      detail overlay. Two separate affordances so expansion
                      doesn't fight with the primary "open asset" gesture. */}
                  <div className="flex items-center gap-1 border-b">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(assetId)}
                      className="h-8 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenAsset(assetId)}
                      className={cn(
                        'flex-1 min-w-0 text-left px-1 py-2 flex items-center gap-2',
                        'hover:bg-muted/50 transition-colors',
                        'focus:outline-none focus:ring-1 focus:ring-primary/50',
                      )}
                      title="Open full asset view"
                    >
                      <Badge variant="outline" className="text-[10px] flex-shrink-0">
                        {asset?.kind ?? 'asset'}
                      </Badge>
                      <span className="truncate text-sm font-medium flex-1 min-w-0">
                        {asset?.title ?? `Asset #${assetId}`}
                      </span>
                      {asset?.parent_title && (
                        <span className="truncate text-[10px] text-muted-foreground flex-shrink-0 max-w-[140px]">
                          in {asset.parent_title}
                        </span>
                      )}
                      <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                        {rows.length}
                      </Badge>
                      <ExternalLink className="h-3 w-3 mr-2 text-muted-foreground flex-shrink-0" />
                    </button>
                  </div>

                  {/* Annotation cards render only when expanded — keeps the
                      mounted React tree cheap on dense buckets. */}
                  {isExpanded && (
                    <div className="divide-y">
                      {rows.map((row) => {
                        const schema = schemaById.get(row.schema_id);
                        if (!schema) {
                          return (
                            <div key={row.annotation_id} className="px-3 py-2 text-xs text-muted-foreground">
                              Annotation #{row.annotation_id} · schema {row.schema_id} (not available)
                            </div>
                          );
                        }
                        const formatted: FormattedAnnotation = {
                          id: row.annotation_id,
                          asset_id: row.asset_id,
                          schema_id: row.schema_id,
                          run_id: row.run_id,
                          value: row.value,
                          timestamp: row.timestamp,
                          status: (row.status as AnnotationResultStatus) || 'success',
                        };
                        return (
                          <div key={row.annotation_id} className="px-3 py-2 space-y-1">
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span className="font-medium text-foreground/80">{schema.name}</span>
                              <span className="tabular-nums">
                                {new Date(row.timestamp).toLocaleString()}
                              </span>
                              {row.element_index != null && (
                                <span>· element #{row.element_index}</span>
                              )}
                            </div>
                            <AnnotationResultDisplay
                              result={formatted}
                              schema={schema}
                              compact
                              renderContext="dialog"
                              selectedFieldKeys={effectiveFieldKeysFor(schema.id)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {cursorNext && !searchTerm && (
            <div className="py-3 flex items-center justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={isLoading}
                className="text-xs"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    Loading…
                  </>
                ) : (
                  <>Load {Math.min(PAGE_SIZE, Math.max(0, total - items.length)).toLocaleString()} more</>
                )}
              </Button>
            </div>
          )}

          {cursorNext && searchTerm && (
            <div className="py-2 text-[10px] text-muted-foreground text-center">
              Showing {items.length} of {total.toLocaleString()} loaded. Clear the filter to load more.
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
