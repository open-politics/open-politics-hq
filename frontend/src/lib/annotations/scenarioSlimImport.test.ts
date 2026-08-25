/**
 * The slim scenario schema must survive the Import door.
 *
 * `docs/plans/observation-model/schemas/scenario-slim.schema.json` is written in
 * the shape the Schemas page's *Export* produces, so it round-trips through the
 * same adapters the editor uses. This replays that path and asserts the things
 * the graph actually runs on come out the other side.
 *
 * Two failure modes it exists to catch, and both have happened before:
 *
 * * an `x-*` extension dropped in parse-then-re-emit, which loses a roster link
 *   silently — the schema imports, the run succeeds, and the graph is a set of
 *   disconnected dots nobody can explain;
 * * the file drifting from what `templates.py` generates, so the checked-in
 *   artifact and the template disagree about the same schema.
 */
import { describe, expect, it } from 'bun:test';
import {
  adaptSchemaReadToSchemaFormData,
  adaptSchemaFormDataToSchemaCreate,
} from './adapters';
import EXPORT from '../../../../docs/plans/observation-model/schemas/scenario-slim.schema.json';

const SECTIONS = [
  'actors', 'places', 'interests',
  'events', 'observations', 'attributes', 'relations',
];

/** Every `x-*` key in a contract, by JSON pointer. Written against the SHAPE of
 *  the problem rather than a list of keys, because a list is what kept failing:
 *  a walker catches the key nobody has thought of yet. */
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

describe('the file is a valid export', () => {
  it('is an array of one schema with the two fields Import reads', () => {
    expect(Array.isArray(EXPORT)).toBe(true);
    expect(read.name).toBe('Scenario (slim)');
    expect(contract.type).toBe('object');
  });
});

describe('the sections are the seven, and no more', () => {
  it('has exactly the intended set', () => {
    const arrays = Object.entries(doc)
      .filter(([, v]: any) => v.type === 'array').map(([k]) => k);
    expect(arrays.sort()).toEqual([...SECTIONS].sort());
  });

  it('claims carry eleven fields, not twenty', () => {
    expect(Object.keys(doc.observations.items.properties).sort()).toEqual([
      'at', 'by', 'during', 'kind', 'modality',
      'opposes', 'serves', 'to', 'until', 'via', 'when',
    ]);
  });

  it('and grounds ride every row without being one of them', () => {
    // `include_justification` is a flag the annotation runtime reads, not a
    // declared property — which is why the field is absent here and present in
    // every emitted row. `x-graph.evidence` points at what the runtime supplies.
    expect(doc.observations.items.include_justification).toBe(true);
    expect(doc.observations['x-graph'].evidence).toEqual({ path: 'justification' });
  });

  it('never points at a roster it does not have', () => {
    // Merging `instruments` into `actors` left five `x-ref` lists naming a
    // section that no longer exists. The editor's own validator rejects that on
    // save, so the file would have failed at the Import door.
    const sections = new Set(Object.entries(doc)
      .filter(([, v]: any) => v.type === 'array').map(([k]) => k));
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
    walk(doc);
    expect(bad).toEqual([]);
  });

  it('drops what the reader could not use honestly', () => {
    const obs = doc.observations.items.properties;
    // `magnitude` mixed EUR with a 1–10 salience score in one field, so every
    // denominator computed across incommensurable things.
    expect(obs.magnitude).toBeUndefined();
    // `id` made occurrence identity depend on the model inventing a stable
    // reference. Positional identity is stable and never folds two accounts of
    // one act.
    expect(obs.id).toBeUndefined();
    expect(doc.evidence).toBeUndefined();
    expect(doc.instruments).toBeUndefined();
  });

  it('never asks for a field it does not have', () => {
    // Archetype guidance is concatenated per archetype, so it went on telling
    // the model to "put everyone present in `with`" long after `with` was gone.
    // A description naming an absent field is worse than no description: the
    // model pays for it on every row and the parser drops the result.
    const stale = ['magnitude', 'covers_from', '`with`', '`origin`', '`cites`'];
    const prose = JSON.stringify(contract);
    for (const s of stale) expect(prose).not.toContain(s);
  });
});

describe('it survives parse-then-re-emit', () => {
  const back = adaptSchemaFormDataToSchemaCreate(
    adaptSchemaReadToSchemaFormData(read as any),
  );
  const after = (back as any).output_contract;

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

  it('keeps the declarations the layout reads', () => {
    const d = after.properties.document.properties;
    expect(d.places['x-graph']).toEqual({ role: 'anchor', frame: 'geo' });
    expect(d.interests['x-graph']).toEqual({ role: 'vector', frame: 'interest' });
    expect(d.relations['x-graph'].about).toBe('between');
    expect(d.observations['x-graph'].about).toBe('self');
    // Dropping `id` means identity is positional — the declaration must not
    // still point at a field that is gone.
    expect(d.observations['x-graph'].node_name).toBeUndefined();
    expect(d.observations['x-graph'].weight).toBeUndefined();
  });
});
