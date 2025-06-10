'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import AssetDetailView from './AssetDetailView';
import { Button } from '@/components/ui/button';
import { Maximize, Loader2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { AssetRead } from '@/client/models';

interface AssetDetailOverlayProps {
  open: boolean;
  onClose: () => void;
  assetId: number | null;
  highlightAssetIdOnOpen: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  onOpenManagerRequest?: () => void;
}

export default function AssetDetailOverlay({
  open,
  onClose,
  assetId,
  highlightAssetIdOnOpen,
  onLoadIntoRunner,
  onOpenManagerRequest
}: AssetDetailOverlayProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { activeInfospace } = useInfospaceStore();
  const [dataFetched, setDataFetched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { getAssetById } = useAssetStore();
  const [asset, setAsset] = useState<AssetRead | null>(null);

  // Fetch the asset details
  const fetchAssetDetails = useCallback(async (id: number) => {
    if (!activeInfospace?.id) return null;
    
    try {
      const fetchedAsset = await getAssetById(id);
      return fetchedAsset;
    } catch (error) {
      console.error(`Error fetching asset ${id}:`, error);
      return null;
    }
  }, [activeInfospace?.id, getAssetById]);

  const fetchData = useCallback(async () => {
    if (!activeInfospace || !assetId) return;
    
    setIsLoading(true);
    setLoadError(null);
    
    try {
      const fetchedAsset = await fetchAssetDetails(assetId);
      
      if (fetchedAsset) {
        setAsset(fetchedAsset);
        setDataFetched(true);
      } else {
        setLoadError(`Could not find asset with ID: ${assetId}`);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoadError('Failed to load asset details.');
      toast.error('Failed to load asset details.');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace, assetId, fetchAssetDetails]);

  useEffect(() => {
    if (open && assetId && activeInfospace && !dataFetched) {
      fetchData();
    }
  }, [open, assetId, activeInfospace, dataFetched, fetchData]);

  useEffect(() => {
    if (!open) {
      setDataFetched(false);
      setAsset(null);
      setLoadError(null);
    }
  }, [open]);

  const handleOpenInManager = () => {
    if (asset) {
      onOpenManagerRequest?.();
      onClose();
    }
  };

  const handleEdit = (asset: AssetRead) => {
    console.warn('handleEdit needs refactoring for assets');
  };

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      toast.success(`Loading into Classification Runner`, {
        description: `Loading run "${runName}" (ID: ${runId}) into the Classification Runner`,
        duration: 3000,
      });
      
      onLoadIntoRunner(runId, runName);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between p-4 border-b">
          <DialogTitle>Asset Details {assetId ? `(ID: ${assetId})` : ''}</DialogTitle>
          {asset && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleOpenInManager}
              title="Open in Asset Manager"
              className="h-8 w-8"
            >
              <Maximize className="h-4 w-4" />
            </Button>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <p>Loading details...</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center h-full text-destructive">
              <AlertCircle className="h-10 w-10 mb-4" />
              <p className="text-center">{loadError}</p>
            </div>
          ) : asset ? (
            <AssetDetailView
              onEdit={handleEdit}
              schemes={[]}
              selectedAssetId={assetId}
              highlightAssetIdOnOpen={highlightAssetIdOnOpen}
              onLoadIntoRunner={handleLoadIntoRunner}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p>No asset found or item does not exist.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 