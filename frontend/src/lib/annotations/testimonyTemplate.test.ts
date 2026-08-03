/**
 * The shipped `testimony` template, through the editor, unchanged.
 *
 * `templateRoundTrip.test.ts` proves the *mechanism* on a hand-written
 * fixture. This proves the actual artifact: the JSON `templates.py` serves is
 * checked in beside this file, so if the generator drifts from what the editor
 * can parse, this fails rather than a user's schema quietly losing its links.
 *
 * Regenerate the fixture with:
 *   docker compose exec -T backend python -c "import json; \
 *     from app.api.modules.annotation.templates import build_contract; \
 *     print(json.dumps(build_contract('full', \
 *       ['statements','citations','seats','memberships']), indent=2))"
 */
import { describe, expect, it } from 'bun:test';
import CONTRACT from './__fixtures__/testimonyContract.json';
import {
  adaptSchemaReadToSchemaFormData,
  adaptSchemaFormDataToSchemaCreate,
} from './adapters';
import type { AdvancedSchemeField } from './types';

function roundTrip(contract: any) {
  const form = adaptSchemaReadToSchemaFormData({
    name: 'Testimony', description: '', output_contract: contract,
  } as any);
  const out = adaptSchemaFormDataToSchemaCreate({ ...form, name: 'Testimony' });
  return { form, contract: out.output_contract as any };
}

const doc = (c: any) => c?.properties?.document?.properties ?? {};
const fields = (f: any): AdvancedSchemeField[] => f.structure[0].fields;
const byName = (fs: AdvancedSchemeField[], n: string) => fs.find(f => f.name === n)!;

describe('testimony template → editor', () => {
  it('loads every section into the editor', () => {
    const fs = fields(roundTrip(CONTRACT).form);
    // `interests` sits with `places` rather than with `instruments`: the
    // why-axis arrives at STANDARD tier, because two of the six investigation
    // shapes are news-shaped and turn entirely on it.
    expect(fs.map(f => f.name)).toEqual([
      'actors', 'places', 'interests', 'instruments',
      'events', 'observations', 'attributes', 'relations', 'evidence',
      'at', 'dated', 'ref',
    ]);
  });

  it('renders rosters as entity arrays the editor can edit', () => {
    const fs = fields(roundTrip(CONTRACT).form);
    for (const [name, type] of [
      ['actors', 'Person'], ['places', 'Location'],
      ['interests', 'Interest'], ['instruments', 'Account'],
    ] as const) {
      const f = byName(fs, name);
      expect(f.type).toBe('array');
      expect(f.items?.type).toBe('entity');
      expect(f.items?.entityConfig?.entity_type).toBe(type);
    }
  });

  it('renders the observation row with every binding the projection needs', () => {
    const obs = byName(fields(roundTrip(CONTRACT).form), 'observations');
    const props = obs.items!.properties!;
    const names = props.map(p => p.name);
    // the generic roles · node identity · the two clocks · place · the label
    expect(names).toEqual(expect.arrayContaining([
      'kind', 'by', 'with', 'to', 'via', 'concerns',
      'at', 'when', 'until', 'covers_from', 'covers_until',
      'modality', 'magnitude', 'id', 'serves', 'cites', 'during',
    ]));
    // `via` is the hub slot — a cross-domain query depends on it existing here.
    expect(byName(props, 'via').items?.type).toBe('entity');
    expect(byName(props, 'during').items?.entityConfig?.entity_type).toBe('Event');
    expect(byName(props, 'cites').items?.entityConfig?.entity_type).toBe('Evidence');
    expect(byName(props, 'modality').enum).toContain('denied');
    expect(byName(props, 'kind').enum).toContain('testimony');
  });

  it('renders the events row — the referent layer', () => {
    const ev = byName(fields(roundTrip(CONTRACT).form), 'events');
    const names = ev.items!.properties!.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['name', 'kind', 'when', 'until', 'at']));
  });

  it('keeps every roster link — the whole point of the schema', () => {
    // Lose one of these and the same person named in three rows becomes three
    // nodes. It is silent: the run succeeds and the graph is quietly wrong.
    const out = roundTrip(CONTRACT).contract;
    const obs = doc(out).observations.items.properties;
    expect(obs.by.items['x-ref']).toBe('actors');
    expect(obs.with.items['x-ref']).toBe('actors');
    expect(obs.at['x-ref']).toBe('places');
    expect(obs.serves.items['x-ref']).toBe('interests');

    // Unions — a role that spans rosters says so.
    expect(obs.to.items['x-ref']).toEqual(['actors', 'instruments']);
    expect(obs.via.items['x-ref']).toEqual(['actors', 'instruments']);
    expect(obs.concerns.items['x-ref']).toEqual(['actors', 'instruments', 'places']);

    const attr = doc(out).attributes.items.properties;
    expect(attr.subject['x-ref']).toEqual(
      ['actors', 'instruments', 'places', 'interests']);
    expect(attr.place['x-ref']).toBe('places');

    // Both ends span every roster. Referencing `actors` alone made an
    // ownership chain through shells undeclarable — a shell lives in
    // `instruments` — and forbade hierarchy outright, since a place inside a
    // place is a link between two members of ONE roster.
    const rel = doc(out).relations.items.properties;
    const ROSTERS = ['actors', 'instruments', 'places', 'interests'];
    expect(rel.from['x-ref']).toEqual(ROSTERS);
    expect(rel.to['x-ref']).toEqual(ROSTERS);

    expect(doc(out).at['x-ref']).toBe('places');
    expect(doc(out).events.items.properties.at['x-ref']).toBe('places');
  });

  it('keeps cardinality per role, across a union', () => {
    // A ref supplies the population, never the shape.
    const out = doc(roundTrip(CONTRACT).contract);
    expect(out.observations.items.properties.by.type).toBe('array');
    expect(out.observations.items.properties.at.type).toBe('object');
    expect(out.attributes.items.properties.subject.type).toBe('object');
    expect(out.at.type).toBe('object');
  });

  it('keeps the justification flag on the rows that carry evidence', () => {
    const out = doc(roundTrip(CONTRACT).contract);
    expect(out.observations.items.include_justification).toBe(true);
    expect(out.relations.items.include_justification).toBe(true);
    expect(out.events.items.include_justification).toBe(true);
  });

  it('keeps the document rung and the docket reference', () => {
    const out = doc(roundTrip(CONTRACT).contract);
    expect(out.at['x-entityField']).toBe(true);
    expect(out.dated.type).toBe('string');
    expect(out.ref.type).toBe('string');
    expect(out.ref.description).toContain('docket');
  });

  it('is stable — editing and saving twice changes nothing', () => {
    const once = roundTrip(CONTRACT).contract;
    expect(roundTrip(once).contract).toEqual(once);
  });
});
