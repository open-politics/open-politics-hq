'use client';

import { Separator } from '@/components/ui/separator';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

// Importing the existing components with designs
import InfospaceInfo from '@/components/collection/infospaces/management/InfospaceInfo';
import InfospaceManager from '@/components/collection/infospaces/management/InfospaceManager';
import AssetManager from '@/components/collection/infospaces/assets/AssetManager';
import AnnotationRunnerPage from './annotation-runner/page';

export default function InfospaceDashboardPage() {
  const { activeInfospace } = useInfospaceStore();

  return (
    <div className="relative flex flex-col items-center mx-auto top-4 min-h-screen max-h-[calc(100vh-200px)] overflow-y-auto bg-primary-950">      
      <div className="flex flex-col items-center w-full max-w-8xl p-4 overflow-y-auto">
        {/* Infospace Info */}
        <InfospaceInfo />

        <Separator className="w-full my-4" />
        {/* Classification and Results Section */}
        <div className="w-full mb-8 space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* Classification Runner */}
            <div className="col-span-1">
              <AnnotationRunnerPage />
            </div>
          </div>
        </div>

        <Separator className="w-full" />

        {/* Grid Layout for Managers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          {/* Infospace Manager */}
          <div className="col-span-1 md:col-span-2">
            <InfospaceManager activeInfospace={activeInfospace} />
          </div>

          <Separator className="w-full" />

          {/* Asset Manager */}
          <div className="col-span-1 md:col-span-2">
            <AssetManager />
          </div>
        </div>
      </div>
    </div>
  );
}