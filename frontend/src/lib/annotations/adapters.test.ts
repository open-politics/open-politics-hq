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
      fld({ name: 'sender', type: 'string', ref: { targets: ['actors'] }, description: 'Mail sender' }),
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
      fld({ name: 'sender', type: 'string', ref: { targets: ['actors'] } }),
    ]);
    const restored = roundTrip(original);
    const sender = restored.structure[0].fields.find(f => f.name === 'sender')!;
    expect(sender.ref?.targets).toEqual(['actors']);
  });

  test('cycle detection rejects A → B → A', () => {
    const form = docFormData([
      fld({ name: 'a', type: 'string', ref: { targets: ['b'] } }),
      fld({ name: 'b', type: 'string', ref: { targets: ['a'] } }),
    ]);
    expect(() => adaptSchemaFormDataToSchemaCreate(form)).toThrow(SchemaRefCycleError);
  });

  test('broken ref to non-existent target rejected', () => {
    const form = docFormData([
      fld({ name: 'sender', type: 'string', ref: { targets: ['nonexistent'] } }),
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

  test('array_entity round-trips with entity_type, enum, typeConstrained', () => {
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

// =============================================================================
// Canon tie (`x-canon`)
//
// The generic field branch emits `x-canon` onto the property node, but a scalar
// `entity` field returns straight out of `buildEntityObjectSchema` and never
// reaches it — so its canon tie was silently dropped on every save. The backend
// reads `x-canon` from either position (`schema_map._parse_canon`).
// =============================================================================

describe('canon tie', () => {
  test('scalar entity field emits x-canon', () => {
    const created = adaptSchemaFormDataToSchemaCreate(docFormData([
      fld({
        name: 'location', type: 'entity',
        entityConfig: { entity_type: 'Location', typeConstrained: true },
        canonTie: { canonId: 7, type: 'location' },
      }),
    ]));
    const schema = (created.output_contract as any).properties.document.properties.location;
    expect(schema['x-entityField']).toBe(true);
    expect(schema['x-canon']).toEqual({ canon_id: 7, type: 'location' });
  });

  test('scalar entity canon tie survives a full round-trip', () => {
    const back = roundTrip(docFormData([
      fld({
        name: 'location', type: 'entity',
        entityConfig: { entity_type: 'Location', typeConstrained: true },
        canonTie: { canonId: 7, type: 'location' },
      }),
    ]));
    const f = back.structure[0].fields[0];
    expect(f.canonTie?.canonId).toBe(7);
    expect(f.canonTie?.type).toBe('location');
  });

  test('array_entity keeps its tie on the array node', () => {
    const created = adaptSchemaFormDataToSchemaCreate(docFormData([
      fld({
        name: 'entities', type: 'array',
        items: { type: 'entity', entityConfig: { entity_type: 'Person', typeConstrained: true } },
        canonTie: { canonId: 3, type: 'Person' },
      }),
    ]));
    const schema = (created.output_contract as any).properties.document.properties.entities;
    expect(schema['x-canon']).toEqual({ canon_id: 3, type: 'Person' });
    expect(schema.items['x-entityField']).toBe(true);
  });

  test('no x-canon emitted when the field has no tie', () => {
    const created = adaptSchemaFormDataToSchemaCreate(docFormData([
      fld({ name: 'location', type: 'entity', entityConfig: { entity_type: 'Location' } }),
    ]));
    const schema = (created.output_contract as any).properties.document.properties.location;
    expect(schema['x-canon']).toBeUndefined();
  });
});

// =============================================================================
// Date fields
//
// `templates.py:date_field` emits `{type: "string", format: "date"}`, and
// `schema_map.py` reads that format — `shape: "date"` is what makes a field a
// *time candidate* at all, which is what the scrubber, the lanes and
// `after:`/`before:` bind to.
//
// The editor modelled only `schema.type`, so `format` was dropped on load and
// never re-emitted on save. Opening a template in the editor silently demoted
// every `when`, `until` and `from` to a bare string, leaving the model with
// nothing but prose asking it for a date. Two runs in a row answered
// "Wednesday".
// =============================================================================

describe('Date field round-trip', () => {
  test('format: date survives the editor', () => {
    const form = docFormData([
      fld({ name: 'when', type: 'date', description: 'When it happened.' }),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const when = (created.output_contract as any).properties.document.properties.when;
    expect(when.type).toBe('string');
    expect(when.format).toBe('date');

    // …and comes back as a date, not as a string.
    expect(roundTrip(form).structure[0].fields[0].type).toBe('date');
  });

  test('a plain string field does not acquire a format', () => {
    const created = adaptSchemaFormDataToSchemaCreate(
      docFormData([fld({ name: 'summary', type: 'string' })]),
    );
    const summary = (created.output_contract as any)
      .properties.document.properties.summary;
    expect(summary.type).toBe('string');
    expect(summary.format).toBeUndefined();
  });

  test('a date inside a repeating row survives too', () => {
    // Where it actually matters: `observations[*].when` is the binding the
    // occurrence's t0 is read from.
    const form = docFormData([
      fld({
        name: 'observations', type: 'array',
        items: {
          type: 'object',
          properties: [
            fld({ name: 'kind', type: 'string' }),
            fld({ name: 'when', type: 'date' }),
          ],
        },
      } as any),
    ]);
    const created = adaptSchemaFormDataToSchemaCreate(form);
    const when = (created.output_contract as any)
      .properties.document.properties.observations.items.properties.when;
    expect(when).toEqual({ description: undefined, type: 'string', format: 'date' });

    const back = roundTrip(form).structure[0].fields[0];
    expect(back.items?.properties?.find(f => f.name === 'when')?.type).toBe('date');
  });
});

// =============================================================================
// Node palette
// =============================================================================

describe('node palette — one place a type says how it looks', () => {
  const readOf = (contract: any): AnnotationSchemaRead => ({
    id: 1, uuid: 'u', name: 'T', description: '', output_contract: contract,
    instructions: null, field_specific_justification_configs: {},
    is_active: true, version: '1.0', tags: [], infospace_id: 1, user_id: 1,
    created_at: '', updated_at: '',
  } as any);

  test('emits at the contract root and round-trips', () => {
    const form: AnnotationSchemaFormData = {
      ...docFormData([fld({ name: 'actors', type: 'entity', entityConfig: { entity_type: 'Person' } })]),
      nodeStyles: { PERSON: { icon: 'Crown', color: '#112233' } },
    };
    const created = adaptSchemaFormDataToSchemaCreate(form);
    expect((created.output_contract as any)['x-nodeStyles'])
      .toEqual({ PERSON: { icon: 'Crown', color: '#112233' } });
    expect(roundTrip(form).nodeStyles).toEqual({ PERSON: { color: '#112233', icon: 'Crown' } });
  });

  test('an empty palette leaves the contract byte-clean', () => {
    const created = adaptSchemaFormDataToSchemaCreate(docFormData([fld({ name: 'a', type: 'string' })]));
    expect('x-nodeStyles' in (created.output_contract as any)).toBe(false);
    expect(roundTrip(docFormData([fld({ name: 'a', type: 'string' })])).nodeStyles).toBeUndefined();
  });

  test('a self-node section can be styled — nothing else could reach its type', () => {
    // `events` declares its node type in `x-graph`; it has no entity field, so
    // per-field colour and icon had nowhere to live and the type was
    // unstyleable. The palette is keyed by type, so it simply works.
    const form: AnnotationSchemaFormData = {
      ...docFormData([
        fld({
          name: 'events', type: 'array',
          extensions: { 'x-graph': { about: 'self', node_type: 'Event' } },
          items: { type: 'object', properties: [fld({ name: 'name', type: 'string' })] },
        }),
      ]),
      nodeStyles: { EVENT: { icon: 'CalendarRange' } },
    };
    expect(roundTrip(form).nodeStyles).toEqual({ EVENT: { icon: 'CalendarRange' } });
  });
});

describe('node palette — migrating contracts that predate it', () => {
  const load = (contract: any) => adaptSchemaReadToSchemaFormData({
    id: 1, uuid: 'u', name: 'T', description: '', output_contract: contract,
    instructions: null, field_specific_justification_configs: {},
    is_active: true, version: '1.0', tags: [], infospace_id: 1, user_id: 1,
    created_at: '', updated_at: '',
  } as any);

  test('a per-field x-entityIcon is folded into the palette', () => {
    const form = load({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            interests: {
              type: 'array',
              items: {
                type: 'object',
                'x-entityField': true,
                'x-entityType': 'Interest',
                'x-entityIcon': 'ActivityIcon',
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
    });
    expect(form.nodeStyles).toEqual({ INTEREST: { icon: 'ActivityIcon' } });

    // And on the way back out it lives ONLY in the palette — leaving the old
    // key behind would let a stale copy shadow the next edit.
    const contract = adaptSchemaFormDataToSchemaCreate(form).output_contract as any;
    expect(contract['x-nodeStyles']).toEqual({ INTEREST: { icon: 'ActivityIcon' } });
    expect(contract.properties.document.properties.interests.items['x-entityIcon']).toBeUndefined();
  });

  test("a ref's inherited icon does not migrate onto the type it borrowed", () => {
    // Schema 18397: the icon was set once, on `interests`. Ref expansion put it
    // on roles declared `Person`, and every person came out wearing it.
    const form = load({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            interests: {
              type: 'array',
              items: { type: 'object', 'x-entityField': true, 'x-entityType': 'Interest', 'x-entityIcon': 'ActivityIcon', properties: {} },
            },
            relations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from: {
                    type: 'object', 'x-entityField': true, 'x-entityType': 'Person',
                    'x-entityIcon': 'ActivityIcon', 'x-ref': ['actors', 'interests'], properties: {},
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(form.nodeStyles).toEqual({ INTEREST: { icon: 'ActivityIcon' } });
    expect(form.nodeStyles?.PERSON).toBeUndefined();
  });

  test('a graph field\'s buried type maps migrate too', () => {
    const form = load({
      type: 'object',
      properties: {
        document: {
          type: 'object',
          properties: {
            triplets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  subject_name: { type: 'string' },
                  subject_type: {
                    type: 'string',
                    'x-entityTypeList': ['Person'],
                    'x-entityTypeColors': { Person: '#abcdef' },
                    'x-entityTypeIcons': { Person: 'Users' },
                  },
                  predicate: { type: 'string' },
                  object_name: { type: 'string' },
                  object_type: { type: 'string' },
                },
              },
            },
          },
        },
      },
    });
    expect(form.nodeStyles).toEqual({ PERSON: { color: '#abcdef', icon: 'Users' } });

    const contract = adaptSchemaFormDataToSchemaCreate(form).output_contract as any;
    const subjectType = contract.properties.document.properties.triplets.items.properties.subject_type;
    expect(subjectType['x-entityTypeIcons']).toBeUndefined();
    expect(subjectType['x-entityTypeColors']).toBeUndefined();
    // The vocabulary itself is untouched — only the visuals moved.
    expect(subjectType['x-entityTypeList']).toEqual(['Person']);
  });

  test('a ref carries vocabulary but no longer carries appearance', () => {
    const form = docFormData([
      fld({ name: 'actors', type: 'entity', entityConfig: { entity_type: 'Person', enum: ['Alice'] } }),
      fld({ name: 'sender', type: 'entity', entityConfig: { entity_type: 'Organization' }, ref: { targets: ['actors'] } }),
    ]);
    const sender = (adaptSchemaFormDataToSchemaCreate(form).output_contract as any)
      .properties.document.properties.sender;
    expect(sender['x-entityEnum']).toEqual(['Alice']);      // vocabulary, inherited
    expect(sender['x-entityType']).toBe('Organization');    // its own type, kept
    expect(sender['x-entityIcon']).toBeUndefined();         // appearance, never
  });
});
