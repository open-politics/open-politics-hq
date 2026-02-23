'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Edit, Trash2, Network, Loader2, Users } from 'lucide-react';
import Link from 'next/link';
import { KnowledgeGraphsService } from '@/client';
import type { KnowledgeGraphCreate, KnowledgeGraphUpdate } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useToast } from '@/components/ui/use-toast';
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
import { toast } from 'sonner';

interface KnowledgeGraphRecord {
  id: number;
  uuid: string;
  infospace_id: number;
  name: string;
  description: string | null;
  source_config: Record<string, unknown>;
  edit_policy: string;
  created_at: string;
  updated_at: string;
}

const KnowledgeGraphManager: React.FC = () => {
  const { activeInfospace } = useInfospaceStore();
  const [graphs, setGraphs] = useState<KnowledgeGraphRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGraph, setEditingGraph] = useState<KnowledgeGraphRecord | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEditPolicy, setFormEditPolicy] = useState<'method_only' | 'editable'>('method_only');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeGraphRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadGraphs = useCallback(async () => {
    if (!activeInfospace?.id) return;
    setIsLoading(true);
    try {
      const res = await KnowledgeGraphsService.listKnowledgeGraphs({
        infospaceId: activeInfospace.id,
      });
      setGraphs((res as KnowledgeGraphRecord[]) || []);
    } catch (e) {
      toast.error('Failed to load knowledge graphs');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace?.id]);

  useEffect(() => {
    loadGraphs();
  }, [loadGraphs]);

  const handleOpenCreate = () => {
    setEditingGraph(null);
    setFormName('');
    setFormDescription('');
    setFormEditPolicy('method_only');
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (g: KnowledgeGraphRecord) => {
    setEditingGraph(g);
    setFormName(g.name);
    setFormDescription(g.description || '');
    setFormEditPolicy((g.edit_policy as 'method_only' | 'editable') || 'method_only');
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!activeInfospace?.id) return;
    if (!formName.trim()) {
      toast.error('Name is required');
      return;
    }
    setIsSaving(true);
    try {
      if (editingGraph) {
        const body: KnowledgeGraphUpdate = {
          name: formName.trim(),
          description: formDescription.trim() || null,
          edit_policy: formEditPolicy,
        };
        await KnowledgeGraphsService.updateKnowledgeGraph({
          infospaceId: activeInfospace.id,
          graphId: editingGraph.id,
          requestBody: body,
        });
        toast.success('Knowledge graph updated');
      } else {
        const body: KnowledgeGraphCreate = {
          name: formName.trim(),
          description: formDescription.trim() || null,
          edit_policy: formEditPolicy,
        };
        await KnowledgeGraphsService.createKnowledgeGraph({
          infospaceId: activeInfospace.id,
          requestBody: body,
        });
        toast.success('Knowledge graph created');
      }
      setIsDialogOpen(false);
      loadGraphs();
    } catch (e) {
      toast.error(editingGraph ? 'Failed to update' : 'Failed to create');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeInfospace?.id || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await KnowledgeGraphsService.deleteKnowledgeGraph({
        infospaceId: activeInfospace.id,
        graphId: deleteTarget.id,
      });
      toast.success('Knowledge graph deleted');
      setDeleteTarget(null);
      loadGraphs();
    } catch (e) {
      toast.error('Failed to delete');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!activeInfospace) {
    return (
      <div className="p-6 text-muted-foreground">
        Select an infospace to manage knowledge graphs.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Network className="h-5 w-5" />
          Knowledge Graphs
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/hq/infospaces/infospace-manager#entities-section">
              <Users className="h-4 w-4 mr-1" />
              Entity Canon
            </Link>
          </Button>
          <Button onClick={handleOpenCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Graph
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : graphs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Network className="h-12 w-12 mb-2 opacity-50" />
          <p>No knowledge graphs yet.</p>
          <Button variant="outline" className="mt-4" onClick={handleOpenCreate}>
            Create your first graph
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Edit policy</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {graphs.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    {g.description || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.edit_policy === 'editable' ? 'default' : 'secondary'}>
                      {g.edit_policy}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenEdit(g)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(g)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGraph ? 'Edit' : 'Create'} Knowledge Graph</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Main policy graph"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div className="grid gap-2">
              <Label>Edit policy</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={formEditPolicy}
                onChange={(e) => setFormEditPolicy(e.target.value as 'method_only' | 'editable')}
              >
                <option value="method_only">Method only (auto-curated)</option>
                <option value="editable">Editable (manual merge/rename allowed)</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingGraph ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete graph?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Delete "${deleteTarget.name}"? Entities will be moved to infospace-level.`
                : ''}
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
    </div>
  );
};

export default KnowledgeGraphManager;
