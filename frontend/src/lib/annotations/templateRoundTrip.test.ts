/**
 * A template must survive the editor.
 *
 * "Start from a template, then shape it" only works if the editor can parse a
 * generated contract and emit it back without losing the `x-*` extensions the
 * graph runs on. `templates.py` exists precisely because the editor and the
 * companion have each grown their own contract emitter and drifted before, so
 * this is the test that keeps the third path — parse-then-re-emit — honest.
 *
 * The fixture is a trimmed `money` template: a roster, an occurrence array with
 * a `ref`-linked entity role and a multi-valued one, and a property row.
 */
import { describe, expect, it } from 'bun:test';
import {
  CONSUMED_EXTENSIONS,
  adaptSchemaReadToSchemaFormData,
  adaptSchemaFormDataToSchemaCreate,
} from './adapters';

/**
 * Every `x-*` key in a contract, by JSON pointer.
 *
 * The fidelity assertion is written against the SHAPE of the problem rather
 * than a list of keys, because a list of keys is what kept failing: three
 * narrow fixes, each for one key, each landing after the loss was noticed
 * downstream. A walker catches the key nobody has thought of yet.
 */
function extensionKeys(node: any, at = ''): Array<[string, unknown]> {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((v, i) => extensionKeys(v, `${at}/${i}`));
  return Object.entries(node).flatMap(([k, v]) =>
    k.startsWith('x-') ? [[`${at}/${k}`, v] as [string, unknown]] : extensionKeys(v, `${at}/${k}`),
  );
}

/** No `x-*` key present in `input` may be missing or altered in `output`. */
function expectExtensionsPreserved(input: any, output: any) {
  const after = new Map(extensionKeys(output));
  for (const [pointer, value] of extensionKeys(input)) {
    expect({ pointer, value: after.get(pointer) }).toEqual({ pointer, value });
  }
}

const entity = (type: string, ref?: string) => ({
  type: 'object',
  'x-entityField': true,
  'x-entityType': type,
  'x-entityTypeConstrained': true,
  properties: {
    name: { type: 'string' },
    type: { type: 'string', 'x-entityTypeDeclared': type },
    additional_types: { type: 'array', items: { type: 'string' } },
  },
  required: ['name'],
  ...(ref ? { 'x-ref': ref } : {}),
});

const TEMPLATE = {
  type: 'object',
  description: 'NAMING. Use one spelling for one real-world thing…',
  properties: {
    document: {
      type: 'object',
      properties: {
        actors: {
          type: 'array',
          description: 'Everyone and every organisation named anywhere.',
          items: entity('Person'),
        },
        places: {
          type: 'array',
          description: 'Every place named anywhere in this document.',
          items: entity('Location'),
        },
        interests: {
          type: 'array',
          description: 'Interests an act can further.',
          items: entity('Interest'),
        },
        transfers: {
          type: 'array',
          description: 'Payments, donations, aid — value moving between parties.',
          items: {
            type: 'object',
            include_justification: true,
            properties: {
              id: { type: 'string', description: 'An identifier the DOCUMENT provides.' },
              sender: entity('Organization', 'actors'),
              recipient: entity('Organization', 'actors'),
              via: entity('Organization', 'actors'),
              serves: { type: 'array', items: entity('Interest', 'interests') },
              amount: { type: 'number', description: 'As stated. Do not convert.' },
              at: entity('Location', 'places'),
              on: { type: 'string', format: 'date', description: 'When it happened.' },
            },
          },
        },
        dated: { type: 'string', format: 'date', description: 'The date the document gives itself.' },
      },
    },
  },
};

function roundTrip(contract: any) {
  const form = adaptSchemaReadToSchemaFormData({
    name: 'T', description: '', output_contract: contract,
  } as any);
  const out = adaptSchemaFormDataToSchemaCreate({ ...form, name: 'T' });
  return { form, contract: (out.output_contract as any) };
}

const doc = (c: any) => c?.properties?.document?.properties ?? {};

describe('template → editor → contract', () => {
  it('keeps every top-level section', () => {
    const { contract } = roundTrip(TEMPLATE);
    expect(Object.keys(doc(contract)).sort())
      .toEqual(['actors', 'dated', 'interests', 'places', 'transfers']);
  });

  it('keeps a roster an entity array, with its type', () => {
    const actors = doc(roundTrip(TEMPLATE).contract).actors;
    expect(actors.type).toBe('array');
    expect(actors.items['x-entityField']).toBe(true);
    expect(actors.items['x-entityType']).toBe('Person');
  });

  it('keeps `x-ref` on a nested entity role', () => {
    // The link that makes "the same person in three rows" ONE node. Losing it
    // is silent: the schema still runs, and the graph is quietly wrong.
    const sender = doc(roundTrip(TEMPLATE).contract).transfers.items.properties.sender;
    expect(sender['x-entityField']).toBe(true);
    expect(sender['x-ref']).toBe('actors');
  });

  it('keeps a multi-valued entity role an array of entities', () => {
    const serves = doc(roundTrip(TEMPLATE).contract).transfers.items.properties.serves;
    expect(serves.type).toBe('array');
    expect(serves.items['x-entityField']).toBe(true);
    expect(serves.items['x-ref']).toBe('interests');
  });

  it('keeps the per-row justification flag', () => {
    // Every projection binds `evidence: {path: "justification"}`; drop this and
    // the evidence pane is empty for the whole run.
    const transfers = doc(roundTrip(TEMPLATE).contract).transfers;
    expect(transfers.items.include_justification).toBe(true);
  });

  it('keeps scalar types and descriptions', () => {
    const props = doc(roundTrip(TEMPLATE).contract).transfers.items.properties;
    expect(props.amount.type).toBe('number');
    expect(props.amount.description).toContain('Do not convert');
    expect(props.on.type).toBe('string');
    expect(doc(roundTrip(TEMPLATE).contract).dated.description).toContain('gives itself');
  });

  it('is stable — a second pass changes nothing', () => {
    // Kept, but note what it can and cannot catch: it compares round-trip
    // output to round-trip output, so it detects oscillation and NOT loss. A
    // key destroyed on pass 1 is equally absent on pass 2 and this test is
    // perfectly happy. Fidelity is asserted below.
    const once = roundTrip(TEMPLATE).contract;
    const twice = roundTrip(once).contract;
    expect(twice).toEqual(once);
  });
});

describe('nothing is silently dropped', () => {
  it('preserves EVERY x-* key the template carries', () => {
    expectExtensionsPreserved(TEMPLATE, roundTrip(TEMPLATE).contract);
  });

  it('preserves an extension the editor has never heard of', () => {
    // THE test. The editor rebuilds the contract from a closed field model, so
    // for years the only keys that survived were the ones someone had written
    // an emitter for. A contract may carry declarations this editor does not
    // author — `x-graph` is the next one — and it must still carry them after
    // a save. Asserted with a made-up key so it cannot pass by coincidence.
    const withUnknown = structuredClone(TEMPLATE) as any;
    const d = withUnknown.properties.document.properties;
    withUnknown['x-contractLevel'] = { v: 1 };
    d.transfers['x-madeUpKey'] = { deep: { nested: [1, 2] } };     // section node
    d.transfers.items.properties.amount['x-alsoMadeUp'] = 'scalar'; // row property
    d.actors.items['x-onTheEntity'] = ['a', 'b'];                   // entity object
    d.transfers.items.properties.serves.items['x-onNestedEntity'] = true;

    const out = roundTrip(withUnknown).contract;
    expectExtensionsPreserved(withUnknown, out);
    // Spelled out, so a failure names the position rather than a pointer.
    expect(out['x-contractLevel']).toEqual({ v: 1 });
    const o = out.properties.document.properties;
    expect(o.transfers['x-madeUpKey']).toEqual({ deep: { nested: [1, 2] } });
    expect(o.transfers.items.properties.amount['x-alsoMadeUp']).toBe('scalar');
    expect(o.actors.items['x-onTheEntity']).toEqual(['a', 'b']);
    expect(o.transfers.items.properties.serves.items['x-onNestedEntity']).toBe(true);
  });

  it('preserves the contract-level guidance', () => {
    // `BASE_GUIDANCE` — the prompt preamble. Dropped for every template-derived
    // schema on its first save, because the editor read the DB `description`
    // column on the way in and wrote no contract description on the way out.
    const { contract } = roundTrip(TEMPLATE);
    expect(contract.description).toBe(TEMPLATE.description);
  });

  it('preserves a section node’s own description', () => {
    const withSectionDoc = structuredClone(TEMPLATE) as any;
    withSectionDoc.properties.document.description = 'What one document yields.';
    expect(roundTrip(withSectionDoc).contract.properties.document.description)
      .toBe('What one document yields.');
  });

  it('never preserves a key it also emits', () => {
    // The anti-drift device. `CONSUMED_EXTENSIONS` and the emitters must be
    // complements: add an emitter without listing its key and the key is
    // preserved from the old contract AND re-emitted, so a user edit loses to a
    // stale value. Nothing else would notice.
    const { form } = roundTrip(TEMPLATE);
    const seen: string[] = [];
    const walk = (fields: any[]) => {
      for (const f of fields ?? []) {
        seen.push(...Object.keys(f.extensions ?? {}));
        seen.push(...Object.keys(f.items?.extensions ?? {}));
        seen.push(...Object.keys(f.entityConfig?.extensions ?? {}));
        seen.push(...Object.keys(f.items?.entityConfig?.extensions ?? {}));
        walk(f.properties);
        walk(f.items?.properties);
      }
    };
    form.structure.forEach(s => {
      seen.push(...Object.keys(s.extensions ?? {}));
      walk(s.fields);
    });
    expect(seen.filter(k => CONSUMED_EXTENSIONS.has(k))).toEqual([]);
  });
});
