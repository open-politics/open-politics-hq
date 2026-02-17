'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { D3ForceGraph, GraphViewConfig, defaultGraphViewConfig } from './D3ForceGraph';
import { GraphSettingsPopover } from './GraphSettingsPopover';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AnnotationsService, CanonicalEntitiesService } from '@/client';
import { curatedDataToGraphData } from './graphAdapters';

interface CuratedGraphViewProps {
  infospaceId: number;
  initialGraphConfig?: Partial<GraphViewConfig>;
  onGraphConfigChange?: (config: GraphViewConfig) => void;
}

export function CuratedGraphView({ 
  infospaceId,
  initialGraphConfig,
  onGraphConfigChange,
}: CuratedGraphViewProps) {
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [selectedEdge, setSelectedEdge] = useState<any>(null);
  const [graphConfig, setGraphConfig] = useState<GraphViewConfig>(
    initialGraphConfig ? { ...defaultGraphViewConfig, ...initialGraphConfig } : defaultGraphViewConfig
  );

  const handleGraphConfigChange = useCallback((newConfig: GraphViewConfig) => {
    setGraphConfig(newConfig);
    onGraphConfigChange?.(newConfig);
  }, [onGraphConfigChange]);

  const { data: curatedTriplets, isLoading, refetch } = useQuery({
    queryKey: ['curated-triplets', infospaceId],
    queryFn: async () => {
      return await AnnotationsService.getCuratedTriplets({
        infospaceId,
      });
    },
  });

  const { data: entities } = useQuery({
    queryKey: ['canonical-entities', infospaceId],
    queryFn: async () => {
      return await CanonicalEntitiesService.listEntities({
        infospaceId,
      });
    },
  });

  // Transform data for D3 graph using adapter
  const { nodes, edges } = useMemo(() => {
    if (!entities || !curatedTriplets || entities.length === 0 || curatedTriplets.length === 0) {
      return { nodes: [], edges: [] };
    }
    // Type assertion: entities from API match the expected structure
    return curatedDataToGraphData(entities as any, curatedTriplets as any);
  }, [entities, curatedTriplets]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!curatedTriplets || curatedTriplets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Curated Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No curated triplets found. Curate some triplets from annotation results to see the graph.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Curated Knowledge Graph</CardTitle>
          <div className="flex items-center gap-2">
            <GraphSettingsPopover
              config={graphConfig}
              onConfigChange={handleGraphConfigChange}
              defaultConfig={defaultGraphViewConfig}
            />
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="h-[800px]">
          <D3ForceGraph
            nodes={nodes}
            edges={edges}
            autoResize={true}
            config={graphConfig}
            onNodeClick={(node) => {
              setSelectedNode(node);
              setSelectedEdge(null);
            }}
            onEdgeClick={(edge) => {
              setSelectedEdge(edge);
              setSelectedNode(null);
            }}
          />
        </CardContent>
      </Card>

      {selectedNode && (
        <Card>
          <CardHeader>
            <CardTitle>Entity Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p><strong>Name:</strong> {selectedNode.canonical_name}</p>
              <p><strong>Type:</strong> {selectedNode.entity_type}</p>
              {selectedNode.aliases && selectedNode.aliases.length > 0 && (
                <p><strong>Aliases:</strong> {selectedNode.aliases.join(', ')}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedEdge && (
        <Card>
          <CardHeader>
            <CardTitle>Relationship Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p>
                <strong>{selectedEdge.subject.canonical_name}</strong> →{' '}
                <strong>{selectedEdge.predicate}</strong> →{' '}
                <strong>{selectedEdge.object.canonical_name}</strong>
              </p>
              {selectedEdge.properties && Object.keys(selectedEdge.properties).length > 0 && (
                <div>
                  <strong>Properties:</strong>
                  <pre className="mt-2 text-sm bg-muted p-2 rounded">
                    {JSON.stringify(selectedEdge.properties, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
