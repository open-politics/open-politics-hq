"use client";

/**
 * RolePicker — one unified picker UI for panel field selection.
 *
 * Given the selected annotation run's schemas and the panel's role-schema
 * declaration, the picker renders:
 *   - schema selector (narrows the field palette)
 *   - per-role field tree with substring search + `[*]` explode toggle
 *   - aggregation function selector
 *   - optional `edge_weight_mode` selector (graph panels only)
 *   - schema-owned visual preview chips (graph: entity icons/colors, predicate arrows)
 *   - "Manage Value Aliases" link (stubbed until Phase 6)
 *
 * The picker is stateless w.r.t. the panel config. It emits a single
 * `RolePickerValue` via `onChange` and callers persist it to
 * `panelConfig.projection.field_mappings` and `.explosion` + `.aggregation`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationSchemaRead } from '@/client';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  X as XIcon,
  Plus,
  Info,
  Search as SearchIcon,
  Settings2,
} from 'lucide-react';
import type { PanelRoleSchema, RoleDef } from '@/lib/annotations/panelRoleSchema';
import type { PanelAggregation } from '@/lib/annotations/types';
import {
  walkOutputContract,
  flattenFieldPaths,
  getArrayNodesInPath,
  paletteHasShape,
  type FieldPath,
  type FieldShape,
} from '@/lib/annotations/fieldPaths';

// ---------- Value shape ----------

export type EdgeWeightMode =
  | 'count'
  | 'property'
  | 'sum_property'
  | 'avg_property'
  | 'max_property'
  | 'count_times_property';

export interface RolePickerValue {
  /** Schema driving the palette. null = not yet picked. */
  schemaId: number | null;
  /**
   * role_key → list of dot-paths. Single-select roles use a 1-element array
   * (empty when unset) so multi/single can share a model.
   */
  fieldsByRole: Record<string, string[]>;
  /** role_key → explosion node chosen for that role (one per role at most). */
  explosionByRole: Record<string, string | null>;
  /** Aggregation config (function + value field + interval for chart). */
  aggregation: PanelAggregation;
  /** Only used for graph panels: weight-combination mode. */
  edgeWeightMode?: EdgeWeightMode;
}

export interface RolePickerProps {
  /** Role schema for the hosting panel type. */
  schema: PanelRoleSchema;
  /** Schemas available in the current annotation run. */
  availableSchemas: AnnotationSchemaRead[];
  /** Current value; parent owns state. */
  value: RolePickerValue;
  /** Emits the new value on every change. */
  onChange: (v: RolePickerValue) => void;
  /**
   * Force the picker into the expanded body, hiding the collapsed header.
   * Used by ``RolePickerPopover`` — the popover itself is the collapsed
   * surface, so we don't want a second collapse toggle inside it.
   */
  alwaysOpen?: boolean;
  /** Render the "Manage Value Aliases" link? (Phase 6 wire-up.) */
  onOpenValueAliases?: () => void;
}

// ---------- Helpers ----------

const ROLE_GROUP_ORDER: Record<NonNullable<RoleDef['group']>, number> = {
  primary: 0,
  secondary: 1,
  advanced: 2,
};

const ROLE_GROUP_LABEL: Record<NonNullable<RoleDef['group']>, string> = {
  primary: 'Core',
  secondary: 'Optional',
  advanced: 'Advanced',
};

function groupRoles(roles: ReadonlyArray<RoleDef>) {
  const groups: Record<string, RoleDef[]> = {};
  for (const r of roles) {
    const g = r.group ?? 'primary';
    (groups[g] ??= []).push(r);
  }
  return Object.entries(groups).sort(
    ([a], [b]) =>
      (ROLE_GROUP_ORDER[a as keyof typeof ROLE_GROUP_ORDER] ?? 99) -
      (ROLE_GROUP_ORDER[b as keyof typeof ROLE_GROUP_ORDER] ?? 99),
  );
}

function acceptsShape(role: RoleDef, shape: FieldShape): boolean {
  return role.accepts.includes(shape);
}

/**
 * Pick the single best candidate field for a role from the current palette.
 *
 * We walk `role.accepts` in declared order (the schema orders them by
 * preference — e.g. `date` comes before `string` for chart.x) and take the
 * first matching field in the flattened palette. Returns `null` when nothing
 * matches, so callers can leave the role unfilled and let the empty-state
 * teach the user.
 */
function pickBestField(role: RoleDef, flatPaths: FieldPath[]): FieldPath | null {
  for (const shape of role.accepts) {
    const hit = flatPaths.find((p) => p.shape === shape);
    if (hit) return hit;
  }
  return null;
}

/**
 * Auto-fill required roles from a freshly-picked schema. Only touches
 * required/primary roles — advanced knobs stay empty until the user opts in.
 *
 * `triplet` / `array_object` hits also seed `explosionByRole` since these
 * roles pipe through the backend explosion path (`core/filters.parse_explosion`).
 * If `chart.x` auto-fills to a date, default `aggregation.interval = day` so a
 * timeline panel renders without one more click.
 */
function autoFillRolesForSchema(
  roleSchema: PanelRoleSchema,
  paths: FieldPath[],
  currentAgg: PanelAggregation,
): Pick<RolePickerValue, 'fieldsByRole' | 'explosionByRole' | 'aggregation'> {
  const flat = flattenFieldPaths(paths);
  const fieldsByRole: Record<string, string[]> = {};
  const explosionByRole: Record<string, string | null> = {};
  let aggregation: PanelAggregation = { ...currentAgg };

  for (const role of roleSchema.roles) {
    if (!role.required) continue;
    const hit = pickBestField(role, flat);
    if (!hit) continue;
    fieldsByRole[role.key] = [hit.path];
    if (hit.shape === 'triplet' || hit.shape === 'array_object') {
      explosionByRole[role.key] = hit.path;
    }
    if (roleSchema.panelType === 'chart' && role.key === 'x' && hit.shape === 'date' && !aggregation.interval) {
      aggregation = { ...aggregation, interval: 'day' };
    }
  }

  return { fieldsByRole, explosionByRole, aggregation };
}

// ---------- Field tree renderer (for the popover) ----------

interface FieldTreeProps {
  paths: FieldPath[];
  role: RoleDef;
  selected: Set<string>;
  explosionForRole: string | null;
  onToggleSelect: (path: string) => void;
  onToggleExplode: (path: string | null) => void;
  searchQuery: string;
}

function FieldTree({
  paths,
  role,
  selected,
  explosionForRole,
  onToggleSelect,
  onToggleExplode,
  searchQuery,
}: FieldTreeProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = (p: FieldPath): boolean => {
    if (!query) return true;
    return (
      p.label.toLowerCase().includes(query) ||
      p.path.toLowerCase().includes(query) ||
      (p.description?.toLowerCase().includes(query) ?? false)
    );
  };

  const renderNode = (p: FieldPath, depth: number): React.ReactNode => {
    const subtreeMatch =
      matchesQuery(p) || flattenFieldPaths(p.children).some(matchesQuery);
    if (!subtreeMatch) return null;

    const open = !collapsed[p.path];
    const accepted = acceptsShape(role, p.shape);
    const isSelected = selected.has(p.path);

    // Explode is offered on the first array-node only; deeper array nodes are
    // disabled (matches backend path grammar: ONE `[*]` per path).
    const arrayDepth = getArrayNodesInPath(p.path);
    const canExplodeHere = p.isArrayNode && arrayDepth <= 1;
    const disabledExplode =
      p.isArrayNode && arrayDepth > 1
        ? 'Backend supports a single explosion point per path.'
        : null;
    const explodingHere = explosionForRole === p.path;

    return (
      <div key={p.path}>
        <div
          className={cn(
            'flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/40 text-xs',
            !accepted && 'opacity-50',
          )}
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          {p.children.length > 0 ? (
            <button
              type="button"
              className="h-4 w-4 flex items-center justify-center"
              onClick={() => setCollapsed((s) => ({ ...s, [p.path]: open }))}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="inline-block h-4 w-4" />
          )}

          <Checkbox
            checked={isSelected}
            disabled={!accepted}
            onCheckedChange={() => {
              if (!accepted) return;
              onToggleSelect(p.path);
            }}
            aria-label={`Select ${p.label}`}
          />
          <span className="flex-1 truncate font-mono text-[11px]">
            {p.label}
            <span className="text-muted-foreground ml-1">({p.shape})</span>
          </span>

          {canExplodeHere && (
            <label
              className={cn(
                'flex items-center gap-1 text-[10px] text-muted-foreground',
                disabledExplode && 'opacity-50 cursor-not-allowed',
              )}
              title={disabledExplode ?? 'Explode: one row per array item'}
            >
              <Checkbox
                checked={explodingHere}
                disabled={!!disabledExplode}
                onCheckedChange={(checked) => {
                  if (disabledExplode) return;
                  onToggleExplode(checked ? p.path : null);
                }}
                aria-label="Explode"
              />
              explode
            </label>
          )}
        </div>
        {open &&
          p.children.length > 0 &&
          p.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="max-h-72 overflow-auto border rounded bg-background p-1">
      {paths.map((p) => renderNode(p, 0))}
      {paths.length === 0 && (
        <div className="text-xs text-muted-foreground p-2">
          No fields in this schema.
        </div>
      )}
    </div>
  );
}

// ---------- Per-role row ----------

interface RoleRowProps {
  role: RoleDef;
  fields: string[];
  explosion: string | null;
  onFieldsChange: (fields: string[]) => void;
  onExplosionChange: (path: string | null) => void;
  fieldPaths: FieldPath[];
  /** "inline" (default) = [label | chips | button] horizontal.
   *  "stacked" = [label on top | chips+button below]. Used on the primary
   *  row so multiple roles can sit side-by-side without stealing width. */
  variant?: 'inline' | 'stacked';
}

function RoleRow({
  role,
  fields,
  explosion,
  onFieldsChange,
  onExplosionChange,
  fieldPaths,
  variant = 'inline',
}: RoleRowProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = new Set(fields);

  const toggleSelect = (path: string) => {
    if (role.multi) {
      onFieldsChange(
        selected.has(path) ? fields.filter((f) => f !== path) : [...fields, path],
      );
    } else {
      onFieldsChange(selected.has(path) ? [] : [path]);
    }
  };

  const stacked = variant === 'stacked';
  const labelNode = (
    <div className={cn(
      'flex items-center gap-1.5',
      stacked ? '' : 'min-w-[120px]',
    )}>
      <span className={cn(
        stacked ? 'text-[10px] uppercase tracking-wide text-muted-foreground' : 'text-xs font-medium',
      )}>{role.label}</span>
      {role.required && (
        <span className="text-destructive text-[10px]" title="Required">
          •
        </span>
      )}
      {role.hint && (
        <span title={role.hint}>
          <Info className="h-3 w-3 text-muted-foreground" />
        </span>
      )}
    </div>
  );

  return (
    <div className={cn('flex gap-1', stacked ? 'flex-col' : 'flex-col py-1')}>
      {stacked && labelNode}
      <div className="flex items-center gap-2">
        {!stacked && labelNode}

        {/* Selected chips */}
        <div className="flex-1 flex flex-wrap gap-1 items-center min-h-[26px]">
          {fields.length === 0 ? (
            <span className="text-[11px] text-muted-foreground italic">
              not set
            </span>
          ) : (
            fields.map((f) => (
              <Badge
                key={f}
                variant="secondary"
                className="text-[10px] gap-1 px-1.5 py-0.5"
              >
                <span className="font-mono">{f}</span>
                <button
                  type="button"
                  className="hover:text-destructive"
                  onClick={() =>
                    onFieldsChange(fields.filter((x) => x !== f))
                  }
                  aria-label={`Remove ${f}`}
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </Badge>
            ))
          )}
          {explosion && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
              explode: <span className="font-mono ml-1">{explosion}</span>
            </Badge>
          )}
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-6 text-[11px]">
              <Plus className="h-3 w-3 mr-1" />
              {fields.length === 0 ? 'Pick' : 'Edit'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[360px] p-2" align="end">
            <div className="flex items-center gap-1 mb-1.5">
              <SearchIcon className="h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fields…"
                className="h-7 text-xs"
              />
            </div>
            <FieldTree
              paths={fieldPaths}
              role={role}
              selected={selected}
              explosionForRole={explosion}
              onToggleSelect={toggleSelect}
              onToggleExplode={onExplosionChange}
              searchQuery={search}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ---------- Main picker ----------

export function RolePicker({
  schema,
  availableSchemas,
  value,
  onChange,
  alwaysOpen = false,
  onOpenValueAliases,
}: RolePickerProps) {
  const selectedSchema = useMemo(
    () => availableSchemas.find((s) => s.id === value.schemaId) ?? null,
    [availableSchemas, value.schemaId],
  );
  const fieldPaths = useMemo(
    () => walkOutputContract(selectedSchema),
    [selectedSchema],
  );

  const groups = useMemo(() => groupRoles(schema.roles), [schema.roles]);
  const requiredRoles = schema.roles.filter((r) => r.required);
  const missingRequired = requiredRoles.filter(
    (r) => (value.fieldsByRole[r.key] ?? []).length === 0,
  );

  // Collapsible: auto-open when required roles are missing; once the user
  // clicks the chevron their choice wins (null → auto, true/false → sticky).
  // When ``alwaysOpen`` is set (popover wrapper owns the collapse) we skip
  // the header entirely and render the body directly.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const autoExpanded = missingRequired.length > 0 || !selectedSchema;
  const isOpen = alwaysOpen ? true : (userExpanded === null ? autoExpanded : userExpanded);
  // Advanced / secondary roles stay hidden unless the user opts in.
  const [showMoreRoles, setShowMoreRoles] = useState(false);

  const setSchemaId = (id: number | null) => {
    if (id == null) {
      onChange({ ...value, schemaId: null, fieldsByRole: {}, explosionByRole: {} });
      return;
    }
    const nextSchema = availableSchemas.find((s) => s.id === id) ?? null;
    const nextPaths = walkOutputContract(nextSchema);
    const auto = autoFillRolesForSchema(schema, nextPaths, value.aggregation);
    onChange({
      ...value,
      schemaId: id,
      fieldsByRole: auto.fieldsByRole,
      explosionByRole: auto.explosionByRole,
      aggregation: auto.aggregation,
    });
  };

  const setRoleFields = (roleKey: string, fields: string[]) =>
    onChange({
      ...value,
      fieldsByRole: { ...value.fieldsByRole, [roleKey]: fields },
    });

  const setRoleExplosion = (roleKey: string, path: string | null) =>
    onChange({
      ...value,
      explosionByRole: { ...value.explosionByRole, [roleKey]: path },
    });

  const setAgg = (partial: Partial<PanelAggregation>) =>
    onChange({ ...value, aggregation: { ...value.aggregation, ...partial } });

  // Auto-fill required roles the first time we see a schema with no
  // selections. Covers the case where a panel pre-picks a schema via
  // settings (so `setSchemaId` here never ran) but leaves required roles
  // empty. The guard key prevents the effect from re-firing after the user
  // manually clears a role.
  const autoFilledFor = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedSchema || value.schemaId == null) return;
    if (autoFilledFor.current === value.schemaId) return;
    const hasAnyFields = Object.values(value.fieldsByRole ?? {}).some(
      (xs) => Array.isArray(xs) && xs.length > 0,
    );
    if (hasAnyFields) {
      autoFilledFor.current = value.schemaId;
      return;
    }
    const auto = autoFillRolesForSchema(schema, fieldPaths, value.aggregation);
    const autoHasAny = Object.keys(auto.fieldsByRole).length > 0;
    if (!autoHasAny) {
      autoFilledFor.current = value.schemaId;
      return;
    }
    autoFilledFor.current = value.schemaId;
    onChange({
      ...value,
      fieldsByRole: auto.fieldsByRole,
      explosionByRole: auto.explosionByRole,
      aggregation: auto.aggregation,
    });
  }, [selectedSchema, value.schemaId, value.fieldsByRole, fieldPaths, schema, onChange]);

  // Empty-state shortcut: show available shapes near the schema select
  const paletteDiag = paletteHasShape(fieldPaths, schema.roles.flatMap((r) => r.accepts));

  // Summary chips for the collapsed header.
  const summaryRoles = schema.roles
    .map((r) => ({ role: r, fields: value.fieldsByRole[r.key] ?? [] }))
    .filter(({ fields }) => fields.length > 0);

  return (
    <div className={cn(
      'flex flex-col gap-2',
      alwaysOpen ? '' : 'border rounded p-2 bg-card',
    )}>
      {/* Collapsed header — hidden entirely when the parent is already a
          collapse surface (popover). Keeps the panel chrome compact when
          the user has already configured the required roles. */}
      {!alwaysOpen && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium hover:text-primary"
            onClick={() => setUserExpanded(!isOpen)}
            aria-expanded={isOpen}
            title={isOpen ? 'Collapse picker' : 'Expand picker'}
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Settings2 className="h-3 w-3" />
            <span>{selectedSchema?.name ?? 'Configure'}</span>
          </button>

          {!isOpen && summaryRoles.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center min-w-0 flex-1">
              {summaryRoles.map(({ role, fields }) => (
                <Badge
                  key={role.key}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 gap-1 truncate"
                  title={`${role.label}: ${fields.join(', ')}`}
                >
                  <span className="text-muted-foreground">{role.label}:</span>
                  <span className="font-mono truncate max-w-[180px]">{fields.join(', ')}</span>
                </Badge>
              ))}
            </div>
          )}
          {!isOpen && missingRequired.length > 0 && (
            <span className="text-[10px] text-amber-700 dark:text-amber-400">
              Needs: {missingRequired.map((r) => r.label).join(', ')}
            </span>
          )}

          {!isOpen && <div className="flex-1" />}

          {isOpen && schema.supportsValueAliases && onOpenValueAliases && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={onOpenValueAliases}
            >
              Value aliases
            </Button>
          )}
        </div>
      )}

      {/* Value aliases link when the collapsed header is suppressed. */}
      {alwaysOpen && schema.supportsValueAliases && onOpenValueAliases && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={onOpenValueAliases}
          >
            Value aliases
          </Button>
        </div>
      )}

      {isOpen && (
        <>
          {/* Primary row — schema + required roles + inline adjuncts.
              Everything the user needs to render a non-empty panel lives
              on this single flex-wrap strip. No "Core" header — the row
              IS the core config. Aggregation defaults to count; the
              function knob lives in the optional tray below. */}
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div className="flex flex-col gap-1 min-w-[180px]">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Schema</span>
              <Select
                value={value.schemaId != null ? String(value.schemaId) : ''}
                onValueChange={(v) => setSchemaId(v ? Number(v) : null)}
              >
                <SelectTrigger className="w-full h-7 text-xs">
                  <SelectValue placeholder="Select schema…" />
                </SelectTrigger>
                <SelectContent>
                  {availableSchemas.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedSchema &&
              schema.roles
                .filter((r) => (r.group ?? 'primary') === 'primary')
                .map((role) => (
                  <div key={role.key} className="flex flex-col gap-1 flex-1 min-w-[220px]">
                    <RoleRow
                      role={role}
                      fields={value.fieldsByRole[role.key] ?? []}
                      explosion={value.explosionByRole[role.key] ?? null}
                      onFieldsChange={(f) => setRoleFields(role.key, f)}
                      onExplosionChange={(p) => setRoleExplosion(role.key, p)}
                      fieldPaths={fieldPaths}
                      variant="stacked"
                    />
                  </div>
                ))}

            {selectedSchema && schema.panelType === 'chart' && (
              <div className="flex flex-col gap-1 min-w-[100px]">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Interval</span>
                <Select
                  value={value.aggregation.interval ?? ''}
                  onValueChange={(v) =>
                    setAgg({ interval: (v || undefined) as PanelAggregation['interval'] })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="none" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">day</SelectItem>
                    <SelectItem value="week">week</SelectItem>
                    <SelectItem value="month">month</SelectItem>
                    <SelectItem value="quarter">quarter</SelectItem>
                    <SelectItem value="year">year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedSchema && schema.panelType === 'graph' && (
              <div className="flex flex-col gap-1 min-w-[160px]">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Edge weight</span>
                <Select
                  value={value.edgeWeightMode ?? 'count'}
                  onValueChange={(v) =>
                    onChange({ ...value, edgeWeightMode: v as EdgeWeightMode })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">count of triplets</SelectItem>
                    <SelectItem value="property">property only</SelectItem>
                    <SelectItem value="sum_property">sum of property</SelectItem>
                    <SelectItem value="avg_property">avg of property</SelectItem>
                    <SelectItem value="max_property">max of property</SelectItem>
                    <SelectItem value="count_times_property">count × avg property</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {selectedSchema && !paletteDiag.matches && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1">
              {paletteDiag.why ?? 'No compatible fields in this schema for this panel.'}
            </div>
          )}

          {/* Optional-role tray — secondary + advanced + the aggregation
              function knob. Hidden by default so the picker stays focused
              on the required config. */}
          {selectedSchema && (schema.roles.some((r) => (r.group ?? 'primary') !== 'primary') || schema.aggregationFns.length > 1) && (
            <button
              type="button"
              onClick={() => setShowMoreRoles((s) => !s)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary self-start pl-1"
            >
              <ChevronsUpDown className="h-3 w-3" />
              {showMoreRoles ? 'Hide advanced' : 'Show advanced'}
            </button>
          )}

          {selectedSchema && showMoreRoles && (
            <div className="flex flex-col gap-1 pt-1 border-t">
              {groups
                .filter(([g]) => g !== 'primary')
                .map(([group, roles]) => (
                  <div key={group} className="flex flex-col gap-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground pl-1">
                      {ROLE_GROUP_LABEL[group as keyof typeof ROLE_GROUP_LABEL] ?? group}
                    </div>
                    {roles.map((role) => (
                      <RoleRow
                        key={role.key}
                        role={role}
                        fields={value.fieldsByRole[role.key] ?? []}
                        explosion={value.explosionByRole[role.key] ?? null}
                        onFieldsChange={(f) => setRoleFields(role.key, f)}
                        onExplosionChange={(p) => setRoleExplosion(role.key, p)}
                        fieldPaths={fieldPaths}
                      />
                    ))}
                  </div>
                ))}

              {schema.aggregationFns.length > 1 && (
                <div className="flex items-center gap-2 pt-1">
                  <span
                    className="text-xs font-medium min-w-[90px]"
                    title="How to combine values inside each bucket — count of rows, sum/avg/max of the value field."
                  >
                    Aggregation
                  </span>
                  <Select
                    value={value.aggregation.function ?? 'count'}
                    onValueChange={(v) => setAgg({ function: v as PanelAggregation['function'] })}
                  >
                    <SelectTrigger className="w-28 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {schema.aggregationFns.map((fn) => (
                        <SelectItem key={fn} value={fn}>
                          {fn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
