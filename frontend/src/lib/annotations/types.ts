/**
 * Core type definitions for the annotation system
 */

// --- Data Source & Asset Types --- //
export type SourceKind = "rss" | "api" | "scrape" | "upload" | "search" | "csv" | "pdf" | "url_list" | "text_block";
export type SourceStatus = "pending" | "processing" | "complete" | "failed";

export interface Source {
  id: number;
  infospace_id: number;
  user_id: number;
  name: string;
  kind: SourceKind;
  details: Record<string, any>;
  source_metadata: Record<string, any>;
  status: SourceStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  asset_count?: number | null;
}

export interface Asset {
  id: number;
  source_id?: number | null;
  parent_asset_id?: number | null;
  title?: string | null;
  kind: string; // Should be AssetKind from client
  text_content: string;
  source_metadata?: Record<string, any>;
  event_timestamp?: string | null;
  created_at: string;
  content_hash?: string | null;
  source?: Source;
}

// --- Annotation Schema & Field Types --- //
export type FieldType = "int" | "str" | "List[str]" | "List[Dict[str, any]]";
export type IntType = "binary" | "scale";

export interface DictKeyDefinition {
  name: string;
  type: "str" | "int" | "float" | "bool";
}

export interface FieldConfig {
  scale_min?: number;
  scale_max?: number;
  is_set_of_labels?: boolean;
  labels?: string[];
  dict_keys?: DictKeyDefinition[];
  is_time_axis_hint?: boolean;
}

export interface SchemeField {
  name: string;
  type: FieldType;
  description: string;
  config: FieldConfig;
  request_justification?: boolean | null;
  request_bounding_boxes?: boolean;
  use_enum_for_labels?: boolean;
}

export interface AnnotationSchema {
  id: number;
  name: string;
  description: string;
  fields: SchemeField[];
  instructions?: string;
  validation_rules?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  annotation_count?: number;
}

export interface AnnotationSchemaFormData {
  name: string;
  description: string;
  fields: SchemeField[];
  instructions?: string;
  validation_rules?: Record<string, any>;
  default_thinking_budget?: number | null;
  request_justifications_globally?: boolean;
  enable_image_analysis_globally?: boolean;
}

// --- Annotation Run & Result Types --- //
export type AnnotationRunStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed";

export interface AnnotationRun {
  id: number;
  infospace_id: number;
  user_id: number;
  name: string;
  description?: string | null;
  configuration: Record<string, any>;
  status: AnnotationRunStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  annotation_count?: number | null;
  target_schema_ids: number[];
  target_asset_ids: number[];
  target_bundle_id?: number;
}

export type AnnotationResultStatus = 'success' | 'failed';

export interface AnnotationResult {
  id: number;
  asset_id: number;
  schema_id: number;
  run_id: number;
  value: any;
  timestamp: string;
  status: AnnotationResultStatus;
  error_message?: string | null;
  asset?: Asset | null;
  schema?: AnnotationSchema | null;
  run?: AnnotationRun | null;
}

export interface FormattedAnnotation extends AnnotationResult {
  displayValue?: string | number | string[] | Record<string, any> | null;
  isOptimistic?: boolean;
}

export interface TimeAxisConfig {
  type: 'default' | 'schema' | 'event';
  schemaId?: number;
  fieldKey?: string;
}

// --- Parameters for initiating an annotation RUN --- //
export interface AnnotationRunParams {
  infospaceId: number;
  name: string;
  description?: string;
  assetIds: number[];
  schemaIds: number[];
  target_bundle_id?: number;
  thinking_budget_override?: number | null;
  enable_image_analysis_override?: boolean;
}

// Type guard functions
export const isFieldType = (value: string): value is FieldType => {
  return ["int", "str", "List[str]", "List[Dict[str, any]]"].includes(value);
};

export const isIntType = (value: string | null | undefined): value is IntType => {
  return value === "binary" || value === "scale";
};

export function getFieldTypeDescription(field: SchemeField): string {
  switch (field.type) {
    case 'str':
      return 'Text';
    case 'int':
      if (field.config.scale_min === 0 && field.config.scale_max === 1) {
        return 'Yes/No';
      }
      return `Scale (${field.config.scale_min} to ${field.config.scale_max})`;
    case 'List[str]':
      if (field.config.is_set_of_labels && field.config.labels && field.config.labels.length > 0) {
        return `Multiple Choice (${field.config.labels.length} options)`;
      }
      return 'List of Strings';
    case 'List[Dict[str, any]]':
      return 'Complex Structure';
    default:
      return field.type;
  }
}

export const SCHEME_TYPE_OPTIONS = [
  { value: 'str', label: 'Text' },
  { value: 'int', label: 'Number' },
  { value: 'List[str]', label: 'Multiple Choice' },
  { value: 'List[Dict[str, any]]', label: 'Complex Structure' }
]; 