'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Edit, Trash2, Users, Loader2, GitMerge } from 'lucide-react';
import { CanonicalEntitiesService } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

interface EntityRecord {
  id: number;
  infospace_id: number;
  graph_id: number | null;
  canonical_name: string;
  entity_type: string;
  aliases: string[];
  properties: Record<string, unknown>;
  provenance_type: string;
}

const EntityManager: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('PERSON');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EntityRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<number>>(new Set());
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [mergeKeepId, setMergeKeepId] = useState<number | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const loadEntities = useCallback(async () => {
    if (!activeInfospace?.id) return;
    setIsLoading(true);
    try {
      const res = await CanonicalEntitiesService.listEntities({
        infospaceId: activeInfospace.id,
        entityType: entityTypeFilter || undefined,
      });
      setEntities((res as EntityRecord[]) || []);
    } catch (e) {
      toast.error('Failed to load entities');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace?.id, entityTypeFilter]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  const handleCreate = async () => {
    if (!activeInfospace?.id || !createName.trim()) return;
    setIsSaving(true);
    try {
      await CanonicalEntitiesService.createEntity({
        infospaceId: activeInfospace.id,
        requestBody: {
          canonical_name: createName.trim(),
          entity_type: createType,
        },
      });
      toast.success('Entity created');
      setIsCreateOpen(false);
      setCreateName('');
      loadEntities();
    } catch (e) {
      toast.error('Failed to create entity');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeInfospace?.id || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await CanonicalEntitiesService.deleteEntity({
        infospaceId: activeInfospace.id,
        entityId: deleteTarget.id,
      });
      toast.success('Entity deleted');
      setDeleteTarget(null);
      loadEntities();
    } catch (e) {
      toast.error('Failed to delete');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMerge = async () => {
    if (!activeInfospace?.id || mergeSelected.size < 2) return;
    const ids = Array.from(mergeSelected);
    const keepId = mergeKeepId ?? ids[0];
    setIsMerging(true);
    try {
      await CanonicalEntitiesService.mergeEntities({
        infospaceId: activeInfospace.id,
        requestBody: { entity_ids: ids, keep_id: keepId },
      });
      toast.success('Entities merged');
      setMergeSelected(new Set());
      setIsMergeOpen(false);
      setMergeKeepId(null);
      loadEntities();
    } catch (e) {
      toast.error('Failed to merge');
    } finally {
      setIsMerging(false);
    }
  };

  const toggleMergeSelect = (id: number) => {
    setMergeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const entityTypes = Array.from(new Set(entities.map((e) => e.entity_type))).sort();

  if (!activeInfospace) {
    return (
      <div className="p-6 text-muted-foreground">
        Select an infospace to manage entities.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5" />
          Entity Canon
        </h2>
        <div className="flex items-center gap-2">
          <select
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
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
          <Button onClick={() => setIsCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Entity
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : entities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Users className="h-12 w-12 mb-2 opacity-50" />
          <p>No entities yet.</p>
          <p className="text-sm mt-1">Run annotations with graph output to populate.</p>
          <Button variant="outline" className="mt-4" onClick={() => setIsCreateOpen(true)}>
            Create entity manually
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entities.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Checkbox
                      checked={mergeSelected.has(e.id)}
                      onCheckedChange={() => toggleMergeSelect(e.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{e.canonical_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{e.entity_type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    {(e.aliases || []).filter((a) => a !== e.canonical_name).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Entity</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Canonical name"
              />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Input
                value={createType}
                onChange={(e) => setCreateType(e.target.value)}
                placeholder="PERSON, ORGANIZATION, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isSaving || !createName.trim()}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entity?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Delete "${deleteTarget.canonical_name}"?` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Entities</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Select which entity to keep. Aliases from others will be merged into it.
          </p>
          <div className="grid gap-2 py-2">
            {Array.from(mergeSelected).map((id) => {
              const e = entities.find((x) => x.id === id);
              return e ? (
                <label
                  key={e.id}
                  className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="radio"
                    name="keep"
                    checked={mergeKeepId === e.id}
                    onChange={() => setMergeKeepId(e.id)}
                  />
                  <span className="font-medium">{e.canonical_name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {e.entity_type}
                  </Badge>
                </label>
              ) : null;
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={isMerging || mergeSelected.size < 2 || !mergeKeepId}
            >
              {isMerging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EntityManager;
