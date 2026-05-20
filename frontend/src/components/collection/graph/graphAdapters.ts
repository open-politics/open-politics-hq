import { GraphNode, GraphEdge } from './graphTypes';

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
 * For use with GraphView
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

/**
 * Transform a self-contained triplets array into GraphNode/GraphEdge.
 * The triplets format used by the KG schemas in this system embeds the
 * subject/object name (and optional type) directly on each triplet, rather
 * than pointing at a sibling `entities` array — same shape `AnnotationResultsGraph`
 * reads when surfacing per-triplet evidence:
 *   `{ subject_name | subject, predicate, object_name | object,
 *      subject_type?, object_type?, description?, context?, confidence?, weight? }`
 *
 * Nodes are deduped by lowercased label so repeated mentions across triplets
 * collapse to one node and accumulate frequency. Optional types fall back to
 * `'UNKNOWN'` so colour resolution still works.
 */
export function tripletsArrayToGraphData(
  triplets: Array<{
    subject_name?: string;
    subject?: string;
    object_name?: string;
    object?: string;
    predicate?: string;
    subject_type?: string;
    object_type?: string;
    weight?: number;
    confidence?: number;
    description?: string;
    context?: string;
    [extra: string]: any;
  }>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeById = new Map<string, GraphNode>();
  const upsert = (name: string | undefined, type: string | undefined): string | null => {
    const label = (name ?? '').trim();
    if (!label) return null;
    const id = label.toLowerCase();
    const existing = nodeById.get(id);
    if (existing) {
      existing.frequency = (existing.frequency ?? 1) + 1;
      // Latch in a real type if a later mention provides one and the first didn't.
      if (existing.type === 'UNKNOWN' && type && type.length > 0) existing.type = type;
      return id;
    }
    nodeById.set(id, {
      id,
      label,
      type: type && type.length > 0 ? type : 'UNKNOWN',
      frequency: 1,
    });
    return id;
  };

  const edges: GraphEdge[] = [];
  triplets.forEach((t, i) => {
    if (t == null || typeof t !== 'object') return;
    const sId = upsert(t.subject_name ?? t.subject, t.subject_type);
    const oId = upsert(t.object_name ?? t.object, t.object_type);
    if (!sId || !oId) return;
    edges.push({
      id: `triplet-${i}`,
      sourceId: sId,
      targetId: oId,
      predicate: (t.predicate ?? '').trim() || 'related_to',
      weight: typeof t.weight === 'number' ? t.weight : undefined,
      confidence: typeof t.confidence === 'number' ? t.confidence : undefined,
      context: typeof t.context === 'string' ? t.context : (typeof t.description === 'string' ? t.description : undefined),
    });
  });

  return { nodes: Array.from(nodeById.values()), edges };
}