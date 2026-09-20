'use client';

import React, { useCallback } from 'react';
import AssetManager from '@/components/collection/assets/AssetManager';
import { Surface } from '@/components/layout/Surface';

export default function AssetManagerPage() {
  const handleLoadIntoRunner = useCallback((runId: number, runName: string) => {
    console.info(`Loading into runner: ${runName} (ID: ${runId})`);
  }, []);

  return (
    <Surface>
      <AssetManager onLoadIntoRunner={handleLoadIntoRunner} />
    </Surface>
  );
}