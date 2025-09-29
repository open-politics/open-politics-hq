'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BundleRead } from '@/client';
import { toast } from 'sonner';
import { Layers, Save, X } from 'lucide-react';

interface BundleEditDialogProps {
  open: boolean;
  onClose: () => void;
  bundle: BundleRead;
  onSave: (bundleId: number, updateData: { name?: string; description?: string }) => Promise<void>;
}

export default function BundleEditDialog({ 
  open, 
  onClose, 
  bundle,
  onSave,
}: BundleEditDialogProps) {
  const [name, setName] = useState(bundle.name);
  const [description, setDescription] = useState(bundle.description || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(bundle.name);
    setDescription(bundle.description || '');
  }, [bundle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.error('Bundle name is required.');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(bundle.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onClose();
    } catch (error) {
      console.error('Error updating bundle:', error);
      // Error handling is done in the parent component
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setName(bundle.name);
    setDescription(bundle.description || '');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Edit Bundle: {bundle.name}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bundle-name">Bundle Name *</Label>
            <Input
              id="bundle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter bundle name"
              required
              disabled={isSaving}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="bundle-description">Description</Label>
            <Textarea
              id="bundle-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter bundle description (optional)"
              rows={3}
              disabled={isSaving}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSaving || !name.trim()}
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
} 