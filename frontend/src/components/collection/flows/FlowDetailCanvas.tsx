'use client';

import React, { useMemo, useEffect, useCallback, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
  Panel,
  BackgroundVariant,
  Position,
  Handle,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { FlowRead } from '@/client';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useFlowStore } from '@/zustand_stores/storeFlows';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Play,
  Pause,
  Zap,
  Trash2,
  RefreshCw,
  FolderOpen,
  RadioTower,
  Activity,
  Filter,
  Microscope,
  Tag,
  GitBranch,
  Radio,
  Clock,
  CheckCircle2,
  Settings,
  Maximize2,
  RotateCcw,
} from 'lucide-react';

// Step icons and colors
const stepConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  FILTER: { icon: Filter, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30 border-orange-300' },
  ANNOTATE: { icon: Microscope, color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300' },
  CURATE: { icon: Tag, color: 'text-teal-600', bg: 'bg-teal-100 dark:bg-teal-900/30 border-teal-300' },
  ROUTE: { icon: GitBranch, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300' },
  EMBED: { icon: Zap, color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300' },
  ANALYZE: { icon: Activity, color: 'text-pink-600', bg: 'bg-pink-100 dark:bg-pink-900/30 border-pink-300' },
};

// Custom Node: Source
function SourceNodeComponent({ data }: NodeProps) {
  return (
    <div className="min-w-[180px] rounded-lg border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/30 shadow-md">
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-blue-500" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <RadioTower className="h-5 w-5 text-blue-600" />
          <span className="font-semibold text-sm">Source</span>
        </div>
        <p className="font-medium">{data.name}</p>
        <Badge variant="outline" className="mt-2 text-xs">{data.kind}</Badge>
        {data.is_active && (
          <div className="flex items-center gap-1 mt-2 text-xs text-green-600">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Active
          </div>
        )}
      </div>
    </div>
  );
}

// Custom Node: Bundle
function BundleNodeComponent({ data }: NodeProps) {
  const isInput = data.role === 'input';
  const isOutput = data.role === 'output';
  
  return (
    <div className={cn(
      "min-w-[160px] rounded-lg border-2 shadow-md",
      isInput ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" :
      isOutput ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" :
      "border-gray-300 bg-gray-50 dark:bg-gray-900"
    )}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-amber-500" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-500" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <FolderOpen className={cn(
            "h-5 w-5",
            isInput ? "text-amber-600" : isOutput ? "text-emerald-600" : "text-gray-600"
          )} />
          <span className="font-semibold text-sm">
            {isInput ? 'Input Bundle' : isOutput ? 'Output Bundle' : 'Bundle'}
          </span>
        </div>
        <p className="font-medium">{data.name}</p>
        <p className="text-xs text-muted-foreground mt-1">{data.asset_count ?? 0} assets</p>
      </div>
    </div>
  );
}

// Custom Node: Flow Step
function StepNodeComponent({ data }: NodeProps) {
  const config = stepConfig[data.type] || stepConfig.ANALYZE;
  const Icon = config.icon;
  
  return (
    <div className={cn(
      "min-w-[140px] rounded-lg border-2 shadow-md",
      config.bg
    )}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-violet-500" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-violet-500" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={cn("h-5 w-5", config.color)} />
          <span className="font-semibold">{data.type}</span>
        </div>
        <p className="text-xs text-muted-foreground">Step {data.index + 1}</p>
        {data.type === 'ANNOTATE' && data.schema_ids?.length > 0 && (
          <p className="text-xs mt-1">{data.schema_ids.length} schema(s)</p>
        )}
        {data.type === 'CURATE' && data.fields?.length > 0 && (
          <p className="text-xs mt-1">{data.fields.length} field(s)</p>
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  source: SourceNodeComponent,
  bundle: BundleNodeComponent,
  step: StepNodeComponent,
};

interface FlowDetailCanvasProps {
  flow: FlowRead;
  onBack: () => void;
}

function FlowDetailCanvasInner({ flow, onBack }: FlowDetailCanvasProps) {
  const { activeInfospace } = useInfospaceStore();
  const { sources, fetchSources } = useSourceStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { activateFlow, pauseFlow, triggerExecution, deleteFlow, resetCursor } = useFlowStore();
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (activeInfospace?.id) {
      fetchSources();
      fetchBundles(activeInfospace.id);
    }
  }, [activeInfospace?.id, fetchSources, fetchBundles]);

  // Build nodes for this specific flow
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const steps = (flow.steps as any[]) || [];

    let xPos = 0;
    const STEP_WIDTH = 200;
    const yPos = 150;

    // Find related source (if any source outputs to the input bundle)
    const inputBundle = bundles.find(b => b.id === flow.input_bundle_id);
    const relatedSource = sources.find(s => s.output_bundle_id === flow.input_bundle_id);

    // 1. Source node (if exists)
    if (relatedSource) {
      nodes.push({
        id: 'source',
        type: 'source',
        position: { x: xPos, y: yPos },
        data: relatedSource,
      });
      xPos += STEP_WIDTH;
    }

    // 2. Input Bundle node
    if (inputBundle) {
      nodes.push({
        id: 'input-bundle',
        type: 'bundle',
        position: { x: xPos, y: yPos },
        data: { ...inputBundle, role: 'input' },
      });
      
      if (relatedSource) {
        edges.push({
          id: 'e-source-input',
          source: 'source',
          target: 'input-bundle',
          animated: relatedSource.is_active && relatedSource.status?.toLowerCase() === 'active',
          style: { stroke: '#3b82f6', strokeWidth: 2 },
        });
      }
      xPos += STEP_WIDTH;
    }

    // 3. Step nodes
    let prevNodeId = inputBundle ? 'input-bundle' : (relatedSource ? 'source' : null);
    
    steps.forEach((step, index) => {
      const stepId = `step-${index}`;
      nodes.push({
        id: stepId,
        type: 'step',
        position: { x: xPos, y: yPos },
        data: { ...step, index },
      });

      if (prevNodeId) {
        edges.push({
          id: `e-${prevNodeId}-${stepId}`,
          source: prevNodeId,
          target: stepId,
          animated: flow.status === 'active',
          style: { stroke: '#8b5cf6', strokeWidth: 2 },
        });
      }
      
      prevNodeId = stepId;
      xPos += STEP_WIDTH;
    });

    // 4. Output Bundle (from ROUTE step)
    const routeStep = steps.find(s => s.type === 'ROUTE');
    if (routeStep?.bundle_id) {
      const outputBundle = bundles.find(b => b.id === routeStep.bundle_id);
      if (outputBundle) {
        nodes.push({
          id: 'output-bundle',
          type: 'bundle',
          position: { x: xPos, y: yPos },
          data: { ...outputBundle, role: 'output' },
        });

        if (prevNodeId) {
          edges.push({
            id: `e-${prevNodeId}-output`,
            source: prevNodeId,
            target: 'output-bundle',
            animated: flow.status === 'active',
            style: { stroke: '#10b981', strokeWidth: 2 },
          });
        }
      }
    }

    return { nodes, edges };
  }, [flow, sources, bundles]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setTimeout(() => fitView({ padding: 0.3, duration: 500 }), 100);
  }, [initialNodes, initialEdges, setNodes, setEdges, fitView]);

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this flow?')) {
      await deleteFlow(flow.id);
      onBack();
    }
  };

  const statusColor = flow.status === 'active' ? 'text-green-600' :
                      flow.status === 'paused' ? 'text-yellow-600' :
                      flow.status === 'error' ? 'text-red-600' : 'text-gray-600';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-background">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Activity className={cn("h-5 w-5", statusColor)} />
              {flow.name}
            </h1>
            {flow.description && (
              <p className="text-sm text-muted-foreground">{flow.description}</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge className={cn(
            flow.status === 'active' ? 'bg-green-100 text-green-700' :
            flow.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-700'
          )}>
            {flow.status}
          </Badge>
          {flow.trigger_mode === 'on_arrival' && (
            <Badge variant="outline">
              <Radio className="h-3 w-3 mr-1 text-green-500" />
              Auto-trigger
            </Badge>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-6 px-4 py-2 bg-muted/30 border-b text-sm">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Executions:</span>
          <span className="font-medium">{flow.total_executions || 0}</span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Assets Processed:</span>
          <span className="font-medium">{flow.total_assets_processed || 0}</span>
        </div>
        {flow.last_execution_at && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Last Run:</span>
            <span className="font-medium">
              {new Date(flow.last_execution_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.5}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} className="!bg-background !border !shadow-sm" />
          
          {/* Actions Panel */}
          <Panel position="top-right" className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fitView({ padding: 0.3, duration: 500 })}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </Panel>
        </ReactFlow>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between p-4 border-t bg-background">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetCursor(flow.id)}
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset Cursor
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerExecution(flow.id)}
          >
            <Zap className="h-4 w-4 mr-1" />
            Run Now
          </Button>
          
          {flow.status === 'active' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => pauseFlow(flow.id)}
            >
              <Pause className="h-4 w-4 mr-1" />
              Pause
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => activateFlow(flow.id)}
            >
              <Play className="h-4 w-4 mr-1" />
              Activate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FlowDetailCanvas(props: FlowDetailCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowDetailCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
