import { GraphNode, GraphEdge } from './D3ForceGraph';

/**
 * Transform backend graph aggregator response into generic GraphNode/GraphEdge format
 */
export function aggregatorResponseToGraphData(response: any): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const graphData = response.graph_data || response;
  const nodes: GraphNode[] = (graphData.nodes || []).map((node: any) => ({
    id: node.id,
    label: node.data?.label || node.label || '',
    type: node.data?.type || node.type || 'UNKNOWN',
    frequency: node.data?.frequency || node.frequency,
    sourceAssetCount: node.data?.source_asset_count || node.source_asset_count,
    sourceAssetIds: node.data?.source_asset_ids || node.source_asset_ids,
    properties: node.data?.properties || node.properties,
  }));

  const edges: GraphEdge[] = (graphData.edges || []).map((edge: any) => ({
    id: edge.id,
    sourceId: edge.source,
    targetId: edge.target,
    predicate: edge.label || edge.data?.predicate || edge.predicate || '',
    frequency: edge.data?.frequency || edge.frequency,
    sourceAssetCount: edge.data?.source_asset_count || edge.source_asset_count,
    sourceAssetIds: edge.data?.source_asset_ids || edge.source_asset_ids,
    weight: edge.data?.weight || edge.weight,
    confidence: edge.data?.confidence || edge.confidence,
    context: edge.data?.context || edge.context,
    properties: edge.data?.properties || edge.properties,
  }));

  return { nodes, edges };
}

/**
 * Transform curated graph data (canonical entities + curated edges) into generic GraphNode/GraphEdge format
 * For future use with CuratedGraphView
 */
export function curatedDataToGraphData(
  entities: Array<{
    id: number;
    canonical_name: string;
    entity_type: string;
    aliases?: string[];
    properties?: Record<string, any>;
  }>,
  triplets: Array<{
    id: number;
    predicate: string;
    subject: {
      canonical_id: number;
      canonical_name: string;
    };
    object: {
      canonical_id: number;
      canonical_name: string;
    };
    properties?: Record<string, any>;
    weight?: number;
    confidence?: number;
    date?: string;
    context?: string;
  }>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = entities.map((entity) => ({
    id: `entity_${entity.id}`,
    label: entity.canonical_name,
    type: entity.entity_type,
    aliases: entity.aliases || [],
    properties: entity.properties,
  }));

  const edges: GraphEdge[] = triplets.map((triplet) => ({
    id: `edge_${triplet.id}`,
    sourceId: `entity_${triplet.subject.canonical_id}`,
    targetId: `entity_${triplet.object.canonical_id}`,
    predicate: triplet.predicate,
    weight: triplet.weight,
    confidence: triplet.confidence,
    context: triplet.context,
    properties: triplet.properties,
  }));

  return { nodes, edges };
}