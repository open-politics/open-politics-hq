'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import KnowledgeGraphManager from '@/components/collection/graph/KnowledgeGraphManager';
import EntityManager from '@/components/collection/graph/EntityManager';
import { CuratedGraphView } from '@/components/collection/graph';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function KnowledgeGraphsPage() {
  const { activeInfospace } = useInfospaceStore();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'graph';
  const graphIdParam = searchParams.get('graph_id');

  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
      <Tabs defaultValue={initialTab} className="flex flex-col flex-1">
        <div className="border-b px-4 pt-2">
          <TabsList>
            <TabsTrigger value="graph">Graph View</TabsTrigger>
            <TabsTrigger value="manage">Manage</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="graph" className="flex-1 px-4 py-4">
          {activeInfospace?.id ? (
            <CuratedGraphView
              infospaceId={activeInfospace.id}
              graphId={graphIdParam ? parseInt(graphIdParam) : undefined}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Select an infospace to view the knowledge graph.</p>
          )}
        </TabsContent>

        <TabsContent value="manage" className="flex-1 overflow-y-auto">
          <KnowledgeGraphManager />
          <div id="entities-section" className="px-4 pb-4">
            <EntityManager />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
