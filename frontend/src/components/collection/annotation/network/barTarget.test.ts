import { describe, expect, test } from 'bun:test';
import type { BarItem } from '@/lib/commandBar';
import type { NodeSet, Term } from '@/components/collection/graph/plane';
import type { NetworkView } from '@/lib/annotations/types';
import type { Catalog } from './suggest';
import { networkTarget } from './barTarget';

const item = (term: Term, node?: number): BarItem => ({
  key: `${term.kind}:${term.values.join('|')}`, label: term.values.join(' / '), op: term.op, data: { term, node },
});
const trump = item({ kind: 'entity', op: '=', values: ['n:trump'] }, 7);
const berlin = item({ kind: 'place', op: '=', values: ['Berlin'] });
const interest = item({ kind: 'type', op: '=', values: ['Financial Interest'] });

function target(catalog: Catalog | null = {} as Catalog) {
  const calls = { goTo: [] as number[], sets: [] as NodeSet[], views: [] as Partial<NetworkView>[] };
  const t = networkTarget({
    label: 'Network',
    catalog,
    loadValues: async () => [],
    goTo: (n) => calls.goTo.push(n),
    addSet: (s) => calls.sets.push(s),
    setView: (v) => calls.views.push(v),
    view: undefined,
  });
  return { t, calls, find: t.find!, command: (name: string) => t.commands!.find((c) => c.name === name)! };
}

describe('network bar target', () => {
  test('a name on its own goes to it', () => {
    const { find, calls } = target();
    find.go([trump]);
    expect(calls.goTo).toEqual([7]);
    expect(calls.sets).toEqual([]);
  });

  test('a loosened name is a set — the node and what it links to', () => {
    const { find, calls } = target();
    find.go([find.turn!(trump)]);
    expect(calls.goTo).toEqual([]);
    expect(calls.sets[0].terms).toEqual([{ kind: 'entity', op: '~', values: ['n:trump'] }]);
  });

  test('beside other terms, a held name reads as what links to it', () => {
    const { find } = target();
    const held = find.settle!([berlin, trump, interest]);
    expect(held.map((i) => i.op)).toEqual(['=', '~', '=']);
    // …and one held alone stays itself.
    expect(find.settle!([trump])[0].op).toBe('=');
  });

  test('/geo with picks makes the set, then lays out on the map', () => {
    const { find, calls, command } = target();
    command('geo').run(find.settle!([berlin, trump, interest]));
    expect(calls.sets).toHaveLength(1);
    expect(calls.sets[0].terms.map((t) => `${t.kind}${t.op}${t.values[0]}`))
      .toEqual(['place=Berlin', 'entity~n:trump', 'type=Financial Interest']);
    expect(calls.views).toEqual([{ core: 'geo', geo: { preset: 'stated', neighbours: true } }]);
  });

  test('a view command with nothing picked only changes the view', () => {
    const { calls, command } = target();
    command('deep').run([]);
    expect(calls.sets).toEqual([]);
    expect(calls.views[0]).toMatchObject({ core: 'time', time: { mode: 'deep' } });
  });

  test('values of a kind join as alternatives; a field still open is left out', () => {
    const { find, calls } = target();
    const munich = item({ kind: 'place', op: '=', values: ['Munich'] });
    const open: BarItem = { key: 'field:sentiment', label: 'sentiment', open: true, data: { field: {}, op: '=' } };
    find.go([berlin, munich, open]);
    expect(calls.sets[0].terms).toEqual([{ kind: 'place', op: '=', values: ['Berlin', 'Munich'] }]);
  });

  test('searchable before the network is in — nothing offered yet, never nothing to search', async () => {
    const { t } = target(null);
    expect(t.find).toBeDefined();
    expect(await t.find!.suggest('Berlin', [])).toEqual([]);
  });
});
