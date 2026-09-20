'use client';

import InfospaceManager from '@/components/collection/management/InfospaceManager';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Surface } from '@/components/layout/Surface';

export default function InfospaceDashboardPage() {
  const { activeInfospace } = useInfospaceStore();
  return (
    <Surface scroll>
      <InfospaceManager activeInfospace={activeInfospace} />
    </Surface>
  );
};