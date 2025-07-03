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

// Types for the Advanced Schema Builder, replacing the old flat structure.
export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface AdvancedSchemeField {
  // UI-specific identifier for keys and loops
  id: string; 
  
  // JSON Schema properties
  name: string; // Corresponds to the key in the 'properties' object
  type: JsonSchemaType;
  description?: string;
  
  // For 'string' with a list of choices
  enum?: string[];

  // For 'array' type, defines the schema of items in the array
  items?: {
    type: JsonSchemaType;
    properties?: AdvancedSchemeField[]; // For an array of objects
  };

  // For 'object' type
  properties?: AdvancedSchemeField[];

  // Not a direct JSON schema property, but used to build the 'required' array on the parent.
  required: boolean;

  // Field-specific justification config
  justification?: {
    enabled: boolean;
    custom_prompt?: string;
  };

  // Field-specific AI model configuration
  provider?: string;
  model_name?: string;
}

export interface SchemaSection {
  id: string; // UI identifier
  name: 'document' | 'per_image' | 'per_audio' | 'per_video';
  fields: AdvancedSchemeField[];
}

export interface AnnotationSchema {
  id: number;
  name: string;
  description: string;
  // The 'fields' property is deprecated in favor of a representation of the output_contract
  // This will be handled by the adapters and new components.
  // For now, we leave it for any components that haven't been migrated.
  fields: any[]; 
  instructions?: string;
  validation_rules?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  annotation_count?: number;
}

// This is the new data structure for the form in the Advanced Schema Builder
export interface AnnotationSchemaFormData {
  name: string;
  description: string;
  instructions?: string;
  // The 'structure' represents the visual layout of the schema builder
  // which will be transformed into the backend's 'output_contract'.
  structure: SchemaSection[];
  // Global AI settings
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

export type AnnotationResultStatus = 'success' | 'failure' | 'in_progress';

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
  name: string;
  description?: string;
  assetIds?: number[];
  bundleId?: number | null;
  schemaIds: number[];
  configuration?: Record<string, any>;
}

// New options for the Advanced Schema Builder dropdown
export const ADVANCED_SCHEME_TYPE_OPTIONS = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'True/False' },
  { value: 'array_string', label: 'List of Text' },
  { value: 'array_number', label: 'List of Numbers' },
  { value: 'array_object', label: 'List of Objects' },
  { value: 'object', label: 'Object (Nested Fields)' },
]; 