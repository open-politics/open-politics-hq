/**
 * The wire contract, pinned.
 *
 * These exist because the mapper silently dropped half the observation model
 * for an entire implementation cycle: `kind`, `places`, `magnitude`, `evidence`
 * and `role` were emitted by the backend, declared on `GraphNode`, read by the
 * HUD and the renderer — and never assigned. Every surface looked like a
 * backend that had not shipped yet.
 *
 * So the rule this file enforces is blunt: **every key the backend emits is
 * mapped**. A field added to `_node_to_dict` without a line here should fail.
 */
import { describe, expect, it } from 'bun:test';
import { viewGraphToGraphData } from './graphAdapters';
import { edgeEpistemics } from './graphTypes';

const OCCURRENCE = {
  id: 'occ1',
  name: '12:observations[*]:1',
  type: 'Payment',
  frequency: 3,
  source_annotation_ids: [12],
  kind: 'occurrence' as const,
  node_type: 'Payment',
  magnitude: 0,
  t0: '2014-03-02',
  t1: null,
  a0: '2014-01-01',
  a1: '2014-12-31',
  place: 'Valletta',
  place_to: 'Zurich',
  places: [
    { place: 'Valletta', lat: 35.9, lon: 14.5, from: '2011', to: null,
      kind: 'registered_office', source: 'attribute' as const, end: null },
    { place: 'Zurich', lat: 47.4, lon: 8.5, source: 'row' as const, end: 'to' as const },
  ],
  lat: 35.9,
  lon: 14.5,
  source_paths: ['document.observations[*]'],
  roles: ['payer'],
  evidence: [{ reasoning: 'stated in the filing', text_spans: [{ text_snippet: 'paid EUR 4m' }] }],
  group_value: { opacity: 8.2, financial_gain: 3.1 },
};

const EDGE = {
  source: 'occ1',
  target: 'bank1',
  predicate: 'via',
  role: 'via',
  weight: 340,
  computed_weight: 12.5,
  group_value: 'denies',
  properties: { modality: 'denies' },
  evidence: [{ reasoning: 'exhibit 4' }],
  t0: '2014-03-02',
  t1: null,
  a0: null,
  a1: null,
  source_paths: ['document.observations[*]'],
};

describe('viewGraphToGraphData', () => {
  it('carries every node field the backend emits', () => {
    const { nodes } = viewGraphToGraphData({ nodes: [OCCURRENCE as any], edges: [] });
    const n = nodes[0];

    expect(n.id).toBe('occ1');
    expect(n.label).toBe('12:observations[*]:1');   // wire key is `name`
    expect(n.type).toBe('Payment');
    expect(n.frequency).toBe(3);
    expect(n.annotationIds).toEqual([12]);
    expect(n.kind).toBe('occurrence');
    expect(n.nodeType).toBe('Payment');
    expect(n.t0).toBe('2014-03-02');
    expect(n.t1).toBeNull();
    expect(n.a0).toBe('2014-01-01');
    expect(n.a1).toBe('2014-12-31');
    expect(n.place).toBe('Valletta');
    expect(n.placeTo).toBe('Zurich');
    expect(n.lat).toBe(35.9);
    expect(n.lon).toBe(14.5);
    expect(n.sourcePaths).toEqual(['document.observations[*]']);
    expect(n.roles).toEqual(['payer']);
    expect(n.evidence).toHaveLength(1);
    expect(n.groupValue).toEqual({ opacity: 8.2, financial_gain: 3.1 });
  });

  it('keeps the whole place ladder, not just the first rung', () => {
    // Divergence — a Valletta seat against a Zurich trajectory end — is only
    // visible if both entries survive with their `source` and `kind`.
    const { nodes } = viewGraphToGraphData({ nodes: [OCCURRENCE as any], edges: [] });
    expect(nodes[0].places).toHaveLength(2);
    expect(nodes[0].places![0].source).toBe('attribute');
    expect(nodes[0].places![0].kind).toBe('registered_office');
    expect(nodes[0].places![1].end).toBe('to');
  });

  it('does not swallow a falsy magnitude', () => {
    // `||` would turn a zero-value act into "no magnitude at all".
    const { nodes } = viewGraphToGraphData({ nodes: [OCCURRENCE as any], edges: [] });
    expect(nodes[0].magnitude).toBe(0);
  });

  it('carries every edge field the backend emits', () => {
    const { edges } = viewGraphToGraphData({ nodes: [], edges: [EDGE as any] });
    const e = edges[0];

    expect(e.sourceId).toBe('occ1');
    expect(e.targetId).toBe('bank1');
    expect(e.predicate).toBe('via');
    expect(e.role).toBe('via');
    expect(e.weight).toBe(340);
    expect(e.properties).toEqual({ modality: 'denies' });
    expect(e.groupValue).toBe('denies');
    expect(e.evidence).toHaveLength(1);
    expect(e.t0).toBe('2014-03-02');
    expect(e.sourcePaths).toEqual(['document.observations[*]']);
  });

  it('feeds epistemic painting, so a denial does not read as an assertion', () => {
    const { edges } = viewGraphToGraphData({ nodes: [], edges: [EDGE as any] });
    expect(edgeEpistemics(edges[0]).stance).toBe('negated');
  });

  it('paints from the grouping value when no property carries modality', () => {
    const bare = { ...EDGE, properties: {} };
    const { edges } = viewGraphToGraphData({ nodes: [], edges: [bare as any] });
    expect(edgeEpistemics(edges[0]).stance).toBe('negated');
  });

  it('defaults a pre-observation-model payload to entity', () => {
    const legacy = {
      id: 'a', name: 'Alice', type: 'Person', frequency: 1,
      source_annotation_ids: [1],
    };
    const { nodes } = viewGraphToGraphData({ nodes: [legacy as any], edges: [] });
    expect(nodes[0].kind).toBe('entity');
    expect(nodes[0].places).toEqual([]);
    expect(nodes[0].evidence).toEqual([]);
    expect(nodes[0].magnitude).toBeNull();
  });

  it('tolerates an empty graph', () => {
    expect(viewGraphToGraphData({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });
});
