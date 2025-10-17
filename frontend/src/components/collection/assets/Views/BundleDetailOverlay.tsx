'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import BundleDetailView from './BundleDetailView';
import { Button } from '@/components/ui/button';
import { Maximize, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { BundleRead } from '@/client';
import { cn } from '@/lib/utils';

interface BundleDetailOverlayProps {
  open: boolean;
  onClose: () => void;
  bundleId: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  onOpenManagerRequest?: () => void;
}

export default function BundleDetailOverlay({
  open,
  onClose,
  bundleId,
  onLoadIntoRunner,
  onOpenManagerRequest,
}: BundleDetailOverlayProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { activeInfospace } = useInfospaceStore();
  const [dataFetched, setDataFetched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { getFullBundle } = useTreeStore();
  const [bundle, setBundle] = useState<BundleRead | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);

  // Fetch the bundle details
  const fetchBundleDetails = useCallback(async (id: number) => {
    if (!activeInfospace?.id) return null;
    
    try {
      const fetchedBundle = await getFullBundle(id);
      return fetchedBundle;
    } catch (error) {
      console.error(`Error fetching bundle ${id}:`, error);
      return null;
    }
  }, [activeInfospace?.id, getFullBundle]);

  const fetchData = useCallback(async () => {
    if (!activeInfospace || !bundleId) return;
    
    setIsLoading(true);
    setLoadError(null);
    
    try {
      const fetchedBundle = await fetchBundleDetails(bundleId);
      
      if (fetchedBundle) {
        setBundle(fetchedBundle);
        setDataFetched(true);
      } else {
        setLoadError(`Could not find bundle with ID: ${bundleId}`);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoadError('Failed to load bundle details.');
      toast.error('Failed to load bundle details.');
    } finally {
      setIsLoading(false);
    }
  }, [activeInfospace, bundleId, fetchBundleDetails]);

  useEffect(() => {
    if (open && bundleId && activeInfospace && !dataFetched) {
      fetchData();
    }
  }, [open, bundleId, activeInfospace, dataFetched, fetchData]);

  useEffect(() => {
    if (!open) {
      setDataFetched(false);
      setBundle(null);
      setLoadError(null);
      setSelectedAssetId(null);
    }
  }, [open]);

  const handleOpenInManager = () => {
    if (bundle) {
      onOpenManagerRequest?.();
      onClose();
    }
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
      <DialogContent className={cn(
        "flex flex-col p-0 max-w-6xl",
        "max-h-[90vh] sm:max-h-[90vh]",
        "w-[100vw] sm:w-auto"
      )}>
        <DialogHeader className="flex flex-row items-center justify-between p-3 sm:p-4 border-b flex-shrink-0">
          <DialogTitle className="text-sm sm:text-base">
            Bundle Details {bundleId ? `(ID: ${bundleId})` : ''}
          </DialogTitle>
          {bundle && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleOpenInManager}
              title="Open in Asset Manager"
              className="h-7 w-7 -mt-4 mr-8"
            >
              <Maximize className="size-4" />
            </Button>
          )}
        </DialogHeader>
        
        <div className="flex-1 min-h-0 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 sm:h-6 sm:w-6 animate-spin mr-2" />
              <p className="text-sm">Loading bundle...</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center h-full text-destructive p-4">
              <AlertCircle className="h-8 w-8 sm:h-10 sm:w-10 mb-4" />
              <p className="text-center text-sm">{loadError}</p>
            </div>
          ) : bundle ? (
            <BundleDetailView
              selectedBundleId={bundleId}
              selectedAssetId={selectedAssetId}
              onAssetSelect={setSelectedAssetId}
              highlightAssetId={null}
              onLoadIntoRunner={handleLoadIntoRunner}
            />
          ) : (
            <div className="flex items-center justify-center h-full p-4">
              <p className="text-sm">No bundle found or item does not exist.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

