import { describe, expect, test } from 'bun:test';
import { nodeIdsOf, type SectionRows } from './rowTypes';

/** The fold the docs surface does, extracted so it can be asserted without a
 *  DOM. Mirrors `DocsTable::groupByDocument`. */
function groupByDocument(tables: ReadonlyArray<SectionRows>) {
  const byDoc = new Map<number, { sections: Set<string>; nodeIds: Set<string>; rows: number }>();
  for (const t of tables) {
    for (const it of t.items) {
      let g = byDoc.get(it.annotationId);
      if (!g) { g = { sections: new Set(), nodeIds: new Set(), rows: 0 }; byDoc.set(it.annotationId, g); }
      g.sections.add(t.section);
      g.rows += 1;
      for (const id of nodeIdsOf(it)) g.nodeIds.add(id);
    }
  }
  return byDoc;
}

const table = (section: string, items: any[]): SectionRows => ({
  section, path: `document.${section}[*]`, columns: [], items, total: items.length, notes: [],
});

describe('a document spans every section', () => {
  const tables = [
    table('observations', [
      { id: 'o1', annotationId: 7, assetId: 1, nodeId: 'act-1',
        cells: { by: [{ name: 'A', nodeId: 'n1' }] } },
      { id: 'o2', annotationId: 7, assetId: 1, nodeId: 'act-2',
        cells: { by: [{ name: 'B', nodeId: 'n2' }] } },
    ]),
    table('actors', [
      { id: 'a1', annotationId: 7, assetId: 1, cells: { '@self': { name: 'A', nodeId: 'n1' } } },
      { id: 'a2', annotationId: 9, assetId: 2, cells: { '@self': { name: 'C', nodeId: 'n3' } } },
    ]),
  ];

  test('one entry per document, not per section', () => {
    const g = groupByDocument(tables);
    expect([...g.keys()].sort()).toEqual([7, 9]);
    expect([...g.get(7)!.sections].sort()).toEqual(['actors', 'observations']);
  });

  test('its subgraph is every node its rows touched', () => {
    // Including each row's OWN node — this is what "highlight subgraph" lights
    // up, and the old counter read 0 on every observation-model run because it
    // re-matched edges by label against `document.triplets`.
    expect([...groupByDocument(tables).get(7)!.nodeIds].sort())
      .toEqual(['act-1', 'act-2', 'n1', 'n2']);
  });

  test('a node named by two documents belongs to both', () => {
    // Not a conflict — it is the linking payoff, and the reason a document's
    // subgraph is a set rather than a partition.
    const g = groupByDocument([
      ...tables,
      table('actors', [{ id: 'a3', annotationId: 9, assetId: 2,
                        cells: { '@self': { name: 'A', nodeId: 'n1' } } }]),
    ]);
    expect(g.get(7)!.nodeIds.has('n1')).toBe(true);
    expect(g.get(9)!.nodeIds.has('n1')).toBe(true);
  });

  test('nothing in scope is not an error', () => {
    expect(groupByDocument([]).size).toBe(0);
  });
});
