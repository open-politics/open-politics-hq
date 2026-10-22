/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { decodeNetwork, type NetworkWire } from './network';
import { merge } from './merge';

/**
 *   Donald Trump · Trump · President Trump — one person under three labels,
 *   asked as one group with Donald Trump as its head.
 */
const wire: NetworkWire = {
  nodes: {
    id: ['dt', 'tr', 'pt'],
    name: ['Donald Trump', 'Trump', 'President Trump'],
    type: [0, 0, 0],
    kind: [0, 0, 0],
    frequency: [70, 40, 10],
    size: [null, null, null],
    t0: [null, null, null],
    t1: [null, null, null],
    ann: { offsets: [0, 1, 2, 3], ids: [10, 11, 12] },
    places: { offsets: [0, 0, 0, 0], coord: [], rung: [], from: [], to: [], end: [] },
  },
  edges: { source: [], target: [], kind: [], predicate: [], weight: [] },
  vocab: {
    type: ['Person'], edge_kind: [], predicate: [], node_kind: ['entity'],
    rung: [], coord: [],
  },
  assets: { annotation: [10, 11, 12], asset: [100, 101, 102], time: [0, 0, 0] },
  dropped_edges: 0,
  meta: { ms: 1, capped: false },
};

const net = decodeNetwork(wire);
const head = { name: 'Donald Trump', type: 'Person' };

describe('merge', () => {
  test('a group folds into its head, named by the label it chose', () => {
    const view = merge(net, [
      { id: 1, a: head, b: { name: 'Trump', type: 'Person' }, keep: 'a', name: 'President Trump', type: 'Person' },
      { id: 2, a: head, b: { name: 'President Trump', type: 'Person' }, keep: 'b', name: 'President Trump', type: 'Person' },
    ]);
    expect(view.net.size).toBe(1);
    expect(view.net.name[0]).toBe('President Trump');
    expect(view.net.frequency[0]).toBe(120);
  });

  test('without a group label the kept side names it, as before', () => {
    const view = merge(net, [{ id: 1, a: head, b: { name: 'Trump', type: 'Person' }, keep: 'a', type: 'Person' }]);
    expect(view.net.size).toBe(2);
    expect([...view.net.name]).toContain('Donald Trump');
  });
});
