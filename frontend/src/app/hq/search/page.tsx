'use client';

import React from 'react';
import { DiscoverPanel } from '@/components/collection/intake/discover/DiscoverPanel';
import { Surface } from '@/components/layout/Surface';

export const maxDuration = 60;

// Standalone search route now renders the shared Discover surface (web search +
// RSS feed → ingest / promote), so it stays in lockstep with the asset-manager
// toolbar and chat instead of duplicating an older search component.
export default function SearchPage() {
  return (
    <Surface scroll className="container mx-auto py-6">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border">
        <DiscoverPanel mode="overlay" fullscreen={false} close={() => {}} escalate={() => {}} />
      </div>
    </Surface>
  );
}
