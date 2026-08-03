/**
 * Can someone BUILD this in the editor, not just load it?
 *
 * `testimonyTemplate.test.ts` proves parse→emit on the shipped contract. That
 * is a different claim: a template can survive the editor while the pattern it
 * embodies remains unauthorable, which is exactly where this was. Two things
 * blocked it and both were invisible from a round-trip test —
 *
 *   1. the type picker offered `array_entity` but no scalar `entity`, so a
 *      single-valued role (`speaker`, `at`, `subject`) could not be made;
 *   2. setting a ref locked the type, because a ref used to mean "copy the
 *      target" — so pointing `speaker` at the `actors` roster turned it into a
 *      copy of the whole list.
 *
 * These build fields the way the editor's own mutators do and check the
 * emitted contract, so the authoring path is pinned independently of the
 * template generator.
 */
import { describe, expect, it } from 'bun:test';
import { adaptSchemaFormDataToSchemaCreate } from './adapters';
import { ADVANCED_SCHEME_TYPE_OPTIONS } from './types';
import type { AdvancedSchemeField, AnnotationSchemaFormData } from './types';

let n = 0;
const id = () => `f${n++}`;

const fld = (f: Partial<AdvancedSchemeField>): AdvancedSchemeField =>
  ({ id: id(), name: 'x', type: 'string', required: false, ...f } as AdvancedSchemeField);

const form = (fields: AdvancedSchemeField[]): AnnotationSchemaFormData => ({
  name: 'Hand-built', description: '', instructions: '',
  structure: [{ id: id(), name: 'document', fields }],
});

const emit = (fields: AdvancedSchemeField[]) =>
  (adaptSchemaFormDataToSchemaCreate(form(fields)).output_contract as any)
    .properties.document.properties;

/** A roster, as `computeTypeChangeUpdate(field, 'array_entity')` builds it. */
const roster = (name: string, type: string) => fld({
  name, type: 'array',
  items: { type: 'entity', entityConfig: { entity_type: type, typeConstrained: true } },
});

/** A single role, as `computeTypeChangeUpdate(field, 'entity')` builds it. */
const role = (name: string, type: string, ref?: string) => fld({
  name, type: 'entity',
  entityConfig: { entity_type: type, typeConstrained: true },
  ...(ref ? { ref: { targets: [ref] } } : {}),
});

describe('the editor can author the observation model', () => {
  it('offers a scalar entity type at all', () => {
    // Most roles in the model are single-valued. Without this option the
    // picker could only make lists, and a payment would have many senders.
    const values = ADVANCED_SCHEME_TYPE_OPTIONS.map(o => o.value);
    expect(values).toContain('entity');
    expect(values).toContain('array_entity');
  });

  it('builds a roster', () => {
    const out = emit([roster('actors', 'Person')]);
    expect(out.actors.type).toBe('array');
    expect(out.actors.items['x-entityField']).toBe(true);
    expect(out.actors.items['x-entityType']).toBe('Person');
  });

  it('builds a single role that draws from that roster', () => {
    // The whole linking payoff. `speaker` must stay ONE entity while naming the
    // same population as `actors`.
    const out = emit([
      roster('actors', 'Person'),
      fld({
        name: 'statements', type: 'array',
        items: {
          type: 'object',
          properties: [role('speaker', 'Person', 'actors')],
        },
      }),
    ]);
    const speaker = out.statements.items.properties.speaker;
    expect(speaker.type).toBe('object');          // one entity, not a list
    expect(speaker['x-entityField']).toBe(true);
    expect(speaker['x-ref']).toBe('actors');
  });

  it('builds a multi-valued role that draws from a roster', () => {
    const out = emit([
      roster('interests', 'Interest'),
      fld({
        name: 'statements', type: 'array',
        items: {
          type: 'object',
          properties: [fld({
            name: 'serves', type: 'array',
            items: { type: 'entity', entityConfig: { entity_type: 'Interest', typeConstrained: true } },
            ref: { targets: ['interests'] },
          })],
        },
      }),
    ]);
    const serves = out.statements.items.properties.serves;
    expect(serves.type).toBe('array');
    expect(serves.items['x-ref']).toBe('interests');
  });

  it('keeps a role typed differently from the roster it draws from', () => {
    // A payment's sender is an Organization even when the roster is Person —
    // the ref supplies the population, not the type.
    const out = emit([
      roster('actors', 'Person'),
      role('sender', 'Organization', 'actors'),
    ]);
    expect(out.sender['x-entityType']).toBe('Organization');
    expect(out.sender['x-ref']).toBe('actors');
  });

  it('builds a statement row with every binding a projection reads', () => {
    const out = emit([
      roster('actors', 'Person'),
      roster('places', 'Location'),
      fld({
        name: 'statements', type: 'array',
        justification: { enabled: true },
        items: {
          type: 'object',
          properties: [
            fld({ name: 'id', type: 'string' }),
            role('speaker', 'Person', 'actors'),
            fld({
              name: 'about', type: 'array',
              items: { type: 'entity', entityConfig: { entity_type: 'Person' } },
              ref: { targets: ['actors'] },
            }),
            fld({ name: 'claim', type: 'string' }),
            fld({ name: 'modality', type: 'string', enum: ['asserts', 'denies'] }),
            fld({ name: 'said_on', type: 'string' }),
            fld({ name: 'refers_to_start', type: 'string' }),
            fld({ name: 'refers_to_end', type: 'string' }),
            role('at', 'Location', 'places'),
          ],
        },
      }),
    ]);
    const p = out.statements.items.properties;
    expect(out.statements.items.include_justification).toBe(true);
    expect(p.speaker['x-ref']).toBe('actors');
    expect(p.about.items['x-ref']).toBe('actors');
    expect(p.at['x-ref']).toBe('places');
    expect(p.modality.enum).toEqual(['asserts', 'denies']);
    // node identity + the two clocks survive as plain strings
    expect(p.id.type).toBe('string');
    expect(p.refers_to_start.type).toBe('string');
  });

  it('builds a relation row that is NOT read back as a triplet', () => {
    // subject + predicate + object is the triplet fingerprint. Entity children
    // are what tell the two apart — get it wrong and the roster links vanish.
    const out = emit([
      roster('actors', 'Person'),
      fld({
        name: 'relations', type: 'array',
        items: {
          type: 'object',
          properties: [
            role('subject', 'Person', 'actors'),
            fld({ name: 'predicate', type: 'string', enum: ['represents'] }),
            role('object', 'Person', 'actors'),
          ],
        },
      }),
    ]);
    const p = out.relations.items.properties;
    expect(p.subject['x-entityField']).toBe(true);
    expect(p.subject['x-ref']).toBe('actors');
    expect(p.object['x-ref']).toBe('actors');
    expect(p.subject_name).toBeUndefined();   // not rewritten to a triplet
  });

  it('builds the document rung', () => {
    const out = emit([
      roster('places', 'Location'),
      role('at', 'Location', 'places'),
      fld({ name: 'dated', type: 'string' }),
      fld({ name: 'ref_no', type: 'string' }),
    ]);
    expect(out.at['x-ref']).toBe('places');
    expect(out.dated.type).toBe('string');
    expect(out.ref_no.type).toBe('string');
  });
});

// ─── Unions — one role, several populations ─────────────────────────────────

describe('a role can draw from several rosters', () => {
  it('emits one target as a bare string', () => {
    // Older contracts stay byte-identical; only a genuine union becomes a list.
    const out = emit([roster('actors', 'Person'), role('via', 'Organization', 'actors')]);
    expect(out.via['x-ref']).toBe('actors');
  });

  it('emits several targets as an array', () => {
    // A `via` is an intermediary OR a routing account. Declaring one target
    // forced the field to misdescribe where its vocabulary comes from.
    const out = emit([
      roster('actors', 'Person'),
      roster('instruments', 'Account'),
      fld({
        name: 'via', type: 'entity',
        entityConfig: { entity_type: 'Organization', typeConstrained: true },
        ref: { targets: ['actors', 'instruments'] },
      }),
    ]);
    expect(out.via['x-ref']).toEqual(['actors', 'instruments']);
    expect(out.via['x-entityField']).toBe(true);
  });

  it('keeps the role single-valued across a union', () => {
    const out = emit([
      roster('actors', 'Person'),
      roster('instruments', 'Account'),
      fld({
        name: 'via', type: 'entity',
        entityConfig: { entity_type: 'Organization' },
        ref: { targets: ['actors', 'instruments'] },
      }),
    ]);
    expect(out.via.type).toBe('object');       // not an array of either roster
    expect(out.via['x-entityType']).toBe('Organization');
  });

  it('round-trips a union back into the editor', () => {
    const { adaptSchemaReadToSchemaFormData } = require('./adapters');
    const contract = {
      type: 'object',
      properties: { document: { type: 'object', properties: {
        actors: { type: 'array', items: { type: 'object', 'x-entityField': true, 'x-entityType': 'Person', properties: {} } },
        instruments: { type: 'array', items: { type: 'object', 'x-entityField': true, 'x-entityType': 'Account', properties: {} } },
        via: { type: 'object', 'x-entityField': true, 'x-entityType': 'Organization', properties: {}, 'x-ref': ['actors', 'instruments'] },
      } } },
    };
    const form = adaptSchemaReadToSchemaFormData({ name: 'U', output_contract: contract } as any);
    const via = form.structure[0].fields.find((f: AdvancedSchemeField) => f.name === 'via')!;
    expect(via.ref?.targets).toEqual(['actors', 'instruments']);
    // …and back out unchanged.
    expect((adaptSchemaFormDataToSchemaCreate({ ...form, name: 'U' })
      .output_contract as any).properties.document.properties.via['x-ref'])
      .toEqual(['actors', 'instruments']);
  });

  it('a union on a multi-valued role lands on the items', () => {
    const out = emit([
      roster('actors', 'Person'),
      roster('instruments', 'Account'),
      fld({
        name: 'concerns', type: 'array',
        items: { type: 'entity', entityConfig: { entity_type: 'Person' } },
        ref: { targets: ['actors', 'instruments'] },
      }),
    ]);
    expect(out.concerns.type).toBe('array');
    expect(out.concerns.items['x-ref']).toEqual(['actors', 'instruments']);
  });
});
