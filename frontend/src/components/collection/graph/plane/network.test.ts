/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import {
  annotationsOf, assetCount, decodeNetwork, degree, findNodes, linksOf, neighbours, placesOf,
  publishedAt, typeCounts,
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
    t0: [null, null, '2026-01-01', null, null],
    t1: [null, null, null, null, null],
    ann: { offsets: [0, 2, 3, 4, 5, 7], ids: [10, 11, 11, 11, 10, 11, 12] },
    // Meeting: stated in Rome. Rome: its own canon coords. Acme: seated in
    // Paris, documented in Rome.
    places: {
      offsets: [0, 0, 0, 1, 3, 4],
      coord: [0, 1, 0, 0],
      rung: [0, 1, 2, 3],
      from: [null, '2020-01-01', null, null],
      to: [null, null, null, null],
      end: [0, 0, 0, 0],
    },
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
    rung: ['row', 'attribute', 'doc', 'canon'],
    coord: [[41.9, 12.5, 'Rome'], [48.86, 2.35, 'Paris']],
  },
  assets: { annotation: [10, 11, 12], asset: [100, 101, 101], time: [1_700_000_000, 1_600_000_000, 1_600_000_000] },
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
    expect([...net.members]).toEqual([1, 1, 1, 1, 1]);
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
    // Ann: annotations 10 (asset 100, 2023) and 11 (asset 101, 2020).
    expect(publishedAt(net, 0)).toBe(1_600_000_000_000);
  });

  test('places decode into the ladder\'s shape', () => {
    expect(placesOf(net, 0)).toEqual([]);
    expect(placesOf(net, 3).map((p) => [p.place, p.source, p.from])).toEqual([
      ['Paris', 'attribute', '2020-01-01'], ['Rome', 'doc', null],
    ]);
    expect(placesOf(net, 4)[0]).toMatchObject({ place: 'Rome', lat: expect.closeTo(41.9, 3), source: 'canon' });
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

// ─── Groups, collapse, arrangements ─────────────────────────────────────────
import { canonicalKey, groupPath, groupsAt, louvain, topLevel, topRanks } from './communities';
import { collapse, expandedKeys, expansionOf, groupId, headsOf, identity, inheritFrom, membersOf } from './collapse';
import { byGroups, byPlace, byTime, cellOf, fromSpace, parseTime, robustExtent, toSpace } from './arrange';

/** Two cliques of four joined by one bridge, and a loner. */
function twoCliques() {
  const ids = ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3', 'z'];
  const s: number[] = [], t: number[] = [];
  for (const g of [0, 4]) for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) { s.push(g + x); t.push(g + y); }
  s.push(3); t.push(4);
  const n = ids.length;
  return decodeNetwork({
    ...wire,
    nodes: {
      id: ids, name: ids.map((x) => x.toUpperCase()), type: new Array(n).fill(0), kind: new Array(n).fill(0),
      frequency: ids.map((_, i) => 10 - i), size: new Array(n).fill(null),
      t0: ['2026-01-02', '2026-01-03', '2026-02-01', null, '2026-03-01', '2026-03-02', '1580', '2026-03-03', '2026-03-04'],
      t1: new Array(n).fill(null),
      ann: { offsets: [...Array(n + 1).keys()], ids: ids.map((_, i) => 100 + i) },
      places: { offsets: [0, 1, 1, 1, 1, 2, 2, 2, 2, 2], coord: [0, 1], rung: [0, 2], from: [null, null], to: [null, null], end: [0, 0] },
    },
    edges: { source: s, target: t, kind: s.map(() => 0), predicate: s.map(() => 0), weight: s.map(() => 1) },
    assets: { annotation: [], asset: [], time: [] },
  });
}

describe('louvain', () => {
  const g = twoCliques();
  const c = louvain(g);

  test('finds the two cliques, and leaves the loner alone', () => {
    const top = c.levels[topLevel(c)];
    expect(new Set([0, 1, 2, 3].map((i) => top[i])).size).toBe(1);
    expect(new Set([4, 5, 6, 7].map((i) => top[i])).size).toBe(1);
    expect(top[0]).not.toBe(top[4]);
    expect(c.sizes[topLevel(c)][top[8]]).toBe(1);
  });

  test('groups carry their members and are named by them', () => {
    const groups = groupsAt(g, c, topLevel(c), 3);
    expect(groups.map((x) => x.size)).toEqual([4, 4]);
    expect(groups[0].label).toBe('A0 · A1 · A2');
    expect(groupPath(c, 0, 3)).toEqual([groups[0].key]);
    expect(groupPath(c, 8, 3)).toEqual([]);
    expect(canonicalKey(c, topLevel(c), 0)).toBe(groups[0].key);
    expect([...topRanks(g, c, 3)]).toEqual([0, 0, 0, 0, 1, 1, 1, 1, -1]);
  });
});

describe('collapse', () => {
  const g = twoCliques();
  const c = louvain(g);
  const [ga, gb] = groupsAt(g, c, topLevel(c), 3);

  test('a group is one node, with its members behind it', () => {
    const v = collapse(g, c, new Set());
    expect(v.net.size).toBe(3);                          // two groups and the loner
    const u = v.net.index.get(groupId('a0'))!;           // named by its head
    expect(membersOf(v, u).sort()).toEqual([0, 1, 2, 3]);
    expect(v.net.members[u]).toBe(4);
    expect(v.net.name[u]).toBe('A0 · A1 · A2');
    expect(v.net.links).toBe(1);                         // the bridge, folded
    expect(v.net.annIds.length).toBe(9);                 // every document stays reachable
    expect(v.net.t0[u]).toBe('2026-01-02');
  });

  test('expanding a group shows its members; the rest stays folded', () => {
    const v = collapse(g, c, new Set([ga.key]));
    expect(v.net.size).toBe(4 + 1 + 1);
    expect(v.net.index.has('a0')).toBe(true);
    expect(v.net.index.has(groupId('b0'))).toBe(true);
    // a3 → group b: one folded link, plus the clique's own six.
    expect(v.net.links).toBe(7);
    // Members inherit the group's place; a collapsing group its members'.
    const heads = headsOf(g, c);
    const inherit = inheritFrom(v, c, heads);
    expect(inherit(v.net.index.get('a1')!)).toEqual([[groupId('a0')]]);
    const back = collapse(g, c, new Set());
    expect(inheritFrom(back, c, heads)(back.net.index.get(groupId('a0'))!)[0].sort()).toEqual(['a0', 'a1', 'a2', 'a3']);
    // Leaving the groups view: every node starts where its group was.
    expect(inheritFrom(identity(g), c, heads)(5)).toEqual([[groupId('b0')]]);
  });

  test('what is expanded survives re-clustering, by head and depth', () => {
    const folded = collapse(g, c, new Set());
    const e = expansionOf(folded, c, ga.key)!;
    expect(e).toEqual({ head: 'a0', depth: 0 });
    const again = louvain(g);                            // a fresh partition
    expect([...expandedKeys(g, again, [e])]).toEqual([groupPath(again, 0, 3)[0]]);
    expect([...expandedKeys(g, again, [{ head: 'gone', depth: 0 }])]).toEqual([]);
  });

  test('identity is the network itself', () => {
    const v = identity(g);
    expect(v.net).toBe(g);
    expect(membersOf(v, 5)).toEqual([5]);
  });
});

describe('arrangements', () => {
  const g = twoCliques();

  test('groups pull members together; loners float', () => {
    const a = byGroups(g, (i) => (i < 4 ? 0 : i < 8 ? 1 : -1));
    expect(a.clusters.slice(0, 9)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, undefined]);
    expect(a.strength[8]).toBe(0);
  });

  test('time: robust extent, cells, columns left to right', () => {
    expect(parseTime('2024')).toBe(Date.UTC(2024, 0, 1));
    expect(parseTime('2024-03')).toBe(Date.UTC(2024, 2, 1));
    expect(parseTime('soon')).toBeNaN();
    expect(cellOf(Date.UTC(2026, 2, 4, 15), 'week')).toBe(Date.UTC(2026, 2, 2));   // a Monday
    const times = Float64Array.from(g.t0, parseTime);
    const ext = robustExtent(times)!;
    expect(ext[0]).toBeGreaterThan(Date.UTC(2000, 0, 1));                         // 1580 is outside
    const tl = byTime(g, times, 4096, 'month');
    expect(tl.undated).toBe(1);
    expect(tl.bins.map((b) => b.n)).toEqual([2, 1, 4]);                            // jan, feb, mar
    expect(tl.outside).toBe(1);
    const x = (i: number) => tl.arrangement.targets![2 * i];
    expect(x(0)).toBeLessThan(x(2));
    expect(x(2)).toBeLessThan(x(4));
    expect(tl.arrangement.key).toBe('time:month');
  });

  test('place: the ladder decides; unplaced neighbours come along, the rest leave', () => {
    // a0 stated in Rome (row); b0 documented in Paris (doc).
    const strict = byPlace(g, 'strict', 4096);
    expect(strict.coord[0]).toBe(0);
    expect(strict.coord[4]).toBe(-1);                    // a document's subject is not a stated site
    const stated = byPlace(g, 'stated', 4096);
    expect(stated.coord[4]).toBe(1);
    expect(stated.weight[0]).toBeGreaterThan(stated.weight[4]);
    expect(stated.arrangement.include![1]).toBe(1);      // a1 — a neighbour of a0
    expect(stated.arrangement.include![8]).toBe(0);      // the loner, unplaced
    expect(stated.places.map((p) => p.name)).toEqual(['Rome', 'Paris']);
    const [x, y] = toSpace(41.9, 12.5, 4096);
    const [lat, lon] = fromSpace(x, y, 4096);
    expect(lat).toBeCloseTo(41.9, 4);
    expect(lon).toBeCloseTo(12.5, 4);
    expect(toSpace(60, 0, 4096)[1]).toBeGreaterThan(toSpace(10, 0, 4096)[1]);    // north is up
  });
});

describe('merge', () => {
  const { merge, keyIndex, nodeKey } = require('./merge') as typeof import('./merge');
  const g = twoCliques();

  test('a merge folds two nodes into the kept one, documents and all', () => {
    const v = merge(g, [{ id: 1, a: { name: 'A3', type: 'Person' }, b: { name: 'B0', type: 'Person' }, keep: 'b', type: 'Organization' }]);
    expect(v.net.size).toBe(8);
    const u = v.net.index.get('b0')!;                    // the kept node's id
    expect(v.net.name[u]).toBe('B0');
    expect(v.net.types[v.net.type[u]]).toBe('Organization');
    expect(v.net.members[u]).toBe(1);                    // one entity, not a group
    expect(v.net.frequency[u]).toBe(g.frequency[3] + g.frequency[4]);
    expect(Array.from(v.net.annIds.subarray(v.net.annOffsets[u], v.net.annOffsets[u + 1])).sort()).toEqual([103, 104]);
    expect(v.net.links).toBe(g.links - 1);              // the bridge between them is inside the merge now
    expect(v.unitOf[3]).toBe(v.unitOf[4]);
  });

  test('chains compose; unknown labels change nothing', () => {
    const v = merge(g, [
      { id: 1, a: { name: 'A0', type: 'Person' }, b: { name: 'A1', type: 'Person' }, keep: 'a' },
      { id: 2, a: { name: 'A1', type: 'Person' }, b: { name: 'A2', type: 'Person' }, keep: 'a' },
    ]);
    expect(v.unitOf[0]).toBe(v.unitOf[2]);
    expect(v.net.size).toBe(7);
    expect(merge(g, [{ id: 3, a: { name: 'Nobody', type: 'Person' }, b: { name: 'A0', type: 'Person' } }]).net).toBe(g);
    expect(keyIndex(g).get(nodeKey(' a0 ', 'PERSON'))).toBe(0);
  });
});

describe('time deck', () => {
  test('the present is lit, what is ahead fades, what is behind goes', async () => {
    const { sliceAlpha } = await import('./deck');
    expect(sliceAlpha(3, 3, 0)).toBe(1);
    expect(sliceAlpha(4, 3, 1)).toBe(1);                       // inside a two-slice present
    const ahead = [5, 6, 9].map((k) => sliceAlpha(k, 3, 1));
    expect(ahead[0]).toBeLessThan(0.5);
    expect(ahead[1]).toBeLessThan(ahead[0]);
    expect(ahead[2]).toBeLessThan(ahead[1]);
    expect(sliceAlpha(2, 3, 0)).toBe(0);                       // a slice behind is gone
    expect(sliceAlpha(2.6, 3, 0)).toBeGreaterThan(0);          // … but fades on the way
  });

  test('with a cut, its slice is lit, the window steps back, the past stays a trace', async () => {
    const { cutAlpha } = await import('./deck');
    // A window over slices 3–5, cut at 4.
    expect(cutAlpha(4, 3, 2, 4)).toBe(1);
    expect(cutAlpha(3, 3, 2, 4)).toBe(0.5);
    expect(cutAlpha(5, 3, 2, 4)).toBe(0.5);
    const past = [2, 1].map((k) => cutAlpha(k, 3, 2, 4));
    expect(past[0]).toBeGreaterThan(0);
    expect(past[0]).toBeLessThan(0.3);
    expect(past[1]).toBeLessThan(past[0]);
    expect(cutAlpha(7, 3, 2, 4)).toBeLessThan(0.5);
    expect(cutAlpha(4.5, 3, 2, 4.5)).toBe(1);                 // the cut glides
  });
});

describe('presence', () => {
  test('as published, a node is wherever its documents are — once per document', async () => {
    const { presenceOf } = await import('./presence');
    // Asset 101 is 2020, asset 100 is 2023.
    const p = presenceOf(net, 'published', 'year');
    expect(p.cells).toEqual([Date.UTC(2020, 0, 1), Date.UTC(2023, 0, 1)]);
    const at = (i: number) => [...p.slice.slice(p.offsets[i], p.offsets[i + 1])];
    expect(at(0)).toEqual([0, 1]);                             // Ann: both years
    expect(at(3)).toEqual([1]);                                // Acme: 2023
    expect(at(4)).toEqual([0]);                                // Rome: two annotations, one document
    expect(p.count[p.offsets[4]]).toBe(1);
    expect(p.bins.map((b) => b.n)).toEqual([4, 2]);
    expect(p.present).toBe(5);
  });

  test('as stated, an actor is there when what it takes part in happens', async () => {
    const { presenceOf } = await import('./presence');
    // Only the meeting states a time (2026); Ann and Bob take part in it.
    const p = presenceOf(net, 'stated', 'year');
    expect(p.cells).toEqual([Date.UTC(2026, 0, 1)]);
    const present = [0, 1, 2, 3, 4].filter((i) => p.offsets[i + 1] > p.offsets[i]);
    expect(present).toEqual([0, 1, 2]);
  });

  test('a window holds whoever is there in it, loudest first', async () => {
    const { presenceOf, presentIn, sliceSpan } = await import('./presence');
    const p = presenceOf(net, 'published', 'year');
    expect(sliceSpan(p.cells, [Date.UTC(2023, 0, 1), Date.UTC(2023, 0, 1)], 'year')).toEqual([1, 1]);
    expect(sliceSpan(p.cells, [Date.UTC(2021, 0, 1), Date.UTC(2022, 0, 1)], 'year')).toEqual([-1, -1]);
    expect(presentIn(p, 1, 1, null).sort()).toEqual([0, 3]);
    expect(presentIn(p, 0, 1, Uint8Array.from([1, 1, 1, 0, 1])).includes(3)).toBe(false);
  });
});

describe('space-time cube', () => {
  // ann (entity) at 0, 1, 2 · bob (entity) at 2 · meet (occurrence) at 1 ·
  // acme (entity) at 0, 1 · rome never. Links: ann–meet, bob–meet, ann–acme.
  const presence = (() => {
    const lists: Array<Array<[number, number]>> = [[[0, 1], [1, 3], [2, 1]], [[2, 1]], [[1, 1]], [[0, 2], [1, 1]], []];
    const offsets = new Uint32Array(6);
    lists.forEach((l, i) => { offsets[i + 1] = offsets[i] + l.length; });
    const flat = lists.flat();
    return {
      cells: [0, 1, 2], bins: [], offsets, present: 4,
      slice: Int32Array.from(flat.map(([k]) => k)), count: Uint32Array.from(flat.map(([, m]) => m)),
      peak: Uint32Array.from(lists.map((l) => Math.max(0, ...l.map(([, m]) => m)))),
    };
  })();

  test('actors are threads, relations lie flat where both ends are there, the rest stream', async () => {
    const { deckSlices } = await import('./deck');
    const d = deckSlices(net, presence, null);
    expect(d.nodes).toEqual([[0, 3], [0, 2, 3], [0, 1]]);
    expect(d.loud[1]).toEqual([3, 1, 1]);
    expect(d.threads).toEqual([[0, 3], [0], []]);              // the meeting is a point
    expect(d.flat[0]).toEqual([2]);                            // ann–acme, at 0 and 1
    expect(d.flat[1].sort()).toEqual([0, 2]);                  // ann–meet at 1
    expect(d.streams[1]).toEqual([1]);                         // bob (2) and the meeting (1) never meet
    expect([d.span[2], d.span[3]]).toEqual([2, 1]);
    expect(d.named[1]).toEqual([0, 3]);                        // loudest first; occurrences unnamed
    expect([...d.first]).toEqual([0, 2, 1, 0, -1]);
    expect(d.drawn).toEqual([0, 1, 2, 3]);
    const hidden = deckSlices(net, presence, Uint8Array.from([1, 1, 1, 0, 1]));
    expect(hidden.flat[0]).toEqual([]);
    expect(hidden.threads[0]).toEqual([0]);
  });

  test('change at the present: threads that begin, threads gone quiet', async () => {
    const { deckSlices, deckChange } = await import('./deck');
    const d = deckSlices(net, presence, null);
    expect(deckChange(d, 0).onset.sort()).toEqual([0, 3]);
    expect(deckChange(d, 2)).toEqual({ onset: [], quiet: [3] });   // acme ran 0–1, not at 2
    expect(deckChange(d, 1).quiet).toEqual([]);
    expect(deckChange(d, 5)).toEqual({ onset: [], quiet: [] });
  });

  test('the cut marks where streams pass through it; the plate holds everything drawn', async () => {
    const { deckSlices, deckCrossings, deckExtent } = await import('./deck');
    const d = deckSlices(net, presence, null);
    const pos = Float32Array.from([0, 0, 10, 10, 4, 4, 20, 0, 0, 0]);
    const at = deckCrossings(net, d, pos, 1.5);
    // bob (10, 10) at 2 → meeting (4, 4) at 1: halfway at 1.5.
    expect([...at]).toEqual([7, 7, 1]);
    expect(deckCrossings(net, d, pos, 1).length).toBe(0);      // on a slice is in it, not through it
    const box = deckExtent(pos, d.drawn)!;
    expect(box[0]).toBeLessThan(0);
    expect(box[2]).toBeGreaterThan(20);
  });
});

describe('gain', () => {
  test('a type, an entity and its sub-network, composed in stops', async () => {
    const { gainStops, GAIN_STOPS } = await import('./gain');
    // ann —works_for→ acme; ann and bob both in the meeting.
    const stops = gainStops(net, [
      { kind: 'node', key: 'ann', value: 1 },
      { kind: 'type', key: net.types[net.type[net.index.get('acme')!]], value: 0.5 },
    ], () => null);
    const at = (id: string) => stops[net.index.get(id)!];
    expect(at('ann')).toBe(GAIN_STOPS);
    expect(at('acme')).toBeCloseTo(GAIN_STOPS * 0.6 + GAIN_STOPS * 0.5);   // her neighbour, and its type up
    expect(at('rome')).toBe(0);                                             // unlinked, untyped by the gain
  });

  test('once anything is up, the rest flattens and fades', async () => {
    const { applyGain } = await import('./gain');
    const sizes = Float32Array.from([10, 20, 3, 8, 6]);
    const colors = new Float32Array(20).fill(1);
    const linkColors = new Float32Array(net.links * 4).fill(1);
    applyGain(net, Float32Array.from([2, 0, 0, -2, 0]), { sizes, colors, linkColors });
    expect(sizes[0]).toBeCloseTo(20);                    // ×2 at two stops up
    expect(sizes[1]).toBeCloseTo(3 + 17 * 0.4);          // a hub, flattened
    expect(colors[4 * 1 + 3]).toBeCloseTo(0.4);
    expect(colors[4 * 3 + 3]).toBeLessThan(0.4);         // turned down: fainter still
  });

  test('setGain drops a gain back at zero', async () => {
    const { setGain } = await import('./gain');
    const g = setGain([], 'type', 'Person', 0.5);
    expect(g).toEqual([{ kind: 'type', key: 'Person', value: 0.5 }]);
    expect(setGain(g, 'type', 'Person', 0)).toEqual([]);
  });
});

describe('sets', () => {
  const ids = (xs: readonly number[]) => xs.map((i) => net.id[i]).sort();
  const world = async (assets: Record<string, number[]> = {}) => {
    const { evaluateSets } = await import('./sets');
    return (sets: import('./sets').NodeSet[]) => evaluateSets(sets, {
      net,
      groupMembers: (key) => (key === 'g' ? [0, 1] : undefined),
      valueAssets: (t) => (t.values[0] in assets ? new Set(assets[t.values[0]]) : undefined),
    });
  };

  test('values are alternatives, terms narrow, ≠ takes away', async () => {
    const run = await world();
    const r = run([
      { id: 'a', terms: [{ kind: 'type', op: '=', values: ['person', 'Organization'] }] },
      { id: 'b', terms: [{ kind: 'type', op: '=', values: ['Person'] }, { kind: 'name', op: '~', values: ['an'] }] },
      { id: 'c', terms: [{ kind: 'type', op: '!', values: ['Person'] }] },
      { id: 'd', terms: [] },
    ]);
    expect(ids(r.get('a')!.members)).toEqual(['acme', 'ann', 'bob']);
    expect(ids(r.get('b')!.members)).toEqual(['ann']);
    expect(ids(r.get('c')!.members)).toEqual(['acme', 'meet', 'rome']);
    expect(r.get('d')!.members).toEqual([]);
    // Most frequent first.
    expect(r.get('a')!.members.map((i) => net.id[i])).toEqual(['ann', 'acme', 'bob']);
  });

  test('~ on a node, a group or a set takes in what it links to', async () => {
    const run = await world();
    const r = run([
      { id: 'near', terms: [{ kind: 'entity', op: '~', values: ['ann'] }] },
      { id: 'group', terms: [{ kind: 'group', op: '=', values: ['g'] }] },
      { id: 'both', terms: [{ kind: 'set', op: '=', values: ['near'] }, { kind: 'set', op: '=', values: ['group'] }] },
      { id: 'either', terms: [{ kind: 'set', op: '=', values: ['near', 'group'] }] },
      { id: 'loop', terms: [{ kind: 'set', op: '=', values: ['loop'] }] },
    ]);
    expect(ids(r.get('near')!.members)).toEqual(['acme', 'ann', 'meet']);
    expect(ids(r.get('both')!.members)).toEqual(['ann']);
    expect(ids(r.get('either')!.members)).toEqual(['acme', 'ann', 'bob', 'meet']);
    expect(r.get('loop')!.members).toEqual([]);
  });

  test('a place gathers the nodes claimed there; a value the nodes its documents produced', async () => {
    const run = await world({ negative: [100] });
    const r = run([
      { id: 'paris', terms: [{ kind: 'place', op: '=', values: ['paris'] }] },
      { id: 'value', terms: [{ kind: 'value', field: 'sentiment', op: '=', values: ['negative'] }] },
      { id: 'loading', terms: [{ kind: 'value', field: 'sentiment', op: '=', values: ['positive'] }] },
    ]);
    expect(ids(r.get('paris')!.members)).toEqual(['acme']);
    expect(ids(r.get('value')!.members)).toEqual(['acme', 'ann']);
    expect(r.get('value')!.pending).toBe(false);
    expect(r.get('loading')!).toEqual({ members: [], pending: true });
  });

  test('adding joins a facet, or narrows apart; an emptied term goes', async () => {
    const { addTerm, dropValue, fromWords } = await import('./sets');
    let s: import('./sets').NodeSet = { id: 'x', terms: [] };
    s = addTerm(s, { kind: 'type', op: '=', values: ['Person'] });
    s = addTerm(s, { kind: 'type', op: '=', values: ['Organization'] });
    expect(s.terms).toEqual([{ kind: 'type', op: '=', values: ['Person', 'Organization'] }]);
    s = addTerm(s, { kind: 'entity', op: '~', values: ['ann'] });
    s = addTerm(s, { kind: 'entity', op: '~', values: ['bob'] }, true);
    expect(s.terms.length).toBe(3);
    expect(dropValue(s, 1, 'ann').terms.length).toBe(2);
    expect(fromWords({ id: 'a', q: 'type:Person sanctions', space: 'free', x: 1, y: 2 })).toEqual({
      id: 'a', gain: undefined, at: { free: [1, 2] },
      terms: [{ kind: 'type', op: '=', values: ['Person'] }, { kind: 'name', op: '~', values: ['sanctions'] }],
    });
  });
});

describe('anchors', () => {
  test('an anchor is a cluster at its point; a lane keeps the node\'s time', async () => {
    const { withAnchors } = await import('./anchoring');
    const { byGroups, byTime } = await import('./arrange');
    const { identity } = await import('./collapse');
    const view = identity(net);
    const ann = net.index.get('ann')!, meet = net.index.get('meet')!;
    const pull = { gain: 0, direct: [ann], related: [meet] };
    const free = withAnchors(byGroups(net, () => -1), view, [{ ...pull, space: 'free', x: 100, y: 200 }]);
    const c = free.clusters[ann]!;
    expect([free.clusterPositions[2 * c], free.clusterPositions[2 * c + 1]]).toEqual([100, 200]);
    expect(free.strength[ann]).toBeGreaterThan(free.strength[meet]);
    expect(free.forces.simulationCluster).toBeGreaterThanOrEqual(0.4);

    const times = Float64Array.from(net.id.map((_, i) => Date.UTC(2026, i, 1)));
    const tl = byTime(net, times, 4096, 'month');
    const lane = withAnchors(tl.arrangement, view, [{ ...pull, space: 'time', x: 0, y: 300 }]);
    const k = lane.clusters[ann]!, own = tl.arrangement.clusters[ann]!;
    expect(lane.clusterPositions[2 * k]).toBe(tl.arrangement.clusterPositions[2 * own]);   // its time
    expect(lane.clusterPositions[2 * k + 1]).toBe(300);                                    // the lane's height
  });
});

describe('light', () => {
  test('a lit node lights its direct links and their far ends, and nothing past them', async () => {
    const { lightOf, joinLight, toggleLight } = await import('./light');
    const { identity } = await import('./collapse');
    const view = identity(net);
    const lit = lightOf(view, [net.index.get('acme')!]);
    expect(lit.seeds.map((i) => net.id[i])).toEqual(['acme']);
    expect(lit.points.map((i) => net.id[i]).sort()).toEqual(['acme', 'ann']);
    expect(lit.links).toEqual([2]);
    const both = joinLight([lit, lightOf(view, [net.index.get('bob')!])])!;
    expect(both.points.map((i) => net.id[i]).sort()).toEqual(['acme', 'ann', 'bob', 'meet']);
    expect(joinLight([null, undefined])).toBeNull();
    expect(toggleLight(toggleLight([], 'node', 'a'), 'node', 'a')).toEqual([]);
  });
});

describe('declutter', () => {
  test('names never sit on names; what must show, shows; the order is the say', async () => {
    const { declutter } = await import('./declutter');
    const at = (i: number, x: number, y: number) => ({ i, x, y, r: 3, w: 60, h: 14 });
    // 1 and 2 would overlap; 3 is clear of both.
    const kept = declutter([at(1, 0, 0), at(2, 10, 4), at(3, 0, 40)]);
    expect(kept).toEqual([1, 3]);
    expect(declutter([at(1, 0, 0), at(2, 10, 4)], { must: new Set([2]) })).toEqual([2]);
    expect(declutter([at(1, NaN, 0), at(2, 10, 4)])).toEqual([2]);
    // Side by side with room: both.
    expect(declutter([at(1, 0, 0), at(2, 200, 0)])).toEqual([1, 2]);
  });

  test('a pile under the pointer, loudest first', async () => {
    const { stackAt } = await import('./declutter');
    const screen: Record<number, [number, number, number]> = { 1: [10, 10, 6], 2: [12, 11, 4], 3: [40, 40, 4] };
    const under = stackAt([11, 10], [1, 2, 3], (i) => screen[i], (i) => -i);
    expect(under).toEqual([2, 1]);
    expect(stackAt([40, 40], [1, 2, 3], (i) => screen[i], (i) => -i)).toEqual([3]);
  });
});
