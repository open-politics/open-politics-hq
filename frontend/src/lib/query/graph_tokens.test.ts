/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { negatedValues, setNegatedValues, toggleGraphToken, hasGraphToken }
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
