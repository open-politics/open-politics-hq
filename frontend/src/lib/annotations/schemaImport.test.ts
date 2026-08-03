/**
 * The checked-in schema file must actually import.
 *
 * `AnnotationSchemaManager.handleImportFile` does exactly three things:
 *   JSON.parse → adaptSchemaReadToSchemaFormData → createSchema(formData)
 *
 * so the import path runs through the same adapters the editor does, and every
 * corruption fixed there is load-bearing here too. This replays that path
 * against the file in `docs/`, which is the only way to know the artifact we
 * ship is the artifact the importer accepts.
 */
import { describe, expect, it } from 'bun:test';
import EXPORTED from '../../../../docs/plans/observation-model/schemas/testimony.schema.json';
import {
  adaptSchemaReadToSchemaFormData,
  adaptSchemaFormDataToSchemaCreate,
} from './adapters';

const doc = (c: any) => c?.properties?.document?.properties ?? {};

describe('docs/…/testimony.schema.json imports', () => {
  it('is an array, the shape the exporter writes', () => {
    // `handleImportFile` accepts an object or an array; the exporter always
    // writes an array, so the file should look like a real export.
    expect(Array.isArray(EXPORTED)).toBe(true);
    expect(EXPORTED).toHaveLength(1);
  });

  it('passes the importer\'s validity gate', () => {
    // `if (!importedSchema.name || !importedSchema.output_contract) throw`
    for (const s of EXPORTED as any[]) {
      expect(s.name).toBeTruthy();
      expect(s.output_contract).toBeTruthy();
    }
  });

  it('survives the import transform with every link intact', () => {
    const form = adaptSchemaReadToSchemaFormData((EXPORTED as any[])[0]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const d = doc(created.output_contract);

    expect(created.name).toBe('Testimony and evidence');
    expect(Object.keys(d)).toEqual([
      'actors', 'places', 'interests', 'instruments',
      'events', 'observations', 'attributes', 'relations', 'evidence',
      'at', 'dated', 'ref',
    ]);

    // The roster links — lose one and the same person in three rows becomes
    // three nodes, silently.
    const obs = d.observations.items.properties;
    expect(obs.by.items['x-ref']).toBe('actors');
    expect(obs.at['x-ref']).toBe('places');
    expect(obs.serves.items['x-ref']).toBe('interests');
    expect(d.attributes.items.properties.place['x-ref']).toBe('places');
    expect(d.relations.items.properties.from['x-ref'])
      .toEqual(['actors', 'instruments', 'places', 'interests']);
    expect(d.at['x-ref']).toBe('places');

    // Unions survive as arrays.
    expect(obs.via.items['x-ref']).toEqual(['actors', 'instruments']);
    expect(d.attributes.items.properties.subject['x-ref'])
      .toEqual(['actors', 'instruments', 'places', 'interests']);

    // Cardinality per role: `by` is several, `at` is one.
    expect(obs.by.type).toBe('array');
    expect(obs.at.type).toBe('object');

    // Relations stayed relations rather than being rewritten as triplets.
    expect(d.relations.items.properties.subject_name).toBeUndefined();

    // The quote behind every claim.
    expect(d.observations.items.include_justification).toBe(true);
  });

  it('matches the template it was generated from', () => {
    // Drift guard: the file in docs/ and the fixture the template tests use
    // are two copies of one artifact, and a stale one is worse than none.
    const fixture = require('./__fixtures__/testimonyContract.json');
    expect((EXPORTED as any[])[0].output_contract).toEqual(fixture);
  });
});
