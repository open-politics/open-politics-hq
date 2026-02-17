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
  GraphConfig
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

const buildJsonSchemaProperties = (fields: AdvancedSchemeField[]): { properties: any, required: string[], graphConfigs: GraphConfig[] } => {
    const properties: any = {};
    const required: string[] = [];
    const graphConfigs: GraphConfig[] = [];

    fields.forEach(field => {
        if (field.name) {
            // Handle graph field type - outputs triplets array
            if (field.type === 'graph' && field.graphConfig) {
                const graphConfig = field.graphConfig;
                
                // Build triplet schema (self-contained: subject -> predicate -> object)
                const tripletProperties: any = {};
                const tripletRequired: string[] = ['subject_name', 'subject_type', 'predicate', 'object_name', 'object_type'];
                
                // Subject fields
                tripletProperties.subject_name = { 
                    type: 'string', 
                    description: 'Name of the subject entity' 
                };
                const subjectTypeSchema: any = { 
                    type: 'string', 
                    description: graphConfig.entityTypes.typeDescription || 'Type of the subject entity' 
                };
                if (graphConfig.entityTypes.typeConstrained && graphConfig.entityTypes.typeEnum && graphConfig.entityTypes.typeEnum.length > 0) {
                    subjectTypeSchema.enum = graphConfig.entityTypes.typeEnum.filter(t => t.trim() !== '');
                }
                // Store entity type colors as custom metadata
                if (graphConfig.entityTypes.typeColors && Object.keys(graphConfig.entityTypes.typeColors).length > 0) {
                    subjectTypeSchema['x-entityTypeColors'] = graphConfig.entityTypes.typeColors;
                }
                tripletProperties.subject_type = subjectTypeSchema;
                
                // Predicate field
                const predicateSchema: any = { 
                    type: 'string', 
                    description: graphConfig.relationshipSchema.predicateDescription || 'Relationship predicate (e.g., works_for, located_in)' 
                };
                if (graphConfig.relationshipSchema.predicateConstrained && graphConfig.relationshipSchema.predicateEnum && graphConfig.relationshipSchema.predicateEnum.length > 0) {
                    predicateSchema.enum = graphConfig.relationshipSchema.predicateEnum.filter(p => p.trim() !== '');
                }
                // Store predicate colors as custom metadata
                if (graphConfig.relationshipSchema.predicateColors && Object.keys(graphConfig.relationshipSchema.predicateColors).length > 0) {
                    predicateSchema['x-predicateColors'] = graphConfig.relationshipSchema.predicateColors;
                }
                tripletProperties.predicate = predicateSchema;
                
                // Object fields
                tripletProperties.object_name = { 
                    type: 'string', 
                    description: 'Name of the object entity' 
                };
                const objectTypeSchema: any = { 
                    type: 'string', 
                    description: graphConfig.entityTypes.typeDescription || 'Type of the object entity' 
                };
                if (graphConfig.entityTypes.typeConstrained && graphConfig.entityTypes.typeEnum && graphConfig.entityTypes.typeEnum.length > 0) {
                    objectTypeSchema.enum = graphConfig.entityTypes.typeEnum.filter(t => t.trim() !== '');
                }
                // Store entity type colors as custom metadata (same as subject_type)
                if (graphConfig.entityTypes.typeColors && Object.keys(graphConfig.entityTypes.typeColors).length > 0) {
                    objectTypeSchema['x-entityTypeColors'] = graphConfig.entityTypes.typeColors;
                }
                tripletProperties.object_type = objectTypeSchema;
                
                // Add optional fields (e.g., context, confidence)
                if (graphConfig.relationshipSchema.optionalFields) {
                    const { properties: optProps, required: optRequired } = buildJsonSchemaProperties(graphConfig.relationshipSchema.optionalFields);
                    Object.assign(tripletProperties, optProps);
                    tripletRequired.push(...optRequired);
                }
                
                // Create triplets array
                properties.triplets = {
                    type: 'array',
                    description: 'Array of relationship triplets (subject -> predicate -> object)',
                    items: {
                        type: 'object',
                        properties: tripletProperties,
                        required: tripletRequired
                    }
                };
                
                if (field.required) {
                    required.push('triplets');
                }
                
                // Store graph config for later use (will be stored on AnnotationRun)
                graphConfigs.push(graphConfig.graphConfig);
            } else {
                // Regular field handling
                const property: any = {
                    description: field.description || undefined,
                    type: field.type
                };

                if (field.required) {
                    required.push(field.name);
                }
                if (field.enum && field.enum.length > 0) {
                    property.enum = field.enum;
                }
                if (field.minimum !== undefined) {
                    property.minimum = field.minimum;
                }
                if (field.maximum !== undefined) {
                    property.maximum = field.maximum;
                }
                if (field.type === 'object' && field.properties) {
                    const sub = buildJsonSchemaProperties(field.properties);
                    property.properties = sub.properties;
                    if (sub.required.length > 0) {
                        property.required = sub.required;
                    }
                    graphConfigs.push(...sub.graphConfigs);
                }
                if (field.type === 'array' && field.items) {
                    property.items = { type: field.items.type };
                    if (field.items.type === 'object' && field.items.properties) {
                        const sub = buildJsonSchemaProperties(field.items.properties);
                        property.items.properties = sub.properties;
                         if (sub.required.length > 0) {
                            property.items.required = sub.required;
                        }
                        graphConfigs.push(...sub.graphConfigs);
                    }
                    // Handle enum constraints on array items (for array of strings with limited choices)
                    if (field.items.enum && field.items.enum.length > 0) {
                        let enumValues = [...field.items.enum];
                        // Include "other" option if enabled
                        if (field.items.includeOther && !enumValues.includes('other')) {
                            enumValues.push('other');
                        }
                        property.items.enum = enumValues;
                    }
                }
                properties[field.name] = property;
            }
        }
    });

    return { properties, required, graphConfigs };
};

const collectJustificationConfigs = (structure: SchemaSection[]): { [key: string]: FieldJustificationConfig } => {
    const configs: { [key: string]: FieldJustificationConfig } = {};

    const recurse = (fields: AdvancedSchemeField[]) => {
        for (const field of fields) {
            if (field.justification?.enabled) {
                configs[field.name] = {
                    enabled: true,
                    custom_prompt: field.justification.custom_prompt || undefined
                };
            }
            if (field.properties) {
                recurse(field.properties);
            }
            if (field.items?.properties) {
                recurse(field.items.properties);
            }
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
    
    // Collect all graph configs from all sections (will be stored on AnnotationRun)
    const allGraphConfigs: GraphConfig[] = [];

    formData.structure.forEach(section => {
        const { properties, required, graphConfigs } = buildJsonSchemaProperties(section.fields);
        allGraphConfigs.push(...graphConfigs);
        
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

    return {
        name: formData.name,
        description: formData.description,
        instructions: formData.instructions,
        output_contract: outputContract,
        field_specific_justification_configs: justificationConfigs,
        // TODO: Map global settings from form to the backend model if they exist.
        // For now, they are not part of AnnotationSchemaCreate.
        // Note: graphConfigs are collected but will be stored on AnnotationRun, not schema
    };
};

/**
 * Extract graph configuration from schema form data.
 * Returns the first graph config found (or default if none).
 * This will be stored on AnnotationRun when creating a run.
 */
export const extractGraphConfigFromSchema = (formData: AnnotationSchemaFormData): GraphConfig | null => {
    for (const section of formData.structure) {
        for (const field of section.fields) {
            if (field.type === 'graph' && field.graphConfig) {
                return field.graphConfig.graphConfig;
            }
        }
    }
    return null;
};

const parseJsonSchemaProperties = (properties: any = {}, required: string[] = []): AdvancedSchemeField[] => {
    const fields: AdvancedSchemeField[] = [];
    
    // Check if this is a triplet-based graph schema
    const hasTriplets = properties.triplets && properties.triplets.type === 'array';
    
    if (hasTriplets) {
        // This is a triplet-based graph field - reconstruct it as a single graph field
        const tripletSchema = properties.triplets.items || {};
        const tripletProps = tripletSchema.properties || {};
        
        // Extract entity type constraints (from subject_type or object_type)
        const subjectTypeSchema = tripletProps.subject_type || {};
        const typeEnum = subjectTypeSchema.enum || undefined;
        const typeConstrained = !!typeEnum && typeEnum.length > 0;
        const typeDescription = subjectTypeSchema.description || undefined;
        const typeColors = subjectTypeSchema['x-entityTypeColors'] || undefined;
        
        // Extract predicate constraints
        const predicateSchema = tripletProps.predicate || {};
        const predicateEnum = predicateSchema.enum || undefined;
        const predicateConstrained = !!predicateEnum && predicateEnum.length > 0;
        const predicateDescription = predicateSchema.description || undefined;
        const predicateColors = predicateSchema['x-predicateColors'] || undefined;
        
        // Extract optional fields (everything except the 5 required triplet fields)
        const requiredTripletFields = ['subject_name', 'subject_type', 'predicate', 'object_name', 'object_type'];
        const optionalFields = parseJsonSchemaProperties(
            tripletProps,
            tripletSchema.required || []
        ).filter(f => !requiredTripletFields.includes(f.name));
        
        const field: AdvancedSchemeField = {
            id: nanoid(),
            name: 'graph',
            type: 'graph',
            description: 'Knowledge graph triplets (subject -> predicate -> object)',
            required: required.includes('triplets'),
            graphConfig: {
                entityTypes: {
                    typeEnum: typeEnum,
                    typeConstrained: typeConstrained,
                    typeDescription: typeDescription,
                    typeColors: typeColors
                },
                relationshipSchema: {
                    predicateEnum: predicateEnum,
                    predicateConstrained: predicateConstrained,
                    predicateDescription: predicateDescription,
                    predicateColors: predicateColors,
                    optionalFields: optionalFields
                },
                graphConfig: {
                    deduplication: {
                        enabled: true,
                        strategy: 'normalized',
                        fields: ['name', 'type'],
                        caseSensitive: false,
                        normalizeWhitespace: true
                    }
                }
            }
        };
        fields.push(field);
        return fields;
    }
    
    // Regular field parsing
    return Object.entries(properties).map(([name, schema]: [string, any]) => {
        const field: AdvancedSchemeField = {
            id: nanoid(),
            name: name,
            type: schema.type,
            description: schema.description,
            required: required.includes(name),
        };

        if (schema.enum) {
            field.enum = schema.enum;
        }
        if (schema.minimum !== undefined) {
            field.minimum = schema.minimum;
        }
        if (schema.maximum !== undefined) {
            field.maximum = schema.maximum;
        }
        if (schema.type === 'object') {
            field.properties = parseJsonSchemaProperties(schema.properties, schema.required);
        }
        if (schema.type === 'array' && schema.items) {
            field.items = { type: schema.items.type };
            if(schema.items.type === 'object') {
                field.items.properties = parseJsonSchemaProperties(schema.items.properties, schema.items.required);
            }
            // Handle enum constraints on array items
            if (schema.items.enum && Array.isArray(schema.items.enum)) {
                const enumValues = [...schema.items.enum];
                const hasOther = enumValues.includes('other');
                field.items.enum = hasOther ? enumValues.filter(v => v !== 'other') : enumValues;
                field.items.includeOther = hasOther;
            }
        }

        return field;
    });
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

    // Add justification info back to fields
    if (apiData.field_specific_justification_configs) {
        const allFields = structure.flatMap(s => s.fields); // Simple for now, need recursion for nested
        Object.entries(apiData.field_specific_justification_configs).forEach(([fieldName, config]) => {
            const field = allFields.find(f => f.name === fieldName);
            if (field && config) {
                field.justification = {
                    enabled: config.enabled,
                    custom_prompt: config.custom_prompt || ''
                };
            }
        });
    }
    
    // Ensure at least a default document section exists
    if (!structure.some(s => s.name === 'document')) {
        structure.unshift({ id: nanoid(), name: 'document', fields: [] });
    }

    return {
      name: apiData.name,
      description: apiData.description || "",
      instructions: apiData.instructions ?? undefined,
      structure: structure,
      // TODO: Map global settings from backend to form if they exist
    };
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
    return {
        id: clientAsset.id,
        source_id: clientAsset.source_id,
        parent_asset_id: clientAsset.parent_asset_id,
        title: clientAsset.title,
        kind: clientAsset.kind,
        text_content: clientAsset.text_content || "",
        source_metadata: clientAsset.source_metadata || undefined,
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