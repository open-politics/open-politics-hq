/**
 * Core type definitions for the classification system
 */

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
  classification_count?: number;
  document_count?: number;
}

// Form data for creating or updating a scheme
export interface SchemeFormData {
  name: string;
  description: string;
  fields: SchemeField[];
  model_instructions?: string;
  validation_rules?: Record<string, any>;
}

// A document that can be classified
export interface ClassifiableDocument {
  id: number;
  title: string;
  text_content?: string | null;
  url?: string;
  source?: string | null;
  content_type?: string;
  insertion_date?: string;
  summary?: string | null;
  top_image?: string | null;
  files?: Array<{
    id: number;
    name: string;
    filetype?: string | null;
    size?: number | null;
    url?: string | null;
  }>;
}

// Any content that can be classified (may not be a stored document)
export interface ClassifiableContent {
  id?: number;
  title?: string;
  text_content?: string | null;
  content?: string; // Alternative field name for text content
  url?: string;
  source?: string | null;
  content_type?: string;
  [key: string]: any; // Allow any other properties
}

// A classification result
export interface ClassificationResult {
  id: number;
  document_id: number;
  scheme_id: number;
  value: any;
  timestamp: string;
  run_id: number;
  run_name?: string | null;
  run_description?: string | null;
  document?: ClassifiableDocument;
  scheme?: ClassificationScheme;
}

// A classification result with formatted display value
export interface FormattedClassificationResult extends ClassificationResult {
  displayValue?: string | number | string[] | null;
  scheme?: ClassificationScheme;
  isOptimistic?: boolean;
}

// A classification run
export interface ClassificationRun {
  id: number;
  name: string;
  timestamp: string;
  documentCount: number;
  schemeCount: number;
  description?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

// Parameters for creating a classification
export interface ClassificationParams {
  documentId: number;
  schemeId: number;
  runId?: number;
  runName?: string;
  runDescription?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  onProgress?: (status: string, current?: number, total?: number) => void;
}

// Type guard functions
export const isFieldType = (value: string): value is FieldType => {
  return ["int", "str", "List[str]", "List[Dict[str, any]]"].includes(value);
};

export const isIntType = (value: string | null | undefined): value is IntType => {
  return value === "binary" || value === "scale";
};

/**
 * Get a human-readable description of a field type
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
 * Options for scheme types
 */
export const SCHEME_TYPE_OPTIONS = [
  { value: 'str', label: 'Text' },
  { value: 'int', label: 'Number' },
  { value: 'List[str]', label: 'Multiple Choice' },
  { value: 'List[Dict[str, any]]', label: 'Complex Structure' }
]; 