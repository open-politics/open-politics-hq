'use client';

import React, { useCallback, useMemo, useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
  Panel,
  ConnectionMode,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { SourceNode, BundleNode, FlowNode } from './nodes';
import { AnimatedEdge } from './edges';
import FlowPalette from './FlowPalette';
import NodePropertiesPanel from './NodePropertiesPanel';

import { useFlowStore } from '@/zustand_stores/storeFlows';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { toast } from 'sonner';

import UnifiedSourceConfiguration from '@/components/collection/sources/configuration/UnifiedSourceConfiguration';

// Node types registration
const nodeTypes = {
  source: SourceNode,
  bundle: BundleNode,
  flow: FlowNode,
};

// Edge types registration
const edgeTypes = {
  animated: AnimatedEdge,
};

// Auto-layout constants
const COLUMN_GAP = 300;
const ROW_GAP = 140;
const START_X = 50;
const START_Y = 50;

function FlowCanvasInner() {
  const { activeInfospace } = useInfospaceStore();
  const { flows, fetchFlows, activateFlow, pauseFlow, triggerExecution, deleteFlow } = useFlowStore();
  const { sources, fetchSources } = useSourceStore();
  const { bundles, fetchBundles } = useBundleStore();
  
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isSourceDialogOpen, setIsSourceDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch data on mount
  useEffect(() => {
    const loadData = async () => {
      if (!activeInfospace?.id) return;
      setIsLoading(true);
      try {
        await Promise.all([
          fetchFlows(),
          fetchSources(),
          fetchBundles(activeInfospace.id),
        ]);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [activeInfospace?.id, fetchFlows, fetchSources, fetchBundles]);

  // Build nodes from data with auto-layout
  const initialNodes = useMemo(() => {
    // Track which bundles are inputs/outputs for flows
    const flowInputBundles = new Set(flows.map(f => f.input_bundle_id).filter(Boolean));
    const flowOutputBundles = new Set<number>();
    flows.forEach(f => {
      (f.steps as any[])?.forEach(step => {
        if (step.type === 'ROUTE' && step.bundle_id) {
          flowOutputBundles.add(step.bundle_id);
        }
      });
    });

    // Track which bundles have active sources
    const bundlesWithActiveSources = new Set(
      sources
        .filter(s => s.is_active && s.status?.toLowerCase() === 'active')
        .map(s => s.output_bundle_id)
        .filter(Boolean)
    );

    // Create source nodes (Column 1)
    const sourceNodes: Node[] = sources.map((s, i) => ({
      id: `source-${s.id}`,
      type: 'source',
      position: { x: START_X, y: START_Y + i * ROW_GAP },
      data: {
        ...s,
        poll_interval_seconds: (s as any).poll_interval_seconds || 300,
      },
    }));

    // Create bundle nodes (Column 2 for inputs, Column 4 for outputs)
    const inputBundleNodes: Node[] = [];
    const outputBundleNodes: Node[] = [];
    const otherBundleNodes: Node[] = [];

    bundles.forEach((b, i) => {
      const isInput = flowInputBundles.has(b.id);
      const isOutput = flowOutputBundles.has(b.id);
      const hasActiveSource = bundlesWithActiveSources.has(b.id);

      const bundleData = {
        ...b,
        is_landing_zone: isInput,
        is_output_zone: isOutput,
        has_active_source: hasActiveSource,
        has_active_flow: flows.some(f => f.input_bundle_id === b.id && f.status === 'active'),
      };

      if (isInput && !isOutput) {
        inputBundleNodes.push({
          id: `bundle-${b.id}`,
          type: 'bundle',
          position: { x: START_X + COLUMN_GAP, y: START_Y + inputBundleNodes.length * ROW_GAP },
          data: bundleData,
        });
      } else if (isOutput) {
        outputBundleNodes.push({
          id: `bundle-${b.id}`,
          type: 'bundle',
          position: { x: START_X + COLUMN_GAP * 3, y: START_Y + outputBundleNodes.length * ROW_GAP },
          data: bundleData,
        });
      } else {
        otherBundleNodes.push({
          id: `bundle-${b.id}`,
          type: 'bundle',
          position: { x: START_X + COLUMN_GAP, y: START_Y + (inputBundleNodes.length + otherBundleNodes.length) * ROW_GAP },
          data: bundleData,
        });
      }
    });

    // Create flow nodes (Column 3)
    const flowNodes: Node[] = flows.map((f, i) => ({
      id: `flow-${f.id}`,
      type: 'flow',
      position: { x: START_X + COLUMN_GAP * 2, y: START_Y + i * (ROW_GAP + 40) },
      data: {
        ...f,
        onActivate: activateFlow,
        onPause: pauseFlow,
        onTrigger: triggerExecution,
      },
    }));

    return [
      ...sourceNodes,
      ...inputBundleNodes,
      ...otherBundleNodes,
      ...flowNodes,
      ...outputBundleNodes,
    ];
  }, [sources, bundles, flows, activateFlow, pauseFlow, triggerExecution]);

  // Build edges from relationships
  const initialEdges = useMemo(() => {
    const edges: Edge[] = [];

    // Source → Bundle edges
    sources.forEach(s => {
      if (s.output_bundle_id) {
        const isActive = s.is_active && s.status?.toLowerCase() === 'active';
        const itemsPerHour = s.items_last_poll 
          ? Math.round((s.items_last_poll / ((s as any).poll_interval_seconds || 300)) * 3600)
          : 0;
          
        edges.push({
          id: `e-source-${s.id}-bundle-${s.output_bundle_id}`,
          source: `source-${s.id}`,
          target: `bundle-${s.output_bundle_id}`,
          type: 'animated',
          data: {
            isActive,
            itemsPerHour,
          },
        });
      }
    });

    // Bundle → Flow edges (input)
    flows.forEach(f => {
      if (f.input_bundle_id) {
        const isActive = f.status === 'active';
        edges.push({
          id: `e-bundle-${f.input_bundle_id}-flow-${f.id}`,
          source: `bundle-${f.input_bundle_id}`,
          target: `flow-${f.id}`,
          type: 'animated',
          data: {
            isActive,
            label: isActive ? 'watching' : undefined,
          },
        });
      }
    });

    // Flow → Bundle edges (ROUTE step output)
    flows.forEach(f => {
      const steps = (f.steps as any[]) || [];
      const routeStep = steps.find(s => s.type === 'ROUTE' && s.bundle_id);
      if (routeStep) {
        const isActive = f.status === 'active';
        edges.push({
          id: `e-flow-${f.id}-bundle-${routeStep.bundle_id}`,
          source: `flow-${f.id}`,
          target: `bundle-${routeStep.bundle_id}`,
          type: 'animated',
          data: {
            isActive,
            label: isActive ? 'routing' : undefined,
          },
        });
      }
    });

    return edges;
  }, [sources, flows]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes/edges when data changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Fit view on initial load
  useEffect(() => {
    if (!isLoading && nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.2, duration: 500 }), 100);
    }
  }, [isLoading, nodes.length, fitView]);

  // Handle node selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Refresh data
  const handleRefresh = async () => {
    if (!activeInfospace?.id) return;
    setIsLoading(true);
    try {
      await Promise.all([
        fetchFlows(),
        fetchSources(),
        fetchBundles(activeInfospace.id),
      ]);
      toast.success('Data refreshed');
    } finally {
      setIsLoading(false);
    }
  };

  // Source creation success
  const handleSourceCreated = () => {
    setIsSourceDialogOpen(false);
    fetchSources();
  };

  if (!activeInfospace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select an infospace first.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      {/* Left Panel - Palette */}
      <FlowPalette
        onCreateSource={() => setIsSourceDialogOpen(true)}
        onCreateBundle={() => toast.info('Bundle creation coming soon')}
        onCreateFlow={() => toast.info('Use the Flow Creator dialog for now')}
      />

      {/* Main Canvas */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 z-50 bg-background/80 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          fitView
          minZoom={0.3}
          maxZoom={2}
          defaultEdgeOptions={{
            type: 'animated',
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          
          <Controls 
            showInteractive={false}
            className="!bg-background !border !shadow-sm"
          />
          
          <MiniMap 
            nodeStrokeColor={(node) => {
              if (node.type === 'source') return '#3b82f6';
              if (node.type === 'bundle') return '#f59e0b';
              if (node.type === 'flow') return '#8b5cf6';
              return '#9ca3af';
            }}
            nodeColor={(node) => {
              if (node.type === 'source') return '#dbeafe';
              if (node.type === 'bundle') return '#fef3c7';
              if (node.type === 'flow') return '#ede9fe';
              return '#f3f4f6';
            }}
            className="!bg-background !border !shadow-sm"
          />

          {/* Top Right Actions */}
          <Panel position="top-right" className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => fitView({ padding: 0.2, duration: 500 })}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </Panel>

          {/* Stats Panel */}
          <Panel position="bottom-left" className="bg-background/90 border rounded-lg p-2 text-xs">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                {sources.length} Sources
              </span>
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                {bundles.length} Bundles
              </span>
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                {flows.length} Flows
              </span>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Right Panel - Properties */}
      {selectedNode && (
        <NodePropertiesPanel
          selectedNode={selectedNode}
          onClose={() => setSelectedNode(null)}
          onActivateFlow={activateFlow}
          onPauseFlow={pauseFlow}
          onTriggerFlow={triggerExecution}
          onDeleteFlow={async (id) => {
            await deleteFlow(id);
            setSelectedNode(null);
          }}
          onViewBundle={(id) => {
            // Navigate to asset manager with bundle filter
            toast.info(`View bundle ${id} - navigation coming soon`);
          }}
        />
      )}

      {/* Source Creation Dialog */}
      <Dialog open={isSourceDialogOpen} onOpenChange={setIsSourceDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Source</DialogTitle>
          </DialogHeader>
          <UnifiedSourceConfiguration onSuccess={handleSourceCreated} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}
