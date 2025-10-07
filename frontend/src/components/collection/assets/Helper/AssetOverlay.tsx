'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AssetManager from '../AssetManager';
import { Button } from '@/components/ui/button';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { AssetRead } from '@/client';
import { PlusCircle } from 'lucide-react';

interface AssetOverlayProps {
  open: boolean;
  onClose: () => void;
  onAssetSelect?: (asset: AssetRead) => void;
}

export default function AssetOverlay({ open, onClose, onAssetSelect }: AssetOverlayProps) {
  const { activeInfospace } = useInfospaceStore();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] w-[90vw] overflow-hidden flex flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between p-4 border-b">
          <DialogTitle>Bundle Manager</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden p-4">
          <AssetManager />
        </div>
      </DialogContent>
    </Dialog>
  );
}