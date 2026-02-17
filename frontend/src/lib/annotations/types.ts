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
export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'graph';

export interface AdvancedSchemeField {
  // UI-specific identifier for keys and loops
  id: string; 
  
  // JSON Schema properties
  name: string; // Corresponds to the key in the 'properties' object
  type: JsonSchemaType;
  description?: string;
  
  // For 'string' with a list of choices
  enum?: string[];

  // For 'number' and 'integer' types - min/max constraints
  minimum?: number;
  maximum?: number;

  // For 'array' type, defines the schema of items in the array
  items?: {
    type: JsonSchemaType;
    properties?: AdvancedSchemeField[]; // For an array of objects
    enum?: string[]; // For an array of strings with limited choices
    includeOther?: boolean; // Whether to include an "other" fallback option
  };

  // For 'object' type
  properties?: AdvancedSchemeField[];

  // Not a direct JSON schema property, but used to build the 'required' array on the parent.
  required: boolean;

  // Field-specific justification config
  justification?: {
    enabled: boolean;
    custom_prompt?: string;
    rigor_level?: 'minimal' | 'standard' | 'thorough' | 'exhaustive';
  };

  // Field-specific AI model configuration
  provider?: string;
  model_name?: string;
  
  // Graph-specific configuration (only when type === 'graph')
  graphConfig?: GraphFieldConfig;
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

export interface TimeFrameFilter {
  enabled: boolean;
  startDate?: Date;
  endDate?: Date;
}

export interface TimeAxisConfig {
  type: 'default' | 'schema' | 'event';
  schemaId?: number;
  fieldKey?: string;
  // NEW: Time range filtering
  timeFrame?: TimeFrameFilter;
  // NEW: Advanced aggregation options
  aggregationMode?: 'standard' | 'smooth' | 'weighted';
  smoothingWindow?: number; // For smoothing aggregation
}

// --- Parameters for initiating an annotation RUN --- //
export interface AnnotationRunParams {
  name: string;
  description?: string;
  assetIds?: number[];
  bundleId?: number | null;
  sourceBundleId?: number | null; // NEW: For continuous runs watching a bundle
  schemaIds: number[];
  configuration?: Record<string, any>;
}

// New options for the Advanced Schema Builder dropdown
export const ADVANCED_SCHEME_TYPE_OPTIONS = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'True/False' },
  { value: 'array_string', label: 'List of Text' },
  { value: 'array_string_enum', label: 'List of Labels (Limited Choices)' },
  { value: 'array_number', label: 'List of Numbers' },
  { value: 'array_object', label: 'List of Objects (Nested Fields)' },
  { value: 'object', label: 'Object (Nested Fields)' },
  { value: 'graph', label: 'Knowledge Graph' },
];

// =============================================================================
// KNOWLEDGE GRAPH CONFIGURATION TYPES
// =============================================================================

/**
 * Graph configuration for deduplication and future node management features.
 * Stored on AnnotationRun (run-scoped).
 */
export interface GraphConfig {
  // Deduplication settings (core feature)
  deduplication: {
    enabled: boolean;  // Default: true
    strategy: 'exact' | 'normalized' | 'fuzzy';  // How to detect duplicates
    fields: string[];  // Fields to use for deduplication (e.g., ['name', 'type'])
    caseSensitive: boolean;  // For name matching
    normalizeWhitespace: boolean;  // Trim and normalize spaces
  };
  
  // Future extensibility - port for node management
  nodeManagement?: {
    // Future: merge strategies
    mergeStrategy?: 'manual' | 'auto' | 'suggested';
    // Future: annotation update settings
    updateAnnotationsOnMerge?: boolean;
    // Future: conflict resolution
    conflictResolution?: 'keep_first' | 'merge_data' | 'user_prompt';
  };
  
  // Extensible config dict for future features
  [key: string]: any;  // Allow any additional config
}

/**
 * Graph field configuration for schema definition.
 * Uses self-contained triplets (subject -> predicate -> object) for simpler LLM extraction.
 * Entity resolution and deduplication happens in post-processing.
 */
export interface GraphFieldConfig {
  // Entity type configuration (shared for subject_type and object_type)
  entityTypes: {
    typeEnum?: string[];  // Allowed entity types (e.g., ['PERSON', 'ORGANIZATION', 'LOCATION'])
    typeDescription?: string;  // Natural language guidance on how to categorize entities
    typeConstrained?: boolean;  // Whether to enforce enum or allow free-form types
    typeColors?: Record<string, string>;  // Custom hex colors per entity type (e.g., { "PERSON": "#3B82F6" })
  };
  
  // Relationship/predicate configuration
  relationshipSchema: {
    predicateEnum?: string[];  // Allowed predicates (e.g., ['works_for', 'located_in', 'met_with'])
    predicateDescription?: string;  // Natural language guidance on how to define relationships
    predicateConstrained?: boolean;  // Whether to enforce enum or allow free-form predicates
    predicateColors?: Record<string, string>;  // Custom hex colors per predicate (e.g., { "works_for": "#6366F1" })
    optionalFields: AdvancedSchemeField[];  // Additional triplet fields (e.g., context, confidence)
  };
  
  // Graph configuration (will be stored on AnnotationRun)
  graphConfig: GraphConfig;
}

// =============================================================================
// KNOWLEDGE GRAPH EDITING TYPES
// =============================================================================

/**
 * Represents a merged node operation where multiple nodes are consolidated into one
 */
export interface MergedNode {
  targetNodeId: string;      // The node ID to keep
  mergedNodeIds: string[];   // Node IDs that were merged into the target
  mergedAt: string;          // ISO timestamp of when the merge occurred
  reason?: string;           // Optional reason for the merge (e.g., "duplicate entity")
}

/**
 * Represents a deleted node operation
 */
export interface DeletedNode {
  nodeId: string;
  deletedAt: string;
  reason?: string;  // Optional reason (e.g., "noise", "irrelevant")
}

/**
 * Represents a deleted edge operation
 */
export interface DeletedEdge {
  edgeId: string;
  deletedAt: string;
  reason?: string;  // Optional reason
}

/**
 * Represents a custom edge added manually
 */
export interface CustomEdge {
  id: string;
  source: string;     // Source node ID
  target: string;     // Target node ID
  label: string;      // Edge label/predicate
  createdAt: string;
  description?: string;  // Optional context
}

/**
 * Represents a custom label override for a node
 */
export interface NodeLabelOverride {
  nodeId: string;
  customLabel: string;
  originalLabel: string;  // Keep track of original for undo
}

/**
 * Complete graph editing state stored in panel.settings.graphEdits
 * This follows the same pattern as geocodedPointsCache in map panels
 */
export interface GraphEdits {
  mergedNodes: MergedNode[];
  deletedNodes: DeletedNode[];
  deletedEdges: DeletedEdge[];
  customEdges: CustomEdge[];
  nodeLabels: NodeLabelOverride[];
  version: string;  // For future migrations if structure changes
} 