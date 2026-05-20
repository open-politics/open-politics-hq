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
export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'graph' | 'entity';

/**
 * Entity field configuration. Entity fields are first-class citizens of the
 * schema — they declare a value that resolves (post-curation) to a canon
 * Entity. The runtime value shape is always an object `{ name, type?,
 * additional_types? }` for SQL-path uniformity across paths and reach modes
 * in the relational.cooccurs operator.
 *
 * `entity_type` is the primary type used as the canon resolution matching
 * key. `enum` (when set) restricts the model to a closed list of names.
 * `typeConstrained` controls whether the model may emit a different type
 * than the declared one (lenient = audit signal; strict = always declared).
 */
export interface EntityFieldConfig {
  /** Primary entity type — matches Entity.entity_type in the canon and is the
   * resolution key for canon lookup. The first badge in the editor's
   * type-tag input. */
  entity_type: string;
  /** Optional alternate types the LLM may emit on this field. When set, the
   * LLM picks one of `[entity_type, ...alternate_types]`. Canon resolution
   * still uses whatever type the LLM picks (so each alternate can resolve to
   * its own canon population). Useful for fields that legitimately accept
   * multiple kinds — e.g. an "involved actor" field that could be a Person
   * OR a Konzern OR a Politiker. */
  alternate_types?: string[];
  /** Closed list of allowed entity names — empty/undefined = open extraction.
   * Authored as TagInput badges in the editor. */
  enum?: string[];
  /** Whether to enforce the type list on the wire (true = LLM must pick from
   * the declared types, false = lenient, model may invent — useful as an
   * audit signal). */
  typeConstrained?: boolean;
  /** Optional UI metadata — color and icon for rendering this entity field. */
  color?: string;
  icon?: string;
}

/**
 * Intra-schema reference. A field with `ref` set inherits the target field's
 * full definition (type, enum, entityConfig, optionalFields, etc.) — only
 * `description` may be overridden additively.
 *
 * `target` is a dot-path within the same schema section, e.g. `actors` for a
 * top-level field, or `mails.sender` for a nested one. Cycle detection runs
 * at adapter expansion time (refs are resolved before JSON Schema emission,
 * so the LLM never sees a `$ref` and cycles can't reach the model).
 */
export interface FieldRef {
  /** Dot-path to the target field in the same section. */
  target: string;
}

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

  // For 'array' type, defines the schema of items in the array.
  //
  // `entityConfig` makes `array_entity` work end-to-end: the items themselves
  // are full entity references (object {name, type, additional_types?}) with
  // their own canon resolution key, optional closed enum, color/icon. Same
  // shape as a scalar `entity` field — the array just lifts cardinality.
  //
  // `minimum`/`maximum` apply to numeric items (`array_number` of integer/
  // number) so per-item constraints round-trip. `description` lets nested
  // items carry their own prompt instructions (Phase B prints these).
  items?: {
    type: JsonSchemaType;
    properties?: AdvancedSchemeField[]; // For an array of objects
    enum?: string[]; // For an array of strings with limited choices
    includeOther?: boolean; // Whether to include an "other" fallback option
    entityConfig?: EntityFieldConfig; // For array_entity
    minimum?: number; // For array_number / array_integer
    maximum?: number;
    description?: string;
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

  // Entity-specific configuration (only when type === 'entity')
  entityConfig?: EntityFieldConfig;

  // Intra-schema reference. When set, this field inherits the target's
  // definition. Only `description` is overridable. See FieldRef.
  ref?: FieldRef;

  // Intelligence-layer axis reference (M3). Emits as `x-axis` on the JSON
  // Schema property. References a key in the schema's top-level `axes` block.
  // The schema editor doesn't yet author this; round-trip preservation only.
  xAxis?: string;

  // For graph fields saved at a non-canonical JSON property key (the legacy
  // schemas all stored under "triplets" regardless of user-facing name). When
  // present, the adapter emits at this key rather than `name`, preserving
  // back-compat with existing stored annotations and panel configs. New graph
  // fields leave this unset and emit at `name` directly. Never user-visible.
  legacyKey?: string;
}

export interface SchemaSection {
  id: string; // UI identifier
  name: 'document' | 'per_image' | 'per_audio' | 'per_video';
  fields: AdvancedSchemeField[];
}

// ─── Observation snapshot (M5 — intelligence layer) ────────────────────────
// An Observation is a frozen output of a Formula. Lives in
// DashboardConfig.observations[] as JSON (no DB table in v1). Immutable —
// editing the source Formula afterwards does not mutate prior Observations.

export interface ObservationProvenanceItem {
  annotation_id: number;
  asset_id: number;
  schema_id: number;
  run_id: number;
  source_branch: string;
  branch_ord: number;
  event_timestamp?: string | null;
}

export interface ObservationSnapshot {
  id: string;
  formula_inline: any;       // PanelProjection — keep loose to avoid circular ref
  formula_name: string;
  computed_at: string;
  output_blob: ViewDossierRow[];
  output_keys: string[];
  provenance: Record<string, ObservationProvenanceItem[]>;
  run_id: number;
  schema_id_snapshot?: number | null;
  notes?: string | null;
}

// ─── Schema axes (M3 — intelligence layer) ──────────────────────────────────
// Mirror of backend `AxisDecl` in `app/api/modules/annotation/axes.py`.
// Schemas declare a top-level `axes` block of typed measurement dimensions;
// fields reference axes by name via `x-axis`. Formulas compose by axis name.

export type AxisKind =
  | 'ordinal_llm'        // ordered enum, LLM-assessed (Belegt > Erhärtet > Verdacht)
  | 'categorical_llm'    // unordered enum, LLM-classified (favors / disfavors)
  | 'scalar_1_10_llm'    // numeric 1–10, LLM-rated (treat as ordinal)
  | 'factual_enum'       // verifiable enum (action_type)
  | 'ordinal_doc'        // doc-level ordinal (source_weight)
  | 'categorical_doc'    // doc-level category (source_genre)
  | 'exposure';          // numeric denominator stream

export interface AxisDecl {
  kind: AxisKind;
  values?: string[];                       // required for enum-shaped kinds
  description?: string;                    // surfaced to LLM prompt
  weights?: Record<string, number> | null; // optional enum→numeric lift
}

/** Top-level `axes` block on a schema's output_contract — see HOW_TO.md § Axes. */
export type AxesBlock = Record<string, AxisDecl>;

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
  // Intelligence-layer axes (M3) — typed measurement vocabulary declared
  // at the schema level. The form UI doesn't yet author these; round-trip
  // preservation only so axes survive form-mediated edit cycles.
  axes?: AxesBlock;
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

// Rich type option with description, group, icon key, and downstream capability hints
export interface TypeOption {
  value: string;
  label: string;
  description: string;
  group: 'primitives' | 'collections' | 'structured' | 'relational';
  icon: string; // lucide-react icon name — resolved in the component
  unlocks?: string[]; // downstream capabilities this type enables
}

export const ADVANCED_SCHEME_TYPE_OPTIONS: TypeOption[] = [
  // Primitives
  {
    value: 'string', label: 'Text', group: 'primitives',
    icon: 'Type',
    description: 'A single text value. Use for prose summaries, names, dates, URLs, or categories. Add an allowed-values list to constrain the model to a closed set.',
    unlocks: ['table'],
  },
  {
    value: 'number', label: 'Number', group: 'primitives',
    icon: 'Hash',
    description: 'A numeric value — scores (e.g. 1-10), counts, amounts. Set min/max to constrain the range.',
    unlocks: ['table', 'chart'],
  },
  {
    value: 'boolean', label: 'True / False', group: 'primitives',
    icon: 'ToggleLeft',
    description: 'A yes/no judgment. Good for filtering and conditional counts.',
    unlocks: ['table', 'chart'],
  },
  // Collections
  {
    value: 'array_string', label: 'List of text', group: 'collections',
    icon: 'List',
    description: 'A list of free-form text values — tags, keywords, names without canon resolution. For canon-resolved names, use Entities instead.',
    unlocks: ['table'],
  },
  {
    value: 'array_string_enum', label: 'Labels', group: 'collections',
    icon: 'Tags',
    description: 'Multi-select from a closed list of categories. Drives pie charts and split-by grouping.',
    unlocks: ['table', 'chart', 'pie'],
  },
  {
    value: 'array_number', label: 'List of numbers', group: 'collections',
    icon: 'ListOrdered',
    description: 'A list of numeric values — useful when a row has multiple measurements.',
    unlocks: ['table', 'chart'],
  },
  // Structured
  {
    value: 'object', label: 'Object', group: 'structured',
    icon: 'Braces',
    description: 'A group of related fields nested under one key. Use when several values describe the same thing.',
    unlocks: ['table'],
  },
  {
    value: 'array_object', label: 'List of structured rows', group: 'structured',
    icon: 'LayoutList',
    description: 'Repeating structured items — events, observations, statements, transactions. Each row carries its own typed fields. Pair with `Entities` inside to anchor row participants to a canon vocabulary.',
    unlocks: ['table', 'chart', 'map', 'timeline'],
  },
  // Relational
  {
    value: 'array_entity', label: 'Entities', group: 'relational',
    icon: 'AtSign',
    description: 'Canon-resolved entity references. Declare what types the field holds and (optionally) a closed list of names; the same name across fields and documents resolves to one canon record. Cardinality is always "list" — a single entity is just a length-1 list.',
    unlocks: ['table', 'graph', 'pie'],
  },
  {
    value: 'graph', label: 'Knowledge graph (triplets)', group: 'relational',
    icon: 'GitFork',
    description: 'Subject → predicate → object extraction. Use for relationships (worked_for, located_in, met_with). Anchor subjects/objects to top-level Entity fields for clean bipartite graphs.',
    unlocks: ['graph', 'table'],
  },
];

export const TYPE_GROUP_LABELS: Record<TypeOption['group'], string> = {
  primitives: 'Primitives',
  collections: 'Collections',
  structured: 'Structured',
  relational: 'Relational',
};

// =============================================================================
// KNOWLEDGE GRAPH CONFIGURATION TYPES
// =============================================================================

/**
 * Graph field configuration for schema definition.
 * Uses self-contained triplets (subject -> predicate -> object) for simpler LLM extraction.
 * Entity resolution and deduplication happens in post-processing on the run side
 * (see ``run.graph_config`` — entity_merges, target graph_id), not on the schema.
 */
export interface GraphFieldConfig {
  // Entity type configuration (shared for subject_type and object_type)
  entityTypes: {
    typeEnum?: string[];  // Allowed entity types (e.g., ['PERSON', 'ORGANIZATION', 'LOCATION'])
    typeDescription?: string;  // Natural language guidance on how to categorize entities
    typeConstrained?: boolean;  // Whether to enforce enum or allow free-form types
    typeColors?: Record<string, string>;  // Custom hex colors per entity type (e.g., { "PERSON": "#3B82F6" })
    typeIcons?: Record<string, string>;  // HeroIcon names per entity type (e.g., { "PERSON": "UserIcon" })
  };

  // Relationship/predicate configuration
  relationshipSchema: {
    predicateEnum?: string[];  // Allowed predicates (e.g., ['works_for', 'located_in', 'met_with'])
    predicateDescription?: string;  // Natural language guidance on how to define relationships
    predicateConstrained?: boolean;  // Whether to enforce enum or allow free-form predicates
    predicateColors?: Record<string, string>;  // Custom hex colors per predicate (e.g., { "works_for": "#6366F1" })
    predicateIcons?: Record<string, string>;  // HeroIcon names per predicate (e.g., { "works_for": "BriefcaseIcon" })
    predicateArrows?: Record<string, 'forward' | 'backward' | 'both' | 'none'>;  // Arrow direction per predicate
    optionalFields: AdvancedSchemeField[];  // Additional triplet fields (e.g., context, confidence)
  };

  // Anchored-triplet sources: dot-paths to entity-typed fields elsewhere in the
  // same schema. When set, the model is constrained to extract triplets whose
  // subject (or object) is drawn from the entities named in the referenced
  // field. Same path syntax as FieldRef.target. Wired up in Phase 5.
  from_source?: string;
  to_source?: string;
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

// =============================================================================
// VIEW RESPONSE TYPES (matches backend /view endpoint)
// =============================================================================

/** A single annotation row returned by the /view endpoint rows materialization */
export interface AnnotationResultRow {
  annotation_id: number;
  asset_id: number;
  schema_id: number;
  run_id: number;
  value: Record<string, any>;
  timestamp: string;
  status: string;
  element?: Record<string, any> | null;
  element_index?: number | null;
}

/** Asset context returned alongside rows */
export interface AssetSummary {
  id: number;
  title: string;
  kind: string;
  parent_asset_id: number | null;
  parent_title: string | null;
}

/** Rows materialization response */
export interface ViewRowsPhase {
  items: AnnotationResultRow[];
  assets: Record<number, AssetSummary>;
  total: number;
  cursor_next: number | null;
}

/** A single aggregation bucket */
export interface AggregateBucket {
  key: string;
  count: number;
  stats?: Record<string, any>;
  /**
   * Present only when the aggregate carried a `split_by` — the second-
   * dimension value (e.g. party when grouped by date). Rows sharing a `key`
   * pivot on this to become panel series.
   */
  split_value?: string | null;
}

/** Aggregate materialization response */
export interface ViewAggregatePhase {
  buckets: AggregateBucket[];
  field_path: string;
  interval: string | null;
  total_count: number;
  /** Echoes the request's `split_by` when set; null/undefined for single-dim. */
  split_field_path?: string | null;
}

/** A graph node from triplet extraction */
export interface ViewGraphNode {
  id: string;
  name: string;
  type: string;
  frequency: number;
  source_annotation_ids: number[];
}

/** A graph edge from triplet extraction */
export interface ViewGraphEdge {
  source: string;
  target: string;
  predicate: string;
  weight: number;
}

/** Graph materialization response */
export interface ViewGraphPhase {
  nodes: ViewGraphNode[];
  edges: ViewGraphEdge[];
}

// ─── Dossier phase (projection materialisation) ───────────────────────────

/** One row in a dossier — canon-resolved role bindings + scalars + snippet
 * + edges + provenance. Mirrors backend ``ProjectionRow``.
 *
 * ``role_bindings`` carries Entity ids (or ``-1`` when allow_unresolved
 * surfaced an unresolved sentinel). ``role_names`` carries the canonical
 * display name. ``role_raw`` carries the raw extracted string before
 * merge-map normalisation — useful for "show provenance" surfaces.
 */
export interface ViewDossierRow {
  role_bindings: Record<string, number>;
  role_names: Record<string, string>;
  role_raw: Record<string, string>;
  scalars: Record<string, number | string | null>;
  /** Pre-mapping originals — categoricals lifted via enum_weights leave
   *  the unmapped label here so the UI can render "Belegt (1.0)". */
  scalars_raw?: Record<string, number | string | null>;
  snippet?: {
    verbatim?: string | null;
    structured?: Record<string, unknown> | null;
    fallback?: string | null;
  } | null;
  edges: Array<{
    spec_index: number;
    source_entity_id?: number | null;
    target_entity_id?: number | null;
    pair_a_id?: number | null;
    pair_b_id?: number | null;
    predicate?: string | null;
    directed: boolean;
  }>;
  provenance: {
    annotation_id: number;
    asset_id: number;
    schema_id: number;
    run_id: number;
    source_branch: string;
    branch_ord: number;
    event_timestamp?: string | null;
  };
}

/** Dossier materialization response */
export interface ViewDossierPhase {
  items: ViewDossierRow[];
  total: number;
  has_more: boolean;
  cursor_next: string | null;
  /** Number of rows the canon-resolution gate dropped (or sentinel-tagged). */
  unresolved_rows: number;
}

/** Combined /view endpoint response — each key is present only if requested */
/** The new intelligence-layer materialisation — backend ``OutputRelation``.
 *  One row per group-key tuple; ``measures`` carries the aggregated values
 *  (plus derives); evidence-mode rows additionally carry ``annotation_id``
 *  and ``asset_id``. Mirrors ``OutputRelation`` in ``query.py``. */
export interface ViewFormulaPhase {
  rows: Array<{
    keys: Record<string, string>;
    measures: Record<string, any>;
    annotation_id?: number | null;
    asset_id?: number | null;
    snippet?: string | null;
  }>;
  output_keys: string[];
  measure_names: string[];
  total: number;
  evidence_mode: boolean;
  has_more: boolean;
  cursor_next?: string | null;
}

export interface ViewResponse {
  rows?: ViewRowsPhase;
  aggregate?: ViewAggregatePhase;
  graph?: ViewGraphPhase;
  dossier?: ViewDossierPhase;
  formula?: ViewFormulaPhase;
}

// =============================================================================
// SCOPE & PANEL CONFIG TYPES (cross-panel filter propagation)
// =============================================================================

import type { FilterSet as ClientFilterSet, MergeMap } from '@/client';

/** A scope is a cross-panel filter constraint */
export interface Scope {
  id: string;
  source_panel_id: string;
  mode: 'push' | 'link';
  filter: ClientFilterSet;
  element_context: string | null;
  label: string;
  created_at: string;
  /**
   * Group context from the source panel — when a selection happens inside a
   * grouped render (e.g. a pie slice rendered within a small-multiple for
   * party=FDP), this carries the parent group value so the receiver can
   * honor BOTH the direct selection and the group membership.
   */
  group_context?: { field: string; value: unknown | unknown[] } | null;
  /**
   * Merge maps (value aliases) that were active on the source panel when
   * the gesture fired. Carried so the receiver canonicalizes the filter the
   * same way — otherwise pushing `FDP` (canonical) to a receiver without the
   * same alias would match zero rows.
   */
  merge_maps?: MergeMap[];
}

/** How a panel maps schema fields to visualization roles.
 *
 * Values are single field paths for single-role slots, or arrays for roles
 * marked ``multi`` in ``panelRoleSchema.ts`` (e.g. the chart's ``y`` for
 * multi-series timelines). The new projection-engine roles
 * (``actor`` / ``subject`` / ``mentioned``) are list-valued by default so
 * one role can bind paths across a graph triplet field and a sibling
 * array_object's entity-typed inner field.
 *
 * The optional ``roles`` / ``scalars`` / ``snippet`` / ``edges`` /
 * ``joint_roles`` block is the typed projection-engine shape consumed by
 * ``AnnotationQuery.project()``. When it's set, panels can run the
 * ``dossier`` materialisation against ``/view``. Legacy ``field_mappings``
 * stays for chart/pie/table/map; both shapes round-trip on the same
 * PanelProjection without conflict. */
export interface PanelProjection {
  field_mappings: Record<string, string | string[]>;
  explosion: string | null;
  // Projection-engine bindings (mirror backend RoleBinding/ScalarBinding/etc.).
  // Importing the regenerated client types directly here would create a
  // circular dependency with `@/client`; restate the shape locally so this
  // file stays the canonical PanelProjection wire model used across the app.
  roles?: Record<string, { paths: string[]; entity_type?: string | null }>;
  scalars?: Record<
    string,
    { path: string; agg?: 'count' | 'mean' | 'sum' | 'max' | 'min'; enum_weights?: Record<string, number> | null }
  >;
  snippet?: {
    verbatim?: string | null;
    structured?: string | null;
    fallback?: string | null;
  } | null;
  edges?: Array<{
    from_role?: string | null;
    to_role?: string | null;
    within_role?: string | null;
    predicate?: string | null;
    predicate_path?: string | null;
    directed?: boolean;
  }>;
  joint_roles?: string[];
}

/** Server-side aggregation config for a panel */
export interface PanelAggregation {
  group_by?: string;
  interval?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  function?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  value_field?: string;
  top_n?: number;
}

/** New panel config — replaces PanelViewConfig */
export interface PanelConfig {
  id: string;
  type: 'table' | 'chart' | 'pie' | 'graph' | 'map';
  name: string;
  description?: string;
  projection: PanelProjection;
  /** When set, the panel's projection comes from
   *  ``DashboardConfig.formulas.find(f => f.id === formula_id)`` —
   *  the inline ``projection`` is ignored. Resolved by panel hosts via
   *  ``useResolvedProjection``. Untouched panels stay self-contained.
   *  Renamed from ``observation_id`` in M2 of the intelligence-primitive
   *  plan; the dashboard migrator rewrites the legacy key on load. */
  formula_id?: string | null;
  /** @deprecated legacy alias for ``formula_id``; the dashboard migrator
   *  rewrites this on load. Kept here so persisted configs and any
   *  in-flight call sites still typecheck during the migration window. */
  observation_id?: string | null;
  aggregation: PanelAggregation;
  local_filters: ClientFilterSet;
  incoming_scopes: Scope[];
  merge_maps: MergeMap[];
  grid_position: { x: number; y: number; w: number; h: number };
  collapsed?: boolean;
  // Carry-over settings that panels still need during migration
  settings?: {
    // Graph edits (client-side node merges, deletions, labels)
    graphEdits?: GraphEdits;
    graphViewConfig?: any;
    // Map-specific
    geocodeSource?: { schemaId: number; fieldKey: string };
    labelSource?: { schemaId: number; fieldKey: string };
    showLabels?: boolean;
    showAreas?: boolean;
    geocodedPointsCache?: any;
    // Table-specific
    tableConfig?: any;
    selectedFieldsPerScheme?: Record<number, string[]>;
    // Schema/field selection (for field pickers in chart/pie/graph)
    selectedSchemaId?: number;
    selectedGraphSchemaId?: number;
    selectedFieldKey?: string;
    selectedMaxSlices?: number;
    aggregateSources?: boolean;
    selectedSourceIds?: number[];
    // Chart-specific
    timeAxisConfig?: any;
    selectedTimeInterval?: string;
    showStatistics?: boolean;
    selectedSchemaIds?: number[];
    // Passthrough for any panel-specific settings
    [key: string]: any;
  };
}