/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import { panelNames, derivePanes, makePane, reconcileDerived } from './derive';

describe('panelNames', () => {
  test('a bare name stops at the space', () => {
    // It used to allow spaces unquoted, so `PANEL:interests PANEL:places`
    // captured "interests PANEL" — a pane titled that, and one fewer than
    // asked for.
    expect(panelNames('PANEL:interests PANEL:places PANEL:observations'))
      .toEqual(['interests', 'places', 'observations']);
  });

  test('a quoted name may contain spaces', () => {
    expect(panelNames('PANEL:"Adriatic consignments" type:Person'))
      .toEqual(['Adriatic consignments']);
  });

  test('a comma list is several panes', () => {
    expect(panelNames('PANEL:interests,places')).toEqual(['interests', 'places']);
  });

  test('no PANEL, no panes', () => {
    expect(panelNames('type:Person degree>3')).toEqual([]);
  });
});

describe('derivePanes', () => {
  test('a named pane inherits the scope the engine resolved for it', () => {
    const panes = derivePanes('PANEL:interests', [], [
      { name: 'interests', q: 'type:"Interest"', kind: 'items' },
    ]);
    expect(panes).toHaveLength(1);
    expect(panes[0].q).toBe('type:"Interest"');
    expect(panes[0].kind).toBe('items');
  });

  test('additive — a query that stops naming a pane leaves it alone', () => {
    const first = derivePanes('PANEL:interests', []);
    const second = derivePanes('type:Person', first);
    expect(second.map(p => p.name)).toEqual(['interests']);
  });

  test('never duplicates a pane it already has', () => {
    const first = derivePanes('PANEL:interests', []);
    const again = derivePanes('PANEL:interests PANEL:interests', first);
    expect(again).toHaveLength(1);
  });
});

describe('makePane', () => {
  test('ids stay unique and stable, never random', () => {
    const a = makePane('Notes', []);
    const b = makePane('Notes', [a]);
    expect(a.id).toBe('notes');
    expect(b.id).toBe('notes-2');
  });
});

describe('reconcileDerived — a table pane follows the query', () => {
  const inf = (name: string) => ({ name, q: `SECTION:${name}`, kind: 'table' as const });

  test('a new section gets a pane even when the panel already has one', () => {
    // THE bug: seeding was gated on `panes.length === 0`, so once a panel had
    // any pane at all, a new section could never get one. The panel sat showing
    // `exhibits` — "No rows for this query" — while the engine returned tables
    // for observations and actors.
    const stale = makePane('exhibits', [], undefined, inf('exhibits'), true);
    const out = reconcileDerived([stale], [inf('observations'), inf('actors')]);
    expect(out.map(p => p.name).sort()).toEqual(['actors', 'observations']);
  });

  test('and the section that left loses its pane', () => {
    // A derived pane is a view of the query, not something anyone opened, so
    // "never subtract" does not protect it — it would only leave a pane that
    // can never have rows.
    const out = reconcileDerived(
      [makePane('observations', [], undefined, inf('observations'), true)],
      [inf('actors')],
    );
    expect(out.map(p => p.name)).toEqual(['actors']);
  });

  test('a pane the analyst opened is never touched', () => {
    const mine = { ...makePane('My question', []), q: 'type:Person' };
    const out = reconcileDerived([mine], [inf('actors')]);
    expect(out.find(p => p.name === 'My question')).toEqual(mine);
    expect(out.map(p => p.name).sort()).toEqual(['My question', 'actors']);
  });

  test('an unchanged set is left alone, so nothing rewrites the config', () => {
    const a = makePane('actors', [], undefined, inf('actors'), true);
    expect(reconcileDerived([a], [inf('actors')])).toEqual([a]);
  });

  test('an empty panel gets everything the engine inferred', () => {
    const out = reconcileDerived([], [inf('observations'), inf('actors')]);
    expect(out.map(p => p.name)).toEqual(['observations', 'actors']);
    expect(out.every(p => p.derived)).toBe(true);
  });
});
