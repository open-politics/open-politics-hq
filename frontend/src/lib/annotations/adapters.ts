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
} from './types';
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
  if (!field.ref) return field;
  if (expanding.has(field.id)) {
    throw new SchemaRefCycleError([...trail, field.name]);
  }
  const target = findFieldByPath(sectionFields, field.ref.target.split('.'));
  if (!target) {
    // Broken ref — surface as a cycle-style error so the caller treats it the
    // same way (save fails with a clear message).
    throw new Error(`Field "${field.name}" references "${field.ref.target}" which does not exist in this schema.`);
  }
  expanding.add(field.id);
  trail.push(field.name);
  const resolvedTarget = resolveFieldRef(target, sectionFields, expanding, trail);
  expanding.delete(field.id);
  trail.pop();
  // Inherit from target; override only what's overridable (description and
  // required at the referrer level).
  return {
    ...resolvedTarget,
    id: field.id,
    name: field.name,
    description: field.description ?? resolvedTarget.description,
    required: field.required,
  };
}

// Entity object shape — used both for scalar `entity` fields (back-compat)
// and the items of `array_entity` fields. Returns the JSON-Schema object
// {name, type, additional_types} with x-extensions carrying canon-resolution
// config. Multi-type fields (entity_type + alternate_types) round-trip via
// x-entityType (primary, canon key) + x-entityAlternateTypes (alternates).
const buildEntityObjectSchema = (
    ec: EntityFieldConfig | undefined,
    description: string | undefined,
    refTargetPath?: string,
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
    if (ec?.color) objectShape['x-entityColor'] = ec.color;
    if (ec?.icon) objectShape['x-entityIcon'] = ec.icon;
    if (refTargetPath) objectShape['x-ref'] = refTargetPath;
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
        color: schema['x-entityColor'] || undefined,
        icon: schema['x-entityIcon'] || undefined,
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
        const refTargetPath = rawField.ref?.target;

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
                if (graphConfig.entityTypes.typeColors && Object.keys(graphConfig.entityTypes.typeColors).length > 0) {
                    s['x-entityTypeColors'] = graphConfig.entityTypes.typeColors;
                }
                if (graphConfig.entityTypes.typeIcons && Object.keys(graphConfig.entityTypes.typeIcons).length > 0) {
                    s['x-entityTypeIcons'] = graphConfig.entityTypes.typeIcons;
                }
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
                field.entityConfig, field.description, refTargetPath,
            );
            if (rawField.required) required.push(rawField.name);
        } else {
            // Regular field handling
            const property: any = {
                description: field.description || undefined,
                type: field.type
            };

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
                    property.items = buildEntityObjectSchema(
                        field.items.entityConfig, field.items.description, undefined,
                    );
                } else {
                    property.items = { type: field.items.type };
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
            if (refTargetPath) property['x-ref'] = refTargetPath;
            // Round-trip the intelligence-layer `x-axis` reference (M3).
            // The schema editor doesn't yet author this; it preserves it from
            // JSON-imported schemas so axes survive form-mediated edit cycles.
            if ((rawField as any).xAxis) property['x-axis'] = (rawField as any).xAxis;
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
    const outputContract: any = {
        type: 'object',
        properties: {}
    };

    formData.structure.forEach(section => {
        const { properties, required } = buildJsonSchemaProperties(section.fields);

        if (section.name === 'document') {
            outputContract.properties.document = {
                type: 'object',
                properties: properties,
            };
            if (required.length > 0) {
                 outputContract.properties.document.required = required;
            }
        } else { // per_image, per_audio, etc.
             outputContract.properties[section.name] = {
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

    // Intelligence-layer axes (M3) — merge the top-level `axes` block back
    // onto output_contract when the form data carries one. The form UI does
    // not yet author axes; this preserves axes from JSON-imported schemas
    // so a form-mediated edit doesn't silently drop the block.
    if ((formData as any).axes && typeof (formData as any).axes === 'object') {
        outputContract.axes = (formData as any).axes;
    }

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
    return (k.has('subject_name') || k.has('subject')) &&
           k.has('predicate') &&
           (k.has('object_name') || k.has('object'));
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
                typeColors: subjectTypeSchema['x-entityTypeColors'] || undefined,
                typeIcons: subjectTypeSchema['x-entityTypeIcons'] || undefined,
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
    if (typeof schema['x-ref'] === 'string') {
        field.ref = { target: schema['x-ref'] };
    }
    return field;
};

const parseJsonSchemaProperties = (properties: any = {}, required: string[] = []): AdvancedSchemeField[] => {
    const out: AdvancedSchemeField[] = [];

    for (const [name, schema] of Object.entries<any>(properties)) {
        // Entity field — recognized by x-entityField extension
        if (schema && schema['x-entityField'] === true) {
            out.push(parseEntityField(name, schema, required));
            continue;
        }
        // Graph field — recognized by triplet shape, regardless of property name
        if (isGraphProperty(schema)) {
            out.push(parseGraphField(name, schema, required));
            continue;
        }
        // Regular field
        out.push(parseRegularField(name, schema, required));
    }

    return out;
};

const parseRegularField = (name: string, schema: any, required: string[]): AdvancedSchemeField => {
    const field: AdvancedSchemeField = {
        id: nanoid(),
        name,
        type: schema.type,
        description: schema.description,
        required: required.includes(name),
    };
    // Round-trip the intelligence-layer `x-axis` reference (M3) so a
    // form-mediated edit doesn't drop the axis binding silently.
    if (typeof schema['x-axis'] === 'string') {
        (field as any).xAxis = schema['x-axis'];
    }
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
        } else {
            field.items = { type: schema.items.type };
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
    if (typeof schema['x-ref'] === 'string') {
        field.ref = { target: schema['x-ref'] };
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
                    fields: parseJsonSchemaProperties(sectionSchema.properties, sectionSchema.required)
                });
            } else if (name.startsWith('per_') && sectionSchema.type === 'array' && sectionSchema.items?.type === 'object') {
                 structure.push({
                    id: nanoid(),
                    name: name as SchemaSection['name'],
                    fields: parseJsonSchemaProperties(sectionSchema.items.properties, sectionSchema.items.required)
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

    // Hoist the intelligence-layer `axes` block off output_contract so a
    // form-mediated edit doesn't silently drop it on save. The form UI does
    // not yet author axes; round-trip preservation is what matters for v1.
    const formData: AnnotationSchemaFormData & { axes?: Record<string, any> } = {
      name: apiData.name,
      description: apiData.description || "",
      instructions: apiData.instructions ?? undefined,
      structure: structure,
      // TODO: Map global settings from backend to form if they exist
    };
    if (outputContract && typeof outputContract === 'object' && outputContract.axes) {
        formData.axes = outputContract.axes;
    }
    return formData;
};


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