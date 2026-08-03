/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { collapseOccurrences, inferOccurrenceView, edgeEpistemics,
         type GraphNode, type GraphEdge } from
  './graphTypes';

const occ = (id: string, t0: string, mag?: number): GraphNode =>
  ({ id, label: id, type: 'Payment', kind: 'occurrence', nodeType: 'Payment',
     magnitude: mag ?? null, t0, t1: null });
const ent = (id: string): GraphNode =>
  ({ id, label: id, type: 'Organization', kind: 'entity' });
const link = (o: string, p: string, role: string): GraphEdge =>
  ({ id: `${o}-${p}`, sourceId: o, targetId: p, predicate: role, role });

describe('collapse', () => {
  test('folds two payments between one pair into ONE edge that admits it is two', () => {
    const nodes = [ent('A'), ent('B'), occ('p1', '2019-03-04', 40000),
                   occ('p2', '2023-07-11', 15000)];
    const edges = [link('p1','A','payer'), link('p1','B','payee'),
                   link('p2','A','payer'), link('p2','B','payee')];
    const r = collapseOccurrences(nodes, edges);
    expect(r.nodes.map(n => n.id).sort()).toEqual(['A','B']);
    expect(r.edges.length).toBe(1);
    const e = r.edges[0];
    expect(e.occurrenceCount).toBe(2);                 // <- must be surfaceable
    expect(e.t0).toBe('2019-03-04');
    expect(e.weight).toBe(55000);
    expect(e.occurrences.map(o => o.id).sort()).toEqual(['p1','p2']);
    expect([e.sourceRole, e.targetRole]).toEqual(['payer','payee']);
  });

  test('five passengers fold to ten pairs — which is why manifests stay bipartite', () => {
    const pax = ['E1','E2','E3','E4','E5'];
    const nodes = [...pax.map(ent), occ('N1', '1999-04-12')];
    const edges = pax.map(p => link('N1', p, 'on_board'));
    expect(collapseOccurrences(nodes, edges).edges.length).toBe(10);
    expect(inferOccurrenceView(nodes, edges)).toBe('bipartite');
  });

  test('two-participant rows with a magnitude default to collapsed', () => {
    const nodes = [ent('A'), ent('B'), occ('p1','2019-01-01',10), occ('p2','2020-01-01',20)];
    const edges = [link('p1','A','payer'), link('p1','B','payee'),
                   link('p2','A','payer'), link('p2','B','payee')];
    expect(inferOccurrenceView(nodes, edges)).toBe('collapsed');
  });

  test('a graph with no occurrences is returned untouched', () => {
    const nodes = [ent('A'), ent('B')];
    const edges = [{ id:'e', sourceId:'A', targetId:'B', predicate:'works_for' }];
    const r = collapseOccurrences(nodes, edges as GraphEdge[]);
    expect(r.nodes).toBe(nodes);
    expect(r.edges.length).toBe(1);
  });
});

describe('epistemics', () => {
  const e = (props: any): GraphEdge =>
    ({ id:'x', sourceId:'a', targetId:'b', predicate:'p', properties: props });
  test('a denial is dashed but at FULL opacity — a strong claim, not a weak one', () => {
    const d = edgeEpistemics(e({ modality: 'denies' }));
    expect(d.stance).toBe('negated');
    expect(d.dash).not.toBeNull();
    expect(d.alpha).toBe(1);
  });
  test('does_not_recall is unresolved, not negated', () => {
    expect(edgeEpistemics(e({ modality: 'does_not_recall' })).stance).toBe('unresolved');
    expect(edgeEpistemics(e({ modality: 'does_not_recall' })).alpha).toBeLessThan(1);
  });
  test('retraction is corrective; unknown terms read as plainly asserted', () => {
    expect(edgeEpistemics(e({ stance: 'retracts' })).stance).toBe('corrective');
    expect(edgeEpistemics(e({ modality: 'harrumphs' })).stance).toBe('asserted');
    expect(edgeEpistemics(e({})).dash).toBeNull();
  });
});
