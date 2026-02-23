'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Microscope, Folder } from 'lucide-react';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';

export interface AnnotateFolderParams {
  bundleId: number;
  pathPrefix: string;
}

interface AnnotateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  params: AnnotateFolderParams | null;
}

export default function AnnotateFolderDialog({
  open,
  onOpenChange,
  params,
}: AnnotateFolderDialogProps) {
  const { activeInfospace } = useInfospaceStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { schemas, loadSchemas, createRun, isCreatingRun } = useAnnotationSystem();
  const [selectedSchemaIds, setSelectedSchemaIds] = useState<Set<number>>(new Set());
  const [runName, setRunName] = useState('');

  const loadBundles = async () => {
    if (!activeInfospace?.id) return;
    await fetchBundles(activeInfospace.id);
  };

  useEffect(() => {
    if (open && activeInfospace?.id) {
      loadBundles();
      loadSchemas();
    }
  }, [open, activeInfospace?.id, loadSchemas]);

  const bundle = params ? bundles.find((b) => b.id === params.bundleId) : null;
  const activeSchemas = schemas.filter((s) => s.is_active !== false);

  useEffect(() => {
    if (params && !runName) {
      const folderName = params.pathPrefix ? params.pathPrefix.split('/').filter(Boolean).pop() || params.pathPrefix : 'folder';
      setRunName(`Annotate: ${folderName}`);
    }
  }, [params, runName]);

  const handleCreate = async () => {
    if (!params || selectedSchemaIds.size === 0 || !activeInfospace?.id) {
      toast.warning('Select at least one schema.');
      return;
    }
    const newRun = await createRun({
      name: runName || `Annotate folder ${params.pathPrefix || 'root'}`,
      schemaIds: Array.from(selectedSchemaIds),
      bundleId: params.bundleId,
      configuration: params.pathPrefix ? { path_filter: params.pathPrefix } : {},
    });
    if (newRun) {
      onOpenChange(false);
      setSelectedSchemaIds(new Set());
      setRunName('');
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedSchemaIds(new Set());
      setRunName('');
      onOpenChange(false);
    }
  };

  if (!params) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Microscope className="h-5 w-5 text-purple-500" />
            Annotate folder
          </DialogTitle>
          <DialogDescription>
            Create an annotation run targeting assets in this virtual folder. The run will use path_filter to limit scope.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-lg border p-3 bg-muted/30 space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Folder className="h-4 w-4 text-amber-600" />
              <span className="font-medium">{bundle?.name ?? `Bundle ${params.bundleId}`}</span>
            </div>
            {params.pathPrefix && (
              <p className="text-xs text-muted-foreground truncate" title={params.pathPrefix}>
                Path: {params.pathPrefix}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Run name</Label>
            <input
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="e.g. Annotate: politics/eu"
            />
          </div>
          <div className="space-y-2">
            <Label>Annotation schemas</Label>
            <div className="border rounded-md max-h-[180px] overflow-y-auto p-2 space-y-1">
              {activeSchemas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No schemas available. Create one first.</p>
              ) : (
                activeSchemas.map((schema) => (
                  <label
                    key={schema.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedSchemaIds.has(schema.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedSchemaIds);
                        if (checked) next.add(schema.id);
                        else next.delete(schema.id);
                        setSelectedSchemaIds(next);
                      }}
                    />
                    <Microscope className="h-4 w-4 text-purple-500 shrink-0" />
                    <span className="text-sm truncate">{schema.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={selectedSchemaIds.size === 0 || isCreatingRun}
          >
            {isCreatingRun ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
