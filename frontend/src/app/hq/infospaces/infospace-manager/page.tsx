'use client';

import InfospaceManager from '@/components/collection/management/InfospaceManager';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export default function InfospaceDashboardPage() {
  const { activeInfospace } = useInfospaceStore();
  return (
    <div className="relative flex flex-col items-center mx-auto top-4 min-h-screen overflow-visible bg-primary-950">
      <div className="flex flex-col items-center w-full max-w-8xl p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
        <InfospaceManager activeInfospace={activeInfospace} />
      </div>
    </div>
  );
};