/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { decodeNetwork, type NetworkWire } from './network';
import { and, butNot, extent, foldAnnotations, foldElements, foldMeaning, foldWeights, or, ranked, strength, type Field } from './fields';
import { describeTerm, evaluateSets, explainNode, reachRange, type NodeSet, type SetWorld, type Term } from './sets';

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

describe('strata', () => {
  const { bandsOf, strata } = require('./fields') as typeof import('./fields');
  test('a 1–10 scale is cut in pairs of its own steps, named in them', () => {
    const bands = bandsOf({ by: 'declared', min: 1, max: 10 });
    expect(bands.map((b) => b.label)).toEqual(['1–2', '3–4', '5–6', '7–8', '9–10']);
    // 1 → 0, 2 → 1/9; 9 → 8/9, 10 → 1: every score in exactly one band.
    const scores = f(0, 1 / 9, 2 / 9, 8 / 9, 1, NaN);
    expect(strata(scores, bands)).toEqual([2, 1, 0, 0, 2]);
    // Means between whole steps lie in a band, never between two.
    expect(strata(f(1.5 / 9, 3.5 / 9, 5.5 / 9), bands)).toEqual([1, 1, 1, 0, 0]);
  });
  test('a ranked field is cut in fifths of the run', () => {
    expect(bandsOf({ by: 'rank' }).map((b) => b.label)[4]).toBe('top fifth');
  });
  test('a band holds a graded set to its stratum', () => {
    const score = foldAnnotations(net, { ids: [10, 12], weights: [0.2, 0.8] }); // ann .2, meet .8, rome .5
    const world: SetWorld = { net, groupMembers: () => undefined, valueAssets: () => new Set(), weights: () => score };
    const r = evaluateSets([{ id: 'b', terms: [{ kind: 'value', op: '=', values: ['high'], field: 's', measure: true, range: [0.6, 1] }] }], world).get('b')!;
    expect(r.members).toEqual([2]);
  });
});

describe('scores that belong to entities', () => {
  test('an actor takes the score of the rows that name it, and nothing else does', () => {
    // Annotation 10 names Ann (0.9) and Rome (0.1); 12 names Ann again (0.5).
    const field = foldElements(net, { annotation: [10, 10, 12], name: ['ann', 'ROME', 'Ann'], weights: [0.9, 0.1, 0.5] });
    // ann: 10 → .9, 11 → nothing → .9 (12 is not ann's). rome: 10 → .1, 12 → nothing. Bob, Meeting, Acme: absent.
    expect(round(field)).toEqual([0.9, 'NaN', 'NaN', 'NaN', 0.1]);
  });
  test('with no element column, the document reading stands', () => {
    expect(round(foldWeights(net, { annotation: { ids: [11], weights: [0.4] } }))).toEqual([0.4, 0.4, 'NaN', 'NaN', 'NaN']);
  });
});

describe('why this node', () => {
  test('each term says its piece, and a term with no basis says nothing', () => {
    const score = foldAnnotations(net, { ids: [10, 12], weights: [0.2, 0.8] }); // ann .2, meet .8, rome .5, bob none
    const world: SetWorld = { net, groupMembers: () => undefined, valueAssets: () => new Set(), weights: () => score };
    const set: NodeSet = { id: 's', terms: [
      { kind: 'name', op: '~', values: ['e'] },                       // Meeting, Rome
      { kind: 'value', op: '=', values: [], field: 'x', measure: true },
    ] };
    const read = (i: number) => explainNode(set, i, world, () => undefined).map((r) => r.value);
    expect(read(2)).toEqual([1, Math.fround(0.8)]); // Meeting: matches, scores .8
    expect(read(1)).toEqual([0, null]);             // Bob: no 'e', no score
  });
});

describe('graded edits', () => {
  test('≠ a band takes that band away, and dropping a graded term leaves its neighbours', async () => {
    const { dropValue } = await import('./sets');
    const score = foldAnnotations(net, { ids: [10, 12], weights: [0.2, 0.8] }); // ann .2, meet .8, rome .5
    const world: SetWorld = { net, groupMembers: () => undefined, valueAssets: () => new Set(), weights: () => score };
    const band: Term = { kind: 'value', op: '!', values: ['high'], field: 's', measure: true, range: [0.6, 1] };
    const graded: Term = { kind: 'value', op: '=', values: [], field: 's', measure: true };
    const r = evaluateSets([{ id: 'b', terms: [graded, band] }], world).get('b')!;
    expect(r.members.sort()).toEqual([0, 4]); // Meeting (.8) is in the band and goes
    expect(round(r.weight!)).toEqual([0.2, 'NaN', 'NaN', 'NaN', 0.5]);
    const twoBands = { id: 'x', terms: [band, { ...band, op: '=' as const }] };
    expect(dropValue(twoBands, 0, 'high').terms).toEqual([{ ...band, op: '=' }]);
  });
  test('a plain set less a score leaves members no score can judge without a weight', () => {
    const score = foldAnnotations(net, { ids: [10], weights: [0.5] }); // ann .5, rome .5
    const world: SetWorld = { net, groupMembers: () => undefined, valueAssets: () => new Set(), weights: () => score };
    const less: Term = { kind: 'value', op: '!', values: [], field: 's', measure: true };
    const r = evaluateSets([{ id: 'p', terms: [{ kind: 'type', op: '=', values: ['Thing'] }, less] }], world).get('p')!;
    expect(round(r.weight!)).toEqual([0.5, 'NaN', 'NaN', 'NaN', 0.5]);
  });
});

describe('meaning', () => {
  // Context by annotation: 10 → .9, 12 → .1 (ann .9, meet .1, rome .5).
  // Said by name: Bob .2, Rome 1 — Ann, Meeting and Acme have no vector.
  const answer = {
    annotation: { ids: [10, 12], weights: [0.9, 0.1] },
    label: { names: ['Bob', 'Rome'], weights: [0.2, 1] },
  };

  test('two bases blend, and a node with one reads that one', () => {
    expect(round(foldMeaning(net, answer, 0.5))).toEqual([0.9, 0.2, 0.1, 'NaN', 0.75]);
  });

  test('at either end only that basis reads', () => {
    expect(round(foldMeaning(net, answer, 1))).toEqual([0.9, 'NaN', 0.1, 'NaN', 0.5]);  // documents alone
    expect(round(foldMeaning(net, answer, 0))).toEqual(['NaN', 0.2, 'NaN', 'NaN', 1]);  // names alone
  });

  test('ranked shares among the known, ties at their mean, absent kept', () => {
    expect(round(ranked(f(0.9, NaN, 0.1, 0.5, 0.5)))).toEqual([1, 'NaN', 0, 0.5, 0.5]);
    expect(round(ranked(f(NaN, 0.3)))).toEqual(['NaN', 1]);
  });

  test('a reach holds the closest share, ≈ ranks by meaning', () => {
    const near = ranked(foldMeaning(net, answer, 0.5)); // ann 1, bob .333, meet 0, rome .667
    const world: SetWorld = { net, groupMembers: () => undefined, valueAssets: () => new Set(), weights: () => near };
    const about: Term = { kind: 'about', op: '=', values: ['energy'], range: reachRange(0.5) };
    const r = evaluateSets([{ id: 'm', terms: [about] }], world).get('m')!;
    expect(r.members.sort()).toEqual([0, 4]);
    expect(describeTerm(about, (_, v) => v)).toBe('≈ energy, closest 50%');
  });

  test('strength raises a term, and at 0 a ≠ takes nothing away', () => {
    const w = f(0.5, 0.5, 0.5, 0.5, 0.5);
    const world: SetWorld = { net, groupMembers: () => undefined, valueAssets: () => new Set(), weights: () => w };
    const all: Term = { kind: 'type', op: '=', values: ['Thing'] };
    const weigh = (t: Term) => round(evaluateSets([{ id: 's', terms: [all, t] }], world).get('s')!.weight!)[0];
    expect(weigh({ kind: 'about', op: '=', values: ['x'], strength: 2 })).toBe(0.25);
    expect(weigh({ kind: 'about', op: '=', values: ['x'], strength: 0 })).toBe(1);
    expect(weigh({ kind: 'about', op: '!', values: ['x'] })).toBe(0.5);
    expect(weigh({ kind: 'about', op: '!', values: ['x'], strength: 0 })).toBe(1);
    expect(weigh({ kind: 'about', op: '!', values: ['x'], strength: 2 })).toBe(0.25);
    const why = explainNode({ id: 's', terms: [all, { kind: 'about', op: '=', values: ['x'], strength: 2 }] }, 0, world, () => undefined);
    expect(why.map((r) => r.value)).toEqual([1, 0.25]);
  });
});
