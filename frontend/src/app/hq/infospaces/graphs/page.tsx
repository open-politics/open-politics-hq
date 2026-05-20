'use client';

import { useSearchParams } from 'next/navigation';
import KnowledgeGraphManager from '@/components/collection/graph/KnowledgeGraphManager';
import PredicateManager from '@/components/collection/graph/PredicateManager';
import { CanonsPanel, GraphView } from '@/components/collection/graph';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Graphs surface — the user's knowledge area.
 *
 * Mental model: Infospace > {Canons, Graphs}.
 * - **Graph View** — visualise a selected graph.
 * - **Canons** — vocabulary surface; each canon owns its entities.
 * - **Graphs** — list/manage graphs; each graph resolves against one canon.
 * - **Connections** — manage the verb vocabulary that labels graph edges.
 */
export default function GraphsPage() {
  const { activeInfospace } = useInfospaceStore();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'view';
  const graphIdParam = searchParams.get('graph_id');

  return (
    <div className="h-full flex flex-col min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
      <Tabs defaultValue={initialTab} className="flex flex-col flex-1">
        <div className="border-b px-4 pt-2">
          <TabsList>
            <TabsTrigger value="view">Graph View</TabsTrigger>
            <TabsTrigger value="canons">Canons</TabsTrigger>
            <TabsTrigger value="graphs">Graphs</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="view" className="flex-1 min-h-0 overflow-hidden px-2 py-2">
          {activeInfospace?.id ? (
            <GraphView
              infospaceId={activeInfospace.id}
              graphId={graphIdParam ? parseInt(graphIdParam, 10) : undefined}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Select an infospace to view a graph.</p>
          )}
        </TabsContent>

        <TabsContent value="canons" className="flex-1 min-h-0 overflow-hidden">
          <CanonsPanel />
        </TabsContent>

        <TabsContent value="graphs" className="flex-1 overflow-y-auto">
          <KnowledgeGraphManager />
        </TabsContent>

        <TabsContent value="connections" className="flex-1 overflow-y-auto">
          <PredicateManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
