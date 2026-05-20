"use client";

/**
 * ValueAliasManager — UI for the `MergeMap` backend primitive.
 *
 * A user sees a field (e.g. `party`) and wants `FDP ≡ {Freie Partei
 * Deutschlands, F.D.P.}` to show up as one bucket across every panel reading
 * that field. This dialog lets them define those aliases once per run.
 *
 * Data flow:
 *   - On open, load distinct values + counts via `/distinct_values`
 *     (backend ILIKE prefix filter so we don't pull 5M rows).
 *   - User multi-selects raw values, names a canonical, saves.
 *   - Aliases persist in `DashboardConfig.runWideSettings.globalVariableSplitting.valueAliases`
 *     (run-scoped; shared by all panels).
 *   - Every `/view` request converts aliases → `MergeMap[]` via `mergeMapsFor`
 *     before sending, so the SQL `CASE WHEN` applies at query time.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Search as SearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RunsService } from '@/client';
import type {
  DistinctValueEntry,
  FilterSet,
  MergeMap,
} from '@/client';
import { toast } from 'sonner';

export interface ValueAliasManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  infospaceId: number;
  runId: number;
  /** Field path the user is aliasing (e.g. "document.party"). */
  fieldPath: string;
  /** Current aliases map: canonical → list of raw values. */
  aliases: Record<string, string[]>;
  /** Persist new aliases map. Caller writes to dashboardConfig. */
  onSave: (next: Record<string, string[]>) => void;
  /** Current filter set + schema scope, forwarded to /distinct_values. */
  filters?: FilterSet;
  schemaIds?: number[];
}

/**
 * Convert the UI alias map into `MergeMap[]` for `/view` requests.
 *
 * One MergeMap per field. ``aliases`` is canonical → raw names (many-to-one
 * reversed for easy UI editing), which maps directly onto `MergeMapEntry`
 * rows with `keep` + `names`.
 */
export function aliasesToMergeMaps(
  fieldPath: string,
  aliases: Record<string, string[]>,
): MergeMap[] {
  const entries = Object.entries(aliases)
    .filter(([, names]) => names.length > 0)
    .map(([keep, names]) => ({ keep, names }));
  if (entries.length === 0) return [];
  return [{ field_path: fieldPath, entries }];
}

export function ValueAliasManager({
  open,
  onOpenChange,
  infospaceId,
  runId,
  fieldPath,
  aliases,
  onSave,
  filters,
  schemaIds,
}: ValueAliasManagerProps) {
  const [distinct, setDistinct] = useState<DistinctValueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [truncated, setTruncated] = useState(false);

  // Draft state mirrors aliases so Cancel discards; Save commits.
  const [draftAliases, setDraftAliases] = useState<Record<string, string[]>>(aliases);
  const [stagedSelection, setStagedSelection] = useState<Set<string>>(new Set());
  const [pendingCanonical, setPendingCanonical] = useState('');

  // Reset draft when dialog opens so we don't carry prior edits.
  useEffect(() => {
    if (open) setDraftAliases(aliases);
  }, [open, aliases]);

  // Fetch distinct values with a debounced prefix search.
  useEffect(() => {
    if (!open || !fieldPath) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await RunsService.distinctValues({
          infospaceId,
          runId,
          requestBody: {
            field_path: fieldPath,
            search: search || null,
            limit: 500,
            filters: filters ?? null,
            // Apply aliases as we type so users see merged state.
            merge_maps: aliasesToMergeMaps(fieldPath, draftAliases),
            schema_ids: schemaIds ?? [],
          },
        });
        if (controller.signal.aborted) return;
        setDistinct(res.items ?? []);
        setTruncated(!!res.truncated);
      } catch (err: any) {
        if (!controller.signal.aborted) {
          toast.error(`Failed to load values: ${err.message ?? err}`);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, fieldPath, infospaceId, runId, search, filters, schemaIds, draftAliases]);

  // Raw values already aliased get a badge next to them (already-mapped).
  const rawToCanonical = useMemo(() => {
    const m = new Map<string, string>();
    for (const [canonical, raws] of Object.entries(draftAliases)) {
      for (const raw of raws) m.set(raw, canonical);
    }
    return m;
  }, [draftAliases]);

  const toggleStage = useCallback((value: string) => {
    setStagedSelection(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const commitMerge = useCallback(() => {
    const canonical = pendingCanonical.trim();
    if (!canonical) {
      toast.error('Give the merged group a name.');
      return;
    }
    if (stagedSelection.size === 0) {
      toast.error('Select at least one value to merge.');
      return;
    }
    setDraftAliases(prev => {
      const next = { ...prev };
      // Remove selected values from any other canonical they currently belong to.
      for (const [k, raws] of Object.entries(next)) {
        const filtered = raws.filter(r => !stagedSelection.has(r));
        if (filtered.length === 0) delete next[k];
        else next[k] = filtered;
      }
      // Merge into target canonical.
      const existing = next[canonical] ?? [];
      const merged = Array.from(new Set([...existing, ...stagedSelection]));
      next[canonical] = merged;
      return next;
    });
    setStagedSelection(new Set());
    setPendingCanonical('');
  }, [pendingCanonical, stagedSelection]);

  const removeAlias = useCallback((canonical: string) => {
    setDraftAliases(prev => {
      const next = { ...prev };
      delete next[canonical];
      return next;
    });
  }, []);

  const handleSave = () => {
    onSave(draftAliases);
    onOpenChange(false);
    toast.success('Value aliases saved.');
  };

  const handleCancel = () => {
    setDraftAliases(aliases);
    setStagedSelection(new Set());
    setPendingCanonical('');
    onOpenChange(false);
  };

  const existingAliasCount = Object.keys(draftAliases).length;
  const totalRawMerged = Object.values(draftAliases).reduce((sum, arr) => sum + arr.length, 0);
  const distinctAfterAliasing = distinct.length - totalRawMerged + existingAliasCount;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleCancel())}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Value aliases — <span className="font-mono">{fieldPath}</span></DialogTitle>
          <DialogDescription>
            Merge raw values into a canonical name. Every panel reading this
            field will see the merged buckets.
            {existingAliasCount > 0 && (
              <span className="ml-1">
                After aliasing, this field has <strong>{distinctAfterAliasing}</strong> distinct values (from {distinct.length + totalRawMerged - existingAliasCount}).
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Existing aliases — editable summary */}
        {existingAliasCount > 0 && (
          <div className="border rounded p-2 space-y-1.5 bg-muted/20">
            <div className="text-xs font-medium text-muted-foreground">Existing aliases</div>
            {Object.entries(draftAliases).map(([canonical, raws]) => (
              <div key={canonical} className="flex items-start gap-2 text-xs">
                <Badge variant="outline" className="font-mono flex-shrink-0">
                  {canonical}
                </Badge>
                <span className="text-muted-foreground flex-shrink-0">≡</span>
                <div className="flex-1 flex flex-wrap gap-1">
                  {raws.map(r => (
                    <span key={r} className="bg-background border rounded px-1 py-0.5 font-mono">
                      {r}
                    </span>
                  ))}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  onClick={() => removeAlias(canonical)}
                  title="Remove alias"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Search + results */}
        <div className="flex items-center gap-2">
          <SearchIcon className="h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search values…"
            className="h-7 text-xs"
          />
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>

        <ScrollArea className="flex-1 min-h-[240px] border rounded">
          <div className="p-1">
            {distinct.length === 0 && !loading && (
              <div className="text-xs text-muted-foreground p-3 text-center">
                No distinct values in this field for the current filter set.
              </div>
            )}
            {distinct.map(entry => {
              const staged = stagedSelection.has(entry.value);
              const aliasedTo = rawToCanonical.get(entry.value);
              return (
                <div
                  key={entry.value}
                  className={cn(
                    'flex items-center gap-2 py-0.5 px-1.5 rounded hover:bg-muted/40 text-xs',
                    aliasedTo && 'opacity-60',
                  )}
                >
                  <Checkbox
                    checked={staged}
                    onCheckedChange={() => toggleStage(entry.value)}
                  />
                  <span className="flex-1 truncate font-mono">{entry.value || '(empty)'}</span>
                  {aliasedTo && (
                    <Badge variant="outline" className="text-[10px]">
                      → {aliasedTo}
                    </Badge>
                  )}
                  <span className="text-muted-foreground tabular-nums text-[10px]">
                    {entry.count.toLocaleString()}
                  </span>
                </div>
              );
            })}
            {truncated && (
              <div className="text-[10px] text-amber-700 dark:text-amber-400 p-2 text-center">
                Results truncated at 500. Use the search box to narrow down.
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Merge composer */}
        <div className="flex items-center gap-2 border-t pt-2">
          <span className="text-xs font-medium text-muted-foreground">
            {stagedSelection.size} selected →
          </span>
          <Input
            value={pendingCanonical}
            onChange={(e) => setPendingCanonical(e.target.value)}
            placeholder="Canonical name (e.g. FDP)"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMerge();
            }}
          />
          <Button size="sm" onClick={commitMerge} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            Merge
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save aliases</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
