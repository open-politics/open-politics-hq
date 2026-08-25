/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { negatedValues, setNegatedValues, toggleGraphToken, hasGraphToken,
  GQL_TOKENS, GQL_PREFIXES, parseGraphQueryToPills, type GqlToken }
  from './graph_query_language';

describe('filter chips are a view of the query', () => {
  test('a hidden type round-trips through the string', () => {
    const q = setNegatedValues('', 'type', new Set(['PERSON']));
    expect(q).toBe('-type:PERSON');
    expect(negatedValues(q, 'type')).toEqual(new Set(['PERSON']));
  });

  test('un-hiding removes the token rather than adding a second one', () => {
    let q = setNegatedValues('', 'type', new Set(['PERSON', 'ORG']));
    q = setNegatedValues(q, 'type', new Set(['ORG']));
    expect(negatedValues(q, 'type')).toEqual(new Set(['ORG']));
    expect(q.includes('PERSON')).toBe(false);
  });

  test('it does not disturb the rest of the query', () => {
    const q = setNegatedValues('merkel hops:2 from:"Angela Merkel"', 'type',
      new Set(['LOCATION']));
    expect(q).toContain('merkel');
    expect(q).toContain('hops:2');
    expect(q).toContain('from:"Angela Merkel"');
    expect(negatedValues(q, 'type')).toEqual(new Set(['LOCATION']));
  });

  test('types and predicates are independent axes', () => {
    let q = setNegatedValues('', 'type', new Set(['PERSON']));
    q = setNegatedValues(q, 'predicate', new Set(['knows']));
    expect(negatedValues(q, 'type')).toEqual(new Set(['PERSON']));
    expect(negatedValues(q, 'predicate')).toEqual(new Set(['knows']));
  });

  test('a value needing quotes survives the round trip', () => {
    const q = setNegatedValues('', 'predicate', new Set(['acts for']));
    expect(hasGraphToken(q, 'predicate', 'acts for')).toBe(true);
    expect(negatedValues(q, 'predicate')).toEqual(new Set(['acts for']));
  });

  test('toggling twice is a no-op', () => {
    const once = toggleGraphToken('type:Person', 'predicate', 'owns');
    expect(toggleGraphToken(once, 'predicate', 'owns')).toBe('type:Person');
  });
});

// ─── Grammar parity ─────────────────────────────────────────────────────────
//
// `backend/app/tests/fixtures/gql_tokens.json` is generated from
// `graph/gql.py::TOKENS` and is the shared claim; the Python half is
// `app/tests/test_gql_tokens.py`. The fixture is read from the backend tree
// rather than copied here — a copy is not a parity test, it is the same drift
// with two homes. If it cannot be read this suite FAILS rather than skipping,
// because a parity test that quietly does nothing is how the four copies came
// to disagree in the first place.

const TOKEN_FIXTURE = resolve(
  import.meta.dir, '../../../../backend/app/tests/fixtures/gql_tokens.json',
);
const fixture: { tokens: GqlToken[] } = JSON.parse(
  readFileSync(TOKEN_FIXTURE, 'utf8'),
);

describe('the grammar is one table, mirrored', () => {
  test('every token in the engine is in the mirror, identically', () => {
    // Normalised because JSON has no `undefined`: the Python side writes
    // `null` for an absent optional and the TS literals simply omit it.
    const norm = (t: GqlToken) => ({
      token: t.token, tier: t.tier, hint: t.hint,
      semantics: t.semantics ?? null,
      example: t.example ?? null,
      values: t.values ?? null,
    });
    expect(GQL_TOKENS.map(norm)).toEqual(fixture.tokens.map(norm));
  });

  test('the picker prefixes are derived, not a second list', () => {
    for (const p of GQL_PREFIXES) {
      expect(p.prefix.endsWith(':')).toBe(true);
      expect(GQL_TOKENS.some(t => t.token.startsWith(p.prefix))).toBe(true);
    }
  });

  test('every example parses to at least one pill', () => {
    // An example that does not parse teaches a syntax the engine rejects.
    for (const t of GQL_TOKENS) {
      if (!t.example) continue;
      expect(parseGraphQueryToPills(t.example).length).toBeGreaterThan(0);
    }
  });
});

// ─── The reserved rule ──────────────────────────────────────────────────────

describe('UPPERCASE is a channel, not a filter', () => {
  test('a binding parses as a channel pill, never as free text', () => {
    // The whole failure this pins: the mirror did not know the uppercase rule,
    // so every binding fell through to the free-text branch and became a
    // SUBSTRING MATCH ON NODE NAMES. `PANEL:interests` filtered the canvas to
    // nodes literally called that — none — and every pane built from the same
    // string came back empty, with no error anywhere.
    const q = 'PANEL:interests PANEL:places CONNECT:places type:Person';
    const pills = parseGraphQueryToPills(q);
    const channels = pills.filter(p => p.type === 'channel');
    expect(channels.map(p => p.label)).toEqual(['PANEL', 'PANEL', 'CONNECT']);
    expect(pills.some(p => p.type === 'text')).toBe(false);
    // …and the lowercase half still filters.
    expect(pills.find(p => p.type === 'type')?.value).toBe('Person');
  });

  test('a lowercase prefix is still a filter, not a channel', () => {
    const pills = parseGraphQueryToPills('type:Person serves:opacity');
    expect(pills.some(p => p.type === 'channel')).toBe(false);
  });

  test('bare words are still free text — the fallback is deliberate', () => {
    const pills = parseGraphQueryToPills('merkel');
    expect(pills[0].type).toBe('text');
  });
});
