/**
 * Core type definitions for the classification system (Refactored)
 */

// --- Data Source & Record Types --- //

export type DataSourceType = "csv" | "pdf" | "url_list" | "text_block";
export type DataSourceStatus = "pending" | "processing" | "complete" | "failed";

export interface DataSource {
  id: number;
  workspace_id: number;
  user_id: number;
  name: string;
  type: DataSourceType;
  // JSON fields storing details specific to the source type
  origin_details: Record<string, any>; // e.g., { filepath: "...", filename: "..." } or { urls: [...] }
  source_metadata: Record<string, any>; // e.g., { row_count: 100, columns: [...] } or { page_count: 10 }
  status: DataSourceStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  data_record_count?: number | null; // Optional count from API
}

export interface DataRecord {
  id: number;
  datasource_id: number;
  text_content: string;
  // JSON field storing context about origin within the DataSource
  source_metadata: Record<string, any>; // e.g., { row_number: 5 } or { page_number: 2 } or { url: "..." }
  created_at: string;
  datasource?: DataSource; // Optional link for context
}

// --- Classification Scheme & Field Types (Largely Unchanged) --- //

// Field types supported by the classification system
export type FieldType = "int" | "str" | "List[str]" | "List[Dict[str, any]]";

// Integer scale types
export type IntType = "binary" | "scale";

// Dictionary key definition for structured data fields
export interface DictKeyDefinition {
  name: string;
  type: "str" | "int" | "float" | "bool";
}

// Configuration for a classification field
export interface FieldConfig {
  scale_min?: number;
  scale_max?: number;
  is_set_of_labels?: boolean;
  labels?: string[];
  dict_keys?: DictKeyDefinition[];
}

// A field in a classification scheme
export interface SchemeField {
  name: string;
  type: FieldType;
  description: string;
  config: FieldConfig;
}

// A classification scheme definition
export interface ClassificationScheme {
  id: number;
  name: string;
  description: string;
  fields: SchemeField[];
  model_instructions?: string;
  validation_rules?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  job_count?: number; // Count of jobs using this scheme
}

// Form data for creating or updating a scheme
export interface SchemeFormData {
  name: string;
  description: string;
  fields: SchemeField[];
  model_instructions?: string;
  validation_rules?: Record<string, any>;
}

// --- REMOVED: ClassifiableDocument --- //
// export interface ClassifiableDocument { ... }

// --- REMOVED: ClassifiableContent (DataSource serves as the input source) --- //
// export interface ClassifiableContent { ... }

// --- Classification Job & Result Types --- //

export type ClassificationJobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed";

export interface ClassificationJob {
  id: number;
  workspace_id: number;
  user_id: number;
  name: string;
  description?: string | null;
  // JSON field storing job parameters
  configuration: Record<string, any>; // e.g., { scheme_ids: [...], datasource_ids: [...], llm_provider: ... }
  status: ClassificationJobStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  result_count?: number | null; // Optional counts from API
  datarecord_count?: number | null;
  target_scheme_ids: number[]; // Derived from configuration in API
  target_datasource_ids: number[]; // Derived from configuration in API
}

// A classification result (Refactored)
export interface ClassificationResult {
  id: number;
  datarecord_id: number; // Changed from document_id
  scheme_id: number;
  job_id: number; // Added
  value: any;
  timestamp: string;
  // Removed run_id, run_name, run_description
  // Optional links to related objects
  datarecord?: DataRecord | null; // Optional link, allow null
  scheme?: ClassificationScheme | null; // Optional link, allow null
  job?: ClassificationJob | null; // Optional link, allow null
}

// A classification result with formatted display value (Refactored)
export interface FormattedClassificationResult extends ClassificationResult {
  // Properties datarecord, scheme, job are inherited from ClassificationResult
  displayValue?: string | number | string[] | Record<string, any> | null; // Allow complex display values too
  isOptimistic?: boolean;
}

// --- REMOVED: ClassificationRun --- //
// export interface ClassificationRun { ... }

// --- Parameters for initiating a classification JOB --- //
export interface ClassificationJobParams {
  workspaceId: number;
  name: string;
  description?: string;
  datasourceIds: number[];
  schemeIds: number[];
  // Optional configuration like LLM provider/model can go here
  configuration?: Record<string, any>;
  // Callbacks for monitoring are handled by store/hook
}

// --- REMOVED: ClassificationParams (replaced by JobParams) --- //
// export interface ClassificationParams { ... }

// Type guard functions (Keep as is)
export const isFieldType = (value: string): value is FieldType => {
  return ["int", "str", "List[str]", "List[Dict[str, any]]"].includes(value);
};

export const isIntType = (value: string | null | undefined): value is IntType => {
  return value === "binary" || value === "scale";
};

/**
 * Get a human-readable description of a field type (Keep as is)
 */
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

/**
 * Options for scheme types (Keep as is)
 */
export const SCHEME_TYPE_OPTIONS = [
  { value: 'str', label: 'Text' },
  { value: 'int', label: 'Number' },
  { value: 'List[str]', label: 'Multiple Choice' },
  { value: 'List[Dict[str, any]]', label: 'Complex Structure' }
]; 