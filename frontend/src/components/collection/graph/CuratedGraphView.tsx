'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { D3ForceGraph, GraphViewConfig, defaultGraphViewConfig, type GraphNode, type GraphEdge } from './D3ForceGraph';
import { GraphSettingsPopover } from './GraphSettingsPopover';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw, X, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { AnnotationsService, CanonicalEntitiesService } from '@/client';
import { curatedDataToGraphData } from './graphAdapters';
import { GraphFilterPanel } from './GraphFilterPanel';
import { resolveEntityColor } from '@/lib/annotations/colors';

interface CuratedGraphViewProps {
  infospaceId: number;
  graphId?: number;
  initialGraphConfig?: Partial<GraphViewConfig>;
  onGraphConfigChange?: (config: GraphViewConfig) => void;
  colorOverrides?: import('@/lib/annotations/colors').ColorOverrides;
  typeIcons?: Record<string, string>;
  predicateArrows?: Record<string, 'forward' | 'backward' | 'both' | 'none'>;
}

export function CuratedGraphView({
  infospaceId,
  graphId,
  initialGraphConfig,
  onGraphConfigChange,
  colorOverrides,
  typeIcons,
  predicateArrows,
}: CuratedGraphViewProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<any>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [hiddenEntityTypes, setHiddenEntityTypes] = useState<Set<string>>(new Set());
  const [hiddenPredicates, setHiddenPredicates] = useState<Set<string>>(new Set());
  const [graphConfig, setGraphConfig] = useState<GraphViewConfig>(
    initialGraphConfig ? { ...defaultGraphViewConfig, ...initialGraphConfig } : defaultGraphViewConfig
  );

  const handleGraphConfigChange = useCallback((newConfig: GraphViewConfig) => {
    setGraphConfig(newConfig);
    onGraphConfigChange?.(newConfig);
  }, [onGraphConfigChange]);

  const { data: curatedTriplets, isLoading, refetch } = useQuery({
    queryKey: ['curated-triplets', infospaceId, graphId],
    queryFn: async () => {
      return await AnnotationsService.getCuratedTriplets({
        infospaceId,
        ...(graphId != null ? { graphId } : {}),
      } as any);
    },
  });

  const { data: entities } = useQuery({
    queryKey: ['canonical-entities', infospaceId, graphId],
    queryFn: async () => {
      return await CanonicalEntitiesService.listEntities({
        infospaceId,
        ...(graphId != null ? { graphId } : {}),
      } as any);
    },
  });

  // Transform data for D3 graph using adapter
  const { nodes, edges } = useMemo(() => {
    if (!entities || !curatedTriplets || entities.length === 0 || curatedTriplets.length === 0) {
      return { nodes: [], edges: [] };
    }
    return curatedDataToGraphData(entities as any, curatedTriplets as any);
  }, [entities, curatedTriplets]);

  // Derive selected node details (connections)
  const selectedNodeDetails = useMemo(() => {
    if (!selectedNode) return null;
    const outgoing = edges.filter(e => e.sourceId === selectedNode.id);
    const incoming = edges.filter(e => e.targetId === selectedNode.id);
    return { ...selectedNode, outgoingEdges: outgoing, incomingEdges: incoming, totalConnections: outgoing.length + incoming.length };
  }, [selectedNode, edges]);

  // Derive entity type and predicate lists for filter panel
  const entityTypeList = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach(n => {
      const t = n.type.toUpperCase();
      map.set(t, (map.get(t) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, color: resolveEntityColor(type), count }));
  }, [nodes]);

  const predicateTypeList = useMemo(() => {
    const map = new Map<string, number>();
    edges.forEach(e => map.set(e.predicate, (map.get(e.predicate) ?? 0) + 1));
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([predicate, count]) => ({ predicate, count }));
  }, [edges]);

  const handleToggleEntityType = useCallback((type: string) => {
    setHiddenEntityTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    setShowDetailPanel(true);
  }, []);

  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
    setShowDetailPanel(true);
  }, []);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!curatedTriplets || curatedTriplets.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">No curated triplets found. Curate some triplets from annotation results to see the graph.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/20">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="h-7 text-xs"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDetailPanel(!showDetailPanel)}
          disabled={!selectedNode && !selectedEdge}
          className="h-7 text-xs"
        >
          {showDetailPanel ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
          Details
        </Button>

        <GraphSettingsPopover
          config={graphConfig}
          onConfigChange={handleGraphConfigChange}
          defaultConfig={defaultGraphViewConfig}
        />

        <GraphFilterPanel
          entityTypes={entityTypeList}
          hiddenEntityTypes={hiddenEntityTypes}
          onHiddenEntityTypesChange={setHiddenEntityTypes}
          predicateTypes={predicateTypeList}
          hiddenPredicates={hiddenPredicates}
          onHiddenPredicatesChange={setHiddenPredicates}
        />

        <div className="text-xs text-muted-foreground ml-auto">
          {nodes.length} nodes, {edges.length} edges
        </div>
      </div>

      {/* Main content: graph + optional detail panel */}
      <div className="flex-1 flex min-h-0">
        {/* Graph */}
        <div className={`relative transition-all duration-300 ${showDetailPanel && (selectedNode || selectedEdge) ? 'flex-[2]' : 'flex-1'}`}>
          <D3ForceGraph
            nodes={nodes}
            edges={edges}
            autoResize={true}
            config={graphConfig}
            colorOverrides={colorOverrides}
            typeIcons={typeIcons}
            predicateArrows={predicateArrows}
            highlightedNodeId={selectedNode?.id ?? null}
            connectedNodeIds={selectedNodeDetails ? [...selectedNodeDetails.outgoingEdges.map(e => e.targetId), ...selectedNodeDetails.incomingEdges.map(e => e.sourceId)] : []}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            hiddenEntityTypes={hiddenEntityTypes}
            hiddenPredicates={hiddenPredicates}
            onToggleEntityType={handleToggleEntityType}
          />
        </div>

        {/* Detail Side Panel */}
        {showDetailPanel && (selectedNode || selectedEdge) && (
          <div className="w-80 border-l bg-background p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{selectedNode ? 'Entity Details' : 'Relationship Details'}</h3>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setShowDetailPanel(false); setSelectedNode(null); setSelectedEdge(null); }}>
                <X className="h-3 w-3" />
              </Button>
            </div>

            {selectedNode && selectedNodeDetails && (
              <div className="space-y-3">
                <div className="border-b border-border pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: resolveEntityColor(selectedNode.type) }} />
                    <h4 className="font-semibold text-sm truncate" title={selectedNode.label}>{selectedNode.label}</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <div><span className="font-medium">Type:</span> {selectedNode.type}</div>
                    <div><span className="font-medium">Frequency:</span> {selectedNode.frequency || 1}</div>
                    <div><span className="font-medium">Sources:</span> {selectedNode.sourceAssetCount || 0}</div>
                    <div><span className="font-medium">Connections:</span> {selectedNodeDetails.totalConnections}</div>
                  </div>
                  {selectedNode.aliases && selectedNode.aliases.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium">Aliases:</span> {selectedNode.aliases.join(', ')}
                    </div>
                  )}
                </div>

                {/* Connections */}
                <div>
                  <h5 className="font-medium mb-2 text-xs">Connections ({selectedNodeDetails.totalConnections})</h5>
                  <div className="space-y-1 max-h-80 overflow-y-auto">
                    {selectedNodeDetails.outgoingEdges.map((edge) => {
                      const targetNode = nodes.find(n => n.id === edge.targetId);
                      return (
                        <div
                          key={`out-${edge.id}`}
                          className="p-2 bg-blue-50 dark:bg-blue-950/40 rounded text-xs cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors border-l-2 border-blue-400"
                          onClick={() => targetNode && handleNodeClick(targetNode)}
                        >
                          <div className="flex items-center gap-1">
                            <span className="text-blue-600 dark:text-blue-400 font-medium">{'->'}</span>
                            <span className="font-medium text-foreground truncate">{targetNode?.label}</span>
                          </div>
                          <div className="text-muted-foreground italic truncate">"{edge.predicate}"</div>
                        </div>
                      );
                    })}
                    {selectedNodeDetails.incomingEdges.map((edge) => {
                      const sourceNode = nodes.find(n => n.id === edge.sourceId);
                      return (
                        <div
                          key={`in-${edge.id}`}
                          className="p-2 bg-green-50 dark:bg-green-950/40 rounded text-xs cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors border-l-2 border-green-400"
                          onClick={() => sourceNode && handleNodeClick(sourceNode)}
                        >
                          <div className="flex items-center gap-1">
                            <span className="text-green-600 dark:text-green-400 font-medium">&lt;-</span>
                            <span className="font-medium text-foreground truncate">{sourceNode?.label}</span>
                          </div>
                          <div className="text-muted-foreground italic truncate">"{edge.predicate}"</div>
                        </div>
                      );
                    })}
                    {selectedNodeDetails.totalConnections === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-4">No connections found</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {selectedEdge && (
              <div className="space-y-3">
                <div className="text-sm">
                  <p className="font-medium text-foreground">{selectedEdge.subject?.canonical_name || nodes.find(n => n.id === selectedEdge.sourceId)?.label}</p>
                  <p className="text-muted-foreground italic my-1">{selectedEdge.predicate}</p>
                  <p className="font-medium text-foreground">{selectedEdge.object?.canonical_name || nodes.find(n => n.id === selectedEdge.targetId)?.label}</p>
                </div>
                {/* Edge metadata */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {selectedEdge.weight != null && <div><span className="font-medium">Weight:</span> {selectedEdge.weight}</div>}
                  {selectedEdge.confidence != null && <div><span className="font-medium">Confidence:</span> {selectedEdge.confidence}</div>}
                  {selectedEdge.frequency != null && <div><span className="font-medium">Frequency:</span> {selectedEdge.frequency}</div>}
                  {selectedEdge.date && <div><span className="font-medium">Date:</span> {selectedEdge.date}</div>}
                </div>
                {selectedEdge.context && (
                  <div className="text-xs">
                    <div className="font-medium text-muted-foreground mb-0.5">Context</div>
                    <p className="text-foreground bg-muted/50 p-2 rounded text-[11px] leading-relaxed">{selectedEdge.context}</p>
                  </div>
                )}
                {selectedEdge.properties && Object.keys(selectedEdge.properties).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Properties</div>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                      {JSON.stringify(selectedEdge.properties, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
