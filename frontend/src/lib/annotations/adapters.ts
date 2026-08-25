import {
  Source, Asset, AnnotationRun,
  AnnotationResult,
  AnnotationSchema,
  FormattedAnnotation,
  AnnotationSchemaFormData,
  AdvancedSchemeField,
  JsonSchemaType,
  SchemaSection,
  SourceKind,
  SourceStatus,
  AnnotationRunStatus,
  AnnotationResultStatus,
  GraphFieldConfig,
  EntityFieldConfig,
  FieldRef,
  CanonTie,
  refTargets,
} from './types';
import { NODE_STYLES_EXTENSION, readGraphStyle, type NodeStyle } from './graphStyle';
import {
  AnnotationRead as ClientAnnotationRead,
  AnnotationSchemaRead as ClientAnnotationSchemaRead,
  AnnotationRunRead as ClientAnnotationRunRead,
  AnnotationSchemaCreate,
  FieldJustificationConfig,
  AssetRead as ClientAssetRead,
} from '@/client';
import { nanoid } from 'nanoid';

// =============================================================================
// Intra-schema reference resolution (Phase 1b)
// =============================================================================

/** Custom error thrown when ref expansion detects a cycle. The schema editor
 * surfaces this on save so the user sees exactly which fields form the loop.
 */
export class SchemaRefCycleError extends Error {
  cyclePath: string[];
  constructor(cyclePath: string[]) {
    super(`Reference cycle detected: ${cyclePath.join(' → ')}`);
    this.cyclePath = cyclePath;
    this.name = 'SchemaRefCycleError';
  }
}

/** Find a field by dot-path within a section's field tree. Descends into
 * `properties` (for object fields) and `items.properties` (for array-of-object
 * fields). Does NOT descend into `graph` fields' inner triplet props — those
 * are LLM-internal and not addressable as ref targets. */
function findFieldByPath(
  fields: AdvancedSchemeField[],
  pathSegments: string[],
): AdvancedSchemeField | null {
  if (pathSegments.length === 0) return null;
  const [head, ...rest] = pathSegments;
  const found = fields.find(f => f.name === head);
  if (!found) return null;
  if (rest.length === 0) return found;
  if (found.type === 'object' && found.properties) {
    return findFieldByPath(found.properties, rest);
  }
  if (found.type === 'array' && found.items?.type === 'object' && found.items.properties) {
    return findFieldByPath(found.items.properties, rest);
  }
  return null;
}

/** Given a field with an optional `ref`, return the field whose definition
 * should be emitted. If `ref` is set, walks the ref chain (refs of refs are
 * allowed; cycles throw `SchemaRefCycleError`). The returned field has the
 * referrer's `name` and `description` (own description, if set, wins) but
 * the target's type, enum, entityConfig, items, properties, etc.
 *
 * `expanding` is the set of field IDs currently being expanded — used for
 * cycle detection across the ref chain.
 */
function resolveFieldRef(
  field: AdvancedSchemeField,
  sectionFields: AdvancedSchemeField[],
  expanding: Set<string> = new Set(),
  trail: string[] = [],
): AdvancedSchemeField {
  const targetPaths = refTargets(field.ref);
  if (!targetPaths.length) return field;
  if (expanding.has(field.id)) {
    throw new SchemaRefCycleError([...trail, field.name]);
  }

  expanding.add(field.id);
  trail.push(field.name);
  const resolved: AdvancedSchemeField[] = [];
  try {
    for (const path of targetPaths) {
      const target = findFieldByPath(sectionFields, path.split('.'));
      if (!target) {
        // Broken ref — surface as a cycle-style error so the caller treats it
        // the same way (save fails with a clear message).
        throw new Error(`Field "${field.name}" references "${path}" which does not exist in this schema.`);
      }
      resolved.push(resolveFieldRef(target, sectionFields, expanding, trail));
    }
  } finally {
    expanding.delete(field.id);
    trail.pop();
  }
  // The first target is the primary — it supplies the shape for the alias
  // form and the leading entity type. Later ones only widen the vocabulary.
  const resolvedTarget = resolved[0];

  // **A ref names a shared vocabulary, not a shared shape.**
  //
  // `sender` refs the `actors` roster because they draw from the same
  // population — not because a payment has many senders. Copying the target's
  // definition wholesale turned every single-valued role into an array of the
  // roster, which is a different schema from the one the author wrote and a
  // different graph from the one they asked for. Silent, too: the run
  // succeeds, and the roles come back as lists.
  //
  // So when the referrer is **itself entity-shaped**, it has already said what
  // it is and only the vocabulary is inherited. Anything else is the original
  // alias form — "make this field be whatever `actors` is" — and still expands
  // the target wholesale, which is exactly what a placeholder `type: 'string'`
  // with a ref is asking for.
  const referrerIsEntityShaped =
    field.type === 'entity'
    || (field.type === 'array' && field.items?.type === 'entity');
  if (referrerIsEntityShaped) {
    // Every target contributes; the referrer still wins on anything it states.
    const vocab = resolved
      .map(entityVocabularyOf)
      .reduce<EntityFieldConfig | undefined>((acc, v) => mergeEntityVocabulary(acc, v), undefined);
    return {
      ...field,
      description: field.description ?? resolvedTarget.description,
      entityConfig: mergeEntityVocabulary(field.entityConfig, vocab),
      items: field.items?.type === 'entity'
        ? { ...field.items, entityConfig: mergeEntityVocabulary(field.items.entityConfig, vocab) }
        : field.items,
      enum: field.enum ?? (field.type === 'entity' ? undefined : resolvedTarget.enum),
    };
  }

  return {
    ...resolvedTarget,
    id: field.id,
    name: field.name,
    description: field.description ?? resolvedTarget.description,
    required: field.required,
  };
}

/** The entity config a ref target contributes, scalar or roster.
 *
 *  Vocabulary only — and now that is structural rather than a filter here.
 *  An `EntityFieldConfig` carries no colour or icon any more, because a ref
 *  names a shared population and not a shared appearance: copying visuals made
 *  `relations.from` — declared `Person`, ref'd at `[actors, places,
 *  interests]` — carry the icon its author had set on *interests*, and the
 *  graph then painted every person with it. Appearance lives in the schema's
 *  `nodeStyles` palette, keyed by node type, where a ref cannot reach it. */
function entityVocabularyOf(
  target: AdvancedSchemeField,
): EntityFieldConfig | undefined {
  return target.entityConfig ?? target.items?.entityConfig;
}

/** Referrer wins on anything it states; the target supplies the rest.
 *
 *  In practice the target contributes the closed `enum` (the roster's
 *  vocabulary) while the referrer keeps its own `entity_type` — a payment's
 *  `sender` is an Organization even when the roster it draws from is typed
 *  Person. */
function mergeEntityVocabulary(
  own: EntityFieldConfig | undefined,
  from: EntityFieldConfig | undefined,
): EntityFieldConfig | undefined {
  if (!from) return own;
  if (!own) return from;
  return {
    ...from,
    ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)),
  } as EntityFieldConfig;
}

// ─── Extension passthrough ──────────────────────────────────────────────────
//
// The editor rebuilds `output_contract` from scratch on every save, so any
// `x-*` key it has no field for is destroyed the first time a schema is opened
// and saved. Silently: no warning, no validation error, and the loss is only
// visible downstream, sometimes months later.
//
// That has been patched narrowly three times — `format: date`, then
// `include_justification`, then `x-ref` on items — each time for one key. The
// bucket below is the general form: whatever the emitters do not write, the
// parser keeps and the emitter puts back.
//
// The invariant is that these two lists are complements. A key in
// CONSUMED_EXTENSIONS is one the editor OWNS and must never preserve blindly
// (a stale copy would shadow an edit); a key outside it is preserved verbatim.
// `templateRoundTrip.test.ts` asserts both directions, including the case that
// matters most: a key nobody has heard of yet.
//
// Owned is a slightly wider claim than emitted. `x-entityColor` and
// `x-entityIcon` have no emitter any more — the palette replaced them — but
// they stay listed, because `readPalette` migrates them and preserving the
// originals would resurrect the very divergence the migration removes.

/** Every `x-*` key this file owns. Add to this list in the SAME change that
 *  adds an emitter, or the key gets preserved from the old contract *and*
 *  re-emitted, and a user edit loses to a stale value. */
export const CONSUMED_EXTENSIONS: ReadonlySet<string> = new Set([
  // Entity objects — `buildEntityObjectSchema`
  'x-entityField', 'x-entityType', 'x-entityAlternateTypes', 'x-entityEnum',
  'x-entityTypeConstrained', 'x-entityTypeDeclared', 'x-entityColor', 'x-entityIcon',
  // Generic property nodes
  'x-ref', 'x-canon',
  // Triplet / graph fields — `buildJsonSchemaProperties`
  'x-fieldName', 'x-fromSource', 'x-toSource',
  'x-entityTypeList', 'x-entityTypeColors', 'x-entityTypeIcons',
  'x-predicateList', 'x-predicateConstrained', 'x-predicateColors',
  'x-predicateIcons', 'x-predicateArrows',
  // Contract root — the schema's node palette
  NODE_STYLES_EXTENSION,
]);

/** Unknown `x-*` keys on one JSON Schema node, or undefined when there are
 *  none — undefined rather than `{}` so a hand-authored schema stays byte-clean
 *  and `authorFromScratch` keeps emitting exactly what it always did. */
export const collectExtensions = (
  schema: any,
): Record<string, unknown> | undefined => {
  if (!schema || typeof schema !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    if (key.startsWith('x-') && !CONSUMED_EXTENSIONS.has(key)) out[key] = schema[key];
  }
  return Object.keys(out).length ? out : undefined;
};

// Entity object shape — used both for scalar `entity` fields (back-compat)
// and the items of `array_entity` fields. Returns the JSON-Schema object
// {name, type, additional_types} with x-extensions carrying canon-resolution
// config. Multi-type fields (entity_type + alternate_types) round-trip via
// x-entityType (primary, canon key) + x-entityAlternateTypes (alternates).
const buildEntityObjectSchema = (
    ec: EntityFieldConfig | undefined,
    description: string | undefined,
    refTargetPath?: string | string[],
    canonTie?: CanonTie,
): any => {
    const primaryType = ec?.entity_type ?? '';
    const alternates = (ec?.alternate_types || []).filter(s => typeof s === 'string' && s.trim() !== '');
    const allTypes = primaryType ? [primaryType, ...alternates] : alternates;
    const entityEnum = (ec?.enum || []).filter(s => typeof s === 'string' && s.trim() !== '');
    const constrained = ec?.typeConstrained !== false; // default true

    const typeLabel = allTypes.length === 0
        ? 'entity'
        : allTypes.length === 1
            ? allTypes[0]
            : allTypes.join(' / ');

    const nameProp: any = {
        type: 'string',
        description: primaryType ? `Name of the ${typeLabel}` : 'Entity name',
    };
    if (entityEnum.length > 0) {
        nameProp['x-entityEnum'] = entityEnum;
        if (constrained) nameProp.enum = entityEnum;
    }
    const typeProp: any = {
        type: 'string',
        description: allTypes.length > 1
            ? `Entity type — pick one of: ${allTypes.join(', ')}.`
            : 'Entity type — usually matches the declared primary type.',
    };
    if (primaryType) {
        typeProp['x-entityTypeDeclared'] = primaryType;
        if (constrained && allTypes.length > 0) typeProp.enum = allTypes;
    }
    const objectShape: any = {
        // Preserved unknown keys go FIRST — everything below is a key this
        // builder owns, and an owned key must always beat a stale copy.
        ...(ec?.extensions ?? {}),
        type: 'object',
        description: description || (primaryType ? `A ${typeLabel} reference.` : 'An entity reference.'),
        'x-entityField': true,
        properties: {
            name: nameProp,
            type: typeProp,
            additional_types: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional additional entity types beyond the primary type.',
            },
        },
        required: ['name'],
    };
    if (primaryType) objectShape['x-entityType'] = primaryType;
    if (alternates.length > 0) objectShape['x-entityAlternateTypes'] = alternates;
    if (entityEnum.length > 0) objectShape['x-entityEnum'] = entityEnum;
    objectShape['x-entityTypeConstrained'] = constrained;
    // No `x-entityColor` / `x-entityIcon`: appearance is keyed by node type in
    // the contract's root palette now, not by field. A field is the wrong
    // owner for it (two fields of one type could disagree, and a ref field
    // inherited a type it does not have), and the palette can name self-node
    // types that have no field at all. Old contracts are folded into the
    // palette on load by `readPalette`, so nothing is lost by not writing here.
    if (refTargetPath) objectShape['x-ref'] = refTargetPath;
    // Canon tie. The generic field branch below emits `x-canon` onto the
    // property node, but a scalar `entity` field never reaches that branch —
    // it returns straight out of here — so without this its tie was silently
    // dropped on save. The backend reads `x-canon` from either position
    // (`schema_map._parse_canon`), so emitting it on the entity object is
    // equivalent to the array case.
    if (canonTie && (canonTie.canonId != null || canonTie.type)) {
        objectShape['x-canon'] = {
            ...(canonTie.canonId != null ? { canon_id: canonTie.canonId } : {}),
            ...(canonTie.type ? { type: canonTie.type } : {}),
        };
    }
    return objectShape;
};

// Inverse: walk an entity-shaped JSON Schema object back into an
// EntityFieldConfig. Reads x-entityType (primary) + x-entityAlternateTypes.
// Falls back to the legacy single-type shape gracefully.
const parseEntityConfigFromSchema = (schema: any): EntityFieldConfig => {
    const enumList = schema['x-entityEnum'];
    const alternates = schema['x-entityAlternateTypes'];
    return {
        entity_type:
            schema['x-entityType']
            || schema.properties?.type?.['x-entityTypeDeclared']
            || '',
        alternate_types:
            Array.isArray(alternates) && alternates.length > 0 ? alternates : undefined,
        enum: Array.isArray(enumList) && enumList.length > 0 ? enumList : undefined,
        typeConstrained: schema['x-entityTypeConstrained'] !== false,
        extensions: collectExtensions(schema),
    };
};

type ClientSourceRead = any;

// A temporary placeholder until the client is regenerated
// TODO: Check if this is needed after client regeneration
type ClientEnhancedAnnotationRead = ClientAnnotationRead & { 
    display_value?: any;
};


/**
 * Adapters to convert between backend API types (from `@/client`)
 * and internal frontend types (from `./types`).
 */

// --- NEW ADAPTERS FOR ADVANCED SCHEMA BUILDER ---

/** Build a JSON Schema for a list of fields.
 *
 * @param fields The fields at this level.
 * @param sectionRoot The top-level fields of the section, used for resolving
 *   intra-schema refs. On recursion (into object/array properties or graph
 *   optionalFields), pass the same root through unchanged so refs always
 *   resolve against the section's full tree.
 */
const buildJsonSchemaProperties = (
    fields: AdvancedSchemeField[],
    sectionRoot?: AdvancedSchemeField[],
): { properties: any, required: string[] } => {
    const properties: any = {};
    const required: string[] = [];
    const root = sectionRoot ?? fields;

    fields.forEach(rawField => {
        if (!rawField.name) return;
        // Resolve ref. Throws on cycle / missing target — caller catches.
        const field = rawField.ref ? resolveFieldRef(rawField, root) : rawField;
        const refPaths = refTargets(rawField.ref);
        // One target emits a bare string, several emit an array — both are
        // valid `x-ref` and the bare form keeps older contracts byte-identical.
        const refTargetPath: string | string[] | undefined =
          refPaths.length === 0 ? undefined
            : refPaths.length === 1 ? refPaths[0] : refPaths;

        // Handle graph field type - outputs triplets array
        if (field.type === 'graph' && field.graphConfig) {
            const graphConfig = field.graphConfig;

            // Build triplet schema (self-contained: subject -> predicate -> object)
            const tripletProperties: any = {};
            const tripletRequired: string[] = ['subject_name', 'subject_type', 'predicate', 'object_name', 'object_type'];

            // Anchored-triplet injection: when from_source / to_source point
            // at an entity field elsewhere in the schema, the model is told
            // "the subject (or object) of every triplet you extract must be
            // one of the entities named in <that field>." If the referenced
            // entity field has a closed enum, we copy it onto subject_name /
            // object_name as a JSON Schema `enum` constraint (the LLM gets
            // a Pydantic Literal). For open-ended entity fields, we attach a
            // prose description hint — same intent, softer enforcement.
            const resolveAnchorConstraint = (sourcePath: string | undefined) => {
                if (!sourcePath) return null;
                const target = findFieldByPath(root, sourcePath.split('.'));
                if (!target || target.type !== 'entity' || !target.entityConfig) return null;
                const enumNames = (target.entityConfig.enum || [])
                    .filter(s => typeof s === 'string' && s.trim() !== '');
                return {
                    targetPath: sourcePath,
                    enumNames: enumNames.length > 0 ? enumNames : null,
                    typeHint: target.entityConfig.entity_type || null,
                };
            };
            const fromAnchor = resolveAnchorConstraint(graphConfig.from_source);
            const toAnchor = resolveAnchorConstraint(graphConfig.to_source);

            const buildAnchoredNameSchema = (
                role: 'subject' | 'object',
                anchor: ReturnType<typeof resolveAnchorConstraint>,
            ): any => {
                const base: any = { type: 'string' };
                if (!anchor) {
                    base.description = `Name of the ${role} entity`;
                    return base;
                }
                base.description =
                    `Name of the ${role} entity. Must be one of the entities ` +
                    `named in \`${anchor.targetPath}\`` +
                    (anchor.typeHint ? ` (${anchor.typeHint})` : '') +
                    `.`;
                base[`x-${role}Source`] = anchor.targetPath;
                if (anchor.enumNames) base.enum = anchor.enumNames;
                return base;
            };

            tripletProperties.subject_name = buildAnchoredNameSchema('subject', fromAnchor);
            // Persistence is decoupled from enforcement: the list and UI metadata always
            // round-trip; the JSON-schema `enum` keyword (which the backend turns into a
            // Pydantic Literal) is only emitted when the user opted into constraint.
            const cleanedTypes = (graphConfig.entityTypes.typeEnum || []).filter(t => t.trim() !== '');
            const typeConstrained = !!graphConfig.entityTypes.typeConstrained;

            const buildTypeSchema = (role: 'subject' | 'object'): any => {
                const s: any = {
                    type: 'string',
                    description: graphConfig.entityTypes.typeDescription || `Type of the ${role} entity`,
                };
                if (cleanedTypes.length > 0) {
                    s['x-entityTypeList'] = cleanedTypes;
                    if (typeConstrained) s.enum = cleanedTypes;
                }
                s['x-entityTypeConstrained'] = typeConstrained;
                // Type colours and icons used to be buried here, on the
                // `subject_type` property of a triplet — a place no other
                // authoring surface could write to and none of them thought to
                // read. They live in the contract's root palette now, shared
                // with the section editor. `readPalette` migrates the old ones.
                return s;
            };

            tripletProperties.subject_type = buildTypeSchema('subject');

            // Predicate field — same decoupling
            const cleanedPredicates = (graphConfig.relationshipSchema.predicateEnum || []).filter(p => p.trim() !== '');
            const predicateConstrained = !!graphConfig.relationshipSchema.predicateConstrained;

            const predicateSchema: any = {
                type: 'string',
                description: graphConfig.relationshipSchema.predicateDescription || 'Relationship predicate (e.g., works_for, located_in)',
            };
            if (cleanedPredicates.length > 0) {
                predicateSchema['x-predicateList'] = cleanedPredicates;
                if (predicateConstrained) predicateSchema.enum = cleanedPredicates;
            }
            predicateSchema['x-predicateConstrained'] = predicateConstrained;
            if (graphConfig.relationshipSchema.predicateColors && Object.keys(graphConfig.relationshipSchema.predicateColors).length > 0) {
                predicateSchema['x-predicateColors'] = graphConfig.relationshipSchema.predicateColors;
            }
            if (graphConfig.relationshipSchema.predicateIcons && Object.keys(graphConfig.relationshipSchema.predicateIcons).length > 0) {
                predicateSchema['x-predicateIcons'] = graphConfig.relationshipSchema.predicateIcons;
            }
            if (graphConfig.relationshipSchema.predicateArrows && Object.keys(graphConfig.relationshipSchema.predicateArrows).length > 0) {
                predicateSchema['x-predicateArrows'] = graphConfig.relationshipSchema.predicateArrows;
            }
            tripletProperties.predicate = predicateSchema;

            // Object fields — anchored via to_source if set.
            tripletProperties.object_name = buildAnchoredNameSchema('object', toAnchor);
            tripletProperties.object_type = buildTypeSchema('object');

            // Add optional fields (e.g., context, confidence)
            if (graphConfig.relationshipSchema.optionalFields) {
                const { properties: optProps, required: optRequired } =
                    buildJsonSchemaProperties(graphConfig.relationshipSchema.optionalFields, root);
                Object.assign(tripletProperties, optProps);
                tripletRequired.push(...optRequired);
            }

            // Property key: legacyKey wins (round-trips as "triplets" for fields
            // saved before multi-graph-field landed); otherwise use the field's
            // own name. New schemas with multiple graph fields get distinct keys
            // and edges tag with `source_field_path` at curation time.
            const graphKey = (rawField.legacyKey || field.legacyKey || field.name);
            const tripletPayload: any = {
                type: 'array',
                description: field.description || 'Array of relationship triplets (subject -> predicate -> object)',
                items: {
                    type: 'object',
                    properties: tripletProperties,
                    required: tripletRequired
                }
            };
            // Preserve user-facing name distinct from key when legacy. New
            // schemas don't need x-fieldName since key === name.
            if (graphKey !== field.name) {
                tripletPayload['x-fieldName'] = field.name;
            }
            // Anchored-triplet sources (Phase 5 wires curation; metadata
            // round-trips now so the editor doesn't lose state).
            if (graphConfig.from_source) tripletPayload['x-fromSource'] = graphConfig.from_source;
            if (graphConfig.to_source) tripletPayload['x-toSource'] = graphConfig.to_source;
            properties[graphKey] = tripletPayload;
            if (field.required) required.push(graphKey);
        } else if (field.type === 'entity') {
            // Scalar entity field — emit as object {name, type, additional_types}.
            // Same shape as array_entity items; runtime value is always an
            // object for SQL-path uniformity.
            properties[rawField.name] = buildEntityObjectSchema(
                field.entityConfig, field.description, refTargetPath, field.canonTie,
            );
            if (rawField.required) required.push(rawField.name);
        } else {
            // Regular field handling
            const property: any = {
                // Preserved first; every key below is one this emitter owns.
                ...(field.extensions ?? {}),
                description: field.description || undefined,
                // `date` is the editor's word for a shape JSON Schema spells in
                // two keys. Collapse it back, or the contract carries a type no
                // provider knows.
                type: field.type === 'date' ? 'string' : field.type,
            };
            if (field.type === 'date') property.format = 'date';

            if (rawField.required) required.push(rawField.name);
            if (field.enum && field.enum.length > 0) property.enum = field.enum;
            if (field.minimum !== undefined) property.minimum = field.minimum;
            if (field.maximum !== undefined) property.maximum = field.maximum;
            if (field.type === 'object' && field.properties) {
                const sub = buildJsonSchemaProperties(field.properties, root);
                property.properties = sub.properties;
                if (sub.required.length > 0) property.required = sub.required;
            }
            if (field.type === 'array' && field.items) {
                if (field.items.type === 'entity') {
                    // array_entity: items are full entity-object references.
                    // Reuse the same builder that scalar `entity` fields use.
                    // The ref belongs on the ITEM — that is the node carrying a
                    // vocabulary, and where `schema_map` reads `x-ref`.
                    property.items = buildEntityObjectSchema(
                        field.items.entityConfig, field.items.description, refTargetPath,
                    );
                } else {
                    property.items = { ...(field.items.extensions ?? {}), type: field.items.type };
                    if (field.items.description) property.items.description = field.items.description;
                    if (field.items.type === 'object' && field.items.properties) {
                        const sub = buildJsonSchemaProperties(field.items.properties, root);
                        property.items.properties = sub.properties;
                        if (sub.required.length > 0) property.items.required = sub.required;
                    }
                    if (field.items.enum && field.items.enum.length > 0) {
                        let enumValues = [...field.items.enum];
                        if (field.items.includeOther && !enumValues.includes('other')) enumValues.push('other');
                        property.items.enum = enumValues;
                    }
                    if (field.items.minimum !== undefined) property.items.minimum = field.items.minimum;
                    if (field.items.maximum !== undefined) property.items.maximum = field.items.maximum;
                }
            }
            // If the field was originally a ref, preserve the target on the
            // emitted node so the parser can reconstruct the ref on reload.
            // An entity roster already carries it on `items`, which is where
            // `schema_map` looks for one — putting it in both places would
            // make the same vocabulary appear to be declared twice.
            if (refTargetPath && field.items?.type !== 'entity') property['x-ref'] = refTargetPath;
            // Justification rides in the contract, not only in the side map:
            // the contract is what gets exported, shared and read by the
            // companion, and `_lift_configs_into_contract` writes the same key.
            if (field.justification?.enabled) {
                if (field.type === 'array' && property.items && typeof property.items === 'object') {
                    property.items.include_justification = true;
                } else {
                    property.include_justification = true;
                }
            }
            // Canon tie — round-trip the backing canon + type so curation can
            // resolve the field's output into that canon and fill its shape.
            if (field.canonTie && (field.canonTie.canonId != null || field.canonTie.type)) {
                property['x-canon'] = {
                    ...(field.canonTie.canonId != null ? { canon_id: field.canonTie.canonId } : {}),
                    ...(field.canonTie.type ? { type: field.canonTie.type } : {}),
                };
            }
            properties[rawField.name] = property;
        }
    });

    return { properties, required };
};

/** The JSON property key a field will emit at. For graph fields with a
 * legacyKey set (saved before multi-graph-field landed), the key stays at
 * "triplets" forever to preserve back-compat with stored annotations and
 * panel configs. New graph fields use their user-facing name. */
const fieldOutputKey = (field: AdvancedSchemeField): string => {
    if (field.type === 'graph') return field.legacyKey || field.name;
    return field.name;
};

const collectJustificationConfigs = (structure: SchemaSection[]): { [key: string]: FieldJustificationConfig } => {
    const configs: { [key: string]: FieldJustificationConfig } = {};

    const recurse = (fields: AdvancedSchemeField[]) => {
        for (const field of fields) {
            if (field.justification?.enabled) {
                configs[fieldOutputKey(field)] = {
                    enabled: true,
                    custom_prompt: field.justification.custom_prompt || undefined,
                    rigor_level: field.justification.rigor_level ?? undefined,
                };
            }
            if (field.properties) recurse(field.properties);
            if (field.items?.properties) recurse(field.items.properties);
        }
    };

    recurse(structure.flatMap(s => s.fields));
    return configs;
};


export const adaptSchemaFormDataToSchemaCreate = (formData: AnnotationSchemaFormData): AnnotationSchemaCreate => {
    // Built from scratch, which is why every preserved thing has to be put back
    // explicitly. `contractGuidance` is the contract's own prompt preamble
    // (`templates.py:BASE_GUIDANCE`) — a different string from `description`,
    // the DB column, and it was being dropped on the first save of every
    // template-derived schema.
    const outputContract: any = {
        ...(formData.contractExtensions ?? {}),
        type: 'object',
        ...(formData.contractGuidance ? { description: formData.contractGuidance } : {}),
        ...(formData.nodeStyles && Object.keys(formData.nodeStyles).length
            ? { [NODE_STYLES_EXTENSION]: formData.nodeStyles }
            : {}),
        properties: {}
    };

    formData.structure.forEach(section => {
        const { properties, required } = buildJsonSchemaProperties(section.fields);
        const sectionExtras = {
            ...(section.extensions ?? {}),
            ...(section.description ? { description: section.description } : {}),
        };

        if (section.name === 'document') {
            outputContract.properties.document = {
                ...sectionExtras,
                type: 'object',
                properties: properties,
            };
            if (required.length > 0) {
                 outputContract.properties.document.required = required;
            }
        } else { // per_image, per_audio, etc.
             outputContract.properties[section.name] = {
                ...sectionExtras,
                type: 'array',
                items: {
                    type: 'object',
                    properties: properties
                }
            };
            if (required.length > 0) {
                 outputContract.properties[section.name].items.required = required;
            }
        }
    });

    const justificationConfigs = collectJustificationConfigs(formData.structure);

    return {
        name: formData.name,
        description: formData.description,
        instructions: formData.instructions,
        output_contract: outputContract,
        field_specific_justification_configs: justificationConfigs,
    };
};

/** Detect graph-shaped JSON: an array whose items have subject_name, predicate,
 * and object_name properties. The property name doesn't matter — multi-graph-
 * field schemas key by user-facing name; legacy schemas key under "triplets". */
const isGraphProperty = (schema: any): boolean => {
    if (!schema || schema.type !== 'array') return false;
    const itemProps = schema.items?.properties;
    if (!itemProps || typeof itemProps !== 'object') return false;
    const k = new Set(Object.keys(itemProps));
    const looksLikeTriplet =
        (k.has('subject_name') || k.has('subject')) &&
        k.has('predicate') &&
        (k.has('object_name') || k.has('object'));
    if (!looksLikeTriplet) return false;

    // **Entity children win.** An entity object already carries `{name, type}`,
    // which is exactly what a triplet spells out as `subject_name` +
    // `subject_type` — so a row whose `subject`/`object` ARE entity fields is
    // an entity-linked relation row, not a legacy triplet.
    //
    // Without this, the observation model's `relations[*]` — two entity roles
    // and a predicate, which is how the model says to write a standing link —
    // was rewritten into flat triplet strings on load, dropping both roster
    // links. Silent, and it turned the one section that exists to *avoid*
    // triplets back into triplets. The backend's `_infer_node_roles` makes the
    // same check for the same reason; keep the two in step.
    const isEntity = (p: any) => !!p && p['x-entityField'] === true;
    if (isEntity(itemProps.subject) || isEntity(itemProps.object)) return false;
    return true;
};

/** Reconstruct a graph field from a graph-shaped JSON Schema property. */
const parseGraphField = (
    propertyKey: string,
    schema: any,
    required: string[],
): AdvancedSchemeField => {
    const tripletSchema = schema.items || {};
    const tripletProps = tripletSchema.properties || {};

    const subjectTypeSchema = tripletProps.subject_type || {};
    const typeList = subjectTypeSchema['x-entityTypeList'];
    const typeEnum = Array.isArray(typeList) && typeList.length > 0
        ? typeList : (subjectTypeSchema.enum || undefined);
    const typeConstrained = typeof subjectTypeSchema['x-entityTypeConstrained'] === 'boolean'
        ? subjectTypeSchema['x-entityTypeConstrained']
        : !!(subjectTypeSchema.enum && subjectTypeSchema.enum.length > 0);

    const predicateSchema = tripletProps.predicate || {};
    const predicateList = predicateSchema['x-predicateList'];
    const predicateEnum = Array.isArray(predicateList) && predicateList.length > 0
        ? predicateList : (predicateSchema.enum || undefined);
    const predicateConstrained = typeof predicateSchema['x-predicateConstrained'] === 'boolean'
        ? predicateSchema['x-predicateConstrained']
        : !!(predicateSchema.enum && predicateSchema.enum.length > 0);

    const requiredTripletFields = ['subject_name', 'subject_type', 'predicate', 'object_name', 'object_type'];
    const optionalFields = parseJsonSchemaProperties(tripletProps, tripletSchema.required || [])
        .filter(f => !requiredTripletFields.includes(f.name));

    // Name + legacyKey: schemas saved at literal key "triplets" round-trip at
    // "triplets" forever (back-compat with stored annotations and panel configs).
    // x-fieldName carries the user-facing name when it differs from the key.
    const userFacingName = schema['x-fieldName'] || propertyKey;
    const legacyKey = propertyKey === 'triplets' ? 'triplets' : undefined;

    return {
        id: nanoid(),
        name: userFacingName,
        type: 'graph',
        description: schema.description || 'Knowledge graph triplets (subject -> predicate -> object)',
        required: required.includes(propertyKey),
        legacyKey,
        graphConfig: {
            entityTypes: {
                typeEnum,
                typeConstrained,
                typeDescription: subjectTypeSchema.description || undefined,
            },
            relationshipSchema: {
                predicateEnum,
                predicateConstrained,
                predicateDescription: predicateSchema.description || undefined,
                predicateColors: predicateSchema['x-predicateColors'] || undefined,
                predicateIcons: predicateSchema['x-predicateIcons'] || undefined,
                predicateArrows: predicateSchema['x-predicateArrows'] || undefined,
                optionalFields,
            },
            from_source: schema['x-fromSource'] || undefined,
            to_source: schema['x-toSource'] || undefined,
        },
    };
};

/** Reconstruct an entity field from an entity-shaped JSON Schema property. */
const parseEntityField = (
    propertyKey: string,
    schema: any,
    required: string[],
): AdvancedSchemeField => {
    const field: AdvancedSchemeField = {
        id: nanoid(),
        name: propertyKey,
        type: 'entity',
        description: schema.description || undefined,
        required: required.includes(propertyKey),
        entityConfig: parseEntityConfigFromSchema(schema),
    };
    const refs = refTargets({ targets: schema['x-ref'] } as any);
    if (refs.length) field.ref = { targets: refs };
    return field;
};

const parseJsonSchemaProperties = (properties: any = {}, required: string[] = []): AdvancedSchemeField[] => {
    const out: AdvancedSchemeField[] = [];

    for (const [name, schema] of Object.entries<any>(properties)) {
        // Entity field — recognized by x-entityField extension
        let field: AdvancedSchemeField;
        if (schema && schema['x-entityField'] === true) {
            field = parseEntityField(name, schema, required);
        } else if (isGraphProperty(schema)) {
            // Graph field — recognized by triplet shape, regardless of property name
            field = parseGraphField(name, schema, required);
        } else {
            field = parseRegularField(name, schema, required);
        }
        // Canon tie round-trips for every field kind (see x-canon emission).
        const xc = schema?.['x-canon'];
        if (xc && typeof xc === 'object') {
            field.canonTie = {
                canonId: typeof xc.canon_id === 'number' ? xc.canon_id : null,
                type: typeof xc.type === 'string' ? xc.type : undefined,
            };
        }
        // Everything else `x-*` on the property node, kept verbatim. Here, for
        // every field kind at once, for the same reason `x-canon` is here: a
        // per-branch copy is a per-branch omission waiting to happen.
        const ext = collectExtensions(schema);
        if (ext) field.extensions = ext;
        out.push(field);
    }

    return out;
};

const parseRegularField = (name: string, schema: any, required: string[]): AdvancedSchemeField => {
    const field: AdvancedSchemeField = {
        id: nanoid(),
        name,
        // A date arrives as `{type: "string", format: "date"}` and must not
        // come back out as a bare string. `templates.py:date_field` emits the
        // format and `schema_map.py` reads it — `shape: "date"` is what makes a
        // field a time candidate at all — so dropping it here silently demoted
        // every `when`, `until` and `from` in a template the moment the schema
        // was opened in the editor, and the model was left with prose asking it
        // for a date. That is where "Wednesday" came from.
        type: schema.type === 'string' && schema.format === 'date' ? 'date' : schema.type,
        description: schema.description,
        required: required.includes(name),
    };
    if (schema.enum) field.enum = schema.enum;
    if (schema.minimum !== undefined) field.minimum = schema.minimum;
    if (schema.maximum !== undefined) field.maximum = schema.maximum;
    if (schema.type === 'object') {
        field.properties = parseJsonSchemaProperties(schema.properties, schema.required);
    }
    if (schema.type === 'array' && schema.items) {
        // array_entity: items are entity-object schemas (x-entityField=true).
        // Translate them back to type='entity' on items + entityConfig so the
        // editor renders the same EntityConfigForm used at scalar level.
        if (schema.items && schema.items['x-entityField'] === true) {
            field.items = {
                type: 'entity',
                entityConfig: parseEntityConfigFromSchema(schema.items),
                description: schema.items.description || undefined,
            };
            // For a roster-drawn role the ref lives on the ITEM, because that
            // is the thing with a vocabulary. Read it up onto the field, which
            // is where the editor and the emitter both look.
            const itemRefs = refTargets({ targets: schema.items['x-ref'] } as any);
            if (itemRefs.length) field.ref = { targets: itemRefs };
        } else {
            field.items = { type: schema.items.type, extensions: collectExtensions(schema.items) };
            if (schema.items.description) field.items.description = schema.items.description;
            if (schema.items.type === 'object') {
                field.items.properties = parseJsonSchemaProperties(schema.items.properties, schema.items.required);
            }
            if (schema.items.enum && Array.isArray(schema.items.enum)) {
                const enumValues = [...schema.items.enum];
                const hasOther = enumValues.includes('other');
                field.items.enum = hasOther ? enumValues.filter(v => v !== 'other') : enumValues;
                field.items.includeOther = hasOther;
            }
            if (schema.items.minimum !== undefined) field.items.minimum = schema.items.minimum;
            if (schema.items.maximum !== undefined) field.items.maximum = schema.items.maximum;
        }
    }
    // Round-trip x-ref so refs survive load/save cycles. The actual definition
    // (type/enum/etc.) gets re-expanded from the target on next save.
    const ownRefs = refTargets({ targets: schema['x-ref'] } as any);
    if (ownRefs.length) field.ref = { targets: ownRefs };
    // Inline `include_justification` — the shape `schema_map` reads and every
    // template emits. Without this, loading a template into the editor drops
    // the flag, and the run comes back with an empty evidence pane because
    // every projection binds `evidence: {path: "justification"}`.
    if (schema.include_justification === true || schema.items?.include_justification === true) {
        field.justification = { ...(field.justification ?? {}), enabled: true };
    }
    return field;
};

export const adaptSchemaReadToSchemaFormData = (apiData: ClientAnnotationSchemaRead): AnnotationSchemaFormData => {
    const structure: SchemaSection[] = [];
    const outputContract = apiData.output_contract as any;
    
    if (outputContract?.properties) {
        Object.entries(outputContract.properties).forEach(([name, sectionSchema]: [string, any]) => {
            if (name === 'document' && sectionSchema.type === 'object') {
                structure.push({
                    id: nanoid(),
                    name: 'document',
                    fields: parseJsonSchemaProperties(sectionSchema.properties, sectionSchema.required),
                    description: sectionSchema.description || undefined,
                    extensions: collectExtensions(sectionSchema),
                });
            } else if (name.startsWith('per_') && sectionSchema.type === 'array' && sectionSchema.items?.type === 'object') {
                 structure.push({
                    id: nanoid(),
                    name: name as SchemaSection['name'],
                    fields: parseJsonSchemaProperties(sectionSchema.items.properties, sectionSchema.items.required),
                    description: sectionSchema.description || undefined,
                    extensions: collectExtensions(sectionSchema),
                });
            }
        });
    }

    // Add justification info back to fields. The legacy block is a flat dict
    // keyed by leaf schema-property name, so we walk the full field tree
    // (top-level + nested objects + array<object> items) and resolve by the
    // key the field would emit on save (legacyKey for graph fields with
    // back-compat semantics; user-facing name otherwise).
    if (apiData.field_specific_justification_configs) {
        const resolveField = (fields: AdvancedSchemeField[], key: string): AdvancedSchemeField | undefined => {
            for (const f of fields) {
                if (fieldOutputKey(f) === key) return f;
                if (f.properties) {
                    const hit = resolveField(f.properties, key);
                    if (hit) return hit;
                }
                if (f.items?.properties) {
                    const hit = resolveField(f.items.properties, key);
                    if (hit) return hit;
                }
            }
            return undefined;
        };
        const topFields = structure.flatMap(s => s.fields);
        Object.entries(apiData.field_specific_justification_configs).forEach(([fieldName, config]) => {
            const field = resolveField(topFields, fieldName);
            if (field && config) {
                field.justification = {
                    enabled: config.enabled,
                    custom_prompt: config.custom_prompt || '',
                    rigor_level: (config.rigor_level as any) ?? undefined,
                };
            }
        });
    }
    
    // Ensure at least a default document section exists
    if (!structure.some(s => s.name === 'document')) {
        structure.unshift({ id: nanoid(), name: 'document', fields: [] });
    }

    const formData: AnnotationSchemaFormData = {
      name: apiData.name,
      description: apiData.description || "",
      instructions: apiData.instructions ?? undefined,
      structure: structure,
      // The contract's own preamble, which is NOT `apiData.description` — that
      // is the DB column, and reading it here is how the guidance came to be
      // dropped: the two share a word and nothing else.
      contractGuidance: outputContract?.description || undefined,
      contractExtensions: collectExtensions(outputContract),
      nodeStyles: readPalette(outputContract),
      // TODO: Map global settings from backend to form if they exist
    };
    return formData;
};

/**
 * The schema's node palette, folding every older form into it.
 *
 * `readGraphStyle` already knows all four places a visual declaration can hide
 * and which one wins; running load through it means opening and saving a
 * pre-palette contract *migrates* it — the scattered `x-entityIcon`s and
 * per-graph-field type maps collapse into one root map, and the emitters that
 * wrote them are gone, so they do not come back.
 *
 * Keys are upper-cased. Every reader compares types case-insensitively
 * (`resolveEntityColor` has always uppercased), and normalising on the way in
 * is what stops `Person` and `PERSON` from becoming two entries that disagree.
 */
function readPalette(outputContract: any): Record<string, NodeStyle> | undefined {
    const style = readGraphStyle(outputContract);
    const types = new Set([...Object.keys(style.typeColors), ...Object.keys(style.typeIcons)]);
    if (!types.size) return undefined;

    const palette: Record<string, NodeStyle> = {};
    for (const type of types) {
        const entry: NodeStyle = {};
        if (style.typeColors[type]) entry.color = style.typeColors[type];
        if (style.typeIcons[type]) entry.icon = style.typeIcons[type];
        palette[type] = entry;
    }
    return palette;
}


// --- OLD ADAPTERS (to be phased out or updated) ---
export const adaptSchemaReadToSchema = (schemaRead: ClientAnnotationSchemaRead): AnnotationSchema => {
  // This is a bit of a placeholder as the frontend `fields` and backend `output_contract` differ.
  // We assume the client generation or a service-layer function handles the transformation.
  // For now, we'll return a structure that matches the frontend's expectations.
  return {
      id: schemaRead.id,
      name: schemaRead.name,
      description: schemaRead.description || "",
      fields: [], // Empty array as placeholder
      instructions: schemaRead.instructions || undefined,
      created_at: schemaRead.created_at,
      updated_at: schemaRead.updated_at,
      annotation_count: (schemaRead as any).annotation_count ?? 0, // Cast to any to access temp property
  };
}

export const adaptSchemasToSchemaReads = (schemas: ClientAnnotationSchemaRead[]): AnnotationSchema[] => {
    return schemas.map(adaptSchemaReadToSchema);
};

export const adaptAnnotationToAnnotationRead = (result: FormattedAnnotation): ClientAnnotationRead => {
    return {
        id: result.id,
        asset_id: result.asset_id,
        schema_id: result.schema_id,
        run_id: result.run_id,
        value: result.value || {},
        created_at: result.timestamp,
        // Other fields might not be present on the FormattedAnnotation type
        // This is a potential source of mismatch.
    } as ClientAnnotationRead;
};

export function adaptAnnotationReadToAnnotationResult(resultRead: ClientAnnotationRead): AnnotationResult {
  return {
    id: resultRead.id,
    asset_id: resultRead.asset_id,
    schema_id: resultRead.schema_id,
    run_id: resultRead.run_id,
    value: resultRead.value,
    timestamp: resultRead.created_at || new Date().toISOString(),
    status: resultRead.status as AnnotationResultStatus,
    error_message: (resultRead as any).error_message ?? null,
    asset: undefined,
    schema: undefined,
    run: undefined
  };
}

export function adaptEnhancedAnnotationToFormattedAnnotation(enhancedRead: ClientEnhancedAnnotationRead): FormattedAnnotation {
  return {
    id: enhancedRead.id,
    asset_id: enhancedRead.asset_id,
    schema_id: enhancedRead.schema_id,
    run_id: enhancedRead.run_id,
    value: enhancedRead.value ?? {},
    timestamp: enhancedRead.created_at || new Date().toISOString(),
    displayValue: enhancedRead.display_value ?? null,
    isOptimistic: false,
    status: (enhancedRead.status as AnnotationResultStatus) ?? 'success',
    error_message: (enhancedRead as any).error_message ?? null,
    asset: undefined,
    schema: undefined,
    run: undefined,
  };
}

export function adaptSourceReadToSource(sourceRead: ClientSourceRead): Source {
    return {
        id: sourceRead.id,
        infospace_id: sourceRead.infospace_id,
        user_id: sourceRead.user_id,
        name: sourceRead.name ?? '',
        kind: sourceRead.kind as SourceKind,
        details: (sourceRead.details as Record<string, any>) || {},
        source_metadata: (sourceRead.source_metadata as Record<string, any>) || {},
        status: sourceRead.status as SourceStatus,
        error_message: sourceRead.error_message || undefined,
        created_at: sourceRead.created_at,
        updated_at: sourceRead.updated_at,
        asset_count: (sourceRead as any).asset_count ?? 0
    };
}

export const adaptAssetReadToAsset = (clientAsset: ClientAssetRead): Asset => {
    const facets = (clientAsset as { facets?: Record<string, unknown> }).facets ?? {};
    const fileInfo = (clientAsset as { file_info?: Record<string, unknown> }).file_info ?? {};
    return {
        id: clientAsset.id,
        source_id: clientAsset.source_id,
        parent_asset_id: clientAsset.parent_asset_id,
        title: clientAsset.title,
        kind: clientAsset.kind,
        text_content: clientAsset.text_content || "",
        source_metadata: { ...fileInfo, ...facets },
        event_timestamp: clientAsset.event_timestamp || undefined,
        created_at: clientAsset.created_at,
        content_hash: clientAsset.content_hash || undefined,
    };
};

export function adaptRunReadToRun(runRead: ClientAnnotationRunRead): AnnotationRun {
    return {
        id: runRead.id,
        infospace_id: runRead.infospace_id,
        user_id: runRead.user_id,
        name: runRead.name,
        description: (runRead as any).description, // Assuming description might not be on the base model
        configuration: (runRead.configuration as Record<string, any>) || {},
        status: runRead.status as AnnotationRunStatus,
        error_message: runRead.error_message || undefined,
        created_at: runRead.created_at,
        updated_at: runRead.updated_at,
        annotation_count: (runRead as any).annotation_count,
        target_schema_ids: (runRead as any).schema_ids || [],
        target_asset_ids: (runRead as any).target_asset_ids || [],
        target_bundle_id: (runRead as any).target_bundle_id,
    };
} 