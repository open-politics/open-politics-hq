/**
 * The network panel as a command-bar target (`lib/commandBar.ts`).
 *
 * Typing in the bar while the panel is aimed at searches the network the way
 * its set builder does — the same offers (`suggest.ts`), the same terms
 * (`plane/sets.ts`). ↵ on a name goes to it; ↵ on anything else, or on
 * several picks, makes them a set and picks it, so it lights with its links
 * as a set picked in the panel does.
 *
 * The views are commands that take picks: `/geo Berlin ⇥ Trump ⇥ Interest ↵`
 * makes that set, picks it and lays the network out on the map, in one line.
 * With nothing picked, a view command only changes the view.
 *
 * One reading the bar adds to the builder's: beside other terms, a name held
 * as `= Trump` is read as `~ Trump` — the node *and what it links to*. A set
 * of exactly one node narrowed by anything else is that node or nothing, so
 * that is never what a line like the one above means. It is shown on the
 * chip, and a click on the operator turns it back.
 */
import type { BarCommand, BarItem, BarTarget } from '@/lib/commandBar';
import {
  OP_GLYPH, addTerm, fieldLabel, newSetId, nextOp,
  type NodeSet, type Term, type TermOp,
} from '@/components/collection/graph/plane';
import type { NetworkView } from '@/lib/annotations/types';
import { suggest, valueSuggestions, type Catalog, type FieldOption, type Suggestion } from './suggest';
import { DEFAULT_GEO, DEFAULT_TIME } from './ViewButtons';

/** A held item, to the network: a term (and the node it names), or a field
 *  waiting for its value under an operator. */
type Pick = { term: Term; node?: number } | { field: FieldOption; op: TermOp };

const pickOf = (item: BarItem) => item.data as Pick;

function termItem(term: Term, label: string, extra: Partial<BarItem> = {}): BarItem {
  return {
    key: `${term.kind}:${term.field ?? ''}:${term.values.join('|')}`,
    label,
    facet: term.kind === 'value' ? fieldLabel(term.field ?? '') : term.kind === 'entity' ? undefined : term.kind,
    op: OP_GLYPH[term.op],
    // A loose name reads as its words, not as the offer's sentence.
    chip: term.kind === 'name' ? `“${term.values[0]}”` : undefined,
    ...extra,
  };
}

function fieldItem(field: FieldOption, op: TermOp): BarItem {
  return {
    key: `field:${field.path}`, label: field.label, hint: `field · ${field.schemas.join(', ')}`,
    facet: field.label, op: OP_GLYPH[op], open: true, data: { field, op } satisfies Pick,
  };
}

function itemOf(s: Suggestion): BarItem {
  if (s.kind === 'field') return { ...fieldItem(s.field, '='), label: s.label, hint: s.hint };
  return termItem(s.term, s.label, { hint: s.hint, count: s.count, data: { term: s.term, node: s.node } satisfies Pick });
}

/** The item with its operator turned, `=` → `~` → `≠`. */
function turn(item: BarItem): BarItem {
  const p = pickOf(item);
  if ('field' in p) return { ...item, ...fieldItem(p.field, nextOp(p.op)), label: item.label, hint: item.hint };
  const term = { ...p.term, op: nextOp(p.term.op) };
  return { ...item, op: OP_GLYPH[term.op], data: { ...p, term } satisfies Pick };
}

/** Beside other terms, a name held as `=` is read as `~` (see above). */
function settle(held: BarItem[]): BarItem[] {
  if (held.filter((i) => !i.open).length < 2) return held;
  return held.map((item) => {
    const p = pickOf(item);
    if (item.open || !('term' in p) || p.term.kind !== 'entity' || p.term.op !== '=') return item;
    const term: Term = { ...p.term, op: '~' };
    return { ...item, op: OP_GLYPH['~'], data: { ...p, term } satisfies Pick };
  });
}

/** The terms of what is held, as one set — values of a kind joining as
 *  alternatives, as in the builder. */
function setOf(held: BarItem[]): NodeSet {
  return held.reduce<NodeSet>((set, item) => {
    const p = pickOf(item);
    return 'term' in p ? addTerm(set, p.term) : set;
  }, { id: newSetId(), terms: [] });
}

export function networkTarget({
  label, catalog, loadValues, goTo, addSet, setView, view,
}: {
  label: string;
  catalog: Catalog | null;
  loadValues: (field: FieldOption, search: string) => Promise<Array<{ value: string; count: number }>>;
  /** To a node of the network underneath. */
  goTo: (node: number) => void;
  /** A new set, picked. */
  addSet: (set: NodeSet) => void;
  setView: (patch: Partial<NetworkView>) => void;
  view: NetworkView | null | undefined;
}): BarTarget {
  /** Picks made a set, when there are any. */
  const gather = (held: BarItem[]) => {
    const set = setOf(held);
    if (set.terms.length) addSet(set);
  };
  const layout = (name: string, title: string, hint: string, patch: () => Partial<NetworkView>): BarCommand => ({
    name, title, hint, takes: true,
    run: (held) => { gather(held); setView(patch()); },
  });

  return {
    label,
    // Searchable from the first frame: until the network is in, nothing to offer.
    find: {
      placeholder: `Search ${label} — a name, type, group, place, field`,
      suggest: async (text, held) => {
        const last = held.at(-1);
        const p = last?.open ? pickOf(last) : null;
        if (p && 'field' in p) {
          const values = await loadValues(p.field, text.trim());
          return valueSuggestions(p.field, p.op, text, values).map(itemOf);
        }
        return catalog ? suggest(text, catalog).map(itemOf) : [];
      },
      go: (held) => {
        const only = held.length === 1 ? pickOf(held[0]) : null;
        // A name, as itself: go to it. Loosened or negated, it is a set.
        if (only && 'term' in only && only.node != null && only.term.op === '=') { goTo(only.node); return; }
        gather(held);
      },
      turn,
      settle,
    },
    commands: [
      layout('geo', 'Geo', 'Each node at its place, on the map',
        () => ({ core: 'geo', geo: view?.geo ?? DEFAULT_GEO })),
      layout('time', 'Time', 'Left to right by when each node is',
        () => ({ core: 'time', time: { ...(view?.time ?? DEFAULT_TIME), mode: 'flat' } })),
      layout('deep', 'Deep time', 'The present in front, what follows behind it',
        () => ({ core: 'time', time: { ...(view?.time ?? DEFAULT_TIME), mode: 'deep' } })),
      layout('groups', 'Groups', 'Laid out by the groups its links make',
        () => ({ core: 'groups' })),
    ],
  };
}
