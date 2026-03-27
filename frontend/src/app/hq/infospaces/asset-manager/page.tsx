'use client';

import React, { useCallback } from 'react';
import AssetManager from '@/components/collection/assets/AssetManager';

export default function AssetManagerPage() {
  const handleLoadIntoRunner = useCallback((runId: number, runName: string) => {
    console.info(`Loading into runner: ${runName} (ID: ${runId})`);
  }, []);

  return (
    <div className="flex h-full w-full max-w-full max-h-[92.75svh] flex-col overflow-hidden min-h-[91svh] md:min-h-[92.75svh]">
      <AssetManager onLoadIntoRunner={handleLoadIntoRunner} />
    </div>
  );
}