/// <reference types="bun-types" />
import { describe, expect, test as it } from 'bun:test';
import {
  applyToGql, fromSchemaFields, fromSectionRows, readChannel, reorder,
  setGrain, toColumns, toggleField, writeChannel,
} from './composerModel';
import type { SectionRows } from '@/components/collection/graph/panes/rowTypes';

const OBS: SectionRows = {
  section: 'observations',
  path: 'document.observations[*]',
  columns: [
    { key: 'by', label: 'by', kind: 'nominal', ref: 'entity', source: 'declared' },
    { key: 'to', label: 'to', kind: 'nominal', ref: 'entity', source: 'declared' },
    { key: 'when', label: 'when', kind: 'interval', source: 'declared' },
    { key: 'amount', label: 'amount', kind: 'metric', source: 'shape' },
  ],
  items: [
    { id: 'a', annotationId: 1, assetId: 9, cells: {
      by: [{ name: 'Merkel', type: 'Person' }], to: [{ name: 'Scholz' }],
      when: '2016-04-22', amount: 100,
    } },
    { id: 'b', annotationId: 1, assetId: 9, cells: {
      by: [{ name: 'Merkel', type: 'Person' }], to: [], when: '2016-05-03',
    } },
  ],
  total: 2, notes: [],
} as unknown as SectionRows;

const EXH: SectionRows = {
  section: 'exhibits', path: 'document.exhibits[*]',
  columns: [{ key: 'quote', label: 'quote', kind: 'nominal', source: 'declared' }],
  items: [], total: 0, notes: [],
} as unknown as SectionRows;

describe('channels', () => {
  it('leaves unrelated clauses alone', () => {
    const q = 'type:Person degree>2 SHOW:by,to BY place';
    expect(writeChannel(q, 'SHOW', ['when'])).toContain('type:Person');
    expect(writeChannel(q, 'SHOW', ['when'])).toContain('degree>2');
    expect(readChannel(writeChannel(q, 'SHOW', ['when']), 'SHOW')).toEqual(['when']);
  });

  it('removes a channel when given nothing', () => {
    expect(writeChannel('SECTION:x SHOW:a,b', 'SHOW', [])).toBe('SECTION:x');
  });
});

describe('fromSectionRows', () => {
  it('opens showing what the surface shows — no SHOW: means every column', () => {
    const m = fromSectionRows([OBS], '');
    expect(m.grain).toBe('observations');
    expect(m.selected).toEqual(['by', 'to', 'when', 'amount']);
  });

  it('reads SHOW: in the order written, because order is the point', () => {
    const m = fromSectionRows([OBS], 'SHOW:when,by');
    expect(m.selected).toEqual(['when', 'by']);
  });

  it('accepts a qualified path — SHOW:observations.by addresses the same column', () => {
    expect(fromSectionRows([OBS], 'SHOW:observations.by').selected).toEqual(['by']);
  });

  it('samples real values and counts fills from the loaded rows', () => {
    const by = fromSectionRows([OBS], '').fields.find(f => f.id === 'by')!;
    expect(by.samples).toEqual(['Merkel']);      // deduped, entity by name
    expect(by.kind).toBe('entity');
    const to = fromSectionRows([OBS], '').fields.find(f => f.id === 'to')!;
    expect(to.filled).toBe(1);                   // one row has an empty `to`
    expect(to.sampled).toBe(2);
  });

  it('carries whether a column was declared or found in the data', () => {
    const m = fromSectionRows([OBS], '');
    expect(m.fields.find(f => f.id === 'amount')!.source).toBe('shape');
    expect(m.fields.find(f => f.id === 'by')!.source).toBe('declared');
  });
});

describe('applyToGql', () => {
  it('round-trips a selection', () => {
    const m = fromSectionRows([OBS, EXH], 'SECTION:observations SHOW:by,when');
    const q = applyToGql('SECTION:observations SHOW:by,when', m);
    expect(fromSectionRows([OBS, EXH], q).selected).toEqual(['by', 'when']);
  });

  it('writes no SHOW: when everything is selected — the default stays visible', () => {
    const m = fromSectionRows([OBS], '');
    expect(applyToGql('', m)).toBe('SECTION:observations');
  });

  it('preserves clauses it does not own', () => {
    const m = fromSectionRows([OBS], 'type:Person SHOW:by');
    const q = applyToGql('type:Person SHOW:by', m);
    expect(q).toContain('type:Person');
  });

  it('changing the grain rewrites SECTION: and resets the columns', () => {
    const m = setGrain(fromSectionRows([OBS, EXH], ''), 'exhibits');
    expect(m.selected).toEqual(['quote']);
    expect(readChannel(applyToGql('', m), 'SECTION')).toEqual(['exhibits']);
  });
});

describe('editing', () => {
  it('appends on toggle — the order you pick in is the order you meant', () => {
    const m = fromSectionRows([OBS], 'SHOW:by');
    expect(toggleField(m, 'when').selected).toEqual(['by', 'when']);
    expect(toggleField(toggleField(m, 'when'), 'by').selected).toEqual(['when']);
  });

  it('reorders', () => {
    const m = fromSectionRows([OBS], 'SHOW:by,to,when');
    expect(reorder(m, 2, 0).selected).toEqual(['when', 'by', 'to']);
  });
});

describe('table adapter', () => {
  const groups = [{
    id: 7, label: 'S', fields: [
      { key: 'document.a', name: 'A', type: 'string' },
      { key: 'document.b', name: 'B', type: 'number' },
    ],
  }];

  it('empty columns means show all — the convention the table already relies on', () => {
    const m = fromSchemaFields(groups, []);
    expect(m.selected).toEqual(['7:document.a', '7:document.b']);
    // …and round-trips back to empty rather than to an explicit full list.
    expect(toColumns(m)).toEqual([]);
  });

  it('a subset round-trips to the flat path list the table persists', () => {
    const m = fromSchemaFields(groups, ['document.b']);
    expect(m.selected).toEqual(['7:document.b']);
    expect(toColumns(m)).toEqual(['document.b']);
  });

  it('samples through the caller’s value reader', () => {
    const m = fromSchemaFields(
      groups, [],
      () => [{ 'document.a': 'x' }, { 'document.a': 'y' }],
      (v, k) => (v as Record<string, unknown>)[k],
    );
    const a = m.fields.find(f => f.id === '7:document.a')!;
    expect(a.samples).toEqual(['x', 'y']);
    expect(a.filled).toBe(2);
  });
});

describe('the census outranks the page', () => {
  // A field filled 3 times in 480 rows is the one a picker must not call
  // empty — and it is exactly the one a 25-row page misses.
  const withCensus = {
    ...OBS,
    total: 480,
    columns: [
      { key: 'by', label: 'by', kind: 'nominal', ref: 'entity',
        source: 'declared', filled: 470, examples: ['Merkel'] },
      { key: 'via', label: 'via', kind: 'nominal', source: 'declared',
        filled: 3, examples: ['Banca X'] },
      { key: 'currency', label: 'currency', kind: 'nominal',
        source: 'declared', filled: 0, examples: [] },
    ],
  } as unknown as SectionRows;

  it('counts against the section total, not the loaded page', () => {
    const via = fromSectionRows([withCensus], '').fields.find(f => f.id === 'via')!;
    expect(via.filled).toBe(3);
    expect(via.sampled).toBe(480);   // not the 2 rows on the page
  });

  it('gives a rare field an exemplar the page could never supply', () => {
    // `via` is empty in both loaded rows, so page sampling yields nothing.
    const via = fromSectionRows([withCensus], '').fields.find(f => f.id === 'via')!;
    expect(via.exemplar).toBe('Banca X');
    expect(via.samples).toEqual(['Banca X']);
  });

  it('still prefers a real page value, which carries its raw shape', () => {
    // `by` holds entity objects on the page; the census only has text. The
    // exemplar must keep the object so it renders as a badge, not a string.
    const by = fromSectionRows([withCensus], '').fields.find(f => f.id === 'by')!;
    expect(by.exemplar).toEqual([{ name: 'Merkel', type: 'Person' }]);
    expect(by.filled).toBe(470);
  });

  it('zero is a finding, not a shrug', () => {
    const cur = fromSectionRows([withCensus], '').fields.find(f => f.id === 'currency')!;
    expect(cur.filled).toBe(0);
    expect(cur.sampled).toBe(480);
  });

  it('falls back to page counts when no census ran', () => {
    const to = fromSectionRows([OBS], '').fields.find(f => f.id === 'to')!;
    expect(to.filled).toBe(1);
    expect(to.sampled).toBe(2);
  });
});
