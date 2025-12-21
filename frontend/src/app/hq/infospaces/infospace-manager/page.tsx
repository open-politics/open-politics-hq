'use client';

import InfospaceManager from '@/components/collection/management/InfospaceManager';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export default function InfospaceDashboardPage() {
  const { activeInfospace } = useInfospaceStore();
  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
        <InfospaceManager activeInfospace={activeInfospace} />
    </div>
  );
};