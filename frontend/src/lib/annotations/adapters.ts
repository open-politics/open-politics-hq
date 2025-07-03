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
  AnnotationResultStatus
} from './types';
import {
  AnnotationRead as ClientAnnotationRead,
  AnnotationSchemaRead as ClientAnnotationSchemaRead,
  AnnotationRunRead as ClientAnnotationRunRead,
  AnnotationSchemaCreate,
  FieldJustificationConfig,
  AssetRead as ClientAssetRead,
} from '@/client/models';
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

const buildJsonSchemaProperties = (fields: AdvancedSchemeField[]): { properties: any, required: string[] } => {
    const properties: any = {};
    const required: string[] = [];

    fields.forEach(field => {
        if (field.name) {
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
            if (field.type === 'object' && field.properties) {
                const sub = buildJsonSchemaProperties(field.properties);
                property.properties = sub.properties;
                if (sub.required.length > 0) {
                    property.required = sub.required;
                }
            }
            if (field.type === 'array' && field.items) {
                property.items = { type: field.items.type };
                if (field.items.type === 'object' && field.items.properties) {
                    const sub = buildJsonSchemaProperties(field.items.properties);
                    property.items.properties = sub.properties;
                     if (sub.required.length > 0) {
                        property.items.required = sub.required;
                    }
                }
            }
            properties[field.name] = property;
        }
    });

    return { properties, required };
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

    return {
        name: formData.name,
        description: formData.description,
        instructions: formData.instructions,
        output_contract: outputContract,
        field_specific_justification_configs: justificationConfigs,
        // TODO: Map global settings from form to the backend model if they exist.
        // For now, they are not part of AnnotationSchemaCreate.
    };
};

const parseJsonSchemaProperties = (properties: any = {}, required: string[] = []): AdvancedSchemeField[] => {
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
        if (schema.type === 'object') {
            field.properties = parseJsonSchemaProperties(schema.properties, schema.required);
        }
        if (schema.type === 'array' && schema.items) {
            field.items = { type: schema.items.type };
            if(schema.items.type === 'object') {
                field.items.properties = parseJsonSchemaProperties(schema.items.properties, schema.items.required);
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