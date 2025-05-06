import {
  DataSource, DataRecord, ClassificationJob,
  ClassificationResult,
  ClassificationScheme,
  FormattedClassificationResult,
  SchemeFormData,
  SchemeField,
  FieldType,
  DictKeyDefinition,
  DataSourceType,
  DataSourceStatus,
  ClassificationJobStatus,
  ClassificationResultStatus
} from './types';
import {
  ClassificationResultRead as ClientClassificationResultRead,
  ClassificationSchemeRead as ClientClassificationSchemeRead,
  ClassificationJobRead as ClientClassificationJobRead,
  DataSourceRead as ClientDataSourceRead,
  EnhancedClassificationResultRead as ClientEnhancedClassificationResultRead,
  ClassificationSchemeCreate,
  ClassificationFieldCreate,
  DictKeyDefinition as ClientDictKeyDefinition,
  ClassificationResultRead,
  ClassificationSchemeRead,
  DataRecordRead as ClientDataRecordRead,
} from '@/client/models';

/**
 * Adapters to convert between backend API types (from `@/client/models`)
 * and internal frontend types (from `./types`).
 */

// Convert API ClassificationSchemeRead[] to frontend ClassificationSchemeRead[]
// NOTE: Assuming ClientClassificationSchemeRead and ClassificationSchemeRead are compatible for now
// If they diverge significantly, a more complex mapping is needed.
export const schemesToSchemeReads = (schemes: ClientClassificationSchemeRead[]): ClassificationSchemeRead[] => {
    // Assuming ClientClassificationSchemeRead is structurally compatible with the needed ClassificationSchemeRead
    // If not, map properties explicitly here.
    // This is a basic cast, refine if needed.
    return schemes as unknown as ClassificationSchemeRead[];
};


// Convert FormattedClassificationResult to ClassificationResultRead
// This might be lossy or require assumptions if types differ significantly.
export const resultToResultRead = (result: FormattedClassificationResult): ClassificationResultRead => {
    // Assuming FormattedClassificationResult has compatible structure for basic Read model
    // This might need refinement based on exact type differences.
    return {
        id: result.id,
        datarecord_id: result.datarecord_id,
        scheme_id: result.scheme_id,
        job_id: result.job_id,
        value: result.value || {},
        timestamp: result.timestamp,
        // ClassificationResultRead doesn't have displayValue, isOptimistic or nested objects
    };
};

// Helper to convert API DictKeyDefinition to our frontend type
const adaptApiDictKeyDefinition = (apiDictKey: ClientDictKeyDefinition): DictKeyDefinition => ({
  name: apiDictKey.name,
  type: apiDictKey.type as "str" | "int" | "float" | "bool" // Assert frontend type
});

// Convert API ClassificationSchemeRead to frontend ClassificationScheme
export function adaptSchemeReadToScheme(schemeRead: ClientClassificationSchemeRead): ClassificationScheme {
    return {
        id: schemeRead.id,
        name: schemeRead.name,
        description: schemeRead.description,
        fields: schemeRead.fields.map((field: ClassificationFieldCreate): SchemeField => ({
            name: field.name,
            type: field.type as FieldType,
            description: field.description,
            config: {
                scale_min: field.scale_min ?? undefined,
                scale_max: field.scale_max ?? undefined,
                is_set_of_labels: field.is_set_of_labels ?? undefined,
                labels: field.labels ?? undefined,
                dict_keys: field.dict_keys ? field.dict_keys.map(adaptApiDictKeyDefinition) : undefined
            }
        })),
        model_instructions: schemeRead.model_instructions ?? undefined,
        validation_rules: schemeRead.validation_rules ?? undefined,
        created_at: schemeRead.created_at,
        updated_at: schemeRead.updated_at,
        job_count: schemeRead.job_count ?? schemeRead.classification_count ?? 0,
    };
}

// Convert frontend SchemeFormData to API ClassificationSchemeCreate
export const adaptSchemeFormDataToSchemeCreate = (formData: SchemeFormData): ClassificationSchemeCreate => ({
  name: formData.name,
  description: formData.description,
  fields: formData.fields.map((field): ClassificationFieldCreate => ({
    name: field.name,
    type: field.type,
    description: field.description,
    scale_min: field.config.scale_min ?? null,
    scale_max: field.config.scale_max ?? null,
    is_set_of_labels: field.config.is_set_of_labels ?? null,
    labels: field.config.labels ?? null,
    dict_keys: field.config.dict_keys?.map((dk): ClientDictKeyDefinition => ({
      name: dk.name,
      type: dk.type
    })) ?? null
  })),
  model_instructions: formData.model_instructions ?? undefined,
  validation_rules: formData.validation_rules ?? undefined
});

// Convert API ClassificationSchemeRead to frontend SchemeFormData (for editing)
export const adaptSchemeReadToSchemeFormData = (apiData: ClientClassificationSchemeRead): SchemeFormData => ({
  name: apiData.name,
  description: apiData.description,
  fields: apiData.fields.map((field: ClassificationFieldCreate): SchemeField => ({
    name: field.name,
    type: field.type as FieldType,
    description: field.description,
    config: {
      scale_min: field.scale_min ?? undefined,
      scale_max: field.scale_max ?? undefined,
      is_set_of_labels: field.is_set_of_labels ?? undefined,
      labels: field.labels ?? undefined,
      dict_keys: field.dict_keys ? field.dict_keys.map(adaptApiDictKeyDefinition) : undefined
    }
  })),
  model_instructions: apiData.model_instructions ?? undefined,
  validation_rules: apiData.validation_rules ?? undefined
});

// Convert API ClassificationResultRead to frontend ClassificationResult
export function adaptResultReadToResult(resultRead: ClientClassificationResultRead): ClassificationResult {
  return {
    id: resultRead.id,
    datarecord_id: resultRead.datarecord_id,
    scheme_id: resultRead.scheme_id,
    job_id: resultRead.job_id,
    value: resultRead.value,
    timestamp: resultRead.timestamp || new Date().toISOString(),
    status: 'success',
    error_message: null,
    datarecord: undefined,
    scheme: undefined,
    job: undefined
  };
}

// Convert API EnhancedClassificationResultRead to frontend FormattedClassificationResult
export function adaptEnhancedResultReadToFormattedResult(enhancedRead: ClientEnhancedClassificationResultRead): FormattedClassificationResult {
  return {
    id: enhancedRead.id,
    datarecord_id: enhancedRead.datarecord_id,
    scheme_id: enhancedRead.scheme_id,
    job_id: enhancedRead.job_id,
    value: enhancedRead.value ?? {},
    timestamp: enhancedRead.timestamp || new Date().toISOString(),
    displayValue: (enhancedRead.display_value as string | number | string[] | Record<string, any> | null) ?? null,
    isOptimistic: false,
    status: (enhancedRead.status as ClassificationResultStatus) ?? 'success',
    error_message: enhancedRead.error_message ?? null,
    datarecord: undefined,
    scheme: undefined,
    job: undefined,
  };
}

// Convert API DataSourceRead to frontend DataSource
export function adaptDataSourceReadToDataSource(dataSourceRead: ClientDataSourceRead): DataSource {
    return {
        id: dataSourceRead.id,
        workspace_id: dataSourceRead.workspace_id,
        user_id: dataSourceRead.user_id,
        name: dataSourceRead.name ?? '',
        type: dataSourceRead.type as DataSourceType,
        origin_details: (dataSourceRead.origin_details as Record<string, any>) || {},
        source_metadata: (dataSourceRead.source_metadata as Record<string, any>) || {},
        status: dataSourceRead.status as DataSourceStatus,
        error_message: dataSourceRead.error_message,
        created_at: dataSourceRead.created_at,
        updated_at: dataSourceRead.updated_at,
        data_record_count: dataSourceRead.data_record_count
    };
}

// Convert API DataRecordRead to frontend DataRecord
export const adaptDataRecordReadToDataRecord = (clientRecord: ClientDataRecordRead): DataRecord => {
    return {
        id: clientRecord.id,
        datasource_id: clientRecord.datasource_id,
        title: clientRecord.title,
        text_content: clientRecord.text_content,
        source_metadata: clientRecord.source_metadata,
        event_timestamp: clientRecord.event_timestamp,
        created_at: clientRecord.created_at,
        content_hash: clientRecord.content_hash,
    };
};

// Convert API ClassificationJobRead to frontend ClassificationJob
export function adaptJobReadToJob(jobRead: ClientClassificationJobRead): ClassificationJob {
    return {
        id: jobRead.id,
        workspace_id: jobRead.workspace_id,
        user_id: jobRead.user_id,
        name: jobRead.name,
        description: jobRead.description,
        configuration: (jobRead.configuration as Record<string, any>) || {},
        status: jobRead.status as ClassificationJobStatus,
        error_message: jobRead.error_message,
        created_at: jobRead.created_at,
        updated_at: jobRead.updated_at,
        result_count: jobRead.result_count,
        datarecord_count: jobRead.datarecord_count,
        target_scheme_ids: jobRead.target_scheme_ids || [],
        target_datasource_ids: jobRead.target_datasource_ids || []
    };
} 