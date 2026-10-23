/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { decodeNetwork, type NetworkWire } from './network';
import { and, butNot, extent, foldAnnotations, or, strength, type Field } from './fields';
import { evaluateSets, type NodeSet, type SetWorld, type Term } from './sets';

/** Five nodes and the annotations each came from:
 *  ann [10, 11] · bob [11] · meet [12] · acme [] · rome [10, 12]. */
const wire: NetworkWire = {
  nodes: {
    id: ['ann', 'bob', 'meet', 'acme', 'rome'],
    name: ['Ann', 'Bob', 'Meeting', 'Acme', 'Rome'],
    type: [0, 0, 0, 0, 0],
    kind: [0, 0, 0, 0, 0],
    frequency: [1, 1, 1, 1, 1],
    size: [null, null, null, null, null],
    t0: [null, null, null, null, null],
    t1: [null, null, null, null, null],
    ann: { offsets: [0, 2, 3, 4, 4, 6], ids: [10, 11, 11, 12, 10, 12] },
    places: { offsets: [0, 0, 0, 0, 0, 0], coord: [], rung: [], from: [], to: [], end: [] },
  },
  edges: { source: [], target: [], kind: [], predicate: [], weight: [] },
  vocab: { type: ['Thing'], edge_kind: [], predicate: [], node_kind: ['entity'], rung: [], coord: [] },
  assets: { annotation: [10, 11, 12], asset: [1, 2, 3], time: [null, null, null] },
  dropped_edges: 0,
  meta: { ms: 0, capped: false },
};
const net = decodeNetwork(wire);
const f = (...v: number[]) => Float32Array.from(v);
const round = (a: Float32Array) => Array.from(a, (v) => (Number.isNaN(v) ? 'NaN' : Math.round(v * 1000) / 1000));

describe('fields', () => {
  test('folding means over the annotations that have a basis, and leaves the rest absent', () => {
    // 11 has no weight: ann averages 10 alone, bob has none, rome averages 10 and 12.
    const field = foldAnnotations(net, { ids: [10, 12], weights: [0.2, 0.8] });
    expect(round(field)).toEqual([0.2, 'NaN', 0.8, 'NaN', 0.5]);
  });

  test('and is unknown when any operand is', () => {
    expect(round(and(f(0.5, NaN, 1), f(0.5, 1, NaN)))).toEqual([0.25, 'NaN', 'NaN']);
  });

  test('or is the most of what is known, unknown only when all are', () => {
    expect(round(or(f(0.2, NaN, NaN), f(0.6, 0.3, NaN)))).toEqual([0.6, 0.3, 'NaN']);
  });

  test('but not leaves a where b is unknown', () => {
    expect(round(butNot(f(0.8, 0.8, NaN), f(0.5, NaN, 0.5)))).toEqual([0.4, 0.8, 'NaN']);
  });

  test('strength keeps unknown unknown, and at 0 makes a term neutral rather than empty', () => {
    expect(round(strength(f(0.5, NaN, 0), 2))).toEqual([0.25, 'NaN', 0]);
    expect(round(strength(f(0.5, NaN, 0), 0))).toEqual([1, 'NaN', 1]);
  });

  test('extent counts and spans only what has a basis', () => {
    expect(extent(f(NaN, 0.2, 0.9))).toEqual({ known: 2, lo: Math.fround(0.2), hi: Math.fround(0.9) });
    expect(extent(f(NaN)).known).toBe(0);
  });
});

describe('graded sets', () => {
  // A score per node (0…1) where its documents have one: ann .2, meet .8, rome .5.
  const score = foldAnnotations(net, { ids: [10, 12], weights: [0.2, 0.8] });
  const sentiment = foldAnnotations(net, { ids: [10, 11, 12], weights: [1, 0, 0.5] });
  const world = (fields: Record<string, Field>): SetWorld => ({
    net,
    groupMembers: () => undefined,
    valueAssets: () => new Set(),
    weights: (t: Term) => fields[t.field ?? ''],
  });
  const graded = (field: string, op: Term['op'] = '='): Term => ({ kind: 'value', op, values: [], field, measure: true });
  const run = (set: NodeSet, fields: Record<string, Field>) => evaluateSets([set], world(fields)).get(set.id)!;

  test('a graded term holds the nodes it can judge, a score at the floor included', () => {
    const low = foldAnnotations(net, { ids: [10, 12], weights: [0, 0.8] });
    const r = run({ id: 's', terms: [graded('score')] }, { score: low });
    expect(r.members.sort()).toEqual([0, 2, 4]); // ann scores 0 and stays in
    expect(round(r.weight!)).toEqual([0, 'NaN', 0.8, 'NaN', 0.4]);
  });

  test('two graded terms multiply, and a ≠ on one takes away by degree', () => {
    expect(round(run({ id: 's', terms: [graded('score'), graded('sentiment')] }, { score, sentiment }).weight!))
      .toEqual([0.2 * 0.5, 'NaN', 0.4, 'NaN', 0.375]);
    expect(round(run({ id: 's', terms: [graded('score'), graded('sentiment', '!')] }, { score, sentiment }).weight!))
      .toEqual([0.1, 'NaN', 0.4, 'NaN', 0.125]);
  });

  test('a plain set carries no weight, and a graded term still loading leaves the set pending', () => {
    expect(run({ id: 's', terms: [{ kind: 'name', op: '~', values: ['a'] }] }, {}).weight).toBeUndefined();
    expect(run({ id: 's', terms: [graded('missing')] }, {}).pending).toBe(true);
  });
});

describe('surfaces', () => {
  const { surfaceGrid, towardField } = require('./surface') as typeof import('./surface');
  // Three nodes on a line, all present in slice 0; the middle one also in slice 1.
  const pos = f(0, 10, 50, 10, 100, 10);
  const presence = {
    cells: [0, 1], bins: [], present: 3,
    offsets: Uint32Array.from([0, 1, 3, 4]), slice: Int32Array.from([0, 0, 1, 0]),
    count: Uint32Array.from([1, 1, 1, 1]), peak: Uint32Array.from([1, 1, 1]),
  };

  test('a node rises toward its value by the weight given, and one without a value stays', () => {
    const field = f(0, 1, NaN);
    const span = { lo: 0, hi: -40 };
    expect(Array.from(towardField(pos, field, span, 0))).toEqual(Array.from(pos));
    expect(round(towardField(pos, field, span, 1))).toEqual([0, 0, 50, -40, 100, 10]);
    expect(round(towardField(pos, field, span, 0.5))).toEqual([0, 5, 50, -15, 100, 10]);
  });

  test('the ground is the kernel mean of what stands near, and none where nothing does', () => {
    const g = surfaceGrid(pos, f(0, 1, NaN), presence, 0, 100, { cols: 11, width: 0.8, carry: 0 });
    const at = (r: number, c: number) => g.height[r * g.cols + c];
    expect(at(0, 0)).toBeCloseTo(0, 3); // over the 0
    expect(at(0, 5)).toBeCloseTo(1, 3); // over the 1
    expect(Number.isNaN(at(0, 10))).toBe(true); // the third node has no basis: no ground
    expect(Number.isNaN(at(1, 0))).toBe(true); // slice 1 holds only the middle node
    expect(at(1, 5)).toBeCloseTo(1, 3);
  });
});
