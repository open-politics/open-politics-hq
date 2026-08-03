/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { placeClusters } from './useGeoPaint';
import { geoRadius, mercator, DEFAULT_RUNGS } from './anchors';
import type { GraphNode } from '../graphTypes';

const at = (place: string, lat: number, lon: number, source: any = 'row',
            extra: any = {}): any =>
  ({ place, lat, lon, source, ...extra });

const nodes: GraphNode[] = [
  { id: '1', label: 'a', type: 'E', kind: 'occurrence',
    places: [at('Valletta', 35.8989, 14.5146)] },
  { id: '2', label: 'b', type: 'E', kind: 'occurrence',
    places: [at('Valletta', 35.8989, 14.5146)] },
  { id: '3', label: 'c', type: 'E', kind: 'occurrence',
    places: [at('Zurich', 47.3769, 8.5417)] },
  { id: '4', label: 'd', type: 'E', kind: 'entity',
    places: [at('Nowhere', null as any, null as any)] },
];

describe('place clusters', () => {
  test('ranks places by how much happened there', () => {
    const c = placeClusters(nodes, DEFAULT_RUNGS);
    expect(c.map(x => `${x.place}:${x.count}`)).toEqual(['Valletta:2', 'Zurich:1']);
  });

  test('ungeocoded places are absent, not plotted at the origin', () => {
    expect(placeClusters(nodes, DEFAULT_RUNGS).some(c => c.place === 'Nowhere'))
      .toBe(false);
  });

  test('clusters respect the time cursor, like every other place read', () => {
    const drifting: GraphNode[] = [{
      id: 'h', label: 'Holdco', type: 'Org', kind: 'entity',
      places: [
        at('Tortola', 18.42, -64.64, 'attribute', { from: '2009-01-01', to: '2015-01-01' }),
        at('Valletta', 35.8989, 14.5146, 'attribute', { from: '2015-01-01' }),
      ],
    }];
    expect(placeClusters(drifting, DEFAULT_RUNGS, '2012-01-01')[0].place).toBe('Tortola');
    expect(placeClusters(drifting, DEFAULT_RUNGS, '2020-01-01')[0].place).toBe('Valletta');
  });
});

describe('projection is shared, so outlines cannot drift from nodes', () => {
  test('geoRadius derives from linkDistance, not a private constant', () => {
    expect(geoRadius(100)).toBe(600);
    expect(geoRadius(180)).toBe(1080);
  });

  test('mercator is stable, clamped near the poles, and y grows south', () => {
    const r = geoRadius(100);
    const [x0, y0] = mercator(0, 0, r);
    expect(x0).toBe(0);
    expect(Math.abs(y0)).toBeLessThan(1e-9);   // float noise at the equator
    const [, yNorth] = mercator(50, 0, r);
    const [, ySouth] = mercator(-50, 0, r);
    expect(yNorth).toBeLessThan(0);          // north is up
    expect(ySouth).toBeGreaterThan(0);
    // The projection diverges at the poles; clamping keeps it finite.
    expect(Number.isFinite(mercator(89.9, 0, r)[1])).toBe(true);
    expect(mercator(89.9, 0, r)[1]).toBe(mercator(85, 0, r)[1]);
    // Longitude maps linearly across the full span.
    expect(mercator(0, 180, r)[0]).toBe(r);
    expect(mercator(0, -180, r)[0]).toBe(-r);
  });
});
