/**
 * Per-panel role schemas. Each panel type declares which visual roles it
 * exposes (x, y, triplet, group_by, etc.) and what field shapes each role
 * accepts. The `RolePicker` consumes these to drive one unified picker UI.
 *
 * Schema-owned visuals (graph node/edge icons, colors, predicate arrows) are
 * NOT represented here. Those live on `GraphFieldConfig` in types.ts and the
 * picker renders read-only preview chips for them — the schema is the single
 * source of truth for graph visuals.
 */
import type { FieldShape } from './fieldPaths';

export type PanelType = 'table' | 'chart' | 'pie' | 'graph' | 'map';

/** A role = one slot the panel needs filled to render (or a useful optional knob). */
export interface RoleDef {
  /** Machine key — used as projection.field_mappings key. */
  key: string;
  /** Display label in the picker. */
  label: string;
  /** Short teacher copy shown as help under the label. */
  hint?: string;
  /** Field shapes this role accepts. Used for filtering and empty-state copy. */
  accepts: ReadonlyArray<FieldShape>;
  /** Must be filled for panel to render. */
  required?: boolean;
  /** More than one field can fill this role (e.g. y series on timeline). */
  multi?: boolean;
  /**
   * If present, an explode checkbox is surfaced on selection when the path
   * contains an array node. Defaults to true on array-shaped accepts.
   */
  explodable?: boolean;
  /**
   * Role group for the picker UI — controls ordering / section header.
   * `primary` = required-or-defining roles; `secondary` = optional visual
   * tweaks; `advanced` = power-user settings (group_by, weight fields).
   */
  group?: 'primary' | 'secondary' | 'advanced';
}

export interface PanelRoleSchema {
  panelType: PanelType;
  /** Short one-liner describing the panel's purpose, rendered near the picker. */
  description: string;
  roles: ReadonlyArray<RoleDef>;
  /** If true, `group_by` is surfaced alongside aggregation. */
  supportsGrouping: boolean;
  /** If true, `local_filters` UI is surfaced below the picker. */
  supportsLocalFilters: boolean;
  /** If true, value-alias ("merge maps") manager link is surfaced. */
  supportsValueAliases: boolean;
  /** Aggregation function pickable per panel. */
  aggregationFns: ReadonlyArray<'count' | 'sum' | 'avg' | 'min' | 'max'>;
}

// --- Per-panel schemas ---------------------------------------------------

const TABLE_ROLES: ReadonlyArray<RoleDef> = [
  {
    key: 'columns',
    label: 'Columns',
    hint: 'Pick one or more fields to show as table columns.',
    accepts: [
      'string', 'number', 'boolean', 'date',
      'enum_string', 'array_string', 'array_string_enum', 'array_number',
      // Entity fields render as identity-preserving badges via EntityCell —
      // top-level vocabularies (firmen, behoerden) and nested participant
      // slots (evidenz_einheiten[*].beguenstigte_firmen) share the same
      // visual primitive, so an analyst can scan name + type + tags inline.
      'entity', 'array_entity',
    ],
    required: true,
    multi: true,
    group: 'primary',
  },
  {
    key: 'row_explode',
    label: 'Row explosion',
    hint: 'Pick an array-of-objects (or array-of-entities) field to treat each item as a separate row.',
    accepts: ['array_object', 'array_entity'],
    group: 'secondary',
  },
];

// Chart covers timeline + bar + line; `chart_kind` in settings switches mode.
const CHART_ROLES: ReadonlyArray<RoleDef> = [
  {
    key: 'x',
    label: 'X axis',
    hint: 'Date for timeline mode, category/number for bar mode.',
    accepts: ['date', 'string', 'number', 'enum_string'],
    required: true,
    group: 'primary',
  },
  {
    key: 'y',
    label: 'Y series',
    hint: 'Numeric fields to plot as series. Multiple fields = multiple lines/bars.',
    accepts: ['number', 'boolean', 'enum_string', 'string'],
    required: true,
    multi: true,
    group: 'primary',
  },
  {
    key: 'group_by',
    label: 'Split by',
    hint: 'Break each series into sub-series by this field.',
    accepts: ['string', 'enum_string', 'boolean', 'number'],
    group: 'advanced',
  },
];

const PIE_ROLES: ReadonlyArray<RoleDef> = [
  {
    key: 'slice',
    label: 'Slice by',
    hint: 'Field whose distinct values become slices.',
    accepts: ['string', 'enum_string', 'boolean', 'array_string', 'array_string_enum'],
    required: true,
    group: 'primary',
  },
  {
    key: 'value',
    label: 'Slice value',
    hint: 'Numeric field to sum/avg (optional — defaults to count).',
    accepts: ['number'],
    group: 'secondary',
  },
  {
    key: 'group_by',
    label: 'Small multiples',
    hint: 'Render one pie per distinct group value.',
    accepts: ['string', 'enum_string', 'boolean'],
    group: 'advanced',
  },
];

// Graph role set. Schema-owned visuals (icons/colors/predicate arrows) are
// NOT pickable here — they come from GraphFieldConfig on the selected schema.
const GRAPH_ROLES: ReadonlyArray<RoleDef> = [
  {
    key: 'triplet',
    label: 'Triplet field',
    hint: 'A graph-typed field carrying subject → predicate → object triplets.',
    accepts: ['triplet', 'array_object'],
    required: true,
    group: 'primary',
  },
  // Projection-engine roles (PanelConfig.projection.roles). When set, the
  // panel switches into dossier mode — clicking a node surfaces role-grouped
  // counts ("AS ACTOR — Tipico ×23 mean 7.8"), edges open evidence
  // dossiers, and the canon-resolution gate enforces strict matching.
  // Multi-path: bind multiple paths to the same role (e.g. graph triplet
  // subject_name AND a sibling array_object's actor field) to project across
  // both surfaces under one role.
  {
    key: 'actor',
    label: 'Actor (projection)',
    hint: 'Entity-typed path(s) that play the actor role for the dossier projection. Multi-path supported — bind across graph fields and array_object rows.',
    accepts: ['entity', 'array_entity'],
    multi: true,
    group: 'advanced',
  },
  {
    key: 'subject',
    label: 'Subject (projection)',
    hint: 'Entity-typed path(s) that play the subject role for the dossier projection.',
    accepts: ['entity', 'array_entity'],
    multi: true,
    group: 'advanced',
  },
  {
    key: 'mentioned',
    label: 'Mentioned (projection)',
    hint: 'Optional non-actor / non-subject entity bindings — useful for cooccurrence dossiers.',
    accepts: ['entity', 'array_entity'],
    multi: true,
    group: 'advanced',
  },
  {
    key: 'edge_weight',
    label: 'Edge weight',
    hint: 'Triplet property driving edge thickness (e.g. confidence).',
    accepts: ['number'],
    group: 'secondary',
  },
  {
    key: 'node_size',
    label: 'Node size',
    hint: 'Numeric property driving node radius.',
    accepts: ['number'],
    group: 'secondary',
  },
  {
    key: 'layout_x',
    label: 'Layout X',
    hint: 'Numeric property for spatial layout X coordinate.',
    accepts: ['number'],
    group: 'advanced',
  },
  {
    key: 'layout_y',
    label: 'Layout Y',
    hint: 'Numeric property for spatial layout Y coordinate.',
    accepts: ['number'],
    group: 'advanced',
  },
  {
    key: 'node_timestamp',
    label: 'Node timestamp',
    hint: 'Use for timeline-linked graph views.',
    accepts: ['date'],
    group: 'advanced',
  },
  {
    key: 'node_location',
    label: 'Node location',
    hint: 'Use for map-linked graph views.',
    accepts: ['string'],
    group: 'advanced',
  },
  {
    key: 'node_group_by',
    label: 'Group nodes by',
    hint: 'Attribute at subject/object level that colors nodes.',
    accepts: ['string', 'enum_string'],
    group: 'advanced',
  },
  {
    key: 'edge_group_by',
    label: 'Group edges by',
    hint: 'Attribute at triplet level that splits / colors edges.',
    accepts: ['string', 'enum_string'],
    group: 'advanced',
  },
];

const MAP_ROLES: ReadonlyArray<RoleDef> = [
  {
    key: 'location',
    label: 'Location',
    // Geocodable shapes:
    //   - ``string`` / ``array_string``: plain location names.
    //   - ``enum_string`` / ``array_string_enum``: preset enums (countries,
    //     regions). Each enum value is a string at extraction time, so the
    //     backend walker handles them identically.
    //   - ``entity`` / ``array_entity``: entity-typed fields. The backend
    //     extractor dives into the entity's ``name`` key for these.
    hint: 'Field whose value geocodes to lat/lon. Strings, enums, and entity-typed fields all work.',
    accepts: [
      'string', 'array_string',
      'enum_string', 'array_string_enum',
      'entity', 'array_entity',
    ],
    required: true,
    group: 'primary',
  },
  {
    key: 'label',
    label: 'Label',
    // Numbers are accepted so users can label markers with score-type fields
    // (e.g. ratings). The map renderer aggregates numeric labels (avg) and
    // stacks string labels (deduped, comma-separated). Multi-pick lets the
    // user stack several fields under each marker — they render as
    // ``Field: value`` lines so the source of each datum is obvious.
    hint: 'Text or number shown on each marker. Pick multiple to stack — values render as ``field: value`` lines.',
    accepts: ['string', 'number', 'enum_string', 'array_string', 'array_string_enum', 'array_number'],
    multi: true,
    group: 'secondary',
  },
  {
    key: 'group_by',
    label: 'Color by',
    // Numeric color uses the same range-inference rules as the table's
    // NumberCell (declared minimum/maximum or observed [0,1] / [1,10]
    // bands), then applies a sequential gradient. Strings stay categorical.
    hint: 'Attribute that colors markers/polygons. Numbers use a gradient scale; strings/enums use distinct colors.',
    accepts: ['string', 'enum_string', 'number'],
    group: 'advanced',
  },
];

export const PANEL_ROLE_SCHEMAS: Record<PanelType, PanelRoleSchema> = {
  table: {
    panelType: 'table',
    description: 'Flat, sortable grid. Drill into elements by selecting rows.',
    roles: TABLE_ROLES,
    supportsGrouping: true,
    supportsLocalFilters: true,
    supportsValueAliases: true,
    aggregationFns: ['count', 'sum', 'avg', 'min', 'max'],
  },
  chart: {
    panelType: 'chart',
    description: 'Timeline, bar, or line. Brush to select a range and push scope to other panels.',
    roles: CHART_ROLES,
    supportsGrouping: true,
    supportsLocalFilters: true,
    supportsValueAliases: true,
    aggregationFns: ['count', 'sum', 'avg', 'min', 'max'],
  },
  pie: {
    panelType: 'pie',
    description: 'Distribution across a categorical field. Click a slice and drag to push scope.',
    roles: PIE_ROLES,
    supportsGrouping: true,
    supportsLocalFilters: true,
    supportsValueAliases: true,
    aggregationFns: ['count', 'sum', 'avg'],
  },
  graph: {
    panelType: 'graph',
    description: 'Entity + relationship view from triplet-shaped schemas. Colors and icons come from the schema.',
    roles: GRAPH_ROLES,
    supportsGrouping: true,
    supportsLocalFilters: true,
    supportsValueAliases: true,
    aggregationFns: ['count', 'sum', 'avg', 'max'],
  },
  map: {
    panelType: 'map',
    description: 'Geospatial distribution. Marquee to select a region and push scope.',
    roles: MAP_ROLES,
    supportsGrouping: true,
    supportsLocalFilters: true,
    supportsValueAliases: true,
    aggregationFns: ['count', 'sum', 'avg'],
  },
};

/** Convenience access when only the panel type is known. */
export function getRoleSchemaForPanel(panelType: PanelType): PanelRoleSchema {
  return PANEL_ROLE_SCHEMAS[panelType];
}

/** Lookup a role definition by key within a panel. */
export function getRoleDef(panelType: PanelType, roleKey: string): RoleDef | null {
  const schema = PANEL_ROLE_SCHEMAS[panelType];
  return schema.roles.find((r) => r.key === roleKey) ?? null;
}
