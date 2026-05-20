/**
 * Scope utilities for cross-panel filter propagation.
 *
 * A scope is a data constraint that one panel pushes/links to another.
 * It carries a FilterSet that the receiving panel merges into its own
 * filters before querying /view.
 */

import type { FilterSet, FieldCondition, MergeMap, AnnotationSchemaRead } from '@/client';
import type { Scope, PanelConfig } from './types';
import { nanoid } from 'nanoid';
import { walkOutputContract, flattenFieldPaths, type FieldPath } from './fieldPaths';

// ---------------------------------------------------------------------------
// Filter merging
// ---------------------------------------------------------------------------

/** AND all scope filters with the panel's local filters into a single FilterSet */
export function mergeFiltersAndScopes(
  localFilters: FilterSet,
  scopes: Scope[],
): FilterSet {
  const allConditions: FieldCondition[] = [
    ...(localFilters.conditions || []),
    ...scopes.flatMap(s => s.filter.conditions || []),
    // Fold group_context from each scope as an additional equality/in filter
    // on the parent group field. Callers that don't want this can strip it
    // from the scope before passing in; we assume the receiver honors it.
    ...scopes.flatMap(s => {
      if (!s.group_context) return [] as FieldCondition[];
      const val = s.group_context.value;
      if (Array.isArray(val)) {
        return [{ path: s.group_context.field, operator: 'in', value: val }] as FieldCondition[];
      }
      return [{ path: s.group_context.field, operator: 'eq', value: val }] as FieldCondition[];
    }),
  ];
  if (allConditions.length === 0) return { logic: 'and', conditions: [] };
  return { logic: 'and', conditions: allConditions };
}

/**
 * Collect the MergeMaps carried on incoming scopes. Callers union these with
 * their panel-local merge_maps so the receiver canonicalizes values the same
 * way the source did.
 */
export function mergeMapsFromScopes(scopes: Scope[]): MergeMap[] {
  const seen = new Set<string>();
  const out: MergeMap[] = [];
  for (const s of scopes) {
    for (const mm of s.merge_maps ?? []) {
      if (seen.has(mm.field_path)) continue;
      seen.add(mm.field_path);
      out.push(mm);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scope creation from panel gestures
// ---------------------------------------------------------------------------

export type GestureType = 'brush' | 'click' | 'select' | 'region';

interface SelectionGesture {
  type: GestureType;
  /** The field path this gesture targets */
  fieldPath: string;
  /** The selected value(s) — shape depends on gesture type */
  data: any;
}

/** Create a scope from a user selection inside a panel.
 *
 * When the source panel is actively grouped (aggregation.group_by set via the
 * RolePicker's group_by role), the scope also carries a `group_context` so
 * the receiver can honor the parent group membership — otherwise pushing a
 * slice from a per-party small-multiple pie would lose the party context.
 */
export function createScopeFromSelection(
  sourcePanelId: string,
  gesture: SelectionGesture,
  panelConfig: PanelConfig,
  mode: 'push' | 'link',
  opts?: { mergeMaps?: MergeMap[]; groupValue?: unknown | unknown[] },
): Scope {
  let conditions: FieldCondition[];

  switch (gesture.type) {
    case 'brush':
      // Time range brush → between filter
      conditions = [{
        path: gesture.fieldPath,
        operator: 'between',
        value: gesture.data, // [start, end]
      }];
      break;

    case 'click':
      // Single value click → eq filter
      conditions = [{
        path: gesture.fieldPath,
        operator: 'eq',
        value: gesture.data,
      }];
      break;

    case 'select':
      // Multi-value selection → in filter
      conditions = [{
        path: gesture.fieldPath,
        operator: 'in',
        value: Array.isArray(gesture.data) ? gesture.data : [gesture.data],
      }];
      break;

    case 'region':
      // Geo region selection → between filter on bounds
      conditions = [{
        path: gesture.fieldPath,
        operator: 'between',
        value: gesture.data, // geo bounds
      }];
      break;

    default:
      conditions = [];
  }

  const elementContext = panelConfig.projection.explosion || null;

  // Fill group_context when the panel is actively grouped. Prefer the
  // role-based `group_by` field_mapping (chart split role, pie small
  // multiples); fall back to aggregation.group_by only if the gesture field
  // itself is not the group field (avoids duplicating the condition).
  const roleGroupBy = (panelConfig.projection?.field_mappings?.['group_by'] as string | undefined) ?? null;
  const aggGroupBy = panelConfig.aggregation?.group_by ?? null;
  const groupField = roleGroupBy ?? (aggGroupBy && aggGroupBy !== gesture.fieldPath ? aggGroupBy : null);
  const group_context =
    groupField && opts?.groupValue !== undefined
      ? { field: groupField, value: opts.groupValue }
      : null;

  return {
    id: nanoid(),
    source_panel_id: sourcePanelId,
    mode,
    filter: { logic: 'and', conditions },
    element_context: elementContext,
    label: describeScopeFilter({ conditions, fieldPath: gesture.fieldPath, gestureType: gesture.type }),
    created_at: new Date().toISOString(),
    group_context,
    merge_maps: opts?.mergeMaps ?? panelConfig.merge_maps ?? [],
  };
}

// ---------------------------------------------------------------------------
// DAG validation — scopes must not form cycles
// ---------------------------------------------------------------------------

/** Check that panel scope links form a DAG. Returns the first cycle found, if any. */
export function validateScopeGraph(panels: PanelConfig[]): { valid: boolean; cycle?: string[] } {
  // Build adjacency: source_panel_id → [target_panel_id]
  const adj = new Map<string, string[]>();
  for (const panel of panels) {
    for (const scope of panel.incoming_scopes) {
      if (scope.mode !== 'link') continue; // pushes are snapshots, no cycle risk
      const targets = adj.get(scope.source_panel_id) || [];
      targets.push(panel.id);
      adj.set(scope.source_panel_id, targets);
    }
  }

  // DFS cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    for (const neighbor of adj.get(node) || []) {
      const c = color.get(neighbor) ?? WHITE;
      if (c === GRAY) {
        // Back edge → reconstruct cycle
        const cycle = [neighbor, node];
        let cur = node;
        while (cur !== neighbor) {
          cur = parent.get(cur)!;
          if (cur === undefined) break;
          cycle.push(cur);
        }
        return cycle.reverse();
      }
      if (c === WHITE) {
        parent.set(neighbor, node);
        const result = dfs(neighbor);
        if (result) return result;
      }
    }
    color.set(node, BLACK);
    return null;
  }

  for (const panel of panels) {
    if ((color.get(panel.id) ?? WHITE) === WHITE) {
      const cycle = dfs(panel.id);
      if (cycle) return { valid: false, cycle };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Human-readable descriptions
// ---------------------------------------------------------------------------

function describeScopeFilter(params: {
  conditions: FieldCondition[];
  fieldPath: string;
  gestureType: GestureType;
}): string {
  const { conditions, fieldPath, gestureType } = params;
  const field = fieldPath.split('.').pop() || fieldPath;

  if (conditions.length === 0) return 'Empty scope';

  switch (gestureType) {
    case 'brush': {
      const range = conditions[0]?.value as any[];
      const [start, end] = range || [];
      return `${field}: ${start} – ${end}`;
    }
    case 'click':
      return `${field} = ${String(conditions[0]?.value)}`;
    case 'select': {
      const vals = (conditions[0]?.value as any[]) || [];
      if (vals.length <= 3) return `${field} in [${vals.join(', ')}]`;
      return `${field} in [${vals.slice(0, 2).join(', ')}, +${vals.length - 2} more]`;
    }
    case 'region':
      return `${field}: region selection`;
    default:
      return `${field} filter`;
  }
}

// ---------------------------------------------------------------------------
// Relationship-as-a-lens — relational.cooccurs scope helper
// ---------------------------------------------------------------------------

export type CooccursReach = 'annotation' | 'asset' | 'same_level';

/** Walk a schema's output_contract and return every dotted path that
 * resolves to an entity-typed leaf — entity fields and array-of-entity
 * fields. The relational.cooccurs operator's `paths` argument expects this
 * shape (with `[*]` markers preserved on array-of-entity paths).
 *
 * Schemas without entity-typed fields return []. Callers should treat that
 * as "no relationship lens available for this schema" — typically by
 * disabling the gesture in the UI.
 */
export function entityPathsFromSchema(
  schema: AnnotationSchemaRead | null | undefined,
): string[] {
  if (!schema) return [];
  const tree = walkOutputContract(schema);
  const flat = flattenFieldPaths(tree);
  return flat
    .filter(p => p.shape === 'entity' || p.shape === 'array_entity')
    .map(p => p.path);
}

/** Build a Scope that filters annotations to rows where every named entity
 * appears in at least one of the schema's entity-typed paths.
 *
 * Reach modes:
 * - `annotation` (default) — entities anywhere on the same annotation row.
 *   This is the relationship-as-a-lens default. Tightest practical scope
 *   for "the relationship between A and B in this document."
 * - `asset` — entities anywhere across all annotations of the asset.
 *   Broader sweep; useful when annotations are split across schemas but
 *   the document context is shared.
 * - `same_level` — reserved for v1.5 (same-parent semantics). Backend
 *   currently throws NotImplementedError; surface as "coming soon" in UI.
 *
 * The scope's `source_panel_id` should be the panel or surface that
 * triggered the gesture. For non-panel surfaces (e.g., the curated graph
 * view's Relationship Dialog), pass a stable sentinel like
 * ``"graph-view:<graph_id>"`` so the receiver can attribute provenance.
 *
 * Integration example — pushing a cooccurs scope to every panel of an
 * annotation run dashboard from the curated graph view::
 *
 *   const scope = createCooccursScope({
 *     entities: [a.canonical_name, b.canonical_name],
 *     reach: 'annotation',
 *     schema: dashboardRunSchema,    // entity paths derived from the run's schema
 *     sourcePanelId: `graph-view:${graphId}`,
 *   });
 *   const { addScope } = useAnnotationRunStore.getState();
 *   for (const panel of dashboard.panels) addScope(panel.id, scope);
 *
 * (The full UX of "pick a dashboard / push to all panels there" is
 * out-of-scope for this helper — it's a routing concern. The helper just
 * builds the Scope object; the caller decides which panel(s) it lands on.)
 */
export function createCooccursScope(args: {
  entities: string[];
  reach?: CooccursReach;
  schema?: AnnotationSchemaRead | null;
  paths?: string[];
  sourcePanelId: string;
  mode?: 'push' | 'link';
  label?: string;
}): Scope {
  const reach = args.reach ?? 'annotation';
  const paths = args.paths ?? entityPathsFromSchema(args.schema);

  if (args.entities.length < 1) {
    throw new Error('createCooccursScope: need at least 1 entity');
  }
  if (paths.length === 0) {
    throw new Error('createCooccursScope: schema has no entity-typed paths');
  }

  // Single FieldCondition with operator=relational.cooccurs. The path is
  // the placeholder `$` per backend convention; real config in `value`.
  const condition: FieldCondition = {
    path: '$',
    operator: 'relational.cooccurs' as any, // SDK type narrows to legacy ops; the backend accepts the new operator
    value: {
      entities: args.entities,
      reach,
      paths,
    } as any,
  };

  const filter: FilterSet = {
    logic: 'and',
    conditions: [condition],
  };

  const label =
    args.label ??
    (args.entities.length === 2
      ? `${args.entities[0]} ↔ ${args.entities[1]}`
      : `${args.entities.length} entities`);

  return {
    id: nanoid(),
    source_panel_id: args.sourcePanelId,
    mode: args.mode ?? 'push',
    filter,
    element_context: null,
    label,
    created_at: new Date().toISOString(),
    group_context: null,
    merge_maps: [],
  };
}

/** Iterate the panels of the active dashboard and push a cooccurs scope to
 * each panel whose schema declares entity-typed paths. Returns counts so
 * callers can toast a precise result.
 *
 * `excludePanelId` is honored so a panel emitting the gesture can avoid
 * scoping itself (typical when the source IS a graph panel — the scope
 * would no-op on the same data the user is already looking at).
 *
 * Per-panel scope: each panel gets a scope tailored to ITS schema's entity
 * paths, not the global dashboard's. Two panels reading from different
 * schemas filter independently — the entity name pair is the canonical
 * link, the path set is local.
 */
export function pushCooccursToDashboard(args: {
  entities: string[];
  reach?: CooccursReach;
  panels: Array<{ id: string; settings?: { selectedSchemaId?: number; selectedSchemaIds?: number[] } & Record<string, unknown> }>;
  schemas: Array<{ id: number } & Record<string, unknown>>;
  addScope: (panelId: string, scope: Scope) => void;
  sourcePanelId: string;
  excludePanelId?: string;
  label?: string;
}): { pushed: number; skipped: number } {
  let pushed = 0;
  let skipped = 0;
  for (const panel of args.panels) {
    if (args.excludePanelId && panel.id === args.excludePanelId) continue;
    const schemaId = panel.settings?.selectedSchemaId ?? panel.settings?.selectedSchemaIds?.[0];
    if (!schemaId) {
      skipped += 1;
      continue;
    }
    const schema = args.schemas.find(s => s.id === schemaId) as any;
    if (!schema) {
      skipped += 1;
      continue;
    }
    const paths = entityPathsFromSchema(schema);
    if (paths.length === 0) {
      skipped += 1;
      continue;
    }
    try {
      const scope = createCooccursScope({
        entities: args.entities,
        reach: args.reach,
        paths,
        sourcePanelId: args.sourcePanelId,
        label: args.label,
      });
      args.addScope(panel.id, scope);
      pushed += 1;
    } catch {
      skipped += 1;
    }
  }
  return { pushed, skipped };
}

/**
 * Read the entity names carried by every ``relational.cooccurs`` condition
 * in a FilterSet. Used by panels that render entities (the graph panel
 * today, others later) to drive the ``dim_unmatched`` cascade — when a
 * cooccurs scope is active, every other entity dims and the relationship
 * lens stays sharp.
 *
 * Returns a deduplicated, case-preserving list. Callers fold this into
 * a Set if they need O(1) membership checks.
 */
export function focusedEntityNamesFromFilter(filter: FilterSet | null | undefined): string[] {
  if (!filter || !filter.conditions) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of filter.conditions) {
    if (c.operator !== ('relational.cooccurs' as any)) continue;
    const v = c.value as any;
    const ents = v?.entities;
    if (!Array.isArray(ents)) continue;
    for (const e of ents) {
      if (typeof e !== 'string') continue;
      const k = e.trim();
      if (!k) continue;
      const dedup = k.toLowerCase();
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      out.push(k);
    }
  }
  return out;
}

// ─── Projection-driven comparison split ───────────────────────────────────

/**
 * Spawn a comparison split: clone a source panel N times, each clone
 * filtered to a different subject entity. The asymmetry (e.g.
 * GGL→Tipico vs GGL→bet3000) reads off the resulting sibling panels at a
 * glance.
 *
 * The narrowing is implemented as a single-entity ``relational.cooccurs``
 * filter against the projection's subject role paths — same machinery
 * ``pushCooccursToDashboard`` uses, just with one entity instead of two.
 *
 * The caller is responsible for adding the resulting clones to the
 * active dashboard via the panel store; this helper only builds the
 * configs. Layout is up to the caller — a simple ``w=6`` × N grid works
 * for 2-3 way comparisons; beyond that pick small-multiples.
 */
export function buildComparisonSplitClones(args: {
  sourcePanel: PanelConfig;
  subjects: Array<{ name: string; label?: string }>;
  /** Schema paths that play the subject role (e.g. ``regulatorische_handlungen[*].object_name``).
   *  Falls back to the source panel projection's subject role paths or
   *  every entity-typed path on the schema. */
  subjectPaths?: string[];
  schema?: AnnotationSchemaRead | null;
}): PanelConfig[] {
  const { sourcePanel, subjects } = args;
  const paths = args.subjectPaths
    ?? sourcePanel.projection?.roles?.['subject']?.paths
    ?? entityPathsFromSchema(args.schema ?? null);

  if (paths.length === 0) {
    throw new Error('buildComparisonSplitClones: no subject paths available');
  }
  if (subjects.length < 1) {
    throw new Error('buildComparisonSplitClones: need at least one subject');
  }

  const clones: PanelConfig[] = subjects.map((subject, idx) => {
    const filterCondition: FieldCondition = {
      path: '$',
      operator: 'relational.cooccurs' as any,
      value: {
        entities: [subject.name],
        reach: 'annotation',
        paths,
      } as any,
    };
    const filter: FilterSet = { logic: 'and', conditions: [filterCondition] };
    const cloneId = `${sourcePanel.id}-vs-${idx}`;
    return {
      ...sourcePanel,
      id: cloneId,
      name: subject.label ?? subject.name,
      // local_filters carries the narrowing; incoming_scopes stay empty so
      // the clones don't pick up the source panel's other lenses.
      local_filters: filter,
      incoming_scopes: [],
    } as PanelConfig;
  });

  return clones;
}

/** Human-readable label for an existing scope */
export function describeScopeLabel(scope: Scope): string {
  const conditions = scope.filter.conditions || [];
  if (conditions.length === 0) return 'Empty scope';
  if (conditions.length === 1) {
    const c = conditions[0];
    const field = c.path.split('.').pop() || c.path;
    if (c.operator === 'eq') return `${field} = ${String(c.value)}`;
    if (c.operator === 'in') {
      const vals = Array.isArray(c.value) ? c.value as any[] : [c.value];
      return vals.length <= 3 ? `${field} in [${vals.join(', ')}]` : `${field} in [${vals.length} values]`;
    }
    if (c.operator === 'between') return `${field}: range`;
    return `${field} ${c.operator} ${String(c.value)}`;
  }
  return `${conditions.length} conditions`;
}
