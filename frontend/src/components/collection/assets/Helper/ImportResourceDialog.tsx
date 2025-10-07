'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from "@/components/ui/input";
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import useAuth from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Loader2, PlusCircle } from 'lucide-react';

interface ImportResourceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (targetInfospaceId: number) => void;
  resourceName: string;
  isImporting: boolean;
}

export function ImportResourceDialog({
  isOpen,
  onClose,
  onConfirm,
  resourceName,
  isImporting,
}: ImportResourceDialogProps) {
  const [targetInfospaceId, setTargetInfospaceId] = useState<string>('');
  const [isCreatingInfospace, setIsCreatingInfospace] = useState(false);
  const [newInfospaceName, setNewInfospaceName] = useState('');
  const { user } = useAuth();
  const { infospaces, fetchInfospaces, createInfospace } = useInfospaceStore();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      fetchInfospaces();
    }
  }, [isOpen, user, fetchInfospaces]);

  const handleConfirm = async () => {
    setIsLoading(true);
    let finalTargetId: number | null = targetInfospaceId ? parseInt(targetInfospaceId, 10) : null;

    if (isCreatingInfospace) {
      if (!newInfospaceName.trim()) {
        toast.error('New infospace name cannot be empty.');
        setIsLoading(false);
        return;
      }
      if (!user) {
        toast.error("User not authenticated.");
        setIsLoading(false);
        return;
      }
      try {
        const newInfospace = await createInfospace({
          name: newInfospaceName,
          owner_id: user.id,
        });
        if (!newInfospace) {
          toast.error('Failed to create new infospace.');
          setIsLoading(false);
          return;
        }
        toast.success(`Infospace "${newInfospace.name}" created.`);
        finalTargetId = newInfospace.id;
        useInfospaceStore.getState().setActiveInfospace(finalTargetId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Error creating infospace.");
        setIsLoading(false);
        return;
      }
    }

    if (!finalTargetId) {
      toast.error('You must select a destination infospace.');
      setIsLoading(false);
      return;
    }

    useInfospaceStore.getState().setActiveInfospace(finalTargetId);
    
    setIsLoading(false);
    onConfirm(finalTargetId);
  };

  const isConfirmDisabled = isImporting || isLoading ||
    (!isCreatingInfospace && !targetInfospaceId) ||
    (isCreatingInfospace && !newInfospaceName.trim());

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import "{resourceName}"</DialogTitle>
          <DialogDescription>
            Choose an Infospace to import this resource into, or create a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <label htmlFor="target-infospace" className="text-sm font-medium">
            Destination Infospace
          </label>
          {!isCreatingInfospace ? (
            <div className="flex items-center gap-2">
              <Select value={targetInfospaceId} onValueChange={setTargetInfospaceId} disabled={isLoading}>
                <SelectTrigger id="target-infospace">
                  <SelectValue placeholder="Select an infospace..." />
                </SelectTrigger>
                <SelectContent>
                  {infospaces.length > 0 ? (
                    infospaces.map((infospace) => (
                      <SelectItem key={infospace.id} value={infospace.id.toString()}>
                        {infospace.name}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-4 text-center text-sm text-muted-foreground">No infospaces found.</div>
                  )}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setIsCreatingInfospace(true)} className="text-xs">
                <PlusCircle className="h-4 w-4 mr-1" /> New
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                id="new-infospace-name"
                placeholder="New infospace name..."
                value={newInfospaceName}
                onChange={(e) => setNewInfospaceName(e.target.value)}
                disabled={isLoading}
              />
              <Button variant="ghost" size="sm" onClick={() => { setIsCreatingInfospace(false); setNewInfospaceName(''); }}>
                Cancel
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isConfirmDisabled}>
            {isImporting || isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isLoading ? 'Creating...' : 'Importing...'}
              </>
            ) : (
              'Confirm & Import'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 