import { describe, expect, test } from 'bun:test';
import { applyCompletion, completions, tokenAt, type GraphIndex } from './complete';

const INDEX: GraphIndex = {
  sections: {
    observations: [
      { key: 'by', label: 'by', kind: 'nominal', ref: 'entity', source: 'declared' },
      { key: 'magnitude', label: 'magnitude', kind: 'metric', source: 'declared' },
      { key: 'kind', label: 'kind', kind: 'nominal', source: 'declared' },
      { key: 'tone', label: 'tone', kind: 'nominal', source: 'shape' },
    ],
    places: [{ key: '@self', label: 'name', kind: 'nominal', ref: 'entity', source: 'declared' }],
    interests: [{ key: '@self', label: 'name', kind: 'nominal', ref: 'entity', source: 'declared' }],
  },
  types: ['Person', 'Organization', 'Location', 'Interest'],
  roles: ['by', 'to', 'via', 'serves'],
  predicates: ['owns', 'serves', 'within'],
  properties: ['modality', 'domain'],
};

const at = (text: string) => completions(text, text.length, INDEX);
const values = (text: string) => at(text).map(c => c.value);

describe('the token under the cursor', () => {
  test('runs back to the last space', () => {
    expect(tokenAt('type:Person CLUS', 16)).toEqual({ start: 12, token: 'CLUS' });
  });

  test('a quoted value is one token', () => {
    // Interests are multi-word far more often than not, so breaking at the
    // space offers nothing at the exact moment it would help most.
    const { token } = tokenAt('serves:"port priv', 17);
    expect(token).toBe('serves:"port priv');
  });
});

describe('the ladder is offered in resolution order', () => {
  test('a reserved key comes before a type of the same prefix', () => {
    // `CLUSTER:plac` — `place` (each node's place) and `places` (the section)
    // resolve to DIFFERENT things, and the first suggestion has to be the one
    // the engine would actually pick.
    const v = values('CLUSTER:plac');
    expect(v[0]).toBe('CLUSTER:place');
    expect(v).toContain('CLUSTER:places');
    expect(v.indexOf('CLUSTER:place')).toBeLessThan(v.indexOf('CLUSTER:places'));
  });

  test('a type is offered as "the X it connects to"', () => {
    // Which is what rung three MEANS. `CLUSTER:Location` reading as a column
    // name is why both of the obvious queries did nothing.
    const hit = at('CLUSTER:Loc').find(c => c.value === 'CLUSTER:Location');
    expect(hit?.detail).toBe('the Location it connects to');
  });

  test('a section reaches the types it minted', () => {
    expect(values('CLUSTER:Interes')).toContain('CLUSTER:interests');
  });

  test('a property is the last rung', () => {
    const v = values('CLUSTER:mod');
    expect(v).toContain('CLUSTER:modality');
  });
});

describe('a section prefix offers its own columns and nothing else', () => {
  test('after the dot, only that section', () => {
    const v = values('observations.');
    expect(v).toContain('observations.magnitude');
    expect(v.every(x => x.startsWith('observations.'))).toBe(true);
  });

  test('a guessed column says so', () => {
    const hit = at('observations.to').find(c => c.value === 'observations.tone');
    expect(hit?.detail).toContain('found in the data');
    const declared = at('observations.ma')
      .find(c => c.value === 'observations.magnitude');
    expect(declared?.detail).toContain('declared');
  });

  test('the qualified spelling is offered for a colliding name', () => {
    // `kind:` is reserved; `observations.kind:` is the spelling that reaches
    // the column a schema happens to call `kind`.
    expect(values('CLUSTER:kin')).toContain('CLUSTER:observations.kind');
  });
});

describe('what an empty token offers', () => {
  test('the clauses', () => {
    expect(values('')).toContain('SECTION:');
  });

  test('a bare word naming a section is almost always meant as one', () => {
    expect(values('interes')).toContain('SECTION:interests');
  });
});

describe('filter prefixes complete from what the run HAS', () => {
  test('types', () => {
    expect(values('type:Org')).toEqual(['type:Organization']);
  });

  test('predicates', () => {
    expect(values('predicate:ow')).toEqual(['predicate:owns']);
  });

  test('and nothing when the run has none of it', () => {
    // A completion list that lies is worse than none, because it is believed.
    expect(values('type:Vessel')).toEqual([]);
  });
});

describe('accepting a completion', () => {
  test('replaces only the token being typed', () => {
    const text = 'type:Person CLUSTER:Loc';
    const c = completions(text, text.length, INDEX)
      .find(x => x.value === 'CLUSTER:Location')!;
    expect(applyCompletion(text, text.length, c)).toEqual({
      text: 'type:Person CLUSTER:Location',
      caret: 'type:Person CLUSTER:Location'.length,
    });
  });

  test('and keeps what follows the caret', () => {
    const text = 'CLUSTER:Loc type:Person';
    const c = completions(text, 11, INDEX).find(x => x.value === 'CLUSTER:Location')!;
    expect(applyCompletion(text, 11, c).text).toBe('CLUSTER:Location type:Person');
  });
});

describe('a path keeps going', () => {
  test('an entity slot offers what is inside it', () => {
    // `observations.by` is a slot; `observations.by.name` is a real address in
    // EVERY position. Offering only one level teaches that the grammar stops
    // there, and it does not.
    const v = values('SHOW:observations.by.');
    expect(v).toContain('SHOW:observations.by.name');
    expect(v).toContain('SHOW:observations.by.type');
  });

  test('a scalar column does not pretend to have an inside', () => {
    expect(values('SHOW:observations.magnitude.')).toEqual([]);
  });

  test('and it works in a binding too, not just a projection', () => {
    expect(values('CLUSTER:observations.by.')).toContain('CLUSTER:observations.by.name');
  });
});
