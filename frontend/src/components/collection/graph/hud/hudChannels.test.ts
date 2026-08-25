/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { selectItems, selectEvidence, defaultHudConfig, quoteOf } from './hudChannels';
import type { GraphEdge, GraphNode } from '../graphTypes';

const occ = (id: string, o: Partial<GraphNode> = {}): GraphNode =>
  ({ id, label: id, type: 'Payment', kind: 'occurrence', nodeType: 'Payment', ...o });
const ent = (id: string): GraphNode => ({ id, label: id, type: 'Organization', kind: 'entity' });
const link = (s: string, t: string, role: string, extra: Partial<GraphEdge> = {}): GraphEdge =>
  ({ id: `${s}-${t}-${role}`, sourceId: s, targetId: t, predicate: role, role, ...extra });

const NODES = [
  ent('A'), ent('B'), ent('C'),
  occ('p1', { t0: '2019-03-04', magnitude: 40000,
              evidence: [{ reasoning: 'ledger line', text_spans: [{ text_snippet: 'paid EUR 40,000' }] }] }),
  occ('p2', { t0: '2023-07-11', magnitude: 15000 }),
  occ('m1', { t0: '2021-01-01', nodeType: 'Meeting', type: 'Meeting' }),
];
const EDGES = [
  link('p1', 'A', 'payer'), link('p1', 'B', 'payee'),
  link('p2', 'A', 'payer'), link('p2', 'C', 'payee'),
  link('m1', 'B', 'participant'),
];

describe('items channel', () => {
  test('lists occurrences with their participants and roles', () => {
    const items = selectItems(NODES, EDGES, defaultHudConfig.items);
    expect(items.length).toBe(3);
    const p1 = items.find(i => i.node.id === 'p1')!;
    expect(p1.participants.map(p => `${p.role}:${p.label}`).sort())
      .toEqual(['payee:B', 'payer:A']);
    expect(p1.evidenceCount).toBe(1);
  });

  test('sorts by time with undated rows sinking, not sorting as year zero', () => {
    const nodes = [...NODES, occ('p0', {})];
    const ids = selectItems(nodes, EDGES, defaultHudConfig.items).map(i => i.node.id);
    expect(ids).toEqual(['p1', 'm1', 'p2', 'p0']);
  });

  test('nodeType narrows to one archetype', () => {
    const items = selectItems(NODES, EDGES,
      { ...defaultHudConfig.items, nodeType: 'Meeting' });
    expect(items.map(i => i.node.id)).toEqual(['m1']);
  });

  test('following the selection surfaces what an actor DID, not just the actor', () => {
    const items = selectItems(NODES, EDGES,
      { ...defaultHudConfig.items, follow: 'selection' }, new Set(['C']));
    expect(items.map(i => i.node.id)).toEqual(['p2']);   // C only appears in p2
  });

  test('sort by magnitude ranks by what the document said it was worth', () => {
    const items = selectItems(NODES, EDGES,
      { ...defaultHudConfig.items, sort: 'magnitude' });
    expect(items[0].node.id).toBe('p1');
  });
});

describe('evidence channel', () => {
  test('reads inline justification and keeps the document words apart from reasoning', () => {
    const ev = selectEvidence(NODES, EDGES, { source: 'inline', follow: 'lens' });
    expect(ev.length).toBe(1);
    expect(ev[0].quote).toBe('paid EUR 40,000');
    expect(ev[0].reasoning).toBe('ledger line');
    expect(ev[0].aboutLabel).toBe('p1');
  });

  test('reads Evidence occurrences joined by a supports edge', () => {
    const nodes = [...NODES, occ('x12', {
      nodeType: 'Evidence', type: 'Evidence', label: 'Tr. 214:6',
      properties: { quote: 'I recall the meeting', locator: '214:6', stance: 'supports' },
    })];
    const edges = [...EDGES, link('x12', 'm1', 'supports')];
    const ev = selectEvidence(nodes, edges, { source: 'occurrences', follow: 'lens' });
    expect(ev.length).toBe(1);
    expect(ev[0].quote).toBe('I recall the meeting');
    expect(ev[0].stance).toBe('supports');
    expect(ev[0].aboutId).toBe('m1');
  });

  test('following the selection narrows evidence to what is focused', () => {
    const all = selectEvidence(NODES, EDGES, { source: 'both', follow: 'lens' });
    const none = selectEvidence(NODES, EDGES,
      { source: 'both', follow: 'selection' }, new Set(['m1']));
    expect(all.length).toBe(1);
    expect(none.length).toBe(0);   // p1 carries the quote, m1 does not
  });
});

// ─── Lanes ───────────────────────────────────────────────────────────────────
//
// A smoke test here used to assert `typeof LanesPane === 'function'`. It cost
// this entire file.
//
// `bun test` resolves no runtime `@/…` import in this repo — every other test
// gets away with it because they import relatively or type-only, and a
// type-only import is erased before anything has to resolve. Importing a React
// component dragged `@/lib/utils` into the graph and the module failed to load,
// taking all fourteen tests with it and reporting one unhelpful error.
//
// The assertion was also a tautology: that a `React.FC` const is a function is
// guaranteed by the compiler and re-checked by `next build`. Its own comment
// conceded that behaviour was "covered by the shared selectors above". Thirteen
// real tests for a compile-time fact is a bad trade, so it is gone rather than
// worked around. Render-level coverage, if we want it, wants a DOM runner.

// ─── Justification as evidence ──────────────────────────────────────────────

describe('a justification serves as evidence', () => {
  const denial: GraphNode = {
    id: 'st1', label: 'He never visited the island',
    type: 'Statement', kind: 'occurrence', nodeType: 'Statement',
    t0: '2016-05-03',
    properties: { modality: 'denies' },
    evidence: [{
      reasoning: 'witness answered in the negative',
      text_spans: [{ text_snippet: 'I did not.' }],
    }],
  };
  const assertion: GraphNode = {
    ...denial, id: 'st2', label: 'He was there in July',
    properties: { modality: 'asserts' },
    evidence: [{ text_spans: [{ text_snippet: 'Yes, in July.' }] }],
  };

  test('turns the row quote into an evidence row', () => {
    const out = selectEvidence([denial], [], { source: 'inline', follow: 'lens' });
    expect(out).toHaveLength(1);
    expect(out[0].quote).toBe('I did not.');
    expect(out[0].aboutLabel).toBe('He never visited the island');
  });

  test('inherits the statement modality as its stance', () => {
    // A quote grounding a denial must not read like one grounding an
    // assertion — in a court corpus that is the difference between analysis
    // and asserting what a witness denied.
    const out = selectEvidence([denial, assertion], [], { source: 'inline', follow: 'lens' });
    const byAbout = Object.fromEntries(out.map(e => [e.aboutId, e.stance]));
    expect(byAbout.st1).toBe('denies');
    expect(byAbout.st2).toBe('asserts');
  });

  test('keeps reasoning separate from the document words', () => {
    const out = selectEvidence([denial], [], { source: 'inline', follow: 'lens' });
    expect(out[0].reasoning).toBe('witness answered in the negative');
    expect(out[0].quote).not.toContain('witness answered');
  });

  test('an explicit stance on the payload still wins', () => {
    const corrected: GraphNode = {
      ...denial, id: 'st3',
      evidence: [{ stance: 'retracts', text_spans: [{ text_snippet: 'I withdraw that.' }] }],
    };
    const out = selectEvidence([corrected], [], { source: 'inline', follow: 'lens' });
    expect(out[0].stance).toBe('retracts');
  });

  test('reads numbered exhibits and inline quotes together under `both`', () => {
    const exhibit: GraphNode = {
      id: 'ex4', label: 'EXHIBIT C', type: 'Evidence',
      kind: 'occurrence', nodeType: 'Evidence',
      properties: { stance: 'contradicts', locator: 'p. 14', source: 'deposition' },
    };
    const supports: GraphEdge = {
      id: 'e1', sourceId: 'ex4', targetId: 'st1',
      predicate: 'supports', role: 'supports',
    };
    const out = selectEvidence([denial, exhibit], [supports], {
      source: 'both', follow: 'lens',
    });
    // one from the inline justification, one from the numbered exhibit
    expect(out).toHaveLength(2);
    const fromExhibit = out.find(e => e.id.startsWith('ex4'))!;
    expect(fromExhibit.stance).toBe('contradicts');
    expect(fromExhibit.locator).toBe('p. 14');
    expect(fromExhibit.aboutLabel).toBe('He never visited the island');
  });
});

describe('quoteOf — the document\'s words, and only those', () => {
  test('joins every span, so a split quote is not silently truncated', () => {
    expect(quoteOf({
      text_spans: [{ text_snippet: 'paid EUR 4m' }, { text: 'to the Valletta account' }],
    })).toBe('paid EUR 4m … to the Valletta account');
  });

  test('never returns reasoning as a quote', () => {
    // The one mistake the whole evidence rail exists to avoid: `reasoning` is
    // the model's account of why. Presenting it as something the document said
    // manufactures a source. A justification with no span has no quote.
    expect(quoteOf({ reasoning: 'the filing implies a transfer' })).toBeNull();
  });

  test('an absent or malformed payload is null, not a crash', () => {
    expect(quoteOf(undefined)).toBeNull();
    expect(quoteOf({})).toBeNull();
    expect(quoteOf({ text_spans: 'not an array' })).toBeNull();
    expect(quoteOf({ text_spans: [{}, { text_snippet: '' }] })).toBeNull();
  });
});
