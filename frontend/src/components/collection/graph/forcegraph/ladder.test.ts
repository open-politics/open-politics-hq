/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { resolvePlace, placeDivergence, trajectoryEnds, haversineKm,
         DEFAULT_RUNGS, RUNG_PRESETS } from './anchors';
import type { GraphNode } from '../graphTypes';

const VALLETTA = { lat: 35.8989, lon: 14.5146 };
const ZURICH   = { lat: 47.3769, lon: 8.5417 };
const TORTOLA  = { lat: 18.4207, lon: -64.64 };

const holdco: GraphNode = {
  id: 'h', label: 'Holdco Ltd', type: 'Organization', kind: 'entity',
  places: [
    { place: 'Valletta', ...VALLETTA, from: '2015-03-01', to: null,
      kind: 'registered_office', source: 'attribute' },
    { place: 'Zurich', ...ZURICH, from: '2011-01-01', to: null,
      kind: 'head_office', source: 'attribute' },
    { place: 'Tortola', ...TORTOLA, from: '2009-06-01', to: '2015-03-01',
      kind: 'branch', source: 'attribute' },
    { place: 'Malta', lat: 35.9, lon: 14.4, source: 'doc' },
  ],
};

describe('the place ladder', () => {
  test('the rung decides, not the order seen', () => {
    const meeting: GraphNode = {
      id: 'm', label: 'enc-7', type: 'Encounter', kind: 'occurrence',
      places: [
        { place: 'Malta', lat: 35.9, lon: 14.4, source: 'doc' },
        { place: 'Valletta', ...VALLETTA, source: 'row' },
      ],
    };
    expect(resolvePlace(meeting, DEFAULT_RUNGS)!.place.place).toBe('Valletta');
  });

  test('a zero-weight rung is not merely deprioritised, it is excluded', () => {
    const assetOnly: GraphNode = {
      id: 'a', label: 'a', type: 'X', kind: 'entity',
      places: [{ place: 'Somewhere', lat: 1, lon: 1, source: 'asset' }],
    };
    expect(resolvePlace(assetOnly, DEFAULT_RUNGS)).toBeNull();
  });

  test('COMPANIES DRIFT: the same node anchors elsewhere as the cursor moves', () => {
    const at2010 = resolvePlace(holdco, DEFAULT_RUNGS, '2010-01-01');
    const at2013 = resolvePlace(holdco, DEFAULT_RUNGS, '2013-01-01');
    const at2018 = resolvePlace(holdco, DEFAULT_RUNGS, '2018-01-01');
    // Only the Tortola branch existed in 2010.
    expect(at2010!.place.place).toBe('Tortola');
    // By 2013 the head office is the more recently established claim; the
    // branch is still true but no longer the answer to "where is this now".
    expect(at2013!.place.place).toBe('Zurich');
    // By 2018 the branch has closed and the registration is the newest claim.
    expect(at2018!.place.place).toBe('Valletta');
    // The point of all three: the node MOVES.
    expect(new Set([at2010, at2013, at2018].map(r => r!.place.place)).size).toBe(3);
  });

  test('an open interval is still current and cannot be aged out', () => {
    expect(resolvePlace(holdco, DEFAULT_RUNGS, '2099-01-01')).not.toBeNull();
  });

  test('a preset re-ranks without changing the data', () => {
    const meeting: GraphNode = {
      id: 'm', label: 'x', type: 'E', kind: 'occurrence',
      places: [
        { place: 'Valletta', ...VALLETTA, source: 'row' },
        { place: 'Zurich', ...ZURICH, source: 'attribute' },
      ],
    };
    expect(resolvePlace(meeting, RUNG_PRESETS.stated.rungs)!.place.place).toBe('Valletta');
    expect(resolvePlace(meeting, RUNG_PRESETS.based.rungs)!.place.place).toBe('Zurich');
    expect(resolvePlace(meeting, RUNG_PRESETS.strict.rungs)!.place.place).toBe('Valletta');
  });
});

describe('divergence is a finding, not a bug', () => {
  test('a seat that disagrees with another seat surfaces as a ghost', () => {
    const d = placeDivergence(holdco, DEFAULT_RUNGS, '2018-01-01');
    expect(d).not.toBeNull();
    const km = haversineKm(d!.primary, d!.ghost)!;
    expect(km).toBeGreaterThan(1000);   // Valletta ↔ Zurich is ~1,500 km
  });

  test('agreement yields no ghost', () => {
    const single: GraphNode = {
      id: 's', label: 's', type: 'X', kind: 'entity',
      places: [{ place: 'Valletta', ...VALLETTA, source: 'row' }],
    };
    expect(placeDivergence(single, DEFAULT_RUNGS)).toBeNull();
  });
});

describe('trajectories', () => {
  test('both ends resolve, so a movement can be drawn as an arc', () => {
    const flight: GraphNode = {
      id: 'f', label: 'N908JE', type: 'Movement', kind: 'occurrence',
      places: [
        { place: 'Valletta', ...VALLETTA, source: 'row', end: 'from' },
        { place: 'Zurich', ...ZURICH, source: 'row', end: 'to' },
      ],
    };
    const ends = trajectoryEnds(flight);
    expect(ends).not.toBeNull();
    expect(ends![0][0]).toBeCloseTo(VALLETTA.lat, 3);
    expect(ends![1][0]).toBeCloseTo(ZURICH.lat, 3);
    // The far end must never be mistaken for a seat.
    expect(resolvePlace(flight, DEFAULT_RUNGS)!.place.place).toBe('Valletta');
  });
});
