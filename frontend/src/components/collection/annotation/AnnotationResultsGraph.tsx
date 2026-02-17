'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RefreshCw, AlertCircle, Info, Download, Settings2, Search, X, Eye, EyeOff, Trash2 } from 'lucide-react';
import { AnnotationSchemaRead, AssetRead } from '@/client';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import { AnalysisAdaptersService } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import { VariableSplittingConfig, applySplittingToResults } from './VariableSplittingControls';
import { 
  getAnnotationFieldValue,
  applyGraphEdits,
  createEmptyGraphEdits,
  hasGraphEdits,
  getGraphEditsCount,
} from '@/lib/annotations/utils';
import type { GraphEdits } from '@/lib/annotations/types';
import { D3ForceGraph, GraphNode, GraphEdge, aggregatorResponseToGraphData, GraphViewConfig, defaultGraphViewConfig, GraphSettingsPopover } from '@/components/collection/graph';

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
  // NEW: Graph editing support
  graphEdits?: GraphEdits | null;
  onGraphEditsChange?: (edits: GraphEdits) => void;
}

export default function AnnotationResultsGraph({
  results,
  schemas,
  assets,
  activeRunId,
  allSchemas,
  timeAxisConfig = null,
  variableSplittingConfig = null,
  onVariableSplittingChange,
  onSettingsChange,
  initialSettings,
  onResultSelect,
  graphEdits = null,
  onGraphEditsChange,
}: AnnotationResultsGraphProps) {
  const { activeInfospace } = useInfospaceStore();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  
  // Schema selection - use persisted setting if available
  const persistedSchemaId = initialSettings?.selectedGraphSchemaId;
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>(persistedSchemaId ? persistedSchemaId.toString() : '');
  
  // Graph view config - use persisted setting if available
  const persistedGraphConfig = initialSettings?.graphViewConfig;
  const [graphConfig, setGraphConfig] = useState<GraphViewConfig>(
    persistedGraphConfig ? { ...defaultGraphViewConfig, ...persistedGraphConfig } : defaultGraphViewConfig
  );
  
  // New state for search and highlighting
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);

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

  // Helper function to detect if a schema has graph fields (nodes and edges)
  const hasGraphFields = useCallback((schema: AnnotationSchemaRead): boolean => {
    if (!schema.output_contract || typeof schema.output_contract !== 'object') {
      return false;
    }
    
    const properties = (schema.output_contract as any).properties;
    if (!properties) return false;
    
    // Check for graph structure: nodes and edges arrays, or triplets array
    // Can be at top level or nested under 'document'
    const checkForGraphFields = (props: any): boolean => {
      if (!props || typeof props !== 'object') return false;
      
      // Check for triplets array (new self-contained triplet format)
      const hasTriplets = props.triplets && props.triplets.type === 'array';
      if (hasTriplets) {
        return true;
      }
      
      // Check for nodes and edges arrays (legacy format)
      const hasNodes = props.nodes && props.nodes.type === 'array';
      const hasEdges = props.edges && props.edges.type === 'array';
      
      if (hasNodes && hasEdges) {
        return true;
      }
      
      // Check nested structures (e.g., document.nodes, document.edges)
      for (const [key, value] of Object.entries(props)) {
        if (value && typeof value === 'object' && (value as any).type === 'object' && (value as any).properties) {
          if (checkForGraphFields((value as any).properties)) {
            return true;
          }
        }
      }
      
      return false;
    };
    
    return checkForGraphFields(properties);
  }, []);

  // Find Knowledge Graph schemas - check both run schemas and all available schemas
  // Detection based on actual graph fields (nodes/edges) in output_contract, not just name
  const graphSchemas = useMemo(() => {
    // First, try to find graph schemas in the current run
    const runGraphSchemas = schemas.filter(schema => {
      // Check by name (backward compatibility)
      const nameMatch = schema.name.toLowerCase().includes('knowledge graph') ||
                       schema.name.toLowerCase().includes('graph extractor') ||
                       schema.name.toLowerCase().includes('kg');
      
      // Check by actual graph fields in output_contract
      const hasGraph = hasGraphFields(schema);
      
      return nameMatch || hasGraph;
    });
    
    // If no graph schemas in current run, check all available schemas
    if (runGraphSchemas.length === 0 && allSchemas) {
      const allGraphSchemas = allSchemas.filter(schema => {
        const nameMatch = schema.name.toLowerCase().includes('knowledge graph') ||
                         schema.name.toLowerCase().includes('graph extractor') ||
                         schema.name.toLowerCase().includes('kg');
        const hasGraph = hasGraphFields(schema);
        return nameMatch || hasGraph;
      });
      return allGraphSchemas;
    }
    
    return runGraphSchemas;
  }, [schemas, allSchemas, hasGraphFields]);

  // Auto-select first graph schema if none selected
  useEffect(() => {
    if (graphSchemas.length > 0 && !selectedSchemaId) {
      const firstSchemaId = graphSchemas[0].id.toString();
      setSelectedSchemaId(firstSchemaId);
      // Persist selection
      onSettingsChange?.({ selectedGraphSchemaId: graphSchemas[0].id });
    }
  }, [graphSchemas, selectedSchemaId, onSettingsChange]);

  // Handle schema selection change
  const handleSchemaChange = useCallback((newSchemaId: string) => {
    setSelectedSchemaId(newSchemaId);
    // Persist selection
    onSettingsChange?.({ selectedGraphSchemaId: parseInt(newSchemaId) });
    // Clear selection when schema changes
    setSelectedNodeId(null);
    setShowDetailPanel(false);
    setSearchTerm('');
    setShowSuggestions(false);
  }, [onSettingsChange]);

  // Handle graph config change
  const handleGraphConfigChange = useCallback((newConfig: GraphViewConfig) => {
    setGraphConfig(newConfig);
    // Persist config
    onSettingsChange?.({ graphViewConfig: newConfig });
  }, [onSettingsChange]);

  // Search suggestions based on node labels
  const searchSuggestions = useMemo(() => {
    if (!searchTerm || !nodes.length) return [];
    
    // Create a Map to ensure unique suggestions by ID
    const uniqueSuggestions = new Map();
    
    nodes
      .filter(node => 
        node.label.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .forEach(node => {
        if (!uniqueSuggestions.has(node.id)) {
          uniqueSuggestions.set(node.id, {
            id: node.id,
            label: node.label,
            type: node.type,
            frequency: node.frequency || 1,
          });
        }
      });
    
    return Array.from(uniqueSuggestions.values()).slice(0, 8); // Limit suggestions
  }, [searchTerm, nodes]);

  // Get connected node IDs for a given node
  const getConnectedNodeIds = useCallback((nodeId: string): string[] => {
    const connected = new Set<string>();
    
    edges.forEach(edge => {
      if (edge.sourceId === nodeId) {
        connected.add(edge.targetId);
      }
      if (edge.targetId === nodeId) {
        connected.add(edge.sourceId);
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
    
    const outgoingEdges = edges.filter(e => e.sourceId === nodeId);
    const incomingEdges = edges.filter(e => e.targetId === nodeId);
    
    return {
      ...node,
      connectedNodes,
      outgoingEdges,
      incomingEdges,
      totalConnections: connectedNodeIds.length,
    };
  }, [nodes, edges, getConnectedNodeIds]);

  // Handle node selection
  const handleNodeSelect = useCallback((node: GraphNode) => {
    setSelectedNodeId(node.id);
    setShowDetailPanel(true);
  }, []);

  // Handle search selection
  const handleSearchSelect = useCallback((suggestion: any) => {
    setSearchTerm(suggestion.label);
    setShowSuggestions(false);
    const node = nodes.find(n => n.id === suggestion.id);
    if (node) {
      handleNodeSelect(node);
    }
  }, [nodes, handleNodeSelect]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setShowDetailPanel(false);
    setSearchTerm('');
    setShowSuggestions(false);
  }, []);

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

      // Note: The graph_aggregator adapter automatically reads graph_config from the run
      // (including deduplication settings) when processing annotations. No need to pass it explicitly.
      const response = await AnalysisAdaptersService.executeAnalysisAdapter({
        adapterName: 'graph_aggregator',
        requestBody: config,
      }) as any;

      // Handle the nested response structure from GraphAggregatorAdapter
      if (response.graph_data && response.graph_data.nodes && response.graph_data.edges) {
        // Transform backend response to generic graph format
        const { nodes: graphNodes, edges: graphEdges } = aggregatorResponseToGraphData(response);
        
        // Apply graph edits if they exist
        // Note: applyGraphEdits expects ReactFlow format, so we need to adapt
        // For now, we'll apply edits manually to the generic format
        let finalNodes = graphNodes;
        let finalEdges = graphEdges;
        
        if (graphEdits) {
          // Filter out deleted nodes
          const deletedNodeIds = new Set(graphEdits.deletedNodes.map(n => n.nodeId));
          finalNodes = graphNodes.filter(n => !deletedNodeIds.has(n.id));
          
          // Filter out edges connected to deleted nodes
          finalEdges = graphEdges.filter(e => 
            !deletedNodeIds.has(e.sourceId) && !deletedNodeIds.has(e.targetId)
          );
          
          // Filter out deleted edges
          const deletedEdgeIds = new Set(graphEdits.deletedEdges.map(e => e.edgeId));
          finalEdges = finalEdges.filter(e => !deletedEdgeIds.has(e.id));
        }
        
        const graphData: GraphData = {
          nodes: finalNodes,
          edges: finalEdges,
          metadata: {
            total_nodes: response.graph_metrics?.total_nodes || finalNodes.length,
            total_edges: response.graph_metrics?.total_edges || finalEdges.length,
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
        setNodes(finalNodes);
        setEdges(finalEdges);
        
        const editCount = graphEdits ? getGraphEditsCount(graphEdits) : 0;
        const message = editCount > 0 
          ? `Graph loaded: ${finalNodes.length} nodes, ${finalEdges.length} edges (${editCount} edits applied)`
          : `Graph loaded: ${graphData.metadata.total_nodes} nodes, ${graphData.metadata.total_edges} edges`;
        toast.success(message);
      } else {
        setError('Invalid response format from graph aggregator: missing graph_data.nodes or graph_data.edges');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to aggregate graph data');
      toast.error('Failed to load graph visualization');
    } finally {
      setIsLoading(false);
    }
  }, [activeRunId, selectedSchemaId, schemas, graphEdits]);

  // Auto-load when schema is selected
  useEffect(() => {
    if (selectedSchemaId && activeRunId) {
      aggregateGraph();
    }
  }, [selectedSchemaId, activeRunId]); // Note: aggregateGraph is stable, but we want to re-run when dependencies change

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

  // Get connected node IDs for highlighting
  const connectedNodeIds = useMemo(() => {
    if (!selectedNodeId) return [];
    return getConnectedNodeIds(selectedNodeId);
  }, [selectedNodeId, getConnectedNodeIds]);

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
          <Select value={selectedSchemaId} onValueChange={handleSchemaChange}>
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

        {/* Graph Settings */}
        <GraphSettingsPopover
          config={graphConfig}
          onConfigChange={handleGraphConfigChange}
          defaultConfig={defaultGraphViewConfig}
        />

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
            <D3ForceGraph
              nodes={nodes}
              edges={edges}
              highlightedNodeId={selectedNodeId}
              connectedNodeIds={connectedNodeIds}
              onNodeClick={handleNodeSelect}
              autoResize={true}
              config={graphConfig}
            />
            
            {/* Graph Editing Controls */}
            {selectedNodeId && onGraphEditsChange && (
              <div className="absolute top-2 left-2 bg-white/95 p-3 rounded-lg shadow-lg border z-10">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground mb-2">
                    Edit Graph
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-full text-xs"
                    onClick={() => {
                      const currentEdits = graphEdits || createEmptyGraphEdits();
                      const updatedEdits: GraphEdits = {
                        ...currentEdits,
                        deletedNodes: [
                          ...currentEdits.deletedNodes,
                          {
                            nodeId: selectedNodeId,
                            deletedAt: new Date().toISOString(),
                            reason: 'User deleted'
                          }
                        ]
                      };
                      onGraphEditsChange(updatedEdits);
                      setSelectedNodeId(null);
                      setShowDetailPanel(false);
                      toast.success('Node deleted');
                      // Re-aggregate to apply changes
                      aggregateGraph();
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete Node
                  </Button>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Removes node and connected edges
                  </div>
                </div>
              </div>
            )}
            
            {/* Graph Edit Status */}
            {hasGraphEdits(graphEdits) && (
              <div className="absolute bottom-2 right-2 bg-blue-50/95 px-3 py-2 rounded-lg shadow border border-blue-200 z-10">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-3 w-3 text-blue-600" />
                  <span className="text-xs font-medium text-blue-700">
                    {getGraphEditsCount(graphEdits)} edits applied
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 text-blue-600 hover:text-blue-700"
                    onClick={() => {
                      if (confirm('Clear all graph edits? This cannot be undone.')) {
                        onGraphEditsChange?.(createEmptyGraphEdits());
                        toast.success('Graph edits cleared');
                        aggregateGraph();
                      }
                    }}
                    title="Clear all edits"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
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
                      <div><span className="font-medium">Frequency:</span> {selectedNodeDetails.frequency || 1}</div>
                      <div><span className="font-medium">Sources:</span> {selectedNodeDetails.sourceAssetCount || 0}</div>
                      <div><span className="font-medium">Connections:</span> {selectedNodeDetails.totalConnections}</div>
                    </div>
                    {/* Show source asset IDs if available */}
                    {selectedNodeDetails.sourceAssetIds && selectedNodeDetails.sourceAssetIds.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs font-medium text-gray-600 mb-1">Appears in documents:</div>
                        <div className="flex flex-wrap gap-1">
                          {selectedNodeDetails.sourceAssetIds.slice(0, 10).map((assetId) => {
                            const asset = assetsMap.get(assetId);
                            return (
                              <button
                                key={assetId}
                                onClick={() => {
                                  // Find a result from this asset to select
                                  const result = results.find(r => r.asset_id === assetId);
                                  if (result && onResultSelect) {
                                    onResultSelect(result);
                                  }
                                }}
                                className="text-xs px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 cursor-pointer"
                                title={asset?.title || `Asset ${assetId}`}
                              >
                                {asset?.title || `#${assetId}`}
                              </button>
                            );
                          })}
                          {selectedNodeDetails.sourceAssetIds.length > 10 && (
                            <span className="text-xs text-gray-500">+{selectedNodeDetails.sourceAssetIds.length - 10} more</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Combined Connections View */}
                  <div className="flex-1">
                    <h5 className="font-medium mb-2 text-sm">
                      Connections ({selectedNodeDetails.outgoingEdges.length + selectedNodeDetails.incomingEdges.length})
                    </h5>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {/* Outgoing Relationships */}
                      {selectedNodeDetails.outgoingEdges.map((edge) => {
                        const targetNode = nodes.find(n => n.id === edge.targetId);
                        return (
                          <div 
                            key={`out-${edge.id}`} 
                            className="p-2 bg-blue-50 rounded text-xs cursor-pointer hover:bg-blue-100 transition-colors border-l-2 border-blue-400"
                            onClick={() => {
                              if (targetNode) handleNodeSelect(targetNode);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-blue-600 font-medium">→</span>
                              <div className="flex-1">
                                <div className="font-medium text-gray-800 truncate" title={targetNode?.label}>
                                  {targetNode?.label}
                                </div>
                                <div className="text-xs text-gray-500">{targetNode?.type}</div>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-blue-700 truncate italic" title={edge.predicate}>
                              "{edge.predicate}"
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Incoming Relationships */}
                      {selectedNodeDetails.incomingEdges.map((edge) => {
                        const sourceNode = nodes.find(n => n.id === edge.sourceId);
                        return (
                          <div 
                            key={`in-${edge.id}`} 
                            className="p-2 bg-green-50 rounded text-xs cursor-pointer hover:bg-green-100 transition-colors border-l-2 border-green-400"
                            onClick={() => {
                              if (sourceNode) handleNodeSelect(sourceNode);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-green-600 font-medium">←</span>
                              <div className="flex-1">
                                <div className="font-medium text-gray-800 truncate" title={sourceNode?.label}>
                                  {sourceNode?.label}
                                </div>
                                <div className="text-xs text-gray-500">{sourceNode?.type}</div>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-green-700 truncate italic" title={edge.predicate}>
                              "{edge.predicate}"
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