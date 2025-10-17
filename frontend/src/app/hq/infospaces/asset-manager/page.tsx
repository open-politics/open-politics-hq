'use client';

import React, { useCallback } from 'react';
import AssetManager from '@/components/collection/assets/AssetManager';

export default function AssetManagerPage() {
  const handleLoadIntoRunner = useCallback((runId: number, runName: string) => {
    console.info(`Loading into runner: ${runName} (ID: ${runId})`);
  }, []);

  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto">
      <AssetManager onLoadIntoRunner={handleLoadIntoRunner} />
    </div>
  );
}