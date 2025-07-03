import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { AssetTreeItem } from '../AssetSelector';
import { toast } from 'sonner';
import { ResourceType, ShareableLinkCreate, ShareableLinkRead } from '@/client';
import { Copy, Check } from 'lucide-react';

interface ShareItemDialogProps {
  item: AssetTreeItem;
  onClose: () => void;
}

export default function ShareItemDialog({ item, onClose }: ShareItemDialogProps) {
  const { activeInfospace } = useInfospaceStore();
  const { createLink } = useShareableStore();
  const [createdLink, setCreatedLink] = useState<ShareableLinkRead | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateLink = useCallback(async () => {
    if (!activeInfospace?.id || !item) {
      toast.error('Cannot create link: missing active infospace or item.');
      return;
    }

    setIsLoading(true);
    const resourceType: ResourceType = item.type === 'folder' ? 'bundle' : 'asset';
    const resourceId = item.bundle?.id ?? item.asset?.id;

    if (!resourceId) {
      toast.error('Invalid item for sharing.');
      setIsLoading(false);
      return;
    }

    const linkData: ShareableLinkCreate = {
      resource_type: resourceType,
      resource_id: resourceId,
      name: `Share link for ${item.name}`,
    };

    try {
      const newLink = await createLink(linkData, activeInfospace.id);
      if (newLink) {
        setCreatedLink(newLink);
        toast.success('Share link created!');
      } else {
        toast.error('Failed to create share link.');
      }
    } catch (error) {
      toast.error('An error occurred while creating the share link.');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace, item, createLink]);

  const handleCopy = () => {
    if (createdLink) {
      const shareUrl = `${window.location.origin}/share/${createdLink.token}`;
      navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share "{item.name}"</DialogTitle>
          <DialogDescription>
            {createdLink
              ? 'Copy the link below to share.'
              : 'Create a shareable link for this item.'}
          </DialogDescription>
        </DialogHeader>

        {createdLink ? (
          <div className="flex items-center space-x-2 mt-4">
            <Input
              id="link"
              value={`${window.location.origin}/share/${createdLink.token}`}
              readOnly
            />
            <Button type="button" size="sm" onClick={handleCopy}>
              {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground">
              Click the button below to generate a secure link. You can configure expiration and permissions later.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {createdLink ? 'Close' : 'Cancel'}
          </Button>
          {!createdLink && (
            <Button onClick={handleCreateLink} disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 