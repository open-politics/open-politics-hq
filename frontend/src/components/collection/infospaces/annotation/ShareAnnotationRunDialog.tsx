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
import { AnnotationRunRead } from '@/client/models';
import { toast } from 'sonner';
import { ShareableLinkCreate, ShareableLinkRead } from '@/client';
import { Copy, Check, Share2, ExternalLink } from 'lucide-react';

interface ShareAnnotationRunDialogProps {
  run: AnnotationRunRead;
  onClose: () => void;
}

export default function ShareAnnotationRunDialog({ run, onClose }: ShareAnnotationRunDialogProps) {
  const { activeInfospace } = useInfospaceStore();
  const { createLink } = useShareableStore();
  const [createdLink, setCreatedLink] = useState<ShareableLinkRead | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateLink = useCallback(async () => {
    if (!activeInfospace?.id || !run) {
      toast.error('Cannot create link: missing active infospace or run.');
      return;
    }

    setIsLoading(true);

    const linkData: ShareableLinkCreate = {
      resource_type: 'run',
      resource_id: run.id,
      name: `Share link for ${run.name}`,
      permission_level: 'read_only' as const,
      is_public: false,
      expiration_date: null,
      max_uses: null
    };

    try {
      const newLink = await createLink(linkData, activeInfospace.id);
      if (newLink) {
        setCreatedLink(newLink);
        toast.success('Share link created! Anyone with this link can view the annotation results.');
      } else {
        toast.error('Failed to create share link.');
      }
    } catch (error) {
      console.error('Error creating share link:', error);
      toast.error('An error occurred while creating the share link.');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace, run, createLink]);

  const handleCopy = () => {
    if (createdLink) {
      const shareUrl = `${window.location.origin}/share/${createdLink.token}`;
      navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleOpenInNewTab = () => {
    if (createdLink) {
      const shareUrl = `${window.location.origin}/share/${createdLink.token}`;
      window.open(shareUrl, '_blank');
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Annotation Run
          </DialogTitle>
          <DialogDescription>
            Share "{run.name}" with others
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!createdLink ? (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                <p>Create a shareable link to give others access to view the annotation results for this run.</p>
                <p className="mt-2 text-xs">
                  The shared dashboard will include all annotation results, visualizations, and analysis for this run.
                </p>
              </div>
              
              <div className="bg-muted/50 p-3 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <strong>Run:</strong> {run.name}
                </div>
                {run.description && (
                  <div className="flex items-start gap-2 text-sm mt-1">
                    <strong>Description:</strong> {run.description}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                  <strong>Created:</strong> {new Date(run.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-green-700 bg-green-50 p-3 rounded-lg">
                ✅ Share link created successfully! Anyone with this link can view the annotation results.
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="share-link" className="text-sm font-medium">
                  Share Link
                </Label>
                <div className="flex items-center space-x-2">
                  <Input
                    id="share-link"
                    value={`${window.location.origin}/share/${createdLink.token}`}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button type="button" size="sm" onClick={handleCopy} className="flex-shrink-0">
                    {isCopied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenInNewTab}
                  className="flex-1"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Preview Link
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {createdLink ? 'Done' : 'Cancel'}
          </Button>
          {!createdLink && (
            <Button onClick={handleCreateLink} disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Share Link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 