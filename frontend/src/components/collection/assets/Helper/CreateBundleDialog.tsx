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

interface CreateBundleDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function CreateBundleDialog({ open, onClose }: CreateBundleDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  
  const { createBundle, fetchBundles } = useBundleStore();
  const { activeInfospace } = useInfospaceStore();

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
      };

      const newBundle = await createBundle(bundleData);
      
      if (newBundle) {
        toast.success(`Bundle "${newBundle.name}" created successfully.`);
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
            Create New Bundle
          </DialogTitle>
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