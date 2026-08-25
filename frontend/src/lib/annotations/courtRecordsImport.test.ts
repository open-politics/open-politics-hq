/**
 * The court-records schema must survive the Import door.
 *
 * Same replay as `scenarioSlimImport.test.ts`, plus the assertions specific to
 * this corpus. The ones that matter most are the evidentiary ones: a schema
 * that lets a model write "A did X to B" without carrying who said so, in what
 * kind of document, and with what standing is not an extraction schema — it is
 * an accusation generator. Those fields are load-bearing and the tests treat
 * them that way.
 */
import { describe, expect, it } from 'bun:test';
import {
  adaptSchemaReadToSchemaFormData,
  adaptSchemaFormDataToSchemaCreate,
} from './adapters';
import EXPORT from '../../../../docs/plans/observation-model/schemas/court-records.schema.json';

const SECTIONS = [
  'actors', 'places', 'interests',
  'events', 'observations', 'attributes', 'relations', 'exhibits',
];

function extensionKeys(node: any, at = ''): Array<[string, unknown]> {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((v, i) => extensionKeys(v, `${at}/${i}`));
  return Object.entries(node).flatMap(([k, v]) =>
    k.startsWith('x-')
      ? [[`${at}/${k}`, v] as [string, unknown]]
      : extensionKeys(v, `${at}/${k}`));
}

const read = (EXPORT as any[])[0];
const contract = read.output_contract;
const doc = contract.properties.document.properties;
const obs = doc.observations.items.properties;

describe('evidentiary standing is part of the claim', () => {
  it('every act must state where it stands', () => {
    // `alleged` and `adjudicated` are not the same fact, and a schema that
    // cannot tell them apart flattens a pleading into a finding.
    expect(obs.modality.enum).toEqual([
      'recorded', 'testified', 'alleged', 'corroborated', 'denied',
      'declined', 'disputed', 'adjudicated', 'reported',
    ]);
  });

  it('keeps refusing-to-answer distinct from denying', () => {
    // Invoking a privilege is neither a denial nor an admission, and collapsing
    // it into either is the single most common way this material gets misread.
    expect(obs.modality.enum).toContain('declined');
    expect(obs.modality.enum).toContain('denied');
  });

  it('and the document must state what KIND of evidence it is', () => {
    // A flight manifest and a tabloid report are not the same evidence. Every
    // claim inherits this, so it lives at the document level.
    expect(doc.source_kind.enum).toContain('flight_log');
    expect(doc.source_kind.enum).toContain('deposition');
    expect(doc.source_kind.enum).toContain('news_report');
  });

  it('records how much was blacked out', () => {
    // A name that is not here may be a name that was removed. Without this,
    // absence reads as evidence of absence.
    expect(doc.redaction.enum).toEqual(['none', 'partial', 'heavy']);
  });

  it('the modality reaches the EDGES, not just the rows', () => {
    // Without an `edge_group_by` on modality every denial paints exactly like
    // an assertion — on this material that is the difference between a finding
    // and a libel.
    expect(doc.observations['x-graph'].properties)
      .toEqual([{ field: 'modality' }, { field: 'kind' }, { field: 'currency' }]);
  });
});

describe('co-presence is the primary object', () => {
  it('`with` is back, because a manifest is a list', () => {
    // The generic schema folds co-participants into repeated `by`. A flight has
    // a passenger list, not five senders — and two people on one manifest is
    // the finding this corpus exists to surface.
    expect(obs.with).toBeDefined();
  });

  it('a journey has two ends', () => {
    expect(obs.origin).toBeDefined();
    expect(obs.destination).toBeDefined();
    // …and the place binding is a TRAJECTORY, so the canvas draws the leg
    // rather than asserting the flight stayed at its origin.
    expect(doc.observations['x-graph'].place)
      .toEqual({ start: 'origin.name', end: 'destination.name' });
  });

  it('a speaker is not the subject', () => {
    // For testimony `by` is who spoke and `concerns` is who it is about. They
    // are rarely the same person and merging them invents accusations.
    expect(obs.by).toBeDefined();
    expect(obs.concerns).toBeDefined();
  });
});

describe('a claim can be checked against the record it rests on', () => {
  it('exhibits are a section, not a footnote', () => {
    expect(doc.exhibits).toBeDefined();
    expect(doc.exhibits['x-graph'].role).toBe('attachment');
    expect(doc.exhibits['x-graph'].node_kind).toBe('entity');
  });

  it('and a row points at the exhibit by its own label', () => {
    expect(obs.cites).toBeDefined();
    expect(obs.cites.items?.['x-ref'] ?? obs.cites['x-ref']).toBe('exhibits');
  });
});

describe('identities are recorded as the document gives them', () => {
  it('a roster entry can carry sealed or alternate names', () => {
    // "Jane Doe 3" IS the name. The identity behind it, when the same document
    // supplies it, is an alias — never a silent substitution.
    expect(doc.actors.items.properties.aliases.type).toBe('array');
  });
});

describe('amounts carry their unit', () => {
  it('never a bare number', () => {
    // A bare `magnitude` mixed EUR with a 1–10 salience score on the previous
    // schema, so every denominator computed across incommensurable things.
    expect(obs.amount.type).toBe('number');
    expect(obs.currency.type).toBe('string');
    expect(obs.magnitude).toBeUndefined();
  });

  it('and the graph sizes by the amount, not by a guess', () => {
    expect(doc.observations['x-graph'].weight).toBe('amount');
  });
});

describe('it survives parse-then-re-emit', () => {
  const after = (adaptSchemaFormDataToSchemaCreate(
    adaptSchemaReadToSchemaFormData(read as any),
  ) as any).output_contract;

  it('keeps every x-* extension', () => {
    const before = new Map(extensionKeys(contract));
    const now = new Map(extensionKeys(after));
    for (const [ptr, v] of before) expect([ptr, now.get(ptr)]).toEqual([ptr, v]);
  });

  it('keeps every section', () => {
    const arrays = Object.entries(after.properties.document.properties)
      .filter(([, v]: any) => v.type === 'array').map(([k]) => k);
    expect(arrays.sort()).toEqual([...SECTIONS].sort());
  });

  it('never points at a roster it does not have', () => {
    const sections = new Set(SECTIONS);
    const bad: string[] = [];
    const walk = (n: any, at = ''): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${at}/${i}`));
      const r = n['x-ref'];
      for (const t of (typeof r === 'string' ? [r] : r ?? [])) {
        if (!sections.has(t)) bad.push(`${at} -> ${t}`);
      }
      Object.entries(n).forEach(([k, v]) => walk(v, `${at}/${k}`));
    };
    walk(after.properties.document.properties);
    expect(bad).toEqual([]);
  });
});
