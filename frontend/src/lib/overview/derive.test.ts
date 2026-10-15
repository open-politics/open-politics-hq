/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import {
  activeSections, clampBins, histogram, markers, sectionTotals, unlocatedCount,
} from './derive';
import { UNLOCATED, type OverviewBuckets } from './types';

// Two places, two sections, a document pseudo-section, three weeks.
//   0 Valletta — 5 rows stated there (events), 2 placed only by their document
//   1 Rome     — 3 rows stated there (observations)
// plus 4 event rows at a place nobody located.
const W1 = '2026-01-05T00:00:00+00:00';
const W2 = '2026-01-12T00:00:00+00:00';
const W3 = '2026-01-19T00:00:00+00:00';

const buckets: OverviewBuckets = {
  grain: 'week',
  extent: [W1, W2],
  placed_assets: 3,
  sections: [
    { key: '7:document.events[*]', rows: 12, placed: 11, dated: 12 },
    { key: '7:document.observations[*]', rows: 3, placed: 3, dated: 2 },
    { key: '7:@document', rows: 4, placed: 4, dated: 4 },
  ],
  cells: [W1, W2, W3],
  places: {
    id: ['entry:1', 'name:rome'], name: ['Valletta', 'Rome'], lat: [35.9, 41.9],
    lon: [14.5, 12.5], entry: [1, null], geo: [true, false], rows: [7, 3], assets: [3, 1],
  },
  spellings: {},
  unlocated: { total: 1, items: [] },
  rows: [
    [0, 0, 0, 0, 5],
    [0, 1, 0, 1, 2],
    [1, 0, 1, 1, 3],
    [0, 0, UNLOCATED, 2, 4],
    [2, 1, 0, 0, 4],
  ],
  rows_truncated: 0,
  hist: [[0, 0, 5], [0, 1, 2], [0, 2, 4], [1, 1, 2], [1, -1, 1], [2, 0, 4]],
  assets: [[1, 0, 0, 3], [0, 1, 1, 1]],
  asset_time: [[0, 3], [1, 1]],
};

describe('activeSections', () => {
  test('rows mode counts every real section and leaves the document out', () => {
    expect([...activeSections(buckets, 'rows', new Set())]).toEqual([0, 1]);
  });

  test('a flat schema — only the document — counts the document', () => {
    const flat = { ...buckets, sections: [buckets.sections[2]] };
    expect([...activeSections(flat, 'rows', new Set())]).toEqual([0]);
  });

  test('sections mode counts exactly what was chosen', () => {
    expect([...activeSections(buckets, 'sections', new Set(['7:document.observations[*]']))]).toEqual([1]);
  });
});

describe('markers', () => {
  test('rungs stay apart: stated rows and document-placed rows are separate counts', () => {
    const ms = markers(buckets, 'rows', new Set([0, 1]), null);
    const valletta = ms.find((m) => m.name === 'Valletta')!;
    expect(valletta.row).toBe(5);
    expect(valletta.doc).toBe(2);
    expect(valletta.total).toBe(7);
  });

  test('unlocated buckets never draw', () => {
    const ms = markers(buckets, 'rows', new Set([0, 1]), null);
    expect(ms.every((m) => m.p >= 0)).toBe(true);
    expect(ms.reduce((s, m) => s + m.total, 0)).toBe(10);
  });

  test('a time window recounts without a fetch, and drops the undated', () => {
    const w2 = Date.parse(W2);
    const ms = markers(buckets, 'rows', new Set([0, 1]), [w2, w2]);
    expect(ms.map((m) => [m.name, m.total])).toEqual([['Rome', 3], ['Valletta', 2]]);
  });

  test('assets mode reads the asset buckets', () => {
    const ms = markers(buckets, 'assets', new Set(), null);
    expect(ms.map((m) => [m.name, m.doc, m.row])).toEqual([['Valletta', 3, 0], ['Rome', 0, 1]]);
  });
});

describe('counts', () => {
  test('rows nobody could locate are counted, not lost', () => {
    expect(unlocatedCount(buckets, 'rows', new Set([0, 1]), null)).toBe(4);
    expect(unlocatedCount(buckets, 'rows', new Set([1]), null)).toBe(0);
  });

  test('the histogram counts every row of the counted sections, undated apart', () => {
    const h = histogram(buckets, 'rows', new Set([0, 1]));
    expect(h.bins.map((b) => b.n)).toEqual([5, 4, 4]);
    expect(h.undated).toBe(1);
  });

  test('bins outside the robust extent are counted as outside, not drawn', () => {
    const h = histogram(buckets, 'rows', new Set([0, 1]));
    const c = clampBins(h.bins, buckets.extent);
    expect(c.bins.length).toBe(2);
    expect(c.outside).toBe(4);
  });

  test('section totals are the denominators of the counted sections', () => {
    expect(sectionTotals(buckets, new Set([0, 1]))).toEqual({ rows: 15, placed: 14, dated: 14 });
  });
});
