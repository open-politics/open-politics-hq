/**
 * Walk an AnnotationSchema's `output_contract` (a JSON Schema) and produce
 * flat field-path descriptors the panel role pickers consume.
 *
 * The produced paths follow the backend path grammar in `core/filters.py`:
 *   ^[a-zA-Z0-9_]+(\[\*\])?(\.[a-zA-Z0-9_]+)* $
 * i.e. at most ONE `[*]` explosion node in a path. Paths with more than one
 * array node are still emitted for display, but `getArrayNodesInPath` lets
 * the picker disable additional explode checkboxes.
 */
import type { AnnotationSchemaRead, SchemaMap } from '@/client';

/**
 * A resolved-but-empty schema map.
 *
 * `AnnotationSchemaRead.schema_map` is computed server-side and always present
 * on real data. Use this only where a partial schema object is *synthesised*
 * from some other wire type that doesn't carry a map yet (the shared-run
 * payload's `target_schemas`, the analysis-hub tool result). Those upstream
 * payloads should grow the full `AnnotationSchemaRead` shape; until they do,
 * consumers of the synthesised object see no entity paths or vocabularies.
 *
 * Never build a map client-side to fill this in — the backend is the single
 * authority on what a contract means (see `annotation/schema_map.py`).
 */
export const EMPTY_SCHEMA_MAP: SchemaMap = {
  fields: [],
  vocabularies: {},
  entity_paths: [],
  triplet_paths: [],
  time_paths: [],
  place_paths: [],
};

/** Coarse runtime shape of a field's values. Used to match against role `accepts`. */
export type FieldShape =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum_string'
  | 'array_string'
  | 'array_string_enum'
  | 'array_number'
  | 'object'
  | 'array_object'
  | 'triplet'
  | 'entity'
  | 'array_entity'
  | 'unknown';

/** Info about one field in the contract — one row in the picker tree. */
export interface FieldPath {
  /** Dot path, e.g. `document.events[*].when`. `[*]` marks a chosen explosion. */
  path: string;
  /** Human-friendly label (title falls back to the key). */
  label: string;
  /** Coarse shape inferred from the JSON Schema node. */
  shape: FieldShape;
  /** JSON Schema `format` (e.g. `date-time`) if declared. */
  format?: string;
  /** Declared enum values, if any. */
  enum?: (string | number)[];
  /** Description carried from the schema, for tooltips / search hit copy. */
  description?: string;
  /** Array-node depth in path, e.g. `document.events[*].when` → `[2]` */
  arrayNodeIndices: number[];
  /** Whether the node is an array itself (as opposed to leaf). */
  isArrayNode: boolean;
  /** Children of this field — populated for object/array-of-object nodes. */
  children: FieldPath[];
}

/** Array-node positions in a path: `document.events[*].when` → `[1]`. */
function collectArrayNodes(path: string): number[] {
  if (!path) return [];
  const indices: number[] = [];
  path.split('.').forEach((seg, i) => {
    if (seg.endsWith('[*]')) indices.push(i);
  });
  return indices;
}

/** The path one level up. `a.b[*].c` → `a.b[*]`; `a` → `''`. */
function parentPath(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * Walk a schema's field paths for the panel role pickers.
 *
 * **Reads the backend's `schema_map`; does not re-derive anything.** Shape
 * recognition used to live here as a second implementation of what
 * `annotation/schema_map.py` does, and the two had already drifted (the
 * frontend and backend triplet detectors accepted different key aliases).
 * The map is computed from the stored contract and served on
 * `AnnotationSchemaRead.schema_map`, so this function's only job is to turn
 * the flat list into the tree the pickers render.
 *
 * Two deliberate differences from the old local walk:
 *
 * - **No section wrapper node.** Fields render at top level instead of under a
 *   `document` row nobody could select anyway.
 * - **No entity internals.** `entities[*].name` / `.type` / `.additional_types`
 *   are a closed system shape, so they are no longer offered. Stored panel
 *   configs still work — they hold path strings, which resolve fine at query
 *   time; the picker just stops suggesting them. Anything needing the name leaf
 *   builds `<entity_path>.name` by contract.
 *
 * A canon-injected `properties` bag has no node of its own, so its leaves
 * attach to the entity that carries them — hence "nearest existing ancestor"
 * rather than "exact parent".
 */
export function walkOutputContract(schema: AnnotationSchemaRead | null | undefined): FieldPath[] {
  const fields = schema?.schema_map?.fields;
  if (!fields?.length) return [];

  const byPath = new Map<string, FieldPath>();
  const order: FieldPath[] = [];
  for (const f of fields) {
    const node: FieldPath = {
      path: f.path,
      label: f.label ?? f.path.split('.').pop()!.replace('[*]', ''),
      shape: (f.shape ?? 'unknown') as FieldShape,
      // The map encodes date-ness in `shape`; `format` was only ever read by
      // this module's own inference, so it is derived rather than carried.
      format: f.shape === 'date' ? 'date-time' : undefined,
      enum: f.enum?.length ? [...f.enum] : undefined,
      description: f.description ?? undefined,
      arrayNodeIndices: collectArrayNodes(f.path),
      isArrayNode: f.path.endsWith('[*]'),
      children: [],
    };
    byPath.set(f.path, node);
    order.push(node);
  }

  const roots: FieldPath[] = [];
  for (const node of order) {
    let parent = parentPath(node.path);
    while (parent && !byPath.has(parent)) parent = parentPath(parent);
    const holder = parent ? byPath.get(parent) : undefined;
    if (holder && holder !== node) holder.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Shallow lookup — find the FieldPath descriptor for a dot-path. */
export function findFieldPath(paths: FieldPath[], dotPath: string): FieldPath | null {
  if (!dotPath) return null;
  for (const p of paths) {
    if (p.path === dotPath) return p;
    const nested = findFieldPath(p.children, dotPath);
    if (nested) return nested;
  }
  // Also match by ignoring explode markers so callers can pass "events.when"
  // when the stored form is "events[*].when" (or vice versa).
  const normalize = (p: string) => p.replace(/\[\*\]/g, '');
  const target = normalize(dotPath);
  const walk = (ps: FieldPath[]): FieldPath | null => {
    for (const p of ps) {
      if (normalize(p.path) === target) return p;
      const nested = walk(p.children);
      if (nested) return nested;
    }
    return null;
  };
  return walk(paths);
}

/** Given a schema and a dot-path, return the inferred shape of the leaf. */
export function inferFieldShape(
  schema: AnnotationSchemaRead | null | undefined,
  dotPath: string,
): FieldShape {
  const walked = walkOutputContract(schema);
  const match = findFieldPath(walked, dotPath);
  return match?.shape ?? 'unknown';
}

/** How many `[*]` explosion nodes would this path carry? 0 = scalar, 1 = legal, 2+ = illegal. */
export function getArrayNodesInPath(dotPath: string): number {
  return collectArrayNodes(dotPath).length;
}

/**
 * Flatten the walked tree into a searchable list (for substring match in the
 * picker). Preserves the tree shape via `path`.
 */
export function flattenFieldPaths(paths: FieldPath[]): FieldPath[] {
  const out: FieldPath[] = [];
  const walk = (ps: FieldPath[]) => {
    for (const p of ps) {
      out.push(p);
      walk(p.children);
    }
  };
  walk(paths);
  return out;
}

/**
 * Re-keyed helpers: do the available field paths contain any that match a
 * role's accept list? Returns a structured reason when not.
 */
export function paletteHasShape(
  paths: FieldPath[],
  accepts: ReadonlyArray<FieldShape>,
): { matches: boolean; why?: string } {
  const flat = flattenFieldPaths(paths);
  const hits = flat.filter((p) => accepts.includes(p.shape));
  if (hits.length > 0) return { matches: true };
  if (flat.length === 0) {
    return { matches: false, why: 'Schema has no usable fields.' };
  }
  const present = Array.from(new Set(flat.map((p) => p.shape))).join(', ');
  return {
    matches: false,
    why: `No fields of shape [${accepts.join(', ')}] in this schema. Present: ${present}.`,
  };
}
