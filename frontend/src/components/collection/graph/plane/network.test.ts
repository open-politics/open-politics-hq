/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import {
  annotationsOf, assetCount, decodeNetwork, degree, findNodes, linksOf, neighbours, typeCounts,
  type NetworkWire,
} from './network';
import {
  hexToRgba, linkArrows, linkColors, pointColors, pointSizes, positionsById, seedPositions,
  visibility,
} from './channels';

/**
 *   Ann ─role─ Meeting ─role─ Bob        Ann ─works_for→ Acme
 *   (Meeting is an occurrence)            Rome: no links, geocoded
 */
const wire: NetworkWire = {
  nodes: {
    id: ['ann', 'bob', 'meet', 'acme', 'rome'],
    name: ['Ann', 'Bob', 'Meeting in Rome', 'Acme', 'Rome'],
    type: [0, 0, 1, 2, 3],
    kind: [0, 0, 1, 0, 0],
    frequency: [5, 2, 1, 3, 4],
    size: [null, null, null, 2, null],
    lat: [null, null, null, null, 41.9],
    lon: [null, null, null, null, 12.5],
    t0: [null, null, '2026-01-01', null, null],
    t1: [null, null, null, null, null],
    ann: { offsets: [0, 2, 3, 4, 5, 7], ids: [10, 11, 11, 11, 10, 11, 12] },
  },
  edges: {
    source: [0, 1, 0],
    target: [2, 2, 3],
    kind: [0, 0, 1],
    predicate: [0, 0, 1],
    weight: [1, 1, 3],
  },
  vocab: {
    type: ['Person', 'Meeting', 'Organization', 'Location'],
    edge_kind: ['role', 'relation'],
    predicate: ['participant', 'works_for'],
    node_kind: ['entity', 'occurrence'],
  },
  assets: { annotation: [10, 11, 12], asset: [100, 101, 101] },
  dropped_edges: 0,
  meta: { ms: 12, capped: false },
};

const net = decodeNetwork(wire);

describe('decodeNetwork', () => {
  test('a node is its index across every column', () => {
    expect(net.size).toBe(5);
    expect(net.links).toBe(3);
    expect(net.index.get('acme')).toBe(3);
    expect(net.types[net.type[3]]).toBe('Organization');
    expect(net.kinds[net.kind[2]]).toBe('occurrence');
    expect(net.lat[4]).toBeCloseTo(41.9);
    expect(Number.isNaN(net.lat[0])).toBe(true);
  });

  test('adjacency lists every link under both of its ends', () => {
    expect(degree(net, 0)).toBe(2);
    expect(degree(net, 2)).toBe(2);
    expect(degree(net, 4)).toBe(0);
    expect(neighbours(net, 0).sort()).toEqual([2, 3]);
    expect(neighbours(net, 2).sort()).toEqual([0, 1]);
    expect(linksOf(net, [2]).sort()).toEqual([0, 1]);
  });

  test('provenance leads back to annotations and their assets', () => {
    expect(annotationsOf(net, [0, 1]).sort()).toEqual([10, 11]);
    expect(assetCount(net, 4)).toBe(1);   // annotations 11 and 12, both asset 101
    expect(assetCount(net, 0)).toBe(2);
  });

  test('legend counts and search', () => {
    expect([...typeCounts(net)]).toEqual([2, 1, 1, 1]);
    expect(findNodes(net, 'rom')).toEqual([4, 2]);   // entity first, prefix first
    expect(findNodes(net, '  ')).toEqual([]);
  });
});

describe('channels', () => {
  const palette = { edge: [0.5, 0.5, 0.5, 1] as [number, number, number, number],
                    occurrence: [0.2, 0.2, 0.2, 1] as [number, number, number, number] };

  test('hex parsing', () => {
    expect(hexToRgba('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(hexToRgba('#0f0', 0.5)).toEqual([0, 1, 0, 0.5]);
    expect(hexToRgba('nonsense')).toEqual([0.6, 0.6, 0.6, 1]);
  });

  test('occurrences paint in the tissue tone; entities by type', () => {
    const c = pointColors(net, palette);
    expect(c.length).toBe(20);
    expect([...c.slice(8, 12)].map((v) => +v.toFixed(2))).toEqual([0.2, 0.2, 0.2, 1]);
    expect([...c.slice(0, 4)]).toEqual([...c.slice(4, 8)]);           // both Persons
  });

  test('occurrences stay small; the engine size hint scales', () => {
    const s = pointSizes(net);
    expect(s[2]).toBeLessThan(s[1]);
    expect(s[3]).toBeGreaterThan(pointSizes(decodeNetwork({
      ...wire, nodes: { ...wire.nodes, size: [null, null, null, null, null] },
    }))[3]);
  });

  test('links: relations carry an arrow and their predicate colour; cast recedes', () => {
    expect(linkArrows(net)).toEqual([false, false, true]);
    const lc = linkColors(net, palette);
    expect(lc[3]).toBeLessThan(lc[11]);                                // role alpha < relation alpha
  });

  test('seeding keeps known nodes where they were and puts new ones beside a neighbour', () => {
    const known = new Map<string, [number, number]>([['ann', [100, 200]]]);
    const seed = seedPositions(net, 4096, known);
    expect([seed[0], seed[1]]).toEqual([100, 200]);
    // Meeting is new and links to Ann: it starts within 20 units of her.
    expect(Math.hypot(seed[4] - 100, seed[5] - 200)).toBeLessThanOrEqual(20);
    expect([...seed].every(Number.isFinite)).toBe(true);
    // Deterministic: the same network seeds the same way.
    expect([...seedPositions(net, 4096)]).toEqual([...seedPositions(net, 4096)]);
    expect(positionsById(net, seed).get('ann')).toEqual([100, 200]);
  });

  test('hidden types are absent', () => {
    expect([...visibility(net, new Set(['Person']))]).toEqual([0, 0, 1, 1, 1]);
    expect([...visibility(net, new Set())]).toEqual([1, 1, 1, 1, 1]);
  });
});
