/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { decodeNetwork, type NetworkWire, type Term, type TermKind } from '@/components/collection/graph/plane';
import { alternatives, keyOf, openField, read, resolve, spell } from './dialect';
import { suggest, type Catalog, type FieldOption } from './suggest';

const wire: NetworkWire = {
  nodes: {
    id: ['ann', 'bob', 'trump', 'trump2', 'acme'],
    name: ['Ann', 'Bob', 'Donald Trump', 'Trump Tower', 'Acme'],
    type: [0, 0, 0, 1, 1],
    kind: [0, 0, 0, 0, 0],
    frequency: [5, 2, 9, 1, 3],
    size: [null, null, null, null, null],
    t0: [null, null, null, null, null],
    t1: [null, null, null, null, null],
    ann: { offsets: [0, 0, 0, 0, 0, 0], ids: [] },
    places: { offsets: [0, 0, 0, 0, 0, 0], coord: [], rung: [], from: [], to: [], end: [] },
  },
  edges: { source: [], target: [], kind: [], predicate: [], weight: [] },
  vocab: {
    type: ['Person', 'Organization'], edge_kind: [], predicate: [], node_kind: ['entity'], rung: [], coord: [],
  },
  assets: { annotation: [], asset: [], time: [] },
  dropped_edges: 0,
  meta: { ms: 1, capped: false },
};

const field = (path: string, label: string, shape: FieldOption['shape'] = 'string'): FieldOption =>
  ({ path, label, schemas: ['News'], shape });
const fields = [
  field('document.location', 'Location'),
  field('document.severity', 'Severity', 'number'),
  field('document.topics[*]', 'Topics', 'array_string'),
  field('actors[*].name', 'name'),
];
const catalog: Catalog = {
  base: decodeNetwork(wire),
  types: [{ name: 'Person', count: 3 }, { name: 'Organization', count: 2 }],
  groups: [{ key: 'g1', label: 'Trump circle', size: 4 }],
  places: [{ name: 'Gaza City', count: 7 }, { name: 'Gaza', count: 3 }, { name: 'Berlin', count: 2 }],
  sets: [{ id: 's1', label: 'Hawks', count: 12 }],
  fields,
};
const terms = (line: string) => read(line, catalog).map((c) => resolve(c, catalog)?.term);
const nameOf = (kind: TermKind, v: string) =>
  kind === 'entity' ? catalog.base.name[catalog.base.index.get(v)!] : kind === 'group' ? 'Trump circle' : kind === 'set' ? 'Hawks' : v;

describe('the builder dialect', () => {
  test('a kind by its key, and a field by its name — `:` and `=` alike, spaced or not', () => {
    expect(terms('type:Person')).toEqual([{ kind: 'type', op: '=', values: ['Person'] }]);
    expect(terms('location = Gaza City')).toEqual([{ kind: 'value', field: 'document.location', op: '=', values: ['Gaza City'] }]);
    expect(terms('document.topics:energy')).toEqual([{ kind: 'value', field: 'document.topics[*]', op: '=', values: ['energy'] }]);
  });

  test('a value runs to the next key, so a line reads as clauses', () => {
    expect(terms('type:Person location = Gaza City -place:Berlin')).toEqual([
      { kind: 'type', op: '=', values: ['Person'] },
      { kind: 'value', field: 'document.location', op: '=', values: ['Gaza City'] },
      { kind: 'place', op: '!', values: ['Berlin'] },
    ]);
  });

  test('not, loosely, compared, by meaning', () => {
    expect(terms('type!=Organization')[0]?.op).toBe('!');
    expect(terms('topics:energ*')).toEqual([{ kind: 'value', field: 'document.topics[*]', op: '~', values: ['energ'] }]);
    expect(terms('severity >= 7')).toEqual([{ kind: 'value', field: 'document.severity', op: '=', cmp: '>=', values: ['7'] }]);
    expect(terms('severity: >7')[0]?.cmp).toBe('>');
    expect(terms('~ceasefire talks type:Person')).toEqual([
      { kind: 'about', op: '=', values: ['ceasefire talks'], range: [0.9, 1] },
      { kind: 'type', op: '=', values: ['Person'] },
    ]);
    expect(terms('-~war')[0]).toMatchObject({ kind: 'about', op: '!' });
    // A comparison needs a number.
    expect(terms('severity > high')).toEqual([undefined]);
  });

  test('a kind wins its key; a field of that name is reached by its path', () => {
    expect(terms('name:Ann')).toEqual([{ kind: 'name', op: '=', values: ['Ann'] }]);
    expect(terms('actors.name:Ann')[0]).toMatchObject({ kind: 'value', field: 'actors[*].name' });
    // `location` is the run's own field here; without one it is a place.
    expect(terms('where:Berlin')).toEqual([{ kind: 'place', op: '=', values: ['Berlin'] }]);
  });

  test('a closed list takes its name exactly, or the only one containing it — else waits for a pick', () => {
    expect(terms('place:gaza')).toEqual([{ kind: 'place', op: '=', values: ['Gaza'] }]);
    expect(terms('place:berl')).toEqual([{ kind: 'place', op: '=', values: ['Berlin'] }]);
    expect(terms('place:Ga')).toEqual([undefined]);
    expect(terms('group:trump')).toEqual([{ kind: 'group', op: '=', values: ['g1'] }]);
    expect(terms('type:Person,Organization')[0]?.values).toEqual(['Person', 'Organization']);
    expect(terms('type:Pers*')).toEqual([{ kind: 'type', op: '~', values: ['Pers'] }]);
  });

  test('words: a name containing them; quoted, a node by its name', () => {
    expect(terms('trump type:Person')[0]).toEqual({ kind: 'name', op: '~', values: ['trump'] });
    expect(terms('"Donald Trump"')).toEqual([{ kind: 'entity', op: '=', values: ['trump'] }]);
    expect(terms('"Donald Trump"*')).toEqual([{ kind: 'entity', op: '~', values: ['trump'] }]);
    expect(terms('trump*')).toEqual([{ kind: 'name', op: '~', values: ['trump'] }]);
  });

  test('what is not a key stays words', () => {
    expect(read('meeting at 10:30', catalog).map((c) => c.target.kind)).toEqual(['words']);
    expect(read('locaton:Gaza', catalog)[0].target).toEqual({ kind: 'unknown', key: 'locaton' });
    expect(read('~e = mc2', catalog).map((c) => c.target.kind)).toEqual(['about']);
  });

  test('commas are alternatives, outside quotes', () => {
    expect(alternatives('a, "b, c" ,d')).toEqual(['a', 'b, c', 'd']);
  });

  test('a term spells back into what reads as it', () => {
    const cases: Term[] = [
      { kind: 'type', op: '=', values: ['Person', 'Organization'] },
      { kind: 'place', op: '!', values: ['Gaza City'] },
      { kind: 'value', field: 'document.location', op: '=', values: ['Gaza City'] },
      { kind: 'value', field: 'document.topics[*]', op: '~', values: ['energ'] },
      { kind: 'value', field: 'document.severity', op: '=', cmp: '<', values: ['3'] },
      { kind: 'entity', op: '~', values: ['trump'] },
      { kind: 'group', op: '=', values: ['g1'] },
      { kind: 'name', op: '~', values: ['tru'] },
    ];
    for (const t of cases) expect(terms(spell(t, nameOf, fields)!)).toEqual([t]);
    expect(spell({ kind: 'region', op: '=', values: [] }, nameOf, fields)).toBeUndefined();
    expect(keyOf(fields[3], fields)).toBe('actors.name');
    expect(keyOf(fields[0], fields)).toBe('location');
  });

  test('the field being typed to is open for its values', () => {
    expect(openField('type:Person location = Ga', catalog)).toMatchObject({ field: { path: 'document.location' }, search: 'Ga' });
    expect(openField('location = Gaza, Ra', catalog)?.search).toBe('Ra');
    expect(openField('severity > 3', catalog)).toBeNull();
  });
});

describe('offers for a typed line', () => {
  test('the line as typed first, carrying its other clauses; then the last clause completed', () => {
    const out = suggest('type:Person place:Ga', catalog);
    expect(out[0]).toMatchObject({ kind: 'term', label: 'Gaza City', also: [{ kind: 'type', op: '=', values: ['Person'] }] });
    expect(out.map((s) => s.label)).toEqual(['Gaza City', 'Gaza']);
    const whole = suggest('type:Person place:Berlin', catalog)[0];
    expect(whole).toMatchObject({ typed: true, label: 'type = Person · place = Berlin', term: { kind: 'place', values: ['Berlin'] } });
  });

  test('a field’s values, joining the alternatives typed before', () => {
    const out = suggest('location = Gaza, Ra', catalog, [{ value: 'Rafah', count: 4 }]);
    expect(out.find((s) => s.label === 'Rafah')).toMatchObject({ term: { values: ['Gaza', 'Rafah'] } });
  });

  test('bare words keep the find offers, with the words loosely and by meaning pinned', () => {
    const out = suggest('trump', catalog);
    expect(out.slice(0, 2).map((s) => s.kind === 'term' && s.node)).toEqual([3, 2]);
    expect(out.filter((s) => s.kind === 'term' && s.pinned).map((s) => s.kind === 'term' && s.term.kind)).toEqual(['name', 'about']);
    expect(suggest('ty', catalog).some((s) => s.kind === 'text' && s.text === 'type:')).toBe(true);
  });

  test('a key that names nothing offers what it might have meant', () => {
    const out = suggest('locaton:Gaza', catalog);
    expect(out.some((s) => s.kind === 'field' && s.field.path === 'document.location')).toBe(true);
  });
});
