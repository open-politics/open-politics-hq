import { describe, expect, test } from 'bun:test';
import { nodeIdsOf, refsOf, scalarsOf, type RowItem } from './rowTypes';

describe('a cell may hold many references, and stays one cell', () => {
  test('a single reference', () => {
    expect(refsOf({ name: 'Halász', type: 'Person', nodeId: 'a' }))
      .toEqual([{ name: 'Halász', type: 'Person', nodeId: 'a' }]);
  });

  test('a multi-valued slot flattens for DISPLAY, never into rows', () => {
    // A payment with two payers is one payment. Exploding here would multiply
    // the table and make `total` — which the server counted — a lie.
    const refs = refsOf([
      { name: 'A', nodeId: '1' },
      { name: 'B', nodeId: '2' },
    ]);
    expect(refs.map(r => r.name)).toEqual(['A', 'B']);
  });

  test('a scalar is not a reference', () => {
    expect(refsOf(250000)).toEqual([]);
    expect(refsOf('2016-01-12')).toEqual([]);
    expect(refsOf(null)).toEqual([]);
  });

  test('an object that is not an entity is not a reference', () => {
    expect(refsOf({ reasoning: 'because', quote: 'x' })).toEqual([]);
  });
});

describe('a row addresses the canvas', () => {
  const item: RowItem = {
    id: '58390:observations:1',
    annotationId: 58390,
    cells: {
      by: [{ name: 'Halász', type: 'Person', nodeId: 'n1' }],
      to: [{ name: 'Corvus', type: 'Organization', nodeId: 'n2' }],
      magnitude: 250000,
      when: '2016-01-12',
    },
  };

  test('every entity it touches, and nothing else', () => {
    // This is what makes selection ONE thing across two surfaces: the row
    // knows the ids the assembler minted, so neither surface has to know the
    // other's shape and there is nothing to reconcile.
    expect(nodeIdsOf(item).sort()).toEqual(['n1', 'n2']);
  });

  test('a reference the graph never minted contributes no id', () => {
    // Rather than an undefined that would silently match nothing.
    expect(nodeIdsOf({
      ...item,
      cells: { by: [{ name: 'Someone unresolved' }] },
    })).toEqual([]);
  });
});

describe('a row is reachable by its own act, not only by its cast', () => {
  test('the row\'s own node counts as touched', () => {
    // Without `item.nodeId`, clicking a payment on the canvas matched no row
    // and the table emptied with "Nothing in the selection touches these rows".
    const it: RowItem = {
      id: 'r1', annotationId: 1, nodeId: 'act-1',
      cells: { by: [{ name: 'A', nodeId: 'n1' }] },
    };
    expect(nodeIdsOf(it)).toContain('act-1');
    expect(nodeIdsOf(it)).toContain('n1');
  });

  test('a roster row that minted nothing still reports its cast', () => {
    const it: RowItem = {
      id: 'r2', annotationId: 1,
      cells: { by: [{ name: 'A', nodeId: 'n1' }] },
    };
    expect(nodeIdsOf(it)).toEqual(['n1']);
  });
});

describe('a scalar array is a list, not JSON', () => {
  test('bare strings come back as values', () => {
    // `["HBRK Associates Inc.","Unnamed foundation"]` on screen is the wire
    // format leaking: the brackets are noise and the names are the content.
    expect(scalarsOf(['HBRK Associates Inc.', 'Unnamed foundation']))
      .toEqual(['HBRK Associates Inc.', 'Unnamed foundation']);
  });

  test('numbers and nested arrays flatten', () => {
    expect(scalarsOf([1, [2, 3]])).toEqual(['1', '2', '3']);
  });

  test('objects are not scalars — they are references, handled elsewhere', () => {
    expect(scalarsOf([{ name: 'A' }])).toEqual([]);
  });

  test('empties drop rather than rendering as blanks', () => {
    expect(scalarsOf([null, '', 'x'])).toEqual(['x']);
  });
});
