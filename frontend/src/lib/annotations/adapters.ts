import {
  Source, Asset, AnnotationRun,
  AnnotationResult,
  AnnotationSchema,
  FormattedAnnotation,
  AnnotationSchemaFormData,
  SchemeField,
  FieldType,
  DictKeyDefinition,
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
  // Assuming these will exist after client regeneration
  // TODO: Check these types after client regeneration
  // We are assuming AnnotationFieldCreate and DictKeyDefinition exist on the client models
  AssetRead as ClientAssetRead,
} from '@/client/models';

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

export const adaptSchemaReadToSchema = (schemaRead: ClientAnnotationSchemaRead): AnnotationSchema => {
  // This is a bit of a placeholder as the frontend `fields` and backend `output_contract` differ.
  // We assume the client generation or a service-layer function handles the transformation.
  // For now, we'll return a structure that matches the frontend's expectations.
  return {
      id: schemaRead.id,
      name: schemaRead.name,
      description: schemaRead.description || "",
      fields: (schemaRead.output_contract as any)?.properties ? [] : [], // Placeholder logic
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

const adaptApiDictKeyDefinition = (apiDictKey: any): DictKeyDefinition => ({
  name: apiDictKey.name,
  type: apiDictKey.type as "str" | "int" | "float" | "bool"
});


export const adaptSchemaFormDataToSchemaCreate = (formData: AnnotationSchemaFormData): AnnotationSchemaCreate => ({
  name: formData.name,
  description: formData.description,
  // The frontend's `fields` need to be converted to the backend's `output_contract`.
  // This is a complex transformation that depends on the desired JSON schema structure.
  // The following is a simplified placeholder.
  output_contract: {
    title: formData.name,
    description: formData.description,
    type: "object",
    properties: formData.fields.reduce((acc, field) => {
      // Basic mapping, needs to be more robust
      (acc as any)[field.name] = { type: "string", description: field.description };
      return acc;
    }, {})
  },
  instructions: formData.instructions ?? undefined,
  // validation_rules is not on the backend model
});

export const adaptSchemaReadToSchemaFormData = (apiData: ClientAnnotationSchemaRead): AnnotationSchemaFormData => ({
  name: apiData.name,
  description: apiData.description || "",
  // This requires parsing the `output_contract` from the backend into the `fields` array for the form.
  // This is a complex transformation. The following is a simplified placeholder.
  fields: [],
  instructions: apiData.instructions ?? undefined,
  // validation_rules not on backend model
});

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