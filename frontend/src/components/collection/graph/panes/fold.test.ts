/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { fold, selectNodes } from './fold';
import type { GraphNode } from '../graphTypes';

const node = (o: Partial<GraphNode>): GraphNode =>
  ({ id: o.label ?? 'n', label: 'n', type: 'Location', kind: 'entity', ...o } as GraphNode);

describe('a pane cannot disagree with the canvas about where something is', () => {
  test('coordinates come from the place LADDER, not just the top-level fields', () => {
    // The bug this pins: the pane read `lat`/`lon`, the canvas read
    // `resolvePlace(places[])`. A node placed by a lower rung was plotted on
    // the canvas and reported as "without coordinates" in the pane, a few
    // pixels apart — two answers to "where is this" from one set of nodes.
    const laddered = node({
      label: 'Road Town', lat: null, lon: null,
      places: [{ place: 'Road Town', lat: 18.4, lon: -64.6, source: 'attribute' }],
    } as any);
    const surface = fold({ nodes: [laddered], edges: [], q: '' });
    expect(surface.rows[0].lat).toBeCloseTo(18.4, 3);
    expect(surface.rows[0].lon).toBeCloseTo(-64.6, 3);
  });

  test('a node with no rung anywhere is honestly uncoordinated', () => {
    const surface = fold({ nodes: [node({ label: 'Nowhere' })], edges: [], q: '' });
    expect(surface.rows[0].lat).toBeNull();
  });

  test('the strongest rung wins, as it does on the canvas', () => {
    const both = node({
      label: 'Valletta', lat: null, lon: null,
      places: [
        { place: 'doc guess', lat: 0, lon: 0, source: 'doc' },
        { place: 'stated', lat: 35.9, lon: 14.5, source: 'row' },
      ],
    } as any);
    expect(fold({ nodes: [both], edges: [], q: '' }).rows[0].lat).toBeCloseTo(35.9, 3);
  });
});

describe('a pane query filters on identity, and ignores bindings', () => {
  const nodes = [
    node({ label: 'Trieste', type: 'Location' }),
    node({ label: 'Unit-7', type: 'Organization' }),
  ];

  test('channel clauses do not narrow anything', () => {
    // They are bindings. Treating one as a name substring emptied every pane.
    expect(selectNodes(nodes, 'PANEL:places CONNECT:places')).toHaveLength(2);
  });

  test('lowercase filters still filter', () => {
    expect(selectNodes(nodes, 'type:Location').map(n => n.label)).toEqual(['Trieste']);
  });

  test('an unfolded row carries what the node IS, not just a count', () => {
    const [row] = fold({ nodes: [nodes[1]], edges: [], q: '' }).rows;
    expect(row.type).toBe('Organization');
    expect(row.kind).toBe('entity');
  });

  test('no fold key ⇒ items, not a bar chart of nothing', () => {
    expect(fold({ nodes, edges: [], q: '' }).kind).toBe('items');
    expect(fold({ nodes, edges: [], q: 'BY type' }).kind).toBe('list');
  });
});
