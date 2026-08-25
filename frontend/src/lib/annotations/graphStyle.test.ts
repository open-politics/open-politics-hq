import { describe, expect, test } from 'bun:test';
import { hasGraphStyle, readGraphStyle, readNodeStyles } from './graphStyle';

describe('readNodeStyles', () => {
  test('splits a per-type object into the maps the renderer wants', () => {
    expect(readNodeStyles({
      Interest: { icon: 'ActivityIcon', color: '#8b5cf6' },
      Event: { icon: 'CalendarRange' },
    })).toEqual({
      colors: { INTEREST: '#8b5cf6' },
      icons: { INTEREST: 'ActivityIcon', EVENT: 'CalendarRange' },
    });
  });

  test('junk is dropped rather than propagated', () => {
    expect(readNodeStyles({ A: null, B: 'nope', C: { icon: 4 }, '': { icon: 'x' } }))
      .toEqual({ colors: {}, icons: {} });
    expect(readNodeStyles(undefined)).toEqual({ colors: {}, icons: {} });
  });
});

describe('readGraphStyle — precedence', () => {
  test('the schema palette outranks every older form', () => {
    const contract = {
      'x-nodeStyles': { Person: { icon: 'Crown', color: '#111111' } },
      properties: {
        document: {
          properties: {
            actors: {
              items: {
                'x-entityType': 'Person',
                'x-entityIcon': 'User',
                'x-entityColor': '#222222',
              },
            },
            triplets: {
              items: {
                properties: {
                  subject_type: {
                    'x-entityTypeIcons': { Person: 'Users' },
                    'x-entityTypeColors': { Person: '#333333' },
                  },
                },
              },
            },
          },
        },
      },
    };
    const style = readGraphStyle(contract);
    expect(style.typeIcons.PERSON).toBe('Crown');
    expect(style.typeColors.PERSON).toBe('#111111');
  });

  test('a type map outranks a single field', () => {
    const style = readGraphStyle({
      properties: {
        a: { 'x-entityType': 'Person', 'x-entityIcon': 'User' },
        b: { 'x-entityTypeIcons': { PERSON: 'Users' } },
      },
    });
    expect(style.typeIcons.PERSON).toBe('Users');
  });

  test('a field declaration still wins over the legacy graphConfig nesting', () => {
    const style = readGraphStyle({
      properties: {
        legacy: { graphConfig: { entityTypes: { typeIcons: { PERSON: 'Ghost' } } } },
        actors: { 'x-entityType': 'Person', 'x-entityIcon': 'User' },
      },
    });
    expect(style.typeIcons.PERSON).toBe('User');
  });

  test('the legacy nesting is still read when it is all there is', () => {
    const style = readGraphStyle({
      properties: {
        t: {
          graphConfig: {
            entityTypes: { typeColors: { person: '#abcdef' }, typeIcons: { person: 'User' } },
            relationshipSchema: {
              predicateColors: { works_for: '#123456' },
              predicateArrows: { works_for: 'both' },
            },
          },
        },
      },
    });
    expect(style.typeColors.PERSON).toBe('#abcdef');
    expect(style.typeIcons.PERSON).toBe('User');
    expect(style.predicateColors.works_for).toBe('#123456');
    expect(style.predicateArrows.works_for).toBe('both');
  });
});

describe('readGraphStyle — a ref carries vocabulary, never appearance', () => {
  // Schema 18397, reduced. The icon was set once, on `interests`. Ref
  // expansion copied it onto roles typed `Person`, and reading field
  // declarations blind gave every person the interest glyph.
  const contract = {
    properties: {
      document: {
        properties: {
          interests: {
            items: { 'x-entityType': 'Interest', 'x-entityIcon': 'ActivityIcon' },
          },
          relations: {
            items: {
              properties: {
                from: {
                  'x-entityType': 'Person',
                  'x-entityIcon': 'ActivityIcon',
                  'x-ref': ['actors', 'places', 'interests'],
                },
              },
            },
          },
        },
      },
    },
  };

  test('the declaring field is honoured', () => {
    expect(readGraphStyle(contract).typeIcons.INTEREST).toBe('ActivityIcon');
  });

  test('the ref that inherited it is not', () => {
    expect(readGraphStyle(contract).typeIcons.PERSON).toBeUndefined();
  });
});

describe('readGraphStyle — nothing said, nothing returned', () => {
  test('an undeclared contract leaves the renderer its own defaults', () => {
    expect(hasGraphStyle(readGraphStyle({ properties: { a: { type: 'string' } } }))).toBe(false);
    expect(hasGraphStyle(readGraphStyle(null))).toBe(false);
    expect(hasGraphStyle(readGraphStyle('nonsense'))).toBe(false);
  });

  test('arrows outside the vocabulary are dropped', () => {
    const style = readGraphStyle({ properties: { r: { 'x-predicateArrows': { a: 'sideways', b: 'none' } } } });
    expect(style.predicateArrows).toEqual({ b: 'none' });
  });
});
