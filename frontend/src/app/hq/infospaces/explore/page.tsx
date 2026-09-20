'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AssetExplorer from '@/components/collection/explore/AssetExplorer';
import { Surface } from '@/components/layout/Surface';

function ExploreInner() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  return <AssetExplorer initialQuery={initialQuery} />;
}

export default function ExplorePage() {
  return (
    <Surface>
      <Suspense fallback={null}>
        <ExploreInner />
      </Suspense>
    </Surface>
  );
}
