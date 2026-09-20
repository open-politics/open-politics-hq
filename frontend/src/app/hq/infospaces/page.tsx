'use client';

import { Separator } from '@/components/ui/separator';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

// Importing the existing components with designs
import InfospaceInfo from '@/components/collection/management/InfospaceInfo';
import InfospaceManager from '@/components/collection/management/InfospaceManager';
import AssetManager from '@/components/collection/assets/AssetManager';
import AnnotationRunnerPage from './annotation-runner/page';
import { Surface } from '@/components/layout/Surface';

export default function InfospaceDashboardPage() {
  const { activeInfospace } = useInfospaceStore();

  return (
    <Surface scroll className="items-center pt-4">
      <div className="flex w-full max-w-8xl flex-col items-center p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          {/* Infospace Manager */}
          <div className="col-span-1 md:col-span-2">
            <InfospaceInfo />
          </div>

          <Separator className="w-full" />

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
    </Surface>
  );
}