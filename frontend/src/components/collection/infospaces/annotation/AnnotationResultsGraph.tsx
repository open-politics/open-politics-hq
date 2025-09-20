'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RefreshCw, AlertCircle, Info, Download, Settings2, Search, X, Eye, EyeOff } from 'lucide-react';
import { AnnotationSchemaRead, AssetRead } from '@/client/models';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import { AnalysisAdaptersService } from '@/client/services';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  Panel,
  NodeTypes,
  Position,
  Handle,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { VariableSplittingConfig, applySplittingToResults } from './VariableSplittingControls';
import { getAnnotationFieldValue } from '@/lib/annotations/utils';

// Time filtering utility function (copied from AnnotationResultsChart.tsx)
const getTimestamp = (result: FormattedAnnotation, assetsMap: Map<number, AssetRead>, timeAxisConfig: TimeAxisConfig | null): Date | null => {
  if (!timeAxisConfig) return null;

  switch (timeAxisConfig.type) {
    case 'default':
      return new Date(result.timestamp);
    case 'schema':
      if (result.schema_id === timeAxisConfig.schemaId && timeAxisConfig.fieldKey) {
        const fieldValue = getAnnotationFieldValue(result.value, timeAxisConfig.fieldKey);
        if (fieldValue && (typeof fieldValue === 'string' || fieldValue instanceof Date)) {
          try {
            return new Date(fieldValue);
          } catch {
            return null;
          }
        }
      }
      return null;
    case 'event':
      const asset = assetsMap.get(result.asset_id);
      if (asset?.event_timestamp) {
        try {
          return new Date(asset.event_timestamp);
        } catch {
          return null;
        }
      }
      return null;
    default:
      return new Date(result.timestamp);
  }
};

// Types for graph data from backend
interface GraphNode {
  id: string;
  data: {
    label: string;
    type: string;
    frequency: number;
    source_asset_count: number;
  };
  position: { x: number; y: number };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  data: {
    predicate: string;
    frequency: number;
    source_asset_count: number;
  };
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    total_nodes: number;
    total_edges: number;
    total_fragments_processed: number;
    fragments_with_errors: number;
    processing_stats: {
      nodes_filtered_by_frequency: number;
      nodes_filtered_by_max_limit: number;
      isolated_nodes_included: number;
    };
  };
}

interface AnnotationResultsGraphProps {
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  assets: AssetRead[];
  activeRunId?: number;
  allSchemas?: AnnotationSchemaRead[];
  // NEW: Time frame filtering
  timeAxisConfig?: TimeAxisConfig | null;
  // NEW: Variable splitting
  variableSplittingConfig?: VariableSplittingConfig | null;
  onVariableSplittingChange?: (config: VariableSplittingConfig | null) => void;
  // NEW: Settings persistence
  onSettingsChange?: (settings: any) => void;
  initialSettings?: any;
  // NEW: Result selection callback
  onResultSelect?: (result: FormattedAnnotation) => void;
}

// Custom node component for entities
const EntityNode = ({ data, selected }: { data: any; selected?: boolean }) => {
  const isHighlighted = data.isHighlighted;
  const isConnected = data.isConnected;
  const isDimmed = data.isDimmed;
  
  return (
    <div 
      className={`px-3 py-2 shadow-md rounded-md border-2 min-w-[120px] relative transition-all duration-200 cursor-pointer ${
        isHighlighted 
          ? 'bg-blue-100 border-blue-500 scale-110 shadow-lg' 
          : isConnected
          ? 'bg-green-50 border-green-400'
          : isDimmed
          ? 'bg-gray-100 border-gray-300 opacity-40'
          : 'bg-white border-gray-200 hover:bg-gray-50'
      }`}
    >
      {/* Source handle (outgoing edges) */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        style={{ background: '#555' }}
      />
      
      {/* Target handle (incoming edges) */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        style={{ background: '#555' }}
      />
      
      <div className={`font-bold text-sm text-center ${
        isDimmed ? 'text-gray-400' : 'text-gray-800'
      }`}>
        {data.label}
      </div>
      <div className={`text-xs text-center ${
        isDimmed ? 'text-gray-400' : 'text-gray-500'
      }`}>
        {data.type}
      </div>
      {data.frequency > 1 && (
        <div className={`text-xs text-center ${
          isDimmed ? 'text-gray-400' : 'text-blue-600'
        }`}>
          ({data.frequency}x)
        </div>
      )}
    </div>
  );
};

// Define nodeTypes outside component to prevent recreation
const nodeTypes: NodeTypes = {
  entity: EntityNode,
};

// Inner component that uses useReactFlow hook
function AnnotationResultsGraphInner({
  results,
  schemas,
  assets,
  activeRunId,
  allSchemas,
  // NEW props
  timeAxisConfig = null,
  variableSplittingConfig = null,
  onVariableSplittingChange,
  onSettingsChange,
  initialSettings,
  onResultSelect,
}: AnnotationResultsGraphProps) {
  const { activeInfospace } = useInfospaceStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>('');
  
  // New state for search and highlighting
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  
  const { fitView } = useReactFlow();

  // NEW: Apply time frame filtering and variable splitting
  const assetsMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  
  const timeFilteredResults = useMemo(() => {
    if (!timeAxisConfig?.timeFrame?.enabled || !timeAxisConfig.timeFrame.startDate || !timeAxisConfig.timeFrame.endDate) {
      return results;
    }

    const { startDate, endDate } = timeAxisConfig.timeFrame;
    
    return results.filter(result => {
      const timestamp = getTimestamp(result, assetsMap, timeAxisConfig);
      if (!timestamp) return false;
      
      return timestamp >= startDate && timestamp <= endDate;
    });
  }, [results, timeAxisConfig, assetsMap]);

  const processedResults = useMemo(() => {
    if (variableSplittingConfig?.enabled) {
      return applySplittingToResults(timeFilteredResults, variableSplittingConfig);
    }
    return { all: timeFilteredResults };
  }, [timeFilteredResults, variableSplittingConfig]);

  // Use the appropriate results for graph generation
  const resultsForGraph = useMemo(() => {
    // For graph visualization, we typically want to combine all split results
    // as the graph shows relationships across the entire dataset
    const allResults: FormattedAnnotation[] = [];
    Object.values(processedResults).forEach(splitResults => {
      allResults.push(...splitResults);
    });
    return allResults.length > 0 ? allResults : timeFilteredResults;
  }, [processedResults, timeFilteredResults]);

  // Find Knowledge Graph schemas - check both run schemas and all available schemas
  const graphSchemas = useMemo(() => {
    // First, try to find graph schemas in the current run
    const runGraphSchemas = schemas.filter(schema => 
      schema.name.toLowerCase().includes('knowledge graph') ||
      schema.name.toLowerCase().includes('graph extractor')
    );
    
    // If no graph schemas in current run, check all available schemas
    if (runGraphSchemas.length === 0 && allSchemas) {
      const allGraphSchemas = allSchemas.filter(schema => 
        schema.name.toLowerCase().includes('knowledge graph') ||
        schema.name.toLowerCase().includes('graph extractor')
      );
      return allGraphSchemas;
    }
    
    return runGraphSchemas;
  }, [schemas, allSchemas]);

  // Auto-select first graph schema
  useEffect(() => {
    if (graphSchemas.length > 0 && !selectedSchemaId) {
      setSelectedSchemaId(graphSchemas[0].id.toString());
    }
  }, [graphSchemas, selectedSchemaId]);

  // Search suggestions based on node labels
  const searchSuggestions = useMemo(() => {
    if (!searchTerm || !nodes.length) return [];
    
    // Create a Map to ensure unique suggestions by ID
    const uniqueSuggestions = new Map();
    
    nodes
      .filter(node => 
        node.data.label.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .forEach(node => {
        if (!uniqueSuggestions.has(node.id)) {
          uniqueSuggestions.set(node.id, {
            id: node.id,
            label: node.data.label,
            type: node.data.type,
            frequency: node.data.frequency,
          });
        }
      });
    
    return Array.from(uniqueSuggestions.values()).slice(0, 8); // Limit suggestions
  }, [searchTerm, nodes]);

  // Get connected node IDs for a given node
  const getConnectedNodeIds = useCallback((nodeId: string): string[] => {
    const connected = new Set<string>();
    
    edges.forEach(edge => {
      if (edge.source === nodeId) {
        connected.add(edge.target);
      }
      if (edge.target === nodeId) {
        connected.add(edge.source);
      }
    });
    
    return Array.from(connected);
  }, [edges]);

  // Get detailed information about a node
  const getNodeDetails = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;

    const connectedNodeIds = getConnectedNodeIds(nodeId);
    const connectedNodes = nodes.filter(n => connectedNodeIds.includes(n.id));
    
    const outgoingEdges = edges.filter(e => e.source === nodeId);
    const incomingEdges = edges.filter(e => e.target === nodeId);
    
    return {
      ...node.data,
      id: nodeId,
      connectedNodes,
      outgoingEdges,
      incomingEdges,
      totalConnections: connectedNodeIds.length,
    };
  }, [nodes, edges, getConnectedNodeIds]);

  // Update node highlighting based on selection
  const updateNodeHighlighting = useCallback((selectedId: string | null) => {
    if (!selectedId) {
      // Clear all highlighting
      setNodes(prevNodes => 
        prevNodes.map(node => ({
          ...node,
          data: {
            ...node.data,
            isHighlighted: false,
            isConnected: false,
            isDimmed: false,
          }
        }))
      );
      setEdges(prevEdges =>
        prevEdges.map(edge => {
          const isHighFrequency = edge.data?.frequency > 2 || edge.animated || false;
          return {
            ...edge,
            style: {
              ...edge.style,
              opacity: 1,
              strokeWidth: isHighFrequency ? 3 : 2,
            }
          };
        })
      );
      return;
    }

    const connectedNodeIds = getConnectedNodeIds(selectedId);
    
    setNodes(prevNodes => 
      prevNodes.map(node => {
        const isSelected = node.id === selectedId;
        const isConnected = connectedNodeIds.includes(node.id);
        const isDimmed = !isSelected && !isConnected;
        
        return {
          ...node,
          data: {
            ...node.data,
            isHighlighted: isSelected,
            isConnected: isConnected && !isSelected,
            isDimmed,
          }
        };
      })
    );

    // Update edge highlighting
    setEdges(prevEdges =>
      prevEdges.map(edge => {
        const isConnectedToSelected = edge.source === selectedId || edge.target === selectedId;
        const isHighFrequency = edge.data?.frequency > 2 || edge.animated || false;
        
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: isConnectedToSelected ? 1 : 0.2,
            strokeWidth: isConnectedToSelected 
              ? (isHighFrequency ? 4 : 3)
              : (isHighFrequency ? 2 : 1),
          }
        };
      })
    );
  }, [getConnectedNodeIds, setNodes, setEdges]);

  // Handle node selection
  const handleNodeSelect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setShowDetailPanel(true);
    updateNodeHighlighting(nodeId);
    
    // Focus on the selected node
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      fitView({ 
        nodes: [node], 
        duration: 500,
        padding: 0.3 
      });
    }
  }, [nodes, fitView, updateNodeHighlighting]);

  // Handle search selection
  const handleSearchSelect = useCallback((suggestion: any) => {
    setSearchTerm(suggestion.label);
    setShowSuggestions(false);
    handleNodeSelect(suggestion.id);
  }, [handleNodeSelect]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setShowDetailPanel(false);
    setSearchTerm('');
    setShowSuggestions(false);
    updateNodeHighlighting(null);
  }, [updateNodeHighlighting]);

  // Handle node clicks in ReactFlow
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    handleNodeSelect(node.id);
  }, [handleNodeSelect]);

  const aggregateGraph = useCallback(async () => {
    if (!activeRunId || !selectedSchemaId) {
      setError('Missing run ID or schema selection');
      return;
    }

    // Check if the selected schema was actually used in this run
    const selectedSchemaInRun = schemas.find(s => s.id.toString() === selectedSchemaId);
    if (!selectedSchemaInRun) {
      setError('The selected schema was not used in this annotation run. Please create a new run that includes the "Knowledge Graph Extractor" schema to generate graph visualizations.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const config = {
        target_run_id: activeRunId,
        target_schema_id: parseInt(selectedSchemaId),
        include_isolated_nodes: true,
        node_frequency_threshold: 1,
        max_nodes: 100, // Limit for performance
      };

      const response = await AnalysisAdaptersService.executeAnalysisAdapter({
        adapterName: 'graph_aggregator',
        requestBody: config,
      }) as any;

      // Handle the nested response structure from GraphAggregatorAdapter
      if (response.graph_data && response.graph_data.nodes && response.graph_data.edges) {
        
        const graphData: GraphData = {
          nodes: response.graph_data.nodes,
          edges: response.graph_data.edges,
          metadata: {
            total_nodes: response.graph_metrics?.total_nodes || response.graph_data.nodes.length,
            total_edges: response.graph_metrics?.total_edges || response.graph_data.edges.length,
            total_fragments_processed: response.processing_summary?.total_fragments_processed || 0,
            fragments_with_errors: response.processing_summary?.fragments_with_errors || 0,
            processing_stats: {
              nodes_filtered_by_frequency: response.processing_summary?.total_entities_extracted - response.processing_summary?.entities_after_filtering || 0,
              nodes_filtered_by_max_limit: 0, // Not tracked separately in current implementation
              isolated_nodes_included: response.graph_metrics?.isolated_nodes || 0,
            }
          }
        };
        
        setGraphData(graphData);

        // Convert to ReactFlow format with auto-layout
        const reactFlowNodes: Node[] = graphData.nodes.map((node, index) => {
          // Improved circular/grid layout to spread nodes better
          const nodesPerRow = Math.ceil(Math.sqrt(graphData.nodes.length));
          const row = Math.floor(index / nodesPerRow);
          const col = index % nodesPerRow;
          
          return {
            id: node.id,
            type: 'entity',
            position: {
              x: col * 250 + (row % 2) * 125, // Offset every other row for better spacing
              y: row * 200,
            },
            data: {
              ...node.data,
              label: node.data.label,
            },
          };
        });

        const reactFlowEdges: Edge[] = graphData.edges.map((edge) => {
          
          const isHighFrequency = edge.data?.frequency > 2 || false;
          
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: 'source', // Connect to the source handle
            targetHandle: 'target', // Connect to the target handle
            label: edge.label,
            type: 'smoothstep',
            animated: isHighFrequency,
            data: edge.data, // Preserve the original data
            style: { 
              stroke: isHighFrequency ? '#2563eb' : '#374151', // Darker, more visible colors
              strokeWidth: isHighFrequency ? 3 : 2,
              strokeOpacity: 1, // Ensure full opacity
            },
            labelStyle: { 
              fontSize: 10, 
              fontWeight: 600,
              fill: '#1f2937', // Darker text
            },
            labelBgStyle: { 
              fill: '#ffffff', 
              fillOpacity: 0.9, // More opaque background
              stroke: '#e5e7eb',
              strokeWidth: 1,
            },
          };
        });

        // Debug logging
        
        // Check for ID mismatches
        const nodeIds = new Set(reactFlowNodes.map(n => n.id));
        const edgeWithInvalidIds = reactFlowEdges.filter(e => 
          !nodeIds.has(e.source) || !nodeIds.has(e.target)
        );
        if (edgeWithInvalidIds.length > 0) {
        }

        // Filter out edges with undefined source/target
        const validEdges = reactFlowEdges.filter(e => {
          if (!e.source || !e.target) {
            return false;
          }
          return true;
        });

        // Clear existing nodes and edges first to prevent duplication
        setNodes([]);
        setEdges([]);
        
        // Use setTimeout to ensure clearing happens before setting new data
        setTimeout(() => {
          setNodes(reactFlowNodes);
          setEdges(validEdges);
        }, 0);
        
        toast.success(`Graph loaded: ${graphData.metadata.total_nodes} nodes, ${graphData.metadata.total_edges} edges`);
      } else {
        setError('Invalid response format from graph aggregator: missing graph_data.nodes or graph_data.edges');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to aggregate graph data');
      toast.error('Failed to load graph visualization');
    } finally {
      setIsLoading(false);
    }
  }, [activeRunId, selectedSchemaId, schemas, setNodes, setEdges]);

  // Auto-load when schema is selected
  useEffect(() => {
    if (selectedSchemaId && activeRunId) {
      // Clear any existing selection when schema changes
      setSelectedNodeId(null);
      setShowDetailPanel(false);
      setSearchTerm('');
      setShowSuggestions(false);
      aggregateGraph();
    }
  }, [selectedSchemaId, activeRunId, aggregateGraph]);

  const handleExportGraph = () => {
    if (graphData) {
      const dataStr = JSON.stringify(graphData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `graph-export-run-${activeRunId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Graph data exported');
    }
  };

  if (graphSchemas.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground max-w-md">
          <Info className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">No Graph Schemas Available</h3>
          <p className="text-sm">
            No Knowledge Graph Extractor schemas found in your infospace. 
            Create a schema with "Knowledge Graph" or "Graph Extractor" in the name to enable graph visualizations.
          </p>
        </div>
      </div>
    );
  }

  const selectedNodeDetails = selectedNodeId ? getNodeDetails(selectedNodeId) : null;

  return (
    <div className="h-full flex flex-col">
      {/* Enhanced Controls */}
      <div className="flex items-center gap-4 p-4 border-b bg-muted/20">
        {/* Schema Selection */}
        <div className="flex items-center gap-2">
          <Label htmlFor="schema-select" className="text-sm font-medium">Schema:</Label>
          <Select value={selectedSchemaId} onValueChange={setSelectedSchemaId}>
            <SelectTrigger id="schema-select" className="w-[200px]">
              <SelectValue placeholder="Select a graph schema" />
            </SelectTrigger>
            <SelectContent>
              {graphSchemas.map(schema => (
                <SelectItem key={schema.id} value={schema.id.toString()}>
                  {schema.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search Bar */}
        <div className="relative flex items-center gap-2">
          <Label htmlFor="node-search" className="text-sm font-medium">Search:</Label>
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="node-search"
                type="text"
                placeholder="Search nodes..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="pl-10 pr-10 w-[200px]"
              />
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>

            {/* Search Suggestions */}
            {showSuggestions && searchSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
                {searchSuggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                    onClick={() => handleSearchSelect(suggestion)}
                  >
                    <div className="font-medium text-sm">{suggestion.label}</div>
                    <div className="text-xs text-gray-500">
                      {suggestion.type} • {suggestion.frequency}x
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* View Controls */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDetailPanel(!showDetailPanel)}
          disabled={!selectedNodeId}
        >
          {showDetailPanel ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
          Details
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={clearSelection}
          disabled={!selectedNodeId}
        >
          <X className="h-4 w-4 mr-2" />
          Clear
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={aggregateGraph}
          disabled={isLoading || !selectedSchemaId}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>

        {graphData && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportGraph}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        )}

        {/* Stats */}
        {graphData && (
          <div className="text-sm text-muted-foreground ml-auto">
            {graphData.metadata.total_nodes} nodes, {graphData.metadata.total_edges} edges
            {selectedNodeId && selectedNodeDetails && (
              <span className="ml-2 text-blue-600">
                • {selectedNodeDetails.totalConnections} connections
              </span>
            )}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Aggregating graph data...</p>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {!isLoading && nodes.length > 0 && (
        <div className="flex-1 flex">
          {/* Graph Visualization */}
          <div className={`relative transition-all duration-300 ${
            showDetailPanel ? 'w-2/3' : 'w-full'
          }`}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              connectionMode={ConnectionMode.Loose}
              fitView
              fitViewOptions={{ padding: 0.2 }}
            >
              <Background />
              <Controls />
              <Panel position="top-right" className="bg-white/90 p-2 rounded shadow-md">
                <div className="text-xs space-y-1">
                  <div><strong>Legend:</strong></div>
                  <div>• Click nodes to explore</div>
                  <div>• Blue = selected node</div>
                  <div>• Green = connected nodes</div>
                  <div>• Animated lines = frequent</div>
                </div>
              </Panel>
            </ReactFlow>
          </div>

          {/* Detail Panel */}
          {showDetailPanel && selectedNodeDetails && (
            <div className="w-1/3 border-l bg-white p-4 overflow-y-auto">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    Node Details
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDetailPanel(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Basic Info - More Compact */}
                  <div className="border-b border-gray-200 pb-3">
                    <h4 className="font-semibold text-base mb-2 truncate" title={selectedNodeDetails.label}>
                      {selectedNodeDetails.label}
                    </h4>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                      <div><span className="font-medium">Type:</span> {selectedNodeDetails.type}</div>
                      <div><span className="font-medium">Frequency:</span> {selectedNodeDetails.frequency}</div>
                      <div><span className="font-medium">Sources:</span> {selectedNodeDetails.source_asset_count}</div>
                      <div><span className="font-medium">Connections:</span> {selectedNodeDetails.totalConnections}</div>
                    </div>
                  </div>

                  {/* Combined Connections View */}
                  <div className="flex-1">
                    <h5 className="font-medium mb-2 text-sm">
                      Connections ({selectedNodeDetails.outgoingEdges.length + selectedNodeDetails.incomingEdges.length})
                    </h5>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {/* Outgoing Relationships */}
                      {selectedNodeDetails.outgoingEdges.map((edge) => {
                        const targetNode = nodes.find(n => n.id === edge.target);
                        return (
                          <div 
                            key={`out-${edge.id}`} 
                            className="p-2 bg-blue-50 rounded text-xs cursor-pointer hover:bg-blue-100 transition-colors border-l-2 border-blue-400"
                            onClick={() => handleNodeSelect(edge.target)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-blue-600 font-medium">→</span>
                              <div className="flex-1">
                                <div className="font-medium text-gray-800 truncate" title={targetNode?.data.label}>
                                  {targetNode?.data.label}
                                </div>
                                <div className="text-xs text-gray-500">{targetNode?.data.type}</div>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-blue-700 truncate italic" title={edge.label}>
                              "{edge.label}"
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Incoming Relationships */}
                      {selectedNodeDetails.incomingEdges.map((edge) => {
                        const sourceNode = nodes.find(n => n.id === edge.source);
                        return (
                          <div 
                            key={`in-${edge.id}`} 
                            className="p-2 bg-green-50 rounded text-xs cursor-pointer hover:bg-green-100 transition-colors border-l-2 border-green-400"
                            onClick={() => handleNodeSelect(edge.source)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-green-600 font-medium">←</span>
                              <div className="flex-1">
                                <div className="font-medium text-gray-800 truncate" title={sourceNode?.data.label}>
                                  {sourceNode?.data.label}
                                </div>
                                <div className="text-xs text-gray-500">{sourceNode?.data.type}</div>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-green-700 truncate italic" title={edge.label}>
                              "{edge.label}"
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Empty State */}
                      {selectedNodeDetails.outgoingEdges.length === 0 && selectedNodeDetails.incomingEdges.length === 0 && (
                        <div className="text-xs text-gray-500 text-center py-4">
                          No connections found
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && nodes.length === 0 && selectedSchemaId && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-md">
            <Info className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No Graph Data Found</h3>
            <p className="text-sm">
              No graph fragments were found for this run and schema combination. 
              {schemas.find(s => s.id.toString() === selectedSchemaId) 
                ? "Make sure the annotation run has completed successfully and produced graph results."
                : "Please create a new annotation run that includes the selected schema to generate graph data."
              }
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnnotationResultsGraph({
  results,
  schemas,
  assets,
  activeRunId,
  allSchemas,
  // NEW props
  timeAxisConfig = null,
  variableSplittingConfig = null,
  onVariableSplittingChange,
  onSettingsChange,
  initialSettings,
  onResultSelect,
}: AnnotationResultsGraphProps) {
  return (
    <ReactFlowProvider>
      <AnnotationResultsGraphInner
        results={results}
        schemas={schemas}
        assets={assets}
        activeRunId={activeRunId}
        allSchemas={allSchemas}
        timeAxisConfig={timeAxisConfig}
        variableSplittingConfig={variableSplittingConfig}
        onVariableSplittingChange={onVariableSplittingChange}
        onSettingsChange={onSettingsChange}
        initialSettings={initialSettings}
        onResultSelect={onResultSelect}
      />
    </ReactFlowProvider>
  );
} 