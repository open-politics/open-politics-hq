import { GraphNode, GraphEdge } from './graphTypes';
import type { ViewGraphPhase } from '@/lib/annotations/types';

/**
 * The `/view` graph phase → the renderer's node/edge shape.
 *
 * **This is the whole wire contract, in one place.** It used to live inline in
 * `AnnotationResultsGraph`, next to a second, dead adapter that read keys the
 * backend has never sent — and the two drifted exactly as you would expect: the
 * live one silently dropped `kind`, `places`, `magnitude`, `evidence` and
 * `role`, so occurrences, the place ladder and every quote in the corpus
 * arrived on the wire and were discarded at the door. A field missing from the
 * mapper is indistinguishable from a backend that never sent it, which is why
 * this is a tested function rather than an object literal in a component.
 *
 * The authority on the other side is `annotation/formula_query.py:_node_to_dict`
 * and `_edge_to_dict`. Keep the three in step.
 *
 * `?? null` rather than `||` throughout, so a legitimate falsy value — a zero
 * magnitude, the equator's latitude — survives.
 */
export function viewGraphToGraphData(
  graph: Pick<ViewGraphPhase, 'nodes' | 'edges'>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = (graph.nodes ?? []).map(n => ({
    id: n.id,
    label: n.name,
    type: n.type,
    frequency: n.frequency,
    annotationIds: n.source_annotation_ids,
    // Entity vs occurrence gets opposite rendering, and the item pane is a
    // list over the occurrences. Default `entity` so a payload predating the
    // observation model behaves exactly as it did.
    kind: n.kind ?? 'entity',
    nodeType: n.node_type ?? null,
    magnitude: n.magnitude ?? null,
    size: n.size ?? null,
    cluster: n.cluster ?? null,
    // Time / space / provenance from the projection bindings. Null unless a
    // projection bound them, so an unconfigured panel is unchanged.
    t0: n.t0 ?? null,
    t1: n.t1 ?? null,
    a0: n.a0 ?? null,
    a1: n.a1 ?? null,
    place: n.place ?? null,
    placeTo: n.place_to ?? null,
    places: n.places ?? [],
    lat: n.lat ?? null,
    lon: n.lon ?? null,
    sourcePaths: n.source_paths ?? [],
    roles: n.roles ?? [],
    evidence: n.evidence ?? [],
    // A row's forwarded fields, on the node the row is about — an exhibit's
    // stance and locator, a statement's modality.
    properties: n.properties ?? {},
    groupValue: n.group_value ?? null,
    // The signed affinity vector. Separate from `groupValue`, which holds
    // whatever the panel grouped by — convergence reads this one only, so
    // "colour by role" can no longer be cosined into a confident nothing.
    profile: (n as { profile?: Record<string, number> | null }).profile ?? null,
  }));

  const edges: GraphEdge[] = (graph.edges ?? []).map((e, i) => ({
    id: `edge-${i}`,
    sourceId: e.source,
    targetId: e.target,
    predicate: e.predicate,
    role: e.role ?? null,
    weight: e.weight,
    // `edgeEpistemics` reads modality/stance from the forwarded properties and
    // falls back to the grouping value. Without these a denial paints like an
    // assertion, which manufactures the opposite claim.
    properties: e.properties ?? {},
    kind: (e as any).kind ?? 'relation',
    groupValue: e.group_value ?? null,
    t0: e.t0 ?? null,
    t1: e.t1 ?? null,
    a0: e.a0 ?? null,
    a1: e.a1 ?? null,
    sourcePaths: e.source_paths ?? [],
    annotationIds: e.source_annotation_ids ?? [],
    evidence: e.evidence ?? [],
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
    canonical: string;
    type: string;
    aliases?: string[];
    properties?: Record<string, any>;
  }>,
  triplets: Array<{
    id: number;
    predicate: string;
    // Triplet subject/object keep the LLM-facing ``canonical_name`` wire key
    // emitted by ``getCuratedTriplets`` — this is NOT a CanonEntry field read.
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
    label: entity.canonical,
    type: entity.type,
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