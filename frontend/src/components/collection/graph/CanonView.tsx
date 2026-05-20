'use client';

/**
 * Detail view for a single canon.
 *
 * A canon is an infospace-scoped vocabulary of entities. This component
 * shows the canon's metadata, lists its entities, and exposes per-canon
 * actions: create entity, merge entities, delete-with-preview.
 *
 * Entity creation uses the canon's id (not infospace.default_canon_id) so
 * each canon owns its members. Cross-canon entity reuse is forbidden by
 * the backend — see `backend/app/api/modules/graph/resolution.py`.
 */

import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GitMerge, Loader2, MapPin, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { useCanon, useCanonEntities, useDeleteCanon, useMergeInCanon } from '@/hooks/useCanons';
import { CanonsService, EntitiesService } from '@/client';
import type { DeleteImpact, EntityRead } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { DeletePreviewDialog } from './DeletePreviewDialog';
import { EntitySheet } from './EntitySheet';
import { ProposalReviewDialog } from './ProposalReviewDialog';
import { toast } from 'sonner';

interface Props {
  canonId: number;
  onDeleted?: () => void;
}

export const CanonView: React.FC<Props> = ({ canonId, onDeleted }) => {
  const { activeInfospace } = useInfospaceStore();
  const { canon, loading: canonLoading } = useCanon(canonId);
  const { entities, loading: entitiesLoading, refresh: refreshEntities } = useCanonEntities(canonId);
  const { merge, loading: merging } = useMergeInCanon();
  const { previewOrConfirm: previewDelete } = useDeleteCanon();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('PERSON');
  const [creating, setCreating] = useState(false);

  const [mergeSelected, setMergeSelected] = useState<Set<number>>(new Set());
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [mergeKeepId, setMergeKeepId] = useState<number | null>(null);

  const [deleteEntityTarget, setDeleteEntityTarget] = useState<EntityRead | null>(null);
  const [deletingEntity, setDeletingEntity] = useState(false);

  const [deleteCanonImpact, setDeleteCanonImpact] = useState<DeleteImpact | null>(null);
  const [editingEntity, setEditingEntity] = useState<EntityRead | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposalTaskId, setProposalTaskId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!activeInfospace || !createName.trim()) return;
    setCreating(true);
    try {
      await EntitiesService.createEntity({
        infospaceId: activeInfospace.id,
        requestBody: {
          canonical_name: createName.trim(),
          entity_type: createType,
          canon_id: canonId,
        },
      });
      toast.success('Entity created');
      setIsCreateOpen(false);
      setCreateName('');
      refreshEntities();
    } catch {
      toast.error('Failed to create entity');
    } finally {
      setCreating(false);
    }
  }, [activeInfospace, canonId, createName, createType, refreshEntities]);

  const toggleMergeSelect = (id: number) => {
    setMergeSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMerge = useCallback(async () => {
    if (mergeSelected.size < 2 || !mergeKeepId) return;
    const result = await merge(canonId, Array.from(mergeSelected), mergeKeepId);
    if (result) {
      toast.success('Entities merged');
      setMergeSelected(new Set());
      setIsMergeOpen(false);
      setMergeKeepId(null);
      refreshEntities();
    }
  }, [merge, canonId, mergeSelected, mergeKeepId, refreshEntities]);

  const handleDeleteEntity = useCallback(async () => {
    if (!activeInfospace || !deleteEntityTarget) return;
    setDeletingEntity(true);
    try {
      await EntitiesService.deleteEntity({
        infospaceId: activeInfospace.id,
        entityId: deleteEntityTarget.id,
        requestBody: { confirm: true },
      });
      toast.success('Entity deleted');
      setDeleteEntityTarget(null);
      refreshEntities();
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'Failed to delete';
      toast.error(typeof detail === 'string' ? detail : 'Failed to delete');
    } finally {
      setDeletingEntity(false);
    }
  }, [activeInfospace, deleteEntityTarget, refreshEntities]);

  const beginDeleteCanon = useCallback(async () => {
    const preview = await previewDelete(canonId, false);
    if (preview) setDeleteCanonImpact(preview);
  }, [previewDelete, canonId]);

  const confirmDeleteCanon = useCallback(async () => {
    const result = await previewDelete(canonId, true);
    if (result?.confirmed) {
      toast.success('Canon deleted');
      setDeleteCanonImpact(null);
      onDeleted?.();
    }
  }, [previewDelete, canonId, onDeleted]);

  const handleProposeResolutions = useCallback(async () => {
    if (!activeInfospace) return;
    setProposing(true);
    try {
      const result = await CanonsService.proposeResolutionsAction({
        infospaceId: activeInfospace.id,
        requestBody: {
          target: 'entities',
          canon_id: canonId,
        },
      }) as { task_id?: string; topic?: string; watch_url?: string };
      if (result?.task_id) {
        setProposalTaskId(result.task_id);
      } else {
        toast.error('Dispatch did not return a task id');
      }
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'Failed to dispatch';
      toast.error(typeof detail === 'string' ? detail : 'Failed to dispatch');
    } finally {
      setProposing(false);
    }
  }, [activeInfospace, canonId]);

  if (canonLoading || !canon) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isDefault = canon.id === activeInfospace?.default_canon_id;
  const isGeoDefault = canon.id === activeInfospace?.default_geo_canon_id;
  const RoleIcon = canon.role === 'geo' ? MapPin : Users;

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <RoleIcon className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold truncate">{canon.name}</h3>
            <Badge variant={canon.role === 'geo' ? 'outline' : 'secondary'} className="text-[10px]">
              {canon.role}
            </Badge>
            {isDefault && <Badge variant="outline" className="text-[10px]">default</Badge>}
            {isGeoDefault && <Badge variant="outline" className="text-[10px]">geo default</Badge>}
          </div>
          {canon.description && (
            <p className="text-xs text-muted-foreground">{canon.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={mergeSelected.size < 2}
            onClick={() => {
              setIsMergeOpen(true);
              setMergeKeepId(mergeSelected.size > 0 ? Array.from(mergeSelected)[0] : null);
            }}
          >
            <GitMerge className="h-4 w-4 mr-1" />
            Merge ({mergeSelected.size})
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={proposing || entities.length < 2}
            onClick={handleProposeResolutions}
            title="Scan this canon for embedding-similar entity pairs"
          >
            {proposing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Propose resolutions
          </Button>
          <Button onClick={() => setIsCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Entity
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={beginDeleteCanon}
            title="Delete canon"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {entitiesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : entities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mb-2 opacity-50" />
            <p>No entities in this canon yet.</p>
            <p className="text-sm mt-1">Curate from a run, or add manually.</p>
            <Button variant="outline" className="mt-4" onClick={() => setIsCreateOpen(true)}>
              Create entity
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entities.map(e => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Checkbox
                      checked={mergeSelected.has(e.id)}
                      onCheckedChange={() => toggleMergeSelect(e.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium text-left hover:underline"
                      onClick={() => setEditingEntity(e)}
                    >
                      {e.canonical_name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 items-center">
                      <Badge variant="secondary">{e.entity_type}</Badge>
                      {(e.additional_types ?? []).map(t => (
                        <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    {(e.aliases || []).filter(a => a !== e.canonical_name).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteEntityTarget(e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create entity in &ldquo;{canon.name}&rdquo;</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Canonical name" />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Input value={createType} onChange={e => setCreateType(e.target.value)} placeholder="PERSON, ORGANIZATION, etc." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge entities in &ldquo;{canon.name}&rdquo;</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Select which entity to keep. Aliases from the others are merged into it.
          </p>
          <div className="grid gap-2 py-2">
            {Array.from(mergeSelected).map(id => {
              const e = entities.find(x => x.id === id);
              return e ? (
                <label key={e.id} className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="keep"
                    checked={mergeKeepId === e.id}
                    onChange={() => setMergeKeepId(e.id)}
                  />
                  <span className="font-medium">{e.canonical_name}</span>
                  <Badge variant="secondary" className="text-xs">{e.entity_type}</Badge>
                </label>
              ) : null;
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMergeOpen(false)}>Cancel</Button>
            <Button onClick={handleMerge} disabled={merging || mergeSelected.size < 2 || !mergeKeepId}>
              {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteEntityTarget && (
        <Dialog open={!!deleteEntityTarget} onOpenChange={open => !open && setDeleteEntityTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete entity?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Delete &ldquo;{deleteEntityTarget.canonical_name}&rdquo;? Backed-by edges or curations will block this.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteEntityTarget(null)}>Cancel</Button>
              <Button
                onClick={handleDeleteEntity}
                disabled={deletingEntity}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletingEntity ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <DeletePreviewDialog
        open={!!deleteCanonImpact}
        impact={deleteCanonImpact}
        resourceLabel="canon"
        resourceName={canon.name}
        onConfirm={confirmDeleteCanon}
        onCancel={() => setDeleteCanonImpact(null)}
      />

      <EntitySheet
        entity={editingEntity}
        open={!!editingEntity}
        onClose={() => setEditingEntity(null)}
        onSaved={refreshEntities}
      />

      {proposalTaskId && (
        <ProposalReviewDialog
          open={!!proposalTaskId}
          onClose={() => setProposalTaskId(null)}
          canonId={canonId}
          taskId={proposalTaskId}
          onMerged={refreshEntities}
        />
      )}
    </div>
  );
};

export default CanonView;
