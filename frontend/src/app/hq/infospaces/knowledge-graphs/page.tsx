'use client';

import KnowledgeGraphManager from '@/components/collection/graph/KnowledgeGraphManager';
import EntityManager from '@/components/collection/graph/EntityManager';

export default function KnowledgeGraphsPage() {
  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
      <KnowledgeGraphManager />
      <div id="entities-section" className="px-4 pb-4">
        <EntityManager />
      </div>
    </div>
  );
}
