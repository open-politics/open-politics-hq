import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TYPE_ICONS,
  getIconNode,
  iconNodeToPathData,
  loadIconNode,
  normalizeIconName,
  resolveEntityIcon,
} from './icons';

describe('normalizeIconName — one glyph, four spellings', () => {
  test('the suffixed alias the picker actually writes', () => {
    // Schema 18397 stores exactly this for its `interests` section, and it is
    // the spelling that resolved to nothing for the whole life of the feature.
    expect(normalizeIconName('ActivityIcon')).toBe('activity');
  });

  test('lucide PascalCase, kebab, and digits in the stem', () => {
    expect(normalizeIconName('Activity')).toBe('activity');
    expect(normalizeIconName('activity')).toBe('activity');
    expect(normalizeIconName('MapPin')).toBe('map-pin');
    expect(normalizeIconName('map-pin')).toBe('map-pin');
    // `Building2` is a module named `building-2`; a naive kebab gives
    // `building2` and silently finds nothing.
    expect(normalizeIconName('Building2')).toBe('building-2');
  });

  test('HeroIcon names from pre-Phase-9 schemas', () => {
    expect(normalizeIconName('BuildingOfficeIcon')).toBe('building-2');
    expect(normalizeIconName('UserIcon')).toBe('user');
    // Not in the alias table — stripping the suffix still lands it.
    expect(normalizeIconName('CompassIcon')).toBe('compass');
  });

  test('nothing in, nothing out', () => {
    expect(normalizeIconName('')).toBe('');
    expect(normalizeIconName('   ')).toBe('');
    expect(normalizeIconName(null)).toBe('');
    expect(normalizeIconName(undefined)).toBe('');
  });
});

describe('iconNodeToPathData — every tag lucide draws with', () => {
  test('path passes through', () => {
    expect(iconNodeToPathData([['path', { d: 'M1 2L3 4' }]])).toEqual(['M1 2L3 4']);
  });

  test('circle becomes two half-arcs, not one degenerate one', () => {
    const [d] = iconNodeToPathData([['circle', { cx: '12', cy: '12', r: '10' }]]);
    expect(d).toBe('M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z');
  });

  test('line, polyline, polygon', () => {
    expect(iconNodeToPathData([['line', { x1: '1', y1: '2', x2: '3', y2: '4' }]]))
      .toEqual(['M1 2L3 4']);
    expect(iconNodeToPathData([['polyline', { points: '1 2 3 4 5 6' }]]))
      .toEqual(['M1 2L3 4L5 6']);
    expect(iconNodeToPathData([['polygon', { points: '1,2 3,4 5,6' }]]))
      .toEqual(['M1 2L3 4L5 6Z']);
  });

  test('rect, square and rounded', () => {
    expect(iconNodeToPathData([['rect', { x: '2', y: '3', width: '10', height: '4' }]]))
      .toEqual(['M2 3h10v4h-10Z']);
    const [rounded] = iconNodeToPathData([
      ['rect', { x: '0', y: '0', width: '10', height: '10', rx: '2' }],
    ]);
    // `rx` alone implies `ry`, so the corners are symmetric.
    expect(rounded).toContain('a2 2 0 0 1');
    expect(rounded.startsWith('M2 0')).toBe(true);
  });

  test('degenerate and unknown shapes are dropped, not drawn wrong', () => {
    expect(iconNodeToPathData([['circle', { cx: '1', cy: '1', r: '0' }]])).toEqual([]);
    expect(iconNodeToPathData([['rect', { width: '0', height: '5' }]])).toEqual([]);
    expect(iconNodeToPathData([['foreignObject', { x: '1' }]] as any)).toEqual([]);
    expect(iconNodeToPathData([['polyline', { points: '1 2' }]])).toEqual([]);
    expect(iconNodeToPathData(null)).toEqual([]);
  });
});

describe('registry', () => {
  test('every default type icon is statically bundled', () => {
    // The point of the builtin set is that an undeclared graph paints on the
    // first frame with no chunk load. A default that is not builtin breaks
    // that silently — it renders, just one async hop later.
    for (const [type, icon] of Object.entries(DEFAULT_TYPE_ICONS)) {
      expect(getIconNode(icon), `${type} → ${icon}`).not.toBeNull();
    }
  });

  test('builtins carry real geometry', () => {
    expect(iconNodeToPathData(getIconNode('user')).length).toBeGreaterThan(0);
    expect(iconNodeToPathData(getIconNode('ActivityIcon')).length).toBeGreaterThan(0);
  });

  test('a non-builtin is absent until loaded, then cached', async () => {
    expect(getIconNode('anchor')).toBeNull();
    expect(await loadIconNode('AnchorIcon')).not.toBeNull();
    expect(getIconNode('anchor')).not.toBeNull();
  });

  test('an icon lucide does not have resolves to null, not a throw', async () => {
    expect(await loadIconNode('NotARealGlyphAtAll')).toBeNull();
  });
});

describe('resolveEntityIcon — same precedence chain as resolveEntityColor', () => {
  const schemaIcons = { INTEREST: 'ActivityIcon', PERSON: 'Compass' };

  test('declared beats default, and is normalized on the way out', () => {
    expect(resolveEntityIcon('Interest', { schemaIcons })).toBe('activity');
    expect(resolveEntityIcon('person', { schemaIcons })).toBe('compass');
  });

  test('infospace beats schema', () => {
    expect(resolveEntityIcon('Person', { schemaIcons, infospaceIcons: { PERSON: 'Crown' } }))
      .toBe('crown');
  });

  test('undeclared falls to the type default', () => {
    expect(resolveEntityIcon('Location')).toBe('map-pin');
    expect(resolveEntityIcon('Event')).toBe('calendar');
  });

  test('an unknown type gets no glyph rather than a wrong one', () => {
    expect(resolveEntityIcon('Vessel')).toBeNull();
    expect(resolveEntityIcon('')).toBeNull();
    expect(resolveEntityIcon(null)).toBeNull();
  });

  test('defaults can be switched off without losing declarations', () => {
    // What the `showNodeIcons` toggle governs: the author's statement always
    // paints, the palette's guess only when asked for.
    const off = { includeDefaults: false };
    expect(resolveEntityIcon('Interest', { schemaIcons }, off)).toBe('activity');
    expect(resolveEntityIcon('Location', { schemaIcons }, off)).toBeNull();
  });
});
