/**
 * Core type definitions for the annotation system
 */

import type { Formula } from '@/client';
import type { NodeStyle } from './graphStyle';

export type { NodeStyle };

// --- Data Source & Asset Types --- //
// Mirrors the backend's registered source kinds (content/sources/).
export type SourceKind = "rss" | "web" | "web_search" | "upload" | "text" | "directory" | "crawl";
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
/** `date` is not a JSON Schema type — it is `{type: "string", format: "date"}`,
 *  carried as its own value here because the editor's whole type system is
 *  "what kind of thing is this field", and a date is a different kind of thing
 *  from a string. `adapters.ts` collapses it back on emit. */
export type JsonSchemaType = 'string' | 'date' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'graph' | 'entity';

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
  /** Unknown `x-*` keys on the entity OBJECT node. Entity objects are rebuilt
   *  wholesale by `buildEntityObjectSchema`, so they need their own bucket.
   *  See `AdvancedSchemeField.extensions`. */
  extensions?: Record<string, unknown>;
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
  /** Dot-paths to the target fields in the same section.
   *
   *  **A list, because one role can draw from several populations.** A
   *  payment's `via` is an intermediary bank *or* a routing account; a claim's
   *  `concerns` can be an actor, a place or an instrument. A single target
   *  forced such a field either to misdescribe where its vocabulary comes from
   *  or to declare nothing at all. Emitted as `x-ref` — a bare string when
   *  there is one, an array when there are several. */
  targets: string[];
}

/** `x-ref` in either form, as a list. One place that knows the wire shape. */
export function refTargets(ref: FieldRef | undefined | null): string[] {
  if (!ref) return [];
  const raw = (ref as any).targets ?? (ref as any).target;
  if (typeof raw === 'string') return raw.trim() ? [raw] : [];
  return Array.isArray(raw) ? raw.filter(t => typeof t === 'string' && t.trim()) : [];
}

/**
 * Canon tie. Marks an entity-shaped field as backed by a canon: the field's
 * type resolves into a canon vocabulary, and the canon's declared property
 * shape (`type_schemas[type]`) is what the field asks the model to fill.
 *
 * `type` (the canon entry type) is the durable, canon-blind half — a run can
 * point the schema at any canon and the tie still means the same thing.
 * `canonId` is a soft, authoring-time preference: it sources the type list and
 * the property preview in the editor; the run's own canon still wins at
 * resolution. Emitted round-trip as the `x-canon` JSON Schema extension.
 */
export interface CanonTie {
  /** Preferred canon for authoring — soft; the run's canon overrides. */
  canonId?: number | null;
  /** The canon entry type this field fills (e.g. "person", "location"). */
  type?: string;
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
    /** Unknown `x-*` keys on the ITEM node. See `AdvancedSchemeField.extensions`. */
    extensions?: Record<string, unknown>;
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

  // Canon tie. When set, this (entity) field resolves into a canon and asks the
  // model to fill that canon type's declared properties. Emits as `x-canon`.
  canonTie?: CanonTie;

  // Intelligence-layer axis reference (M3). Superseded by `extensions`, which
  // preserves `x-axis` generically along with every other unknown key. Kept
  // only because nothing reads or writes it either way.
  xAxis?: string;

  /**
   * Every `x-*` key on this field's property node that no named field above
   * consumed, preserved verbatim.
   *
   * **The editor rebuilds the contract from scratch on every save**
   * (`adaptSchemaFormDataToSchemaCreate`), so a key it has no field for is
   * destroyed the first time a schema is opened and saved — silently, with no
   * warning and no validation error. That has been fixed narrowly three times
   * already (`format: date`, `include_justification`, `x-ref` on items), each
   * time for one key, each time after the loss was noticed downstream.
   *
   * This is the general form. A contract may carry declarations the editor does
   * not yet author, and it will still carry them afterwards.
   *
   * Emitted by spreading FIRST, so a key the editor genuinely owns always wins
   * over a stale preserved copy. `CONSUMED_EXTENSIONS` is the list of keys that
   * never land here, and `templateRoundTrip.test.ts` asserts both directions.
   */
  extensions?: Record<string, unknown>;

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
  /** The section node's own prose. `document` carries guidance in templates and
   *  it was being dropped on save along with everything else here. */
  description?: string;
  /** Unknown `x-*` keys on the section node. See `AdvancedSchemeField.extensions`. */
  extensions?: Record<string, unknown>;
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

  /**
   * The contract's OWN top-level `description` — the prompt preamble
   * (`templates.py:BASE_GUIDANCE`), not the schema's DB `description` column.
   *
   * Two different strings that both wanted to be called "description", which is
   * why this one was silently dropped: the editor rebuilt `output_contract`
   * from a literal with no description key, and read `apiData.description` (the
   * column) on the way back in. Every template-derived schema lost its guidance
   * the first time it was opened and saved, quietly costing prompt quality.
   */
  contractGuidance?: string;
  /** Unknown `x-*` keys at the contract root. See `AdvancedSchemeField.extensions`. */
  contractExtensions?: Record<string, unknown>;

  /**
   * How each node type looks on a graph — the schema's palette, keyed by node
   * type as authored. Emitted at the contract root as `x-nodeStyles`.
   *
   * **Schema-level because appearance is a property of the type, not of a
   * field.** Two fields typed `Person` cannot disagree about what a person
   * looks like, and a type that no field declares at all — a section's
   * self-node, `Event` or `Observation` or `Evidence` — can still be styled,
   * which per-field declarations made impossible.
   *
   * Both authoring surfaces write here: the field inspector's colour/icon
   * controls and the graph field editor's per-type rows.
   */
  nodeStyles?: Record<string, NodeStyle>;
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
  sourceBundleId?: number | null; // Single watched bundle (legacy/back-compat)
  sourceBundleIds?: number[]; // One or more bundles a live run watches (subtrees)
  live?: boolean; // Keep the run live: reconcile new content in scope over time
  schemaIds: number[];
  canonIds?: number[]; // Declared coordinate frame — canon(s) curation resolves into
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
    value: 'date', label: 'Date', group: 'primitives',
    icon: 'Calendar',
    description: 'A calendar date — 2016-04-22, or 2016-04 where that is all the text gives. Declaring the shape is what stops a model answering "Wednesday": a plain text field asking for a date gets one about as often as the prose is lucky. Date fields are the ones the timeline, the scrubber and after:/before: can read.',
    unlocks: ['table', 'chart', 'timeline', 'graph'],
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
    value: 'entity', label: 'Entity (one)', group: 'relational',
    icon: 'AtSign',
    description: 'ONE canon-resolved entity — a payment\'s sender, a statement\'s speaker, the place a meeting happened. Point it at a roster with "use vocabulary from another field" and the two become the same population: the same name in three rows is one node. Use Entities (list) when a row genuinely holds several.',
    unlocks: ['table', 'graph', 'pie'],
  },
  {
    value: 'array_entity', label: 'Entities (list)', group: 'relational',
    icon: 'AtSign',
    description: 'Several canon-resolved entities in one field — everyone present at a meeting, every interest an act serves. Declare what types it holds and (optionally) a closed list of names; the same name across fields and documents resolves to one canon record. For a single-valued role use Entity (one).',
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
    // Colours and icons are NOT here. They belong to the node type, which
    // outlives any one graph field, and they live in the schema-level
    // `AnnotationSchemaFormData.nodeStyles` palette that the section editor
    // writes to as well. Keeping a second copy per graph field is what let a
    // schema declare one appearance in two places and render neither.
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
  cursor_next: string | number | null;
  /** Echoes the request's projection list (informational). */
  fields?: string[];
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

/** A graph node from a projection.
 *
 * Hand-maintained because the `/view` graph phase ships nodes as plain dicts,
 * so `openapi-ts` has nothing to generate from. The authority is
 * `annotation/formula_query.py:_node_to_dict` — keep the two in step.
 *
 * Everything below `source_annotation_ids` is null/empty unless a projection
 * bound it, so an unconfigured graph panel behaves exactly as before.
 */
export interface ViewGraphNode {
  id: string;
  name: string;
  type: string;
  frequency: number;
  source_annotation_ids: number[];
  /** Entity or occurrence. An entity comes from a named set — it persists and
   *  recurs. An occurrence is minted from a statement row that is about itself:
   *  it *happened*. The two get opposite rendering, and the item pane is a list
   *  over the occurrences, so this has to survive the wire rather than be
   *  re-guessed from a heuristic. */
  kind?: 'entity' | 'occurrence';
  /** Occurrences only: the declared kind of act — `Payment`, `Meeting`. */
  node_type?: string | null;
  /** What the document said this act was worth. Never a calibrated
   *  measurement — a within-run ranking channel and nothing more. */
  magnitude?: number | null;
  /** Existence interval (ISO). `t1: null` with a `t0` means open-ended —
   *  from `t0` onward, which is what a bare timestamp binding declares. */
  t0?: string | null;
  t1?: string | null;
  /** Activity interval — histogram source when `activity` is bound apart
   *  from `time`. */
  a0?: string | null;
  a1?: string | null;
  /** Raw location string from the projection's `place` binding — the `at`, or
   *  a trajectory's origin. */
  place?: string | null;
  /** A trajectory's far end. A movement is at neither endpoint; it spans them,
   *  and both are needed to draw the arc. */
  place_to?: string | null;
  /** Every place this node is, each with its interval, kind and ladder rung.
   *  A company holds a registered office, a head office and a tax residence at
   *  once, in three countries — the gap between two of them is the finding, so
   *  this is a list and `place`/`lat`/`lon` merely mirror the first entry. */
  places?: Array<{
    place: string;
    lat?: number | null;
    lon?: number | null;
    from?: string | null;
    to?: string | null;
    kind?: string | null;
    source?: 'row' | 'attribute' | 'doc' | 'asset' | 'canon';
    end?: 'from' | 'to' | null;
  }>;
  /** Geo anchor, resolved server-side from the asset-facet geocoding cache or
   *  curated canon coords. A canon is an enhancement, not a requirement. */
  lat?: number | null;
  lon?: number | null;
  /** Projections that produced this node. Length > 1 is the linking payoff:
   *  the same entity named by a roster *and* by a triplet. */
  source_paths?: string[];
  /** Role labels the node appeared under ("speaker", "subject", …). */
  roles?: string[];
  /** Inline justifications from every atom that named this node — the quotes
   *  behind the claim. */
  evidence?: Array<Record<string, any>>;
  /** The row's forwarded fields, for the node the row is ABOUT. An exhibit's
   *  stance and locator; a statement's modality. */
  properties?: Record<string, any>;
  /** The panel's `node_group_by` value. A `{label: weight}` map when the
   *  binding names a computed profile (`neighbours:Interest`, `roles`), which
   *  is the vector shape the affinity anchor clusters on. */
  group_value?: string | string[] | Record<string, number> | null;
  /** The resolved `WEIGHT:` binding, in `[0, 1]`. Server-side because the
   *  denominator is: a median, a per-corpus stratum or a rank all need the
   *  whole population, and the client only ever holds the capped top-N. */
  size?: number | null;
  /** The resolved `CLUSTER:` binding — which pile, not where the pile goes.
   *  Server-side because the key may name a declaration the client cannot see;
   *  the geometry is `anchors.ts::clusterCells`. Null when this node has no
   *  value for the key, which leaves it where the link forces put it. */
  cluster?: string | null;
}

/** A graph edge from a projection. Authority:
 *  `annotation/formula_query.py:_edge_to_dict`. */
export interface ViewGraphEdge {
  source: string;
  target: string;
  kind?: 'contains' | 'follows' | 'role' | 'relation';
  predicate: string;
  /** The role the target plays in its source occurrence — `payer`, `via`,
   *  `on_board`. Role-scoped degree is what turns "340 connections" into
   *  "`via` in 340 payments". */
  role?: string | null;
  weight: number;
  computed_weight?: number | null;
  /** The `edge_group_by` bucket — where `modality`/`stance` lands, which is
   *  what `edgeEpistemics` paints from. */
  group_value?: string | null;
  /** Forwarded row properties. */
  properties?: Record<string, any>;
  /** Inline justifications from each contributing atom. */
  evidence?: Array<Record<string, any>>;
  t0?: string | null;
  t1?: string | null;
  a0?: string | null;
  a1?: string | null;
  source_paths?: string[];
  /** Which annotations produced this edge — the same provenance nodes carry.
   *  This is what edge → document traceability reads; matching an edge back to
   *  a raw annotation payload by label only ever worked for one legacy shape. */
  source_annotation_ids?: number[];
}

/** Graph materialization response */
export interface ViewGraphPhase {
  nodes: ViewGraphNode[];
  edges: ViewGraphEdge[];
  /** The rows behind the picture — one section's records, projected by the
   *  same query. `graph/rows.py::SectionRows`; typed in
   *  `components/collection/graph/panes/rowTypes.ts`, which is where it is
   *  consumed. Untyped here to keep this module free of a UI import.
   *
   *  A LIST: `SECTION:interests,observations` is two questions, not one — the
   *  sections are different relations and unioning them yields a table that is
   *  mostly empty cells. Each entry names its own section and its pane takes
   *  that name. */
  rows?: unknown[];
  meta?: ViewGraphMeta;
}

/** What the engine resolved that the query did not spell out. */
export interface ViewGraphMeta {
  layers?: unknown[];
  frames?: Record<string, unknown>;
  /** Decisions the engine made on the query's behalf, in reading order:
   *  which size measure and denominator, which scale (and whether a requested
   *  one was refused), how many dimensions were spent and what the vector had
   *  to fold into. Meant to be shown — the alternative is a picture whose
   *  rules a reader has to guess at. */
  legend?: string[];
  /** Pane names this contract's declarations imply — what an empty bar means.
   *  Seeds a panel nobody has configured, so it opens with the panes that make
   *  sense for its schema instead of with nothing. */
  panes?: string[];
  /** What the engine resolved in a way the writer may not have meant — a
   *  reserved word colliding with a field name, a section this run has never
   *  heard of, a CLUSTER key that matched nothing.
   *
   *  Distinct from `legend`, and the distinction is the point: the legend says
   *  what the engine DID and renders neutral; a note says what it could not do
   *  with what you wrote and renders amber. Conflating them makes a warning
   *  look like a setting. */
  notes?: string[];
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

/**
 * Combined /view endpoint response. Each key is present only when the
 * corresponding phase was requested. ``aggregate`` carries the
 * :class:`OutputRelation` shape (group keys × measures); ``rows``
 * carries paginated annotations + asset hierarchy; ``graph`` carries
 * nodes + edges.
 *
 * Legacy ``dossier`` + ``formula`` phases were retired in P2 — the
 * unified ``aggregate`` phase replaces them (an OutputRelation with
 * no group dims and a single measure is the old dossier scalar; with
 * dims+measures it's the old aggregate).
 */
export interface ViewResponse {
  rows?: ViewRowsPhase;
  aggregate?: ViewFormulaPhase;
  graph?: ViewGraphPhase;
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

// =============================================================================
// LEGACY ALIASES — keep existing components compiling during P3 sweep.
// Each is `any` so the old code stops blocking the build; new code uses
// the typed Panel/PanelVizConfig below. Both go away in P6 cleanup.
// =============================================================================

export type PanelProjection = any;
export type PanelAggregation = any;

// =============================================================================
// Panel — display artifact (data spec + projection + visual mapping)
// =============================================================================

export type PanelType =
  | 'table' | 'chart' | 'pie' | 'graph' | 'map'
  | 'measurements' | 'scatter';

// ── Per-type visual config (the "Role & Viz Map" emitted by RolePicker) ──
// Each carries role assignments (which Formula output name drives which
// visual channel) + display knobs (mark style, layout, density).
// Discriminated on ``kind``.

export interface PieVizConfig {
  kind: 'pie';
  slice_by?: string | null;
  value?: string | null;
  facet?: string | null;
  max_slices?: number | null;
  /** When ``facet`` is set, restricts the rendered small-multiples to
   *  these facet values. ``null``/``undefined``/empty → show every pie.
   *  Stale entries (values no longer present in the data) are ignored. */
  visible_facets?: string[] | null;
  /** Explicit render order for the small-multiple pies. Listed facets come
   *  first (in this order); any not listed follow in natural order. ``null``
   *  /empty → natural order. Stale entries are ignored. */
  facet_order?: string[] | null;
  /** Fixed number of pies per row in the small-multiples grid. ``null``/
   *  undefined → auto (as many as fit the width). A number forces that many
   *  columns — e.g. 2 turns a 1×4 strip into a balanced 2×2. */
  facet_columns?: number | null;
  /** When ``facet`` is set, these facet values render enlarged — their grid
   *  cell spans 2 columns so the pie grows to the row height and centers
   *  with whitespace on the sides. ``null``/empty → all pies the same size.
   *  Stale entries are ignored. */
  emphasized_facets?: string[] | null;
  /** Draw each slice's category name directly on the wedge (instead of /
   *  alongside the bottom legend). Especially useful for small-multiples,
   *  which carry no legend. */
  show_slice_labels?: boolean;
  legend?: boolean;
}

export interface ChartVizConfig {
  kind: 'chart';
  x?: string | null;
  y: string[];
  color?: string | null;
  mark: 'bar' | 'line' | 'area' | 'timeline';
  /** When ``x`` is a date-shape field, the engine buckets by this
   *  interval (date_trunc). Compile passes this to ``Dimension.interval``.
   *  Ignored for categorical x. */
  time_interval?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  /** How the timeline series is drawn. Independent of bucketing:
   *  ``detail`` = sharp linear line (every bucket, no smoothing);
   *  ``smooth`` = spline (monotone) curve; ``bars`` = vertical bars.
   *  Defaults to ``smooth``. */
  line_style?: 'detail' | 'smooth' | 'bars';
  /** Fix the value (y) axis to an explicit range so the data magnitude no
   *  longer drives the chart height. Either bound may be left null/omitted to
   *  keep that side auto-scaled. When a bound is set the axis clips to it
   *  (recharts ``allowDataOverflow``) instead of expanding to fit outliers. */
  y_min?: number | null;
  y_max?: number | null;
  stacked?: boolean;
  analytics_overlays?: {
    rolling_average?: { window: number } | null;
    bands?: boolean;
    trend_line?: boolean;
    peak_markers?: boolean;
    std_dev_bands?: boolean;
  };
  show_statistics?: boolean;
}

export interface MapVizConfig {
  kind: 'map';
  position?: string | null;
  mode: 'markers' | 'areaGeometryMeasures';
  color?: string | null;
  label: string[];
  geocode_source?: { schemaId: number; fieldKey: string } | null;
  show_labels?: boolean;
  show_areas?: boolean;
}

export interface TableVizConfig {
  kind: 'table';
  columns: string[];
  explode?: string | null;
  sort?: { column: string; direction: 'asc' | 'desc' } | null;
  density: 'compact' | 'comfortable';
  /** Field layout. ``true`` (default) spreads each schema's fields into their
   *  own columns; ``false`` collapses them into one column per schema ("group
   *  by schema"). Persisted so the layout choice survives panel reload. */
  unfold_fields?: boolean;
}

/** One node-bearing slot on a projection's row. Mirrors backend `NodeRole`.
 *  An empty `path` means the exploded element *is* the entity (an entity
 *  roster). */
export interface GraphNodeRole {
  path: string;
  label?: string | null;
  type_path?: string | null;
  type_const?: string | null;
}

/** `start`+`end` is a closed interval; `at` alone is open-ended — the atom
 *  exists from that instant onward. Mirrors backend `TimeBinding`. */
export interface GraphTimeBinding {
  at?: string | null;
  start?: string | null;
  end?: string | null;
}

/** Mirrors backend `Projection` — an array to explode plus how to read node
 *  identity, time, place, weight and evidence off each row. A triplet field, a
 *  nested observation row, and an entity roster are three instances of this. */
export interface GraphProjection {
  path: string;
  /** Empty means "infer": every entity-shaped child of the container, resolved
   *  server-side from the SchemaMap. */
  nodes?: GraphNodeRole[];
  predicate?: string | null;
  time?: GraphTimeBinding | null;
  place?: string | null;
  weight?: string | null;
  evidence?: { path: string; where?: Record<string, any> | null } | null;
  /** Histogram source when it differs from `time`. */
  activity?: GraphTimeBinding | null;
  properties?: Array<{ field: string; agg: 'first' | 'sum' | 'avg' | 'max' }>;
  label?: string | null;
}

export interface GraphVizConfig {
  kind: 'graph';
  /** Authoritative source of graph atoms. Empty falls back to the legacy
   *  single-triplet shape (`source` / `formula.group[0].path`), so panels
   *  authored before projections keep rendering unchanged. */
  projections?: GraphProjection[];
  /** The panel's GQL string — mirrors backend `GraphConfig.q`. Persisted here
   *  (not in component state) so it survives reload, travels with a shared
   *  dashboard, and the companion can write it. */
  q?: string | null;
  source?: string | null;
  target?: string | null;
  edge_label?: string | null;
  edge_weight_field?: string | null;
  edge_weight_mode: 'count' | 'property' | 'sum_property' | 'avg_property' | 'max_property' | 'count_times_property';
  forward_properties: Array<{ field: string; agg: 'first' | 'sum' | 'avg' | 'max' }>;
  node_group_by?: string | null;
  edge_group_by?: string | null;
  /** How the three spatial axes are spent across the four frames — the panel's
   *  primary control. Mirrors backend `GraphConfig.axes`. Declared here for the
   *  reason `q` is: typed so it survives a round-trip, travels with a shared
   *  dashboard, and is writable by the companion. */
  axes?: { plane: string | null; up: string | null; pin: boolean };
  /** Per-layer participation — `canvas` · `pane` · `linked` · `off`, keyed by
   *  projection path. Frontend-owned like `edits`; the engine resolves layers,
   *  the panel decides what to do with each. */
  layer_view?: Record<string, 'canvas' | 'pane' | 'linked' | 'off'>;
  null_policy: 'skip' | 'zero';
  layout: { kind: 'force_directed' | 'spatial' | 'radial' | 'hierarchical'; params?: Record<string, any> };
  dim_unmatched?: boolean;
  edits?: GraphEdits | null;
}

export interface MeasurementsVizConfig {
  kind: 'measurements';
  display_mode: 'scalar' | 'small_list' | 'stats_table';
  label?: string | null;
}

export interface ScatterVizConfig {
  kind: 'scatter';
  x?: string | null;          // categorical or numeric — auto-detected
  y?: string | null;
  color?: string | null;
  size?: string | null;       // measure name; defaults to 'count'
  mark: 'dot' | 'cell';       // dot-matrix vs heatmap cells
  legend?: boolean;
}

export type PanelVizConfig =
  | PieVizConfig
  | ChartVizConfig
  | MapVizConfig
  | TableVizConfig
  | GraphVizConfig
  | MeasurementsVizConfig
  | ScatterVizConfig;

/** A dashboard panel — display artifact with a data spec, projection list,
 *  and visual mapping.
 *
 *  Anatomy:
 *  - ``formula`` — the inline Formula (pure data spec: filter, group,
 *    measures, derive, weight, explode). Edited via RolePicker's
 *    data-side sections (filter, time, group, explode).
 *  - ``formula_ref`` — optional pointer into ``DashboardConfig.formulas[]``;
 *    when set, the saved formula overrides ``formula`` at fetch time.
 *  - ``fields`` — which value-blob paths to ship per row (rows view
 *    projection). Empty = ship the full blob.
 *  - ``panel_config`` — per-type visual mapping. ``panel.type`` and
 *    ``panel_config.kind`` MUST match.
 *  - ``time_source`` — panel-level designated timestamp field.
 *  - ``scopes_in`` — incoming Scope contributions (cross-panel filter).
 *  - ``merge_maps`` — panel-local value aliases.
 */
export interface Panel {
  id: string;
  type: PanelType;
  name: string;
  description?: string;
  formula: Formula;
  formula_ref?: string | null;
  fields: string[];
  panel_config: PanelVizConfig;
  time_source?: string | null;
  scopes_in: Scope[];
  merge_maps: MergeMap[];
  grid_position: { x: number; y: number; w: number; h: number };
  collapsed?: boolean;

  // ── Legacy fields kept as ``any`` during the P3 sweep so existing
  // renderers compile. New code reads ``formula`` + ``panel_config`` +
  // ``fields`` + ``scopes_in``. These all go away when each call site
  // is migrated; the P6 cleanup removes them entirely. ────────────────
  projection?: any;
  aggregation?: any;
  local_filters?: any;
  /** @deprecated use ``scopes_in``. */
  incoming_scopes?: any;
  settings?: any;
  formula_id?: any;
  observation_id?: any;
  formula_inline?: any;
}

/** Backwards-compatible alias — many components still import `PanelConfig`. */
export type PanelConfig = Panel;