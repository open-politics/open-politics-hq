'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SourceRead } from '@/client/types.gen';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Loader2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

interface SourceEditDialogProps {
  source: SourceRead | null;
  open: boolean;
  onClose: () => void;
}

export default function SourceEditDialog({ source, open, onClose }: SourceEditDialogProps) {
  const [name, setName] = useState('');
  const [targetBundleId, setTargetBundleId] = useState<number | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const { updateSource } = useSourceStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { activeInfospace } = useInfospaceStore();

  // Load bundles when dialog opens
  useEffect(() => {
    if (open && activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
    }
  }, [open, activeInfospace?.id, fetchBundles]);

  // Initialize form when source changes
  useEffect(() => {
    if (source) {
      setName(source.name || '');
      // Use output_bundle_id (streaming field) instead of details.target_bundle_id
      setTargetBundleId((source as any).output_bundle_id || source.details?.target_bundle_id);
    } else {
      // Reset form when source is cleared
      setName('');
      setTargetBundleId(undefined);
    }
  }, [source]);

  const handleSave = async () => {
    if (!source) {
      toast.error('No source selected');
      return;
    }
    
    if (!source.id) {
      console.error('Source missing ID:', source);
      toast.error('Invalid source data - missing ID');
      return;
    }

    if (!activeInfospace?.id) {
      toast.error('No active infospace');
      return;
    }

    setIsSaving(true);
    try {
      const updateData: any = {
        name: name.trim(),
        output_bundle_id: targetBundleId || null,
      };

      await updateSource(source.id, updateData);
      toast.success('Source settings updated');
      onClose();
    } catch (error) {
      console.error('Failed to update source:', error);
      toast.error(`Failed to update source: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!source) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Source Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Source Name */}
          <div className="space-y-2">
            <Label htmlFor="source-name">Source Name</Label>
            <Input
              id="source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter source name"
            />
          </div>

          {/* Output Bundle */}
          <div className="space-y-2">
            <Label htmlFor="output-bundle">Output Bundle</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Select which bundle new items from this stream should be routed to
            </p>
            <Select
              value={targetBundleId?.toString() || 'none'}
              onValueChange={(value) => setTargetBundleId(value === 'none' ? undefined : parseInt(value))}
            >
              <SelectTrigger id="output-bundle">
                <SelectValue placeholder="Select a bundle">
                  {targetBundleId ? (
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" />
                      {bundles.find(b => b.id === targetBundleId)?.name || 'Unknown Bundle'}
                    </div>
                  ) : (
                    'No bundle (root level)'
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="text-muted-foreground">No bundle (root level)</span>
                </SelectItem>
                {bundles.map((bundle) => (
                  <SelectItem key={bundle.id} value={bundle.id.toString()}>
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" />
                      {bundle.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Source Details Preview */}
          <div className="space-y-2">
            <Label>Source Details</Label>
            <div className="text-sm text-muted-foreground space-y-1 p-3 bg-muted rounded-md">
              <div><strong>Type:</strong> {source.kind}</div>
              {(source.details as any)?.feed_url && (
                <div><strong>Feed URL:</strong> {(source.details as any).feed_url}</div>
              )}
              {(source.details as any)?.search_config?.query && (
                <div><strong>Search Query:</strong> "{(source.details as any).search_config.query}"</div>
              )}
              <div><strong>Status:</strong> {source.status}</div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name || !name.trim()}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
