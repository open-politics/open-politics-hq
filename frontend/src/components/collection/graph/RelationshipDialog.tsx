'use client';

/**
 * Editor dialog for a single EntityRelationship overlay (pin / tags / notes /
 * properties). The DB row is sparse — created lazily on first PATCH. Tombstone
 * via ``is_active = false`` when the last contributing GraphEdge dies; the
 * overlay survives so curated notes / tags persist.
 *
 * The pair (a, b) is normalized to canonical order ``(min(a,b), max(a,b))``
 * server-side; callers can pass entity ids in any order.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Pin, PinOff, Plus, Target, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RelationshipsService } from '@/client';
import type { DeleteImpact, EntityRelationshipRead, EntityRelationshipUpdate, AnnotationSchemaRead } from '@/client';
import { useUpsertRelationship, useDeleteRelationshipOverlay } from '@/hooks/useRelationships';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { entityPathsFromSchema, pushCooccursToDashboard } from '@/lib/annotations/scopes';
import { DeletePreviewDialog } from './DeletePreviewDialog';
import { toast } from 'sonner';

interface Props {
  graphId: number;
  /** Entity A — order doesn't matter; backend normalizes the pair. */
  entityA: { id: number; label: string };
  entityB: { id: number; label: string };
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** Optional pre-fetched overlay; skips the GET round-trip. */
  initial?: EntityRelationshipRead | null;
}

export const RelationshipDialog: React.FC<Props> = ({
  graphId, entityA, entityB, open, onClose, onSaved, initial,
}) => {
  const { activeInfospace } = useInfospaceStore();
  const { upsert, loading: saving } = useUpsertRelationship();
  const { previewOrConfirm: previewDelete } = useDeleteRelationshipOverlay();
  // Active dashboard panels (zustand persists across the route change from
  // /runs/[id] → /graphs, so the user can scope their last-opened dashboard
  // from the graph view without re-loading the run).
  const dashboardPanels = useAnnotationRunStore(s => s.dashboardConfig?.panels ?? []);
  const dashboardName = useAnnotationRunStore(s => s.dashboardConfig?.name ?? null);
  const addScope = useAnnotationRunStore(s => s.addScope);
  const { schemas } = useAnnotationSystem();

  const [loading, setLoading] = useState(false);
  const [existing, setExisting] = useState<EntityRelationshipRead | null>(initial ?? null);

  const [pinned, setPinned] = useState(false);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);

  // Load the existing overlay (if any) when the dialog opens. The list view
  // already returns derived rows even when no overlay is materialized, so the
  // dialog handles both the materialized and the not-yet-materialized cases.
  useEffect(() => {
    if (!open || !activeInfospace) return;
    if (initial !== undefined) {
      // Caller pre-fetched (or knows there's no overlay yet). Use it directly.
      const row = initial ?? null;
      setExisting(row);
      setPinned(row?.is_pinned ?? false);
      setLabel(row?.label ?? '');
      setNotes(row?.notes ?? '');
      setTags(row?.tags ?? []);
      return;
    }
    let cancelled = false;
    setLoading(true);
    RelationshipsService.getRelationship({
      infospaceId: activeInfospace.id,
      graphId,
      a: entityA.id,
      b: entityB.id,
    })
      .then(row => {
        if (cancelled) return;
        setExisting(row as EntityRelationshipRead);
        setPinned(row?.is_pinned ?? false);
        setLabel(row?.label ?? '');
        setNotes(row?.notes ?? '');
        setTags(row?.tags ?? []);
      })
      .catch(() => {
        // 404 / no overlay yet — derived only. Start blank.
        if (cancelled) return;
        setExisting(null);
        setPinned(false);
        setLabel('');
        setNotes('');
        setTags([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, activeInfospace, graphId, entityA.id, entityB.id, initial]);

  const addTag = () => {
    const v = tagInput.trim();
    if (!v || tags.includes(v)) {
      setTagInput('');
      return;
    }
    setTags(prev => [...prev, v]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));

  const handleSave = useCallback(async () => {
    const body: EntityRelationshipUpdate = {
      is_pinned: pinned,
      label: label.trim() || null,
      notes: notes.trim() || null,
      tags: tags,
    };
    const result = await upsert(graphId, entityA.id, entityB.id, body);
    if (result) {
      toast.success('Relationship saved');
      onSaved?.();
      onClose();
    }
  }, [upsert, graphId, entityA.id, entityB.id, pinned, label, notes, tags, onSaved, onClose]);

  const beginDelete = useCallback(async () => {
    const preview = await previewDelete(graphId, entityA.id, entityB.id, false);
    if (preview) setDeleteImpact(preview);
  }, [previewDelete, graphId, entityA.id, entityB.id]);

  const confirmDelete = useCallback(async () => {
    const result = await previewDelete(graphId, entityA.id, entityB.id, true);
    if (result?.confirmed) {
      toast.success('Overlay removed');
      setDeleteImpact(null);
      onSaved?.();
      onClose();
    }
  }, [previewDelete, graphId, entityA.id, entityB.id, onSaved, onClose]);

  // Count of dashboard panels that CAN receive the scope (have a schema
  // with entity-typed paths). Drives the button's disabled state + tooltip.
  const scopeApplicablePanelCount = useMemo(() => {
    let n = 0;
    for (const p of dashboardPanels) {
      const sid = (p.settings?.selectedSchemaId as number | undefined)
        ?? ((p.settings?.selectedSchemaIds as number[] | undefined)?.[0]);
      if (!sid) continue;
      const s = schemas.find(x => x.id === sid) as AnnotationSchemaRead | undefined;
      if (s && entityPathsFromSchema(s).length > 0) n += 1;
    }
    return n;
  }, [dashboardPanels, schemas]);

  const handleScopeToRelationship = useCallback(() => {
    if (dashboardPanels.length === 0) {
      toast.error('No dashboard loaded — open a run dashboard first to apply this scope.');
      return;
    }
    const { pushed } = pushCooccursToDashboard({
      entities: [entityA.label, entityB.label],
      reach: 'annotation',
      panels: dashboardPanels as any,
      schemas,
      addScope,
      sourcePanelId: `graph-view:${graphId}`,
      label: `${entityA.label} ↔ ${entityB.label}`,
    });
    if (pushed === 0) {
      toast.warning(
        'No applicable panels — the loaded dashboard has no entity-typed schemas. ' +
        'Open a dashboard whose schemas declare Entity fields.',
      );
      return;
    }
    toast.success(
      `Scope applied to ${pushed} panel${pushed === 1 ? '' : 's'}` +
      (dashboardName ? ` in ${dashboardName}` : ''),
    );
    onClose();
  }, [dashboardPanels, dashboardName, schemas, addScope, entityA.label, entityB.label, graphId, onClose]);

  const tombstoned = existing?.is_active === false;

  return (
    <>
      <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-semibold">{entityA.label}</span>
              <span className="text-muted-foreground">↔</span>
              <span className="font-semibold">{entityB.label}</span>
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {existing && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{existing.edge_count} edge{existing.edge_count === 1 ? '' : 's'}</span>
                  {existing.predicates && existing.predicates.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {existing.predicates.slice(0, 4).map(p => (
                        <Badge key={p} variant="outline" className="text-[10px] font-mono">{p}</Badge>
                      ))}
                      {existing.predicates.length > 4 && (
                        <Badge variant="outline" className="text-[10px]">+{existing.predicates.length - 4}</Badge>
                      )}
                    </div>
                  )}
                  {tombstoned && (
                    <Badge variant="destructive" className="text-[10px]">tombstoned</Badge>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={pinned} onCheckedChange={v => setPinned(!!v)} />
                <span className="text-sm flex items-center gap-1.5">
                  {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5 text-muted-foreground" />}
                  Pinned — surface this pair in pinned-only views
                </span>
              </label>

              <div className="grid gap-2">
                <Label className="text-xs">Label (optional, short)</Label>
                <Input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="e.g. Political rivalry"
                  className="h-8 text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs">Notes</Label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Free-form context that survives even if all underlying edges are removed."
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs">Tags</Label>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Add tag and press Enter"
                    className="h-8 text-sm flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map(t => (
                      <Badge key={t} variant="secondary" className="gap-1 pr-1">
                        {t}
                        <button
                          type="button"
                          className="ml-0.5 rounded hover:bg-muted/50"
                          onClick={() => removeTag(t)}
                          aria-label={`Remove tag ${t}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Filter relationships by tag in the panel. GIN-indexed — exact match.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <div className="flex items-center gap-2">
              {existing?.id != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={beginDelete}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Remove overlay
                </Button>
              )}
              {/*
                Scope-to-relationship gesture: builds a relational.cooccurs
                Scope from this entity pair and pushes it to every panel in
                the active dashboard whose schema has entity-typed paths.
                Disabled when no dashboard is loaded or no panels match —
                the tooltip explains why so the user knows what to fix.
              */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleScopeToRelationship}
                        disabled={dashboardPanels.length === 0 || scopeApplicablePanelCount === 0}
                      >
                        <Target className="h-3.5 w-3.5" />
                        Scope to {entityA.label} ↔ {entityB.label}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    {dashboardPanels.length === 0
                      ? 'Open a run dashboard first; the scope pushes to its panels.'
                      : scopeApplicablePanelCount === 0
                      ? 'None of the loaded dashboard’s panels use schemas with Entity fields.'
                      : `Will push a co-occurrence filter to ${scopeApplicablePanelCount} panel${scopeApplicablePanelCount === 1 ? '' : 's'}${dashboardName ? ` in ${dashboardName}` : ''}.`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || loading}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeletePreviewDialog
        open={!!deleteImpact}
        impact={deleteImpact}
        resourceLabel="relationship overlay"
        resourceName={`${entityA.label} ↔ ${entityB.label}`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteImpact(null)}
      />
    </>
  );
};

export default RelationshipDialog;
