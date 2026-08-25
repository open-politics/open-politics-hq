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

describe('convergence — affinity and contact, separately', () => {
  test('CO-ACTING actors still score full alignment; the DISTANCE is what says so', () => {
    const nodes = [
      actor('A', { opacity: 10 }), actor('B', { opacity: 10 }),
      occ('o1'), interest('opacity'),
    ];
    const edges = [
      link('o1', 'A', 'actor'), link('o1', 'B', 'actor'),
      link('o1', 'opacity', 'serves'),
    ];
    // Identical profiles one hop apart. The old code multiplied this to zero
    // and dropped it, which conflated "not aligned" with "aligned for an
    // obvious reason" — two different findings.
    const [pair] = convergencePairs(nodes, edges, { minSimilarity: 0 });
    expect(pair.similarity).toBeCloseTo(1, 5);
    expect(pair.hops).toBe(1);
    // …and `minContact` is what excludes it, as a set difference.
    expect(convergencePairs(nodes, edges, { minSimilarity: 0, minContact: 2 }))
      .toEqual([]);
  });

  test('a shared interest puts two actors at TWO hops — the old 0.5 ceiling', () => {
    // This is the arithmetic that made `converge>0.6` empty in every document
    // that used it as the worked example: affinity 1.0 × penalty(2) = 0.5.
    // Nothing could ever exceed it. Now the similarity is reported whole.
    const nodes = [
      actor('A', { opacity: 10 }), actor('B', { opacity: 10 }),
      occ('o1'), occ('o2'), interest('opacity'),
    ];
    const edges = [
      link('o1', 'A', 'actor'), link('o1', 'opacity', 'serves'),
      link('o2', 'B', 'actor'), link('o2', 'opacity', 'serves'),
    ];
    const [pair] = convergencePairs(nodes, edges, { minSimilarity: 0.6 });
    expect(pair.similarity).toBeCloseTo(1, 5);
  });

  test('UNCONNECTED actors with the same profile pass every contact floor', () => {
    const nodes = [actor('A', { opacity: 10 }), actor('B', { opacity: 10 })];
    const [pair] = convergencePairs(nodes, [], { minSimilarity: 0, minContact: 99 });
    expect(pair.hops).toBeNull();          // no path at all = strongest form
    expect(pair.similarity).toBeCloseTo(1, 5);
    expect(pair.shared).toEqual(['opacity']);
  });

  test('contact is measured in actor hops, and filters as a floor', () => {
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
    const pick = (g: { nodes: GraphNode[]; edges: GraphEdge[] }, minContact = 0) =>
      convergencePairs(g.nodes, g.edges, { minSimilarity: 0, minContact })
        .find(p => p.a.id === 'A' && p.b.id === 'B');
    expect(pick(near)!.hops).toBe(2);
    expect(pick(far)!.hops).toBe(5);
    // Same alignment either way — the pair is selected on distance alone.
    expect(pick(near)!.similarity).toBeCloseTo(pick(far)!.similarity, 5);
    expect(pick(near, 3)).toBeUndefined();
    expect(pick(far, 3)!.hops).toBe(5);
  });

  test('the farther pair ranks first when alignment ties', () => {
    const nodes = [
      actor('A', { opacity: 10 }), actor('B', { opacity: 10 }),
      actor('C', { opacity: 10 }),
    ];
    // A—B adjacent; C floats free. All three profiles identical.
    const edges = [link('A', 'B', 'x')];
    const ranked = convergencePairs(nodes, edges, { minSimilarity: 0 });
    expect(ranked[0].hops).toBeNull();
    expect(ranked[ranked.length - 1].hops).toBe(1);
  });

  test('disjoint interests never surface, however far apart', () => {
    const nodes = [actor('A', { opacity: 10 }), actor('B', { climate: 10 })];
    expect(convergencePairs(nodes, [], { minSimilarity: 0.01 })).toEqual([]);
  });

  test('actors without a profile are simply absent', () => {
    const nodes = [actor('A', { opacity: 1 }), actor('B')];
    expect(convergencePairs(nodes, [], { minSimilarity: 0 })).toEqual([]);
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
