/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test';
import {
  adaptSchemaFormDataToSchemaCreate,
  adaptSchemaReadToSchemaFormData,
  SchemaRefCycleError,
} from './adapters';
import type { AnnotationSchemaFormData, AdvancedSchemeField } from './types';
import type { AnnotationSchemaRead } from '@/client';

// =============================================================================
// Helpers — minimal field/section/form constructors so tests stay readable.
// =============================================================================

const fld = (over: Partial<AdvancedSchemeField> & { name: string; type: AdvancedSchemeField['type'] }): AdvancedSchemeField => ({
  id: `id_${over.name}`,
  required: false,
  ...over,
});

const docFormData = (fields: AdvancedSchemeField[]): AnnotationSchemaFormData => ({
  name: 'Test',
  description: '',
  structure: [{ id: 'sec', name: 'document', fields }],
});

/** Round-trip: form → output_contract → form again. Assertions can compare
 * the second form to the first to verify nothing is lost. */
const roundTrip = (form: AnnotationSchemaFormData): AnnotationSchemaFormData => {
  const created = adaptSchemaFormDataToSchemaCreate(form);
  const read: AnnotationSchemaRead = {
    id: 1,
    uuid: 'u',
    name: created.name,
    description: created.description ?? '',
    output_contract: created.output_contract as any,
    instructions: created.instructions ?? null,
    field_specific_justification_configs: created.field_specific_justification_configs ?? {},
    is_active: true,
    version: '1.0',
    tags: [],
    infospace_id: 1,
    user_id: 1,
    created_at: '',
    updated_at: '',
  } as any;
  return adaptSchemaReadToSchemaFormData(read);
};

// =============================================================================
// Entity field
// =============================================================================

describe('Entity field round-trip', () => {
  test('preserves entity_type, enum, typeConstrained', () => {
    const original = docFormData([
      fld({
        name: 'actors', type: 'entity', required: true,
        description: 'Politicians and officials',
        entityConfig: {
          entity_type: 'Politician',
          enum: ['Merkel', 'Macron', 'Scholz'],
          typeConstrained: true,
        },
      }),
    ]);

    const restored = roundTrip(original);
    const f = restored.structure[0].fields[0];

    expect(f.name).toBe('actors');
    expect(f.type).toBe('entity');
    expect(f.required).toBe(true);
    expect(f.description).toBe('Politicians and officials');
    expect(f.entityConfig?.entity_type).toBe('Politician');
    expect(f.entityConfig?.enum).toEqual(['Merkel', 'Macron', 'Scholz']);
    expect(f.entityConfig?.typeConstrained).toBe(true);
  });

  test('open-ended entity (no enum) round-trips', () => {
    const original = docFormData([
      fld({
        name: 'company', type: 'entity',
        entityConfig: { entity_type: 'Company', typeConstrained: false },
      }),
    ]);
    const restored = roundTrip(original);
    const f = restored.structure[0].fields[0];
    expect(f.type).toBe('entity');
    expect(f.entityConfig?.entity_type).toBe('Company');
    expect(f.entityConfig?.enum).toBeUndefined();
    expect(f.entityConfig?.typeConstrained).toBe(false);
  });

  test('emits as JSON Schema object with x-entityField extension', () => {
    const form = docFormData([
      fld({ name: 'sender', type: 'entity', entityConfig: { entity_type: 'Person', typeConstrained: true } }),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const senderSchema = (created.output_contract as any).properties.document.properties.sender;
    expect(senderSchema.type).toBe('object');
    expect(senderSchema['x-entityField']).toBe(true);
    expect(senderSchema['x-entityType']).toBe('Person');
    expect(senderSchema.properties.name.type).toBe('string');
    expect(senderSchema.properties.type.type).toBe('string');
    expect(senderSchema.required).toContain('name');
  });
});

// =============================================================================
// Intra-schema $ref
// =============================================================================

describe('Field reference (ref)', () => {
  test('ref expands target definition into the referrer', () => {
    const form = docFormData([
      fld({
        name: 'actors', type: 'entity',
        entityConfig: { entity_type: 'Politician', enum: ['Alice', 'Bob'], typeConstrained: true },
      }),
      fld({ name: 'sender', type: 'string', ref: { target: 'actors' }, description: 'Mail sender' }),
    ]);

    const created = adaptSchemaFormDataToSchemaCreate(form);
    const senderSchema = (created.output_contract as any).properties.document.properties.sender;

    // sender inherits the entity-object shape from actors
    expect(senderSchema['x-entityField']).toBe(true);
    expect(senderSchema['x-entityType']).toBe('Politician');
    expect(senderSchema['x-entityEnum']).toEqual(['Alice', 'Bob']);
    // but keeps its own description
    expect(senderSchema.description).toBe('Mail sender');
    // and tags x-ref so the parser can reconstruct on reload
    expect(senderSchema['x-ref']).toBe('actors');
  });

  test('ref round-trips through parse — referrer keeps ref pointer', () => {
    const original = docFormData([
      fld({
        name: 'actors', type: 'entity',
        entityConfig: { entity_type: 'Politician', typeConstrained: true },
      }),
      fld({ name: 'sender', type: 'string', ref: { target: 'actors' } }),
    ]);
    const restored = roundTrip(original);
    const sender = restored.structure[0].fields.find(f => f.name === 'sender')!;
    expect(sender.ref?.target).toBe('actors');
  });

  test('cycle detection rejects A → B → A', () => {
    const form = docFormData([
      fld({ name: 'a', type: 'string', ref: { target: 'b' } }),
      fld({ name: 'b', type: 'string', ref: { target: 'a' } }),
    ]);
    expect(() => adaptSchemaFormDataToSchemaCreate(form)).toThrow(SchemaRefCycleError);
  });

  test('broken ref to non-existent target rejected', () => {
    const form = docFormData([
      fld({ name: 'sender', type: 'string', ref: { target: 'nonexistent' } }),
    ]);
    expect(() => adaptSchemaFormDataToSchemaCreate(form)).toThrow(/does not exist/);
  });
});

// =============================================================================
// Multi-graph-field
// =============================================================================

describe('Graph field — user-facing name + multi-graph-field', () => {
  test('new graph field emits at user-facing name (no x-fieldName needed)', () => {
    const form = docFormData([
      fld({
        name: 'loose_relationships', type: 'graph',
        graphConfig: {
          entityTypes: { typeEnum: ['Person'], typeConstrained: true },
          relationshipSchema: { predicateEnum: [], predicateConstrained: false, optionalFields: [] },
        },
      }),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const props = (created.output_contract as any).properties.document.properties;
    expect(props.loose_relationships).toBeDefined();
    expect(props.triplets).toBeUndefined();
    // x-fieldName not needed when key === user name
    expect(props.loose_relationships['x-fieldName']).toBeUndefined();
  });

  test('legacy graph field at "triplets" key round-trips at "triplets"', () => {
    // Simulate a schema saved at the legacy key by setting legacyKey
    const form = docFormData([
      fld({
        name: 'my_old_graph', type: 'graph', legacyKey: 'triplets',
        graphConfig: {
          entityTypes: { typeEnum: [], typeConstrained: false },
          relationshipSchema: { predicateEnum: [], predicateConstrained: false, optionalFields: [] },
        },
      }),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const props = (created.output_contract as any).properties.document.properties;
    expect(props.triplets).toBeDefined();
    expect(props.my_old_graph).toBeUndefined();
    expect(props.triplets['x-fieldName']).toBe('my_old_graph');
  });

  test('anchored triplets via from_source inherit target field enum', () => {
    // top.actors is an entity field with a closed enum; the graph field
    // anchors subjects to it. Adapter should copy the enum onto subject_name.
    const form = docFormData([
      fld({
        name: 'actors', type: 'entity',
        entityConfig: {
          entity_type: 'Politician',
          enum: ['Merkel', 'Macron', 'Scholz'],
          typeConstrained: true,
        },
      }),
      fld({
        name: 'rivalries', type: 'graph',
        graphConfig: {
          entityTypes: { typeEnum: ['Politician'], typeConstrained: true },
          relationshipSchema: { predicateEnum: [], predicateConstrained: false, optionalFields: [] },
          from_source: 'actors',
          to_source: 'actors',
        },
      }),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const rivalriesSchema = (created.output_contract as any).properties.document.properties.rivalries;
    expect(rivalriesSchema).toBeDefined();
    const subjName = rivalriesSchema.items.properties.subject_name;
    const objName = rivalriesSchema.items.properties.object_name;
    expect(subjName.enum).toEqual(['Merkel', 'Macron', 'Scholz']);
    expect(objName.enum).toEqual(['Merkel', 'Macron', 'Scholz']);
    // Description hint mentions the source path so the LLM understands intent.
    expect(subjName.description).toMatch(/actors/);
    expect(objName.description).toMatch(/actors/);
  });

  test('open-ended anchor (no enum on target) still produces a description hint', () => {
    const form = docFormData([
      fld({
        name: 'companies', type: 'entity',
        entityConfig: { entity_type: 'Company', typeConstrained: true },  // no enum
      }),
      fld({
        name: 'mentions', type: 'graph',
        graphConfig: {
          entityTypes: { typeEnum: [], typeConstrained: false },
          relationshipSchema: { predicateEnum: [], predicateConstrained: false, optionalFields: [] },
          to_source: 'companies',
        },
      }),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const mentionsSchema = (created.output_contract as any).properties.document.properties.mentions;
    const objName = mentionsSchema.items.properties.object_name;
    expect(objName.enum).toBeUndefined();   // no enum on target → no enum here
    expect(objName.description).toMatch(/companies/); // but the prose hint is there
  });

  test('array_entity multi-type round-trips entity_type + alternate_types', () => {
    const original = docFormData([
      fld({
        name: 'beteiligte_akteure',
        type: 'array',
        items: {
          type: 'entity',
          entityConfig: {
            entity_type: 'Person',
            alternate_types: ['Konzern', 'Politiker'],
            typeConstrained: true,
          },
        },
      }),
    ]);
    const restored = roundTrip(original);
    const f = restored.structure[0].fields[0];
    expect(f.items?.entityConfig?.entity_type).toBe('Person');
    expect(f.items?.entityConfig?.alternate_types).toEqual(['Konzern', 'Politiker']);
    // Emitted JSON Schema's type prop should carry all three as enum
    const created = adaptSchemaFormDataToSchemaCreate(original);
    const items = (created.output_contract as any).properties.document.properties.beteiligte_akteure.items;
    expect(items.properties.type.enum).toEqual(['Person', 'Konzern', 'Politiker']);
    expect(items['x-entityType']).toBe('Person');
    expect(items['x-entityAlternateTypes']).toEqual(['Konzern', 'Politiker']);
  });

  test('legacy single-type x-entityType still parses (back-compat)', () => {
    const legacyContract = {
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            firmen: {
              type: 'array',
              items: {
                type: 'object',
                'x-entityField': true,
                'x-entityType': 'Konzern',
                'x-entityTypeConstrained': true,
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['Konzern'] },
                  additional_types: { type: 'array', items: { type: 'string' } },
                },
                required: ['name'],
              },
            },
          },
        },
      },
    };
    const read: any = {
      id: 1, uuid: 'u', name: 't', description: '',
      output_contract: legacyContract,
      instructions: null, field_specific_justification_configs: {},
      is_active: true, version: '1.0', tags: [], infospace_id: 1, user_id: 1,
      created_at: '', updated_at: '',
    };
    const form = adaptSchemaReadToSchemaFormData(read);
    const f = form.structure[0].fields[0];
    expect(f.type).toBe('array');
    expect(f.items?.type).toBe('entity');
    expect(f.items?.entityConfig?.entity_type).toBe('Konzern');
    expect(f.items?.entityConfig?.alternate_types).toBeUndefined();
  });

  test('array_entity round-trips with entity_type, enum, typeConstrained, color, icon', () => {
    const original = docFormData([
      fld({
        name: 'firmen',
        type: 'array',
        items: {
          type: 'entity',
          description: 'Companies named in this row',
          entityConfig: {
            entity_type: 'Konzern',
            enum: ['Merkur', 'Tipwin', 'Insic', 'bet3000'],
            typeConstrained: true,
            color: '#ce1a7a',
            icon: 'House',
          },
        },
      }),
    ]);
    const restored = roundTrip(original);
    const f = restored.structure[0].fields[0];
    expect(f.type).toBe('array');
    expect(f.items?.type).toBe('entity');
    expect(f.items?.entityConfig?.entity_type).toBe('Konzern');
    expect(f.items?.entityConfig?.enum).toEqual(['Merkur', 'Tipwin', 'Insic', 'bet3000']);
    expect(f.items?.entityConfig?.typeConstrained).toBe(true);
    expect(f.items?.entityConfig?.color).toBe('#ce1a7a');
    expect(f.items?.entityConfig?.icon).toBe('House');
    expect(f.items?.description).toBe('Companies named in this row');
  });

  test('array_entity emits as array of x-entityField objects', () => {
    const form = docFormData([
      fld({
        name: 'firmen', type: 'array',
        items: {
          type: 'entity',
          entityConfig: { entity_type: 'Konzern', typeConstrained: true },
        },
      }),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const firmen = (created.output_contract as any).properties.document.properties.firmen;
    expect(firmen.type).toBe('array');
    expect(firmen.items.type).toBe('object');
    expect(firmen.items['x-entityField']).toBe(true);
    expect(firmen.items['x-entityType']).toBe('Konzern');
    expect(firmen.items.properties.name.type).toBe('string');
  });

  test('entity inside array_object child round-trips fully', () => {
    const original = docFormData([
      fld({
        name: 'evidenz_einheiten',
        type: 'array',
        items: {
          type: 'object',
          properties: [
            fld({ name: 'beschreibung', type: 'string', description: 'short description' }),
            fld({
              name: 'beguenstigte_firma',
              type: 'entity',
              description: 'Single firm named as benefactor',
              entityConfig: {
                entity_type: 'Konzern',
                enum: ['Merkur', 'Tipwin'],
                typeConstrained: true,
              },
            }),
            fld({
              name: 'beteiligte_personen',
              type: 'array',
              items: {
                type: 'entity',
                entityConfig: { entity_type: 'Person', typeConstrained: false },
              },
            }),
          ],
        },
      }),
    ]);
    const restored = roundTrip(original);
    const ev = restored.structure[0].fields[0];
    expect(ev.type).toBe('array');
    expect(ev.items?.type).toBe('object');
    const inner = ev.items?.properties || [];
    const benf = inner.find(p => p.name === 'beguenstigte_firma');
    expect(benf?.type).toBe('entity');
    expect(benf?.entityConfig?.entity_type).toBe('Konzern');
    expect(benf?.entityConfig?.enum).toEqual(['Merkur', 'Tipwin']);
    const persons = inner.find(p => p.name === 'beteiligte_personen');
    expect(persons?.type).toBe('array');
    expect(persons?.items?.type).toBe('entity');
    expect(persons?.items?.entityConfig?.entity_type).toBe('Person');
    expect(persons?.items?.entityConfig?.typeConstrained).toBe(false);
  });

  test('per-field justification on nested array_object child round-trips', () => {
    const original = docFormData([
      fld({
        name: 'evidenz_einheiten',
        type: 'array',
        // Row-level justification on the array itself — backend injects
        // _justification inside each row.
        justification: { enabled: true, rigor_level: 'standard', custom_prompt: 'row-level reasoning' },
        items: {
          type: 'object',
          properties: [
            // Per-inner-field justification on a leaf scalar — backend
            // injects sibling <name>_justification inside each row.
            fld({
              name: 'schweregrad', type: 'number', minimum: 1, maximum: 10,
              justification: { enabled: true, rigor_level: 'thorough', custom_prompt: 'severity-specific reasoning' },
            }),
            fld({ name: 'beschreibung', type: 'string' }),
          ],
        },
      }),
    ]);
    const restored = roundTrip(original);
    const arr = restored.structure[0].fields[0];
    expect(arr.justification?.enabled).toBe(true);
    expect(arr.justification?.rigor_level).toBe('standard');
    const inner = arr.items?.properties || [];
    const sev = inner.find(p => p.name === 'schweregrad');
    expect(sev?.justification?.enabled).toBe(true);
    expect(sev?.justification?.rigor_level).toBe('thorough');
    expect(sev?.justification?.custom_prompt).toBe('severity-specific reasoning');
  });

  test('graph optional fields round-trip enum and min/max', () => {
    const form = docFormData([
      fld({
        name: 'treatment_assessments', type: 'graph',
        graphConfig: {
          entityTypes: { typeEnum: ['Behörde', 'Konzern'], typeConstrained: true },
          relationshipSchema: {
            predicateEnum: ['BEVORZUGTE'], predicateConstrained: true,
            optionalFields: [
              fld({ name: 'durchgesetzt', type: 'string', enum: ['ja', 'nein', 'verzoegert'], description: 'Was the action enforced?' }),
              fld({ name: 'bevorzugung_indiz', type: 'number', minimum: 1, maximum: 10, description: '1-10' }),
            ],
          },
        },
      }),
    ]);
    const restored = roundTrip(form);
    const g = restored.structure[0].fields[0];
    const opt = g.graphConfig?.relationshipSchema.optionalFields || [];
    const durch = opt.find(f => f.name === 'durchgesetzt');
    expect(durch?.enum).toEqual(['ja', 'nein', 'verzoegert']);
    const indiz = opt.find(f => f.name === 'bevorzugung_indiz');
    expect(indiz?.minimum).toBe(1);
    expect(indiz?.maximum).toBe(10);
  });

  test('two graph fields in one schema both emitted, both round-tripped', () => {
    const form = docFormData([
      fld({
        name: 'discovery', type: 'graph',
        graphConfig: {
          entityTypes: { typeEnum: ['Person'], typeConstrained: true },
          relationshipSchema: { predicateEnum: [], predicateConstrained: false, optionalFields: [] },
        },
      }),
      fld({
        name: 'assessments', type: 'graph',
        graphConfig: {
          entityTypes: { typeEnum: ['GovAgency', 'Company'], typeConstrained: true },
          relationshipSchema: { predicateEnum: ['gave_license_to'], predicateConstrained: true, optionalFields: [] },
        },
      }),
    ]);
    const restored = roundTrip(form);
    const fields = restored.structure[0].fields;
    expect(fields.length).toBe(2);
    expect(fields.find(f => f.name === 'discovery')?.type).toBe('graph');
    expect(fields.find(f => f.name === 'assessments')?.type).toBe('graph');
    expect(fields.find(f => f.name === 'assessments')?.graphConfig?.relationshipSchema.predicateEnum)
      .toEqual(['gave_license_to']);
  });
});
