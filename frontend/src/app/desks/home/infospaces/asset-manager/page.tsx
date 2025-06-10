'use client';

import React, { useCallback } from 'react';
import AssetManager from '@/components/collection/infospaces/assets/AssetManager';
import { AssetRead } from '@/client/models';
import { toast } from 'sonner';

export default function AssetManagerPage() {
  const handleLoadIntoRunner = useCallback((runId: number, runName: string) => {
    // For now, just show the info in a toast
    // In the future, this could navigate to the runner or open runner interface
    toast.info(`Loading into runner: ${runName} (ID: ${runId})`);
  }, []);

  return (
    <div className="h-full flex flex-col max-w-screen-3xl mx-auto">
      <AssetManager onLoadIntoRunner={handleLoadIntoRunner} />
    </div>
  );
}