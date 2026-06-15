'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import { FolderPlus, Save, X, Loader2 } from 'lucide-react';
import type { BundleRead } from '@/client';

interface CreateBundleDialogProps {
  open: boolean;
  onClose: () => void;
  /** Assets to drop into the new bundle on create (e.g. from a multi-select). */
  initialAssetIds?: number[];
  /** Existing bundles to nest as children of the new bundle. */
  initialChildBundleIds?: number[];
  /** Fired after the bundle is created and seeded — lets the caller refresh its own view. */
  onCreated?: (bundle: BundleRead) => void;
}

export default function CreateBundleDialog({
  open,
  onClose,
  initialAssetIds,
  initialChildBundleIds,
  onCreated,
}: CreateBundleDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const { createBundle, moveBundleToParent, fetchBundles } = useBundleStore();
  const { activeInfospace } = useInfospaceStore();

  const seedAssetCount = initialAssetIds?.length ?? 0;
  const seedBundleCount = initialChildBundleIds?.length ?? 0;
  const seedCount = seedAssetCount + seedBundleCount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.error('Bundle name is required.');
      return;
    }

    if (!activeInfospace?.id) {
      toast.error('No active infospace selected.');
      return;
    }

    setIsCreating(true);
    try {
      const bundleData = {
        name: name.trim(),
        description: description.trim() || undefined,
        purpose: 'manual_collection', // Indicate this was manually created
        asset_ids: seedAssetCount > 0 ? initialAssetIds : undefined,
      };

      const newBundle = await createBundle(bundleData);

      if (newBundle) {
        // Nest any selected bundles under the freshly created one.
        if (seedBundleCount > 0) {
          await Promise.all(
            initialChildBundleIds!.map((id) => moveBundleToParent(id, newBundle.id)),
          );
        }
        toast.success(
          seedCount > 0
            ? `Bundle "${newBundle.name}" created with ${seedCount} item${seedCount > 1 ? 's' : ''}.`
            : `Bundle "${newBundle.name}" created successfully.`,
        );
        onCreated?.(newBundle);
        handleClose();

        // Refresh bundles list
        await fetchBundles(activeInfospace.id);
      }
    } catch (error) {
      console.error('Error creating bundle:', error);
      toast.error('Failed to create bundle.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            {seedCount > 0 ? 'Create Bundle from Selection' : 'Create New Bundle'}
          </DialogTitle>
          {seedCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {seedAssetCount > 0 && `${seedAssetCount} asset${seedAssetCount > 1 ? 's' : ''}`}
              {seedAssetCount > 0 && seedBundleCount > 0 && ' and '}
              {seedBundleCount > 0 && `${seedBundleCount} bundle${seedBundleCount > 1 ? 's' : ''}`}
              {' will be added to the new bundle.'}
            </p>
          )}
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bundle-name">Bundle Name *</Label>
            <Input
              id="bundle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Research Documents, Project Files"
              required
              disabled={isCreating}
              autoFocus
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="bundle-description">Description</Label>
            <Textarea
              id="bundle-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for this bundle"
              rows={3}
              disabled={isCreating}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={handleClose}
              disabled={isCreating}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isCreating || !name.trim()}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Create Bundle
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
} 