'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ForceGraph, type ForceGraphHandle } from './ForceGraph';
import { GraphViewConfig, defaultGraphViewConfig, type GraphNode, type GraphEdge } from './graphTypes';
import { GraphSettingsPopover } from './GraphSettingsPopover';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw, X, Eye, EyeOff, Box, Square, Maximize2, Minimize2, Pin } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useFullscreen } from './forcegraph/useFullscreen';
import { NodeDetailHUD } from './forcegraph/NodeDetailHUD';
import { toast } from 'sonner';
import { AnnotationsService, EntitiesService, KnowledgeGraphsService } from '@/client';
import { curatedDataToGraphData } from './graphAdapters';
import { GraphFilterPanel } from './GraphFilterPanel';
import { RelationshipsPanel } from './RelationshipsPanel';
import { RelationshipDialog } from './RelationshipDialog';
import { resolveEntityColor } from '@/lib/annotations/colors';

/** Parse the "entity_<id>" node id used by curatedDataToGraphData. */
const parseEntityNodeId = (s?: string | null): number | null => {
  if (!s || typeof s !== 'string' || !s.startsWith('entity_')) return null;
  const n = parseInt(s.slice(7), 10);
  return Number.isFinite(n) ? n : null;
};

interface GraphViewProps {
  infospaceId: number;
  graphId?: number;
  initialGraphConfig?: Partial<GraphViewConfig>;
  onGraphConfigChange?: (config: GraphViewConfig) => void;
  colorOverrides?: import('@/lib/annotations/colors').ColorOverrides;
  typeIcons?: Record<string, string>;
  predicateArrows?: Record<string, 'forward' | 'backward' | 'both' | 'none'>;
}

export function GraphView({
  infospaceId,
  graphId,
  initialGraphConfig,
  onGraphConfigChange,
  colorOverrides,
  typeIcons,
  predicateArrows,
}: GraphViewProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<any>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showRelationshipsPanel, setShowRelationshipsPanel] = useState(false);
  const [editingRelationshipPair, setEditingRelationshipPair] = useState<{
    a: { id: number; label: string };
    b: { id: number; label: string };
  } | null>(null);
  const [hiddenEntityTypes, setHiddenEntityTypes] = useState<Set<string>>(new Set());
  const [hiddenPredicates, setHiddenPredicates] = useState<Set<string>>(new Set());
  const [graphConfig, setGraphConfig] = useState<GraphViewConfig>(
    initialGraphConfig ? { ...defaultGraphViewConfig, ...initialGraphConfig } : defaultGraphViewConfig
  );
  const forceGraphRef = useRef<ForceGraphHandle>(null);
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(fullscreenRootRef);

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

  // Resolve the graph's canon so we can scope the entity list to it. Without
  // this the listEntities call would return all infospace entities — fine for
  // smaller infospaces but wasteful and noisy on bigger ones.
  const { data: graphRecord } = useQuery({
    queryKey: ['knowledge-graph', infospaceId, graphId],
    queryFn: async () => graphId == null
      ? null
      : await KnowledgeGraphsService.getKnowledgeGraph({ infospaceId, graphId }),
    enabled: graphId != null,
  });
  const canonId = (graphRecord as any)?.canon_id as number | undefined;

  const { data: entities } = useQuery({
    queryKey: ['entities', infospaceId, canonId],
    queryFn: async () => {
      return await EntitiesService.listEntities({
        infospaceId,
        ...(canonId != null ? { canonId } : {}),
      });
    },
  });

  // Transform data for D3 graph using adapter
  const { nodes, edges } = useMemo(() => {
    if (!entities || !curatedTriplets || entities.length === 0 || curatedTriplets.length === 0) {
      return { nodes: [], edges: [] };
    }
    return curatedDataToGraphData(entities as any, curatedTriplets as any);
  }, [entities, curatedTriplets]);

  // Shallow-clone edges before passing to the renderer — the lib augments
  // ``link.source`` / ``link.target`` in place with node references after
  // first paint, and we don't want that leaking into the detail-panel reads.
  const renderEdges = useMemo(() => edges.map(e => ({ ...e })), [edges]);

  // Lookup map from numeric entity id → GraphNode, for the relationships panel.
  // The adapter encodes ids as ``entity_<id>``; we strip the prefix here.
  const nodesByEntityId = useMemo(() => {
    const m = new Map<number, GraphNode>();
    for (const n of nodes) {
      const id = parseEntityNodeId(n.id);
      if (id != null) m.set(id, n);
    }
    return m;
  }, [nodes]);

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

  // When the panel is currently closed, opening it shrinks the graph pane.
  // Defer the highlight (and its zoom-to-node effect) so it fires against
  // the already-resized pane, otherwise the centering math runs while the
  // SVG is still at its old (full) width and the node lands off-centre.
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedEdge(null);
    if (showDetailPanel) {
      setSelectedNode(node);
      return;
    }
    setShowDetailPanel(true);
    setTimeout(() => {
      setSelectedNode(node);
    }, 300);
  }, [showDetailPanel]);

  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
    setShowDetailPanel(true);
  }, []);

  const closeDetailPanel = useCallback(() => {
    setShowDetailPanel(false);
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  // Esc closes the detail panel (parity with the X button).
  useEffect(() => {
    if (!showDetailPanel && !selectedNode && !selectedEdge) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      closeDetailPanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDetailPanel, selectedNode, selectedEdge, closeDetailPanel]);

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
    <div ref={fullscreenRootRef} className={`h-full flex flex-col ${isFullscreen ? 'bg-background' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/20">
        {/* View Mode Toggle (2D / 3D). 3D dynamic-imported on first flip. */}
        <ToggleGroup
          type="single"
          value={graphConfig.viewMode ?? '2d'}
          onValueChange={(value) => {
            if (value !== '2d' && value !== '3d') return;
            handleGraphConfigChange({ ...graphConfig, viewMode: value });
          }}
          size="sm"
          className="h-7"
          aria-label="Graph view mode"
        >
          <ToggleGroupItem value="2d" className="h-7 px-2 text-xs">
            <Square className="h-3 w-3 mr-1" />
            2D
          </ToggleGroupItem>
          <ToggleGroupItem value="3d" className="h-7 px-2 text-xs">
            <Box className="h-3 w-3 mr-1" />
            3D
          </ToggleGroupItem>
        </ToggleGroup>

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
          onReheatSimulation={() => forceGraphRef.current?.reheatSimulation()}
        />

        <GraphFilterPanel
          entityTypes={entityTypeList}
          hiddenEntityTypes={hiddenEntityTypes}
          onHiddenEntityTypesChange={setHiddenEntityTypes}
          predicateTypes={predicateTypeList}
          hiddenPredicates={hiddenPredicates}
          onHiddenPredicatesChange={setHiddenPredicates}
        />

        {graphId != null && (
          <Button
            variant={showRelationshipsPanel ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowRelationshipsPanel(v => !v)}
            className="h-7 text-xs"
            title="Pin and tag entity pairs"
          >
            <Pin className="h-3 w-3 mr-1" />
            Relationships
          </Button>
        )}

        <div className="text-xs text-muted-foreground ml-auto">
          {nodes.length} nodes, {edges.length} edges
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </Button>
      </div>

      {/* Main content: graph with optional HUD overlay (no resizable side panel —
          the HUD floats over the canvas so it never shrinks the graph view). */}
      <div className="flex-1 min-h-0">
        <div className="relative h-full w-full">
          <ForceGraph
            ref={forceGraphRef}
            nodes={nodes}
            edges={renderEdges}
            autoResize={true}
            config={graphConfig}
            onConfigChange={handleGraphConfigChange}
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
            legendHidden={!!selectedNodeDetails && showDetailPanel}
          />

          {/* Node detail HUD (no documents / evidence on this surface) */}
          {showDetailPanel && selectedNodeDetails && (
            <NodeDetailHUD
              focalNode={selectedNodeDetails as any}
              nodes={nodes}
              edges={[
                ...(selectedNodeDetails as any).outgoingEdges,
                ...(selectedNodeDetails as any).incomingEdges,
              ]}
              onPeerClick={handleNodeClick}
              onClose={closeDetailPanel}
            />
          )}

          {/* Edge floating card (small overlay top-right) */}
          {showDetailPanel && selectedEdge && !selectedNode && (
            <div
              className="absolute top-2 right-12 z-30 w-[320px] max-w-[40%] bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3"
              style={{ pointerEvents: 'auto' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">Edge</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={closeDetailPanel}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="text-sm space-y-1">
                <p className="font-medium text-foreground">{selectedEdge.subject?.canonical_name || nodes.find(n => n.id === selectedEdge.sourceId)?.label}</p>
                <p className="text-muted-foreground italic">{selectedEdge.predicate}</p>
                <p className="font-medium text-foreground">{selectedEdge.object?.canonical_name || nodes.find(n => n.id === selectedEdge.targetId)?.label}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-2 pt-2 border-t">
                {selectedEdge.weight != null && <div><span className="font-medium">Weight:</span> {selectedEdge.weight}</div>}
                {selectedEdge.confidence != null && <div><span className="font-medium">Confidence:</span> {selectedEdge.confidence}</div>}
                {selectedEdge.frequency != null && <div><span className="font-medium">Frequency:</span> {selectedEdge.frequency}</div>}
                {selectedEdge.date && <div><span className="font-medium">Date:</span> {selectedEdge.date}</div>}
              </div>
              {selectedEdge.context && (
                <p className="text-[11px] text-foreground bg-muted/50 p-2 rounded mt-2 leading-relaxed">{selectedEdge.context}</p>
              )}

              {graphId != null && (() => {
                const a = parseEntityNodeId(selectedEdge.sourceId);
                const b = parseEntityNodeId(selectedEdge.targetId);
                if (a == null || b == null) return null;
                const aLabel = nodes.find(n => n.id === selectedEdge.sourceId)?.label || `#${a}`;
                const bLabel = nodes.find(n => n.id === selectedEdge.targetId)?.label || `#${b}`;
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 h-7 text-xs"
                    onClick={() => setEditingRelationshipPair({
                      a: { id: a, label: aLabel },
                      b: { id: b, label: bLabel },
                    })}
                  >
                    <Pin className="h-3 w-3 mr-1" />
                    Pin / tag this pair
                  </Button>
                );
              })()}
            </div>
          )}

          {/* Relationships panel — graph-scoped pin / tag / notes overlay */}
          {graphId != null && showRelationshipsPanel && (
            <RelationshipsPanel
              graphId={graphId}
              nodesById={nodesByEntityId}
              onSelectPair={(a, b) => {
                const node = nodesByEntityId.get(a);
                if (node) {
                  setSelectedEdge(null);
                  setSelectedNode(node);
                  setShowDetailPanel(true);
                }
              }}
              onClose={() => setShowRelationshipsPanel(false)}
            />
          )}
        </div>
      </div>

      {/* Stand-alone relationship dialog when triggered from the edge card */}
      {graphId != null && editingRelationshipPair && (
        <RelationshipDialog
          graphId={graphId}
          entityA={editingRelationshipPair.a}
          entityB={editingRelationshipPair.b}
          open={!!editingRelationshipPair}
          onClose={() => setEditingRelationshipPair(null)}
        />
      )}
    </div>
  );
}
