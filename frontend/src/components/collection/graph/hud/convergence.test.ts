/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { convergencePairs, interestImpact } from './convergence';
import type { GraphEdge, GraphNode } from '../graphTypes';

// `profile`, not `groupValue` — the affinity vector has its own field so that
// a panel grouping by roles cannot be cosined into a confident nothing.
const actor = (id: string, profile?: Record<string, number>): GraphNode =>
  ({ id, label: id, type: 'Person', kind: 'entity', profile: profile ?? null });
const occ = (id: string, o: Partial<GraphNode> = {}): GraphNode =>
  ({ id, label: id, type: 'Act', kind: 'occurrence', nodeType: 'Act', ...o });
const interest = (id: string): GraphNode =>
  ({ id, label: id, type: 'Interest', kind: 'entity' });
const link = (s: string, t: string, role: string): GraphEdge =>
  ({ id: `${s}-${t}-${role}`, sourceId: s, targetId: t, predicate: role, role });

describe('the convergence residual', () => {
  test('CO-ACTING actors score ZERO — sharing an act explains sharing its interest', () => {
    const nodes = [
      actor('A', { opacity: 10 }), actor('B', { opacity: 10 }),
      occ('o1'), interest('opacity'),
    ];
    const edges = [
      link('o1', 'A', 'actor'), link('o1', 'B', 'actor'),
      link('o1', 'opacity', 'serves'),
    ];
    // Identical profiles, but one hop apart: nothing to explain.
    expect(convergencePairs(nodes, edges, { minResidual: 0 })
      .find(p => p.residual > 0)).toBeUndefined();
  });

  test('UNCONNECTED actors with the same profile score the full similarity', () => {
    const nodes = [actor('A', { opacity: 10 }), actor('B', { opacity: 10 })];
    const [pair] = convergencePairs(nodes, [], { minResidual: 0 });
    expect(pair.hops).toBeNull();
    expect(pair.similarity).toBeCloseTo(1, 5);
    expect(pair.residual).toBeCloseTo(1, 5);   // no path at all = strongest form
    expect(pair.shared).toEqual(['opacity']);
  });

  test('the residual RISES with distance for the same alignment', () => {
    const build = (chain: number) => {
      const nodes: GraphNode[] = [actor('A', { opacity: 10 }), actor('B', { opacity: 10 })];
      const edges: GraphEdge[] = [];
      let prev = 'A';
      for (let i = 0; i < chain; i++) {
        const mid = `m${i}`;
        nodes.push(actor(mid));
        edges.push(link(mid, prev, 'x'));
        prev = mid;
      }
      // Close the chain onto B with a plain connection.
      edges.push({ id: 'last', sourceId: prev, targetId: 'B', predicate: 'x' });
      return { nodes, edges };
    };
    const near = build(1);   // A - m0 - B  => 2 hops
    const far = build(4);    // 5 hops
    const rNear = convergencePairs(near.nodes, near.edges, { minResidual: 0 })
      .find(p => p.a.id === 'A' && p.b.id === 'B')!;
    const rFar = convergencePairs(far.nodes, far.edges, { minResidual: 0 })
      .find(p => p.a.id === 'A' && p.b.id === 'B')!;
    expect(rNear.hops).toBe(2);
    expect(rFar.hops).toBe(5);
    expect(rFar.residual).toBeGreaterThan(rNear.residual);
  });

  test('disjoint interests never surface, however far apart', () => {
    const nodes = [actor('A', { opacity: 10 }), actor('B', { climate: 10 })];
    expect(convergencePairs(nodes, [], { minResidual: 0 })).toEqual([]);
  });

  test('actors without a profile are simply absent', () => {
    const nodes = [actor('A', { opacity: 1 }), actor('B')];
    expect(convergencePairs(nodes, [], { minResidual: 0 })).toEqual([]);
  });
});

describe('interest impact', () => {
  test('aggregates acts, actors, magnitude, span and places', () => {
    const nodes = [
      actor('A'), actor('B'), actor('C'), interest('opacity'),
      occ('o1', { magnitude: 40, t0: '2019-01-01', place: 'Valletta' }),
      occ('o2', { magnitude: 10, t0: '2021-06-01', place: 'Zurich' }),
    ];
    const edges = [
      link('o1', 'A', 'actor'), link('o1', 'B', 'actor'), link('o1', 'opacity', 'serves'),
      link('o2', 'A', 'actor'), link('o2', 'C', 'actor'), link('o2', 'opacity', 'serves'),
    ];
    const [row] = interestImpact(nodes, edges);
    expect(row.interest).toBe('opacity');
    expect(row.occurrences).toBe(2);
    expect(row.actors).toBe(3);          // A counted once across both acts
    expect(row.magnitude).toBe(50);
    expect(row.from).toBe('2019-01-01');
    expect(row.to).toBe('2021-06-01');
    expect(row.places).toBe(2);
  });

  test('a graph with no interests yields nothing rather than a zero row', () => {
    expect(interestImpact([actor('A'), occ('o1')], [link('o1', 'A', 'actor')])).toEqual([]);
  });
});
