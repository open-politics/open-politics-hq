'use client';

import React, { useState, useCallback } from 'react';
import AssetDetailOverlay from './AssetDetailOverlay';
import { AssetRead } from '@/client';

interface AssetDetailWrapperProps {
  children: React.ReactNode;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  selectedAssetId?: number | null;
  onAssetSelect?: (asset: AssetRead) => void;
}

export default function AssetDetailWrapper({
  children,
  onLoadIntoRunner,
  selectedAssetId: externalSelectedAssetId,
  onAssetSelect
}: AssetDetailWrapperProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [internalSelectedAssetId, setInternalSelectedAssetId] = useState<number | null>(null);

  // Use external asset ID if provided, otherwise use internal state
  const selectedAssetId = externalSelectedAssetId !== undefined ? externalSelectedAssetId : internalSelectedAssetId;

  const handleAssetSelect = useCallback((asset: AssetRead) => {
    if (onAssetSelect) {
      onAssetSelect(asset);
    } else {
      setInternalSelectedAssetId(asset.id);
      setIsDetailOpen(true);
    }
  }, [onAssetSelect]);

  const handleLoadIntoRunner = useCallback((runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      onLoadIntoRunner(runId, runName);
      setIsDetailOpen(false);
    }
  }, [onLoadIntoRunner]);

  const handleCloseDetail = useCallback(() => {
    setIsDetailOpen(false);
    if (!onAssetSelect) {
      setInternalSelectedAssetId(null);
    }
  }, [onAssetSelect]);

  // Open detail overlay when external asset ID changes
  React.useEffect(() => {
    if (externalSelectedAssetId !== undefined && externalSelectedAssetId !== null) {
      setIsDetailOpen(true);
    }
  }, [externalSelectedAssetId]);

  return (
    <>
      {children}
      <AssetDetailOverlay
        open={isDetailOpen}
        onClose={handleCloseDetail}
        assetId={selectedAssetId}
        onLoadIntoRunner={handleLoadIntoRunner}
        highlightAssetIdOnOpen={selectedAssetId}
      />
    </>
  );
} 