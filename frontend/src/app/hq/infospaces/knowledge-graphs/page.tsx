'use client';

import KnowledgeGraphManager from '@/components/collection/graph/KnowledgeGraphManager';

export default function KnowledgeGraphsPage() {
  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
      <KnowledgeGraphManager />
    </div>
  );
}
