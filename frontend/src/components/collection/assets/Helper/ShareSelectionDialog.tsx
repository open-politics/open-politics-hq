'use client';

import React, { useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, FileText, FolderOpen, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { usePackageStore } from '@/zustand_stores/storePackages';
import type { AssetTreeItem } from '../AssetSelector';

interface Props {
  items: AssetTreeItem[];
  onClose: () => void;
}

export default function ShareSelectionDialog({ items, onClose }: Props) {
  const { createPackage } = usePackageStore();
  const [name, setName] = useState(
    items.length === 1 ? `Share: ${items[0].name}` : `Shared selection (${items.length} items)`
  );
  const [allowDownload, setAllowDownload] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [packageUrl, setPackageUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleCreate = useCallback(async () => {
    setIsLoading(true);
    try {
      const packageItems: Array<{ bundle_id?: number; asset_id?: number }> = [];
      for (const item of items) {
        if (item.type === 'folder' && item.bundle?.id) {
          packageItems.push({ bundle_id: item.bundle.id });
        } else if (item.asset?.id) {
          packageItems.push({ asset_id: item.asset.id });
        }
      }

      if (packageItems.length === 0) {
        toast.error('No valid items to share.');
        return;
      }

      const pkg = await createPackage({
        name,
        default_allow_download: allowDownload,
        default_allow_copy: false,
        visibility: 'token',
        items: packageItems,
      });

      if (pkg) {
        const url = `${window.location.origin}/p/${pkg.token}`;
        setPackageUrl(url);
        navigator.clipboard.writeText(url);
        toast.success('Package created — link copied to clipboard');
      }
    } catch (e: any) {
      toast.error(`Failed to create package: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [items, name, allowDownload, createPackage]);

  const handleCopy = () => {
    if (packageUrl) {
      navigator.clipboard.writeText(packageUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const assetCount = items.filter((i) => i.type !== 'folder').length;
  const bundleCount = items.filter((i) => i.type === 'folder').length;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Share {items.length} item{items.length !== 1 ? 's' : ''}
            </div>
          </DialogTitle>
          <DialogDescription>
            Create a package with a shareable link.
          </DialogDescription>
        </DialogHeader>

        {packageUrl ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2">
              <Input value={packageUrl} readOnly className="text-xs" />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {/* Summary */}
            <div className="flex gap-2">
              {assetCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <FileText className="h-3 w-3" /> {assetCount} asset{assetCount !== 1 ? 's' : ''}
                </Badge>
              )}
              {bundleCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <FolderOpen className="h-3 w-3" /> {bundleCount} bundle{bundleCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-name">Package name</Label>
              <Input
                id="share-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="share-dl">Allow download</Label>
              <Switch id="share-dl" checked={allowDownload} onCheckedChange={setAllowDownload} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {packageUrl ? 'Close' : 'Cancel'}
          </Button>
          {!packageUrl && (
            <Button onClick={handleCreate} disabled={isLoading || !name.trim()}>
              {isLoading ? 'Creating...' : 'Create & Copy Link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
