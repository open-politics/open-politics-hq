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
import type { AnnotationSchemaRead } from '@/client';

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

const TYPE_MAP: Record<string, FieldShape> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'unknown', // refined by items
};

function isTripletItem(itemDef: any): boolean {
  // Triplet items have at least subject/predicate/object keys.
  if (!itemDef || typeof itemDef !== 'object') return false;
  const props = itemDef.properties;
  if (!props || typeof props !== 'object') return false;
  const keys = new Set(Object.keys(props));
  const hasSPO =
    (keys.has('subject') || keys.has('subject_name')) &&
    keys.has('predicate') &&
    (keys.has('object') || keys.has('object_name'));
  return hasSPO;
}

/** An entity-typed JSON Schema node carries the `x-entityField: true` extension
 * (set by the adapter when emitting a field with type='entity'). The runtime
 * value shape is always object `{ name, type?, additional_types? }`. */
function isEntityNode(def: any): boolean {
  if (!def || typeof def !== 'object') return false;
  return def['x-entityField'] === true;
}

function inferNodeShape(def: any): FieldShape {
  if (!def || typeof def !== 'object') return 'unknown';
  const t = def.type;
  if (t === 'graph' || isTripletItem(def?.items)) return 'triplet';
  if (isEntityNode(def)) return 'entity';
  if (t === 'array') {
    const items = def.items;
    if (!items) return 'array_string';
    if (isEntityNode(items)) return 'array_entity';
    if (items.type === 'object') return 'array_object';
    if (items.type === 'number' || items.type === 'integer') return 'array_number';
    if (items.type === 'string' && Array.isArray(items.enum)) return 'array_string_enum';
    return 'array_string';
  }
  if (t === 'string') {
    if (Array.isArray(def.enum)) return 'enum_string';
    if (def.format === 'date' || def.format === 'date-time') return 'date';
    return 'string';
  }
  if (t === 'integer' || t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return TYPE_MAP[t] ?? 'unknown';
}

function collectArrayNodes(path: string): number[] {
  // Returns the 0-based indices of path segments that end in `[*]`.
  if (!path) return [];
  const indices: number[] = [];
  const segments = path.split('.');
  segments.forEach((seg, i) => {
    if (seg.endsWith('[*]')) indices.push(i);
  });
  return indices;
}

function walkNode(
  key: string,
  def: any,
  parentPath: string,
  arrayChosen: boolean,
): FieldPath {
  const shape = inferNodeShape(def);
  const titleFromDef = typeof def?.title === 'string' ? def.title : undefined;

  // Where this node sits in the tree — the display path. `arrayChosen` means
  // the user has toggled explode on some ancestor; when they haven't, we
  // surface the bare dot-path with a marker segment `[*]` at the array node.
  const dotPath = parentPath ? `${parentPath}.${key}` : key;

  const isArray = def?.type === 'array' || shape === 'triplet';
  const explodedPath = isArray ? `${dotPath}[*]` : dotPath;

  const children: FieldPath[] = [];
  // Object properties
  if (def?.type === 'object' && def.properties && typeof def.properties === 'object') {
    for (const [ck, cdef] of Object.entries<any>(def.properties)) {
      children.push(walkNode(ck, cdef, dotPath, arrayChosen));
    }
  }
  // Array of objects — descend into items.properties; child paths root at the
  // array parent (no extra `[*]` injected; the array node itself carries the
  // marker and the backend parses `prefix[*].inner`).
  if (def?.type === 'array' && def.items?.type === 'object' && def.items.properties) {
    // For display we use the path with `[*]` on this node so children clearly
    // live under an explosion point.
    for (const [ck, cdef] of Object.entries<any>(def.items.properties)) {
      children.push(walkNode(ck, cdef, `${dotPath}[*]`, true));
    }
  }

  return {
    path: isArray ? explodedPath : dotPath,
    label: titleFromDef ?? key,
    shape,
    format: def?.format,
    enum: Array.isArray(def?.enum) ? def.enum : undefined,
    description: typeof def?.description === 'string' ? def.description : undefined,
    arrayNodeIndices: collectArrayNodes(isArray ? explodedPath : dotPath),
    isArrayNode: isArray,
    children,
  };
}

/** Walk a schema's output_contract and produce top-level field paths. */
export function walkOutputContract(schema: AnnotationSchemaRead | null | undefined): FieldPath[] {
  if (!schema?.output_contract) return [];
  const contract = schema.output_contract as any;
  const properties = contract?.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.entries<any>(properties).map(([k, def]) => walkNode(k, def, '', false));
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
