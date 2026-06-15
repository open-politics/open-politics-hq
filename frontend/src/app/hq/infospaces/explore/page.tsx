'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AssetExplorer from '@/components/collection/explore/AssetExplorer';

function ExploreInner() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  return <AssetExplorer initialQuery={initialQuery} />;
}

export default function ExplorePage() {
  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-hidden">
      <Suspense fallback={null}>
        <ExploreInner />
      </Suspense>
    </div>
  );
}
