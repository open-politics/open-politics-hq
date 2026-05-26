"use client";

/**
 * PanelConfigPopover — the panel's single configuration surface.
 *
 * Mounted as a popover triggered from the panel header button. Edits
 * the Panel's data side (formula, fields, time_source, scopes_in,
 * merge_maps) AND the per-type visual roles (panel_config). Display
 * knobs (mark, layout, density, mode markers/Area Geometry, geocode
 * source, etc.) stay on the renderer's own toolbar — they're not
 * cross-cutting, so they don't belong in this popover.
 *
 * Sections (collapsible):
 *  - Data         schema + per-type role slots + explode + time_source
 *  - Filter       reuses ``AnnotationFilterControls`` for value/time conditions
 *  - Saved        pick a Workspace SavedFormula (binds via formula_ref)
 *  - Advanced     read-only summary of "Extras" (derives, @composition,
 *                 weight expr, complex filter logic) — visible only
 *                 when present. Each item has an "Edit in Workspace"
 *                 affordance.
 *
 * See ``docs/INTELLIGENCE.md`` § "The Roles ↔ Extras split".
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Settings2, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { UnifiedFilterControls, type FilterSet as UIFilterSet } from '../AnnotationFilterControls';
import { FieldRefPicker, type FieldRefPickerValue } from './FieldRefPicker';
import type { AnnotationSchemaRead } from '@/client';
import type { Panel } from '@/lib/annotations/types';
import type { PanelType } from '@/lib/annotations/panelEligibility';
import { inferFieldShape, type FieldShape } from '@/lib/annotations/fieldPaths';
import { isPanelConfigured } from '@/lib/annotations/panelCompile';

export interface PanelConfigPopoverProps {
  panel: Panel;
  schemas: AnnotationSchemaRead[];
  onUpdate: (next: Panel) => void;
  /** Trigger button class overrides. */
  triggerClassName?: string;
}

/** "Extras" detection — Formula features beyond what RolePicker can edit. */
interface FormulaExtras {
  derives: number;
  compositionRefs: string[];
  hasWeight: boolean;
  hasComplexFilter: boolean;
  hasSnippet: boolean;
  isEmpty: boolean;
}

function detectExtras(panel: Panel): FormulaExtras {
  const f = panel.formula as any;
  if (!f) return { derives: 0, compositionRefs: [], hasWeight: false, hasComplexFilter: false, hasSnippet: false, isEmpty: true };

  const derives = (f.derives ?? []).length;
  const compositionRefs: string[] = [];
  for (const d of (f.derives ?? [])) {
    const m = String(d?.expr ?? '').match(/@(\w+)/g);
    if (m) compositionRefs.push(...m);
  }
  const hasWeight = !!f.weight;
  const hasComplexFilter =
    (f.filter?.logic === 'or') ||
    ((f.filter?.conditions ?? []).some((c: any) => c?.operator === 'cooccurs')) ||
    false;
  const hasSnippet = !!f.snippet;

  const isEmpty =
    derives === 0 &&
    compositionRefs.length === 0 &&
    !hasWeight &&
    !hasComplexFilter &&
    !hasSnippet;

  return { derives, compositionRefs, hasWeight, hasComplexFilter, hasSnippet, isEmpty };
}

// ── Section components ────────────────────────────────────────────────────

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded">
      <button
        type="button"
        className="w-full px-2 py-1.5 flex items-center justify-between text-xs font-medium hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="px-2 pb-2 pt-1 space-y-2">{children}</div>}
    </div>
  );
}

function SchemaPicker({
  schemas,
  value,
  onChange,
}: {
  schemas: AnnotationSchemaRead[];
  value: number | null | undefined;
  onChange: (id: number | null) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground">Schema</label>
      <Select
        value={value ? String(value) : ''}
        onValueChange={(v) => onChange(v ? Number(v) : null)}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="Pick a schema…" />
        </SelectTrigger>
        <SelectContent>
          {schemas.map((s) => (
            <SelectItem key={s.id} value={String(s.id)} className="text-xs">
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Per-type role slots. Each panel type renders its own narrow set of
 * field-pick slots backed by :class:`FieldRefPicker` — a typed
 * field-tree popover with search, shape filtering, and label/path
 * display. Acceptance per role mirrors the boundaries documented in
 * ``docs/INTELLIGENCE.md`` and the (legacy) ``panelRoleSchema.ts``.
 */
// Categorical shapes — every slot that wants "things you can group by"
// accepts these. The engine unrolls array_* shapes natively (one row per
// item), so a `keywords[*]` array_string is just as valid as a scalar
// `topic` string in a slice_by / facet / color slot.
const CATEGORICAL_SHAPES: FieldShape[] = [
  'string', 'enum_string', 'boolean', 'entity',
  'array_string', 'array_string_enum', 'array_entity',
];

const ROLE_ACCEPTS: Record<string, FieldShape[]> = {
  // categorical / entity dimensions
  slice_by:        CATEGORICAL_SHAPES,
  facet:           CATEGORICAL_SHAPES,
  color:           [...CATEGORICAL_SHAPES, 'number'],
  // x axis: time + categorical + number. Arrays unrolled by the engine
  // become per-row x values; valid for both timeline and bar charts.
  x:               [...CATEGORICAL_SHAPES, 'date', 'number'],
  // y series: numeric or aggregatable
  y:               ['number', 'boolean', 'enum_string'],
  // measure / numeric
  value:           ['number', 'boolean', 'enum_string'],
  size:            ['number'],
  // map
  position:        ['string', 'object'],  // geo coords / addresses
  label:           ['string', 'number', 'enum_string', 'date', 'entity', 'array_string', 'array_entity'],
  // table — keep wide; the renderer handles any shape
  columns:         ['string', 'number', 'boolean', 'date', 'enum_string', 'array_string', 'array_string_enum', 'array_number', 'entity', 'array_entity', 'object', 'array_object', 'triplet'],
  explode:         ['array_object', 'array_entity', 'array_string', 'array_string_enum', 'array_number'],
  // graph — triplet/array_object accept lets the user pick a whole triplet
  // field; the backend's graph_stream uses formula.group[0].path as the
  // triplet source. target / edge_label become optional overrides for
  // non-triplet entity-pair graphs.
  source:          ['triplet', 'array_object', 'entity', 'array_entity', 'string'],
  target:          ['entity', 'array_entity', 'string'],
  edge_label:      ['string', 'enum_string'],
  edge_weight_field: ['number'],
};

/** True when the graph source is a triplet/array_object — in that case
 *  source/target/predicate are auto-derived; the manual slots are hidden. */
function isTripletSource(panel: Panel, schemas: AnnotationSchemaRead[]): boolean {
  const cfg = panel.panel_config as any;
  if (cfg?.kind !== 'graph' || !cfg?.source) return false;
  // Cheap inference: a path ending in [*] is an array node; full shape
  // check would require walking the schema. The graph compile / backend
  // graph_stream already handle this — the popover only needs to know
  // whether to hide the manual slots.
  return String(cfg.source).includes('[*]');
}

function RolesSection({
  panel,
  schemas,
  onUpdate,
}: {
  panel: Panel;
  schemas: AnnotationSchemaRead[];
  onUpdate: (p: Panel) => void;
}) {
  const cfg = panel.panel_config as any;
  const formula = (panel.formula as any) ?? {};
  const schemaId: number | null = formula.schema_id ?? null;
  const tripletSource = isTripletSource(panel, schemas);

  const updateCfg = (patch: Record<string, any>) => {
    onUpdate({ ...panel, panel_config: { ...cfg, ...patch } });
  };

  const renderSlot = (label: string, key: string, opts: { multi?: boolean; hint?: string } = {}) => {
    const { multi = false, hint } = opts;
    const current = (cfg as any)?.[key];
    const accepts = ROLE_ACCEPTS[key] ?? [];
    const pickerValue: FieldRefPickerValue = multi
      ? { kind: 'multi', value: (current as string[] | undefined) ?? [] }
      : { kind: 'single', value: (current as string | undefined) ?? null };
    return (
      <div key={key} className="space-y-1">
        <label className="text-[11px] text-foreground/80 font-medium block">{label}</label>
        {hint && (
          <p className="text-[10px] text-muted-foreground/80 leading-tight">{hint}</p>
        )}
        <FieldRefPicker
          schemas={schemas}
          schemaId={schemaId}
          accepts={accepts}
          value={pickerValue}
          onChange={(next) => {
            if (next.kind === 'single') {
              updateCfg({ [key]: next.value });
            } else {
              updateCfg({ [key]: next.value });
            }
          }}
          placeholder={multi ? 'Pick fields…' : 'Pick a field…'}
        />
      </div>
    );
  };

  switch (cfg?.kind as PanelType) {
    case 'pie':
      return (
        <>
          {renderSlot('Show distribution of', 'slice_by', {
            hint: 'The field whose values become pie slices. E.g. topic, keywords, sentiment.',
          })}
          {renderSlot('Slice size', 'value', {
            hint: 'Leave empty to size by count. Pick a numeric field to size by sum/mean instead.',
          })}
          {renderSlot('Split into multiple pies by', 'facet', {
            hint: 'Optional. Renders one pie per value of this field (small multiples).',
          })}
        </>
      );
    case 'chart':
      return (
        <>
          {renderSlot('X axis', 'x', {
            hint: 'Pick a date field for time series, or a categorical field for bar/line groups.',
          })}
          {renderSlot('Y series (measures)', 'y', {
            multi: true,
            hint: 'Leave empty to count rows. Pick numeric fields to plot their values.',
          })}
          {renderSlot('Split by (color)', 'color', {
            hint: 'Optional. Splits each x-value into multiple colored series.',
          })}
          {/* Time interval — only meaningful when x is a date-shape field.
              Lives in the data section because changing it produces a fresh
              backend bucketing (the engine's date_trunc). */}
          <TimeIntervalSlot
            cfg={cfg}
            schema={schemas.find((s) => s.id === schemaId) ?? null}
            onChange={(next) => updateCfg({ time_interval: next })}
          />
        </>
      );
    case 'map':
      return (
        <>
          {renderSlot('Position field', 'position', {
            hint: 'Geo coordinates or address string. Used to place markers / shade regions.',
          })}
          {renderSlot('Color by', 'color', {
            hint: 'Optional. In Area Geometry mode, this is the numeric field that colors regions.',
          })}
          {renderSlot('Label fields', 'label', {
            multi: true,
            hint: 'Optional. Fields surfaced on each marker label.',
          })}
        </>
      );
    case 'table':
      return (
        <>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">Columns</label>
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                onClick={() => updateCfg({ columns: [] })}
                title="Reset to show all annotation fields"
              >
                show all
              </button>
            </div>
            <FieldRefPicker
              schemas={schemas}
              schemaId={schemaId}
              accepts={ROLE_ACCEPTS.columns}
              value={{ kind: 'multi', value: (cfg?.columns as string[]) ?? [] }}
              onChange={(next) => {
                if (next.kind === 'multi') updateCfg({ columns: next.value });
              }}
              placeholder="All fields (default) — pick to narrow…"
            />
          </div>
        </>
      );
    case 'graph':
      return (
        <>
          {/* Triplet field — when set, source/target/predicate auto-derive
              from the triplet item's subject_name/object_name/predicate
              keys. Manual slots stay only for non-triplet (entity-pair)
              graph shapes. */}
          {renderSlot(tripletSource ? 'Triplet field' : 'Source entity', 'source', {
            hint: tripletSource
              ? 'Triplet detected — source / target / predicate auto-derived from this field.'
              : 'For entity-pair graphs (no triplet field). Pick the source entity field.',
          })}
          {!tripletSource && (
            <>
              {renderSlot('Target entity', 'target', { hint: 'The other side of each edge.' })}
              {renderSlot('Edge label', 'edge_label', { hint: 'Optional. Field whose values label each edge.' })}
            </>
          )}
          {renderSlot('Edge weight (numeric)', 'edge_weight_field', {
            hint: 'Optional. Defaults to count of co-occurrences.',
          })}
        </>
      );
    case 'measurements':
      return (
        <div className="text-[11px] text-muted-foreground italic">
          Measurements panel reads a Formula directly — bind a Workspace
          formula via the Saved section below.
        </div>
      );
    case 'scatter':
      return (
        <>
          {renderSlot('X axis', 'x', { hint: 'Categorical or numeric field for the x dimension.' })}
          {renderSlot('Y axis', 'y', { hint: 'Categorical or numeric field for the y dimension.' })}
          {renderSlot('Color by', 'color', { hint: 'Optional. Field driving point color.' })}
          {renderSlot('Size by (measure)', 'size', { hint: 'Optional. Numeric measure driving point size.' })}
        </>
      );
    default:
      return null;
  }
}

// ── Time interval slot — only renders when x is a date-shape field ────────

function TimeIntervalSlot({
  cfg,
  schema,
  onChange,
}: {
  cfg: any;
  schema: AnnotationSchemaRead | null;
  onChange: (next: 'day' | 'week' | 'month' | 'quarter' | 'year') => void;
}) {
  const xPath: string | null = cfg?.x ?? null;
  const xShape: FieldShape = useMemo(() => {
    if (!xPath || !schema) return 'unknown';
    return inferFieldShape(schema, xPath);
  }, [xPath, schema]);

  // Show whenever x is set. Schema-declared dates auto-show with a
  // sensible default (month); for fields without ``format: "date"``
  // the picker is the user's signal — selecting any interval flips
  // compile into time mode regardless of inferred shape.
  if (!xPath) return null;
  const current = (cfg?.time_interval as 'day' | 'week' | 'month' | 'quarter' | 'year' | undefined) ?? 'month';
  const isInferredTime = xShape === 'date';
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-foreground/80 font-medium block">Time interval</label>
      <p className="text-[10px] text-muted-foreground/80 leading-tight">
        {isInferredTime
          ? 'Buckets the time axis (day / week / month / quarter / year).'
          : 'Picking an interval treats the x field as time. Use when your date field lacks a format hint.'}
      </p>
      <Select value={current} onValueChange={(v) => onChange(v as any)}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="day"     className="text-xs">Day</SelectItem>
          <SelectItem value="week"    className="text-xs">Week</SelectItem>
          <SelectItem value="month"   className="text-xs">Month</SelectItem>
          <SelectItem value="quarter" className="text-xs">Quarter</SelectItem>
          <SelectItem value="year"    className="text-xs">Year</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function PanelConfigPopover({
  panel,
  schemas,
  onUpdate,
  triggerClassName,
}: PanelConfigPopoverProps) {
  const [open, setOpen] = useState(false);

  const extras = detectExtras(panel);
  // The "configured?" predicate lives in panelCompile so the warning here,
  // the empty-state in PanelRenderer, and the hook's enabled flag all
  // share one source of truth. (Tables / measurements are always
  // configured — they have sensible defaults.)
  const unconfigured = !isPanelConfigured(panel);

  // Auto-select schema when the run has exactly one — there's no
  // ambiguity to resolve, so don't make the user pick. Fires once when
  // the panel has no schema_id set and the run has a single schema.
  useEffect(() => {
    const current = (panel.formula as any)?.schema_id;
    if (current == null && schemas.length === 1) {
      onUpdate({
        ...panel,
        formula: { ...(panel.formula as any), schema_id: schemas[0].id },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas.length, (panel.formula as any)?.schema_id]);

  const handleSchemaChange = (id: number | null) => {
    onUpdate({
      ...panel,
      formula: { ...(panel.formula as any), schema_id: id },
    });
  };

  const handleFilterChange = (next: UIFilterSet) => {
    // UI FilterSet uses `rules`; Formula's filter uses `conditions`. Adapter
    // mirrors the existing mapping in AnnotationFilterControls.
    const conditions = (next.rules ?? []).map((r: any) => ({
      path: r.path,
      operator: r.operator,
      value: r.value,
    }));
    onUpdate({
      ...panel,
      formula: {
        ...(panel.formula as any),
        filter: { logic: next.logic ?? 'and', conditions },
      },
    });
  };

  const handleTimeSourceChange = (path: string) => {
    onUpdate({ ...panel, time_source: path || null });
  };

  const handleExplodeChange = (path: string) => {
    onUpdate({
      ...panel,
      formula: { ...(panel.formula as any), explosion: path || null },
    });
  };

  // Adapter for the existing UnifiedFilterControls. Maps Formula.filter
  // (logic + conditions) → UI FilterSet shape (logic + rules).
  const uiFilterSet: UIFilterSet = useMemo(() => {
    const f = (panel.formula as any)?.filter;
    if (!f) return { logic: 'and', rules: [] };
    return {
      logic: f.logic ?? 'and',
      rules: (f.conditions ?? []).map((c: any) => ({
        path: c.path,
        operator: c.operator,
        value: c.value,
      })),
    };
  }, [panel.formula]);

  const formula = (panel.formula as any) ?? {};

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-6 w-6 p-0 relative flex-shrink-0',
            unconfigured && 'text-amber-700 dark:text-amber-400',
            triggerClassName,
          )}
          title={unconfigured ? 'Configure panel' : 'Edit panel configuration'}
        >
          <Settings2 className="h-3 w-3" />
          {unconfigured && (
            <AlertCircle className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[560px] max-w-[95vw] p-2 space-y-2"
        align="start"
        side="bottom"
      >
        {/* Data — schema + per-type roles. The minimum needed to make a
            panel render. */}
        <Section title="Data" defaultOpen>
          <SchemaPicker
            schemas={schemas}
            value={formula.schema_id ?? null}
            onChange={handleSchemaChange}
          />
          <RolesSection panel={panel} schemas={schemas} onUpdate={onUpdate} />
        </Section>

        {/* Filter — the second-most common edit after roles. Inline mode
            renders the rules directly (no popover-in-popover). */}
        <Section title="Filter" defaultOpen>
          <UnifiedFilterControls
            filterSet={uiFilterSet}
            onFilterSetChange={handleFilterChange}
            timeAxisConfig={null}
            onTimeAxisConfigChange={() => { /* time_source lives in Advanced */ }}
            showTimeControls={false}
            allSchemas={schemas}
            inline
          />
        </Section>

        {/* Advanced — power-user controls. Time source, row explosion,
            and the read-only Workspace-extras summary. Collapsed by
            default so the popover stays scannable. */}
        <Section title="Advanced" defaultOpen={false}>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">
              Time source field
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                (only needed when no time-shape role is set)
              </span>
            </label>
            <FieldRefPicker
              schemas={schemas}
              schemaId={formula.schema_id ?? null}
              accepts={['date', 'string']}
              value={{ kind: 'single', value: panel.time_source ?? null }}
              onChange={(next) => {
                if (next.kind === 'single') handleTimeSourceChange(next.value ?? '');
              }}
              placeholder="Pick a timestamp field…"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">
              Row explosion (array path)
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                (one row per array element)
              </span>
            </label>
            <FieldRefPicker
              schemas={schemas}
              schemaId={formula.schema_id ?? null}
              accepts={['array_object', 'array_entity', 'array_string', 'array_string_enum', 'array_number']}
              value={{ kind: 'single', value: formula.explosion ?? null }}
              onChange={(next) => {
                if (next.kind === 'single') handleExplodeChange(next.value ?? '');
              }}
              placeholder="Pick an array field to explode rows…"
            />
          </div>
          {!extras.isEmpty && (
            <div className="pt-2 border-t">
              <div className="text-[11px] font-medium mb-1">Workspace-only features</div>
              <ul className="space-y-1 text-[11px]">
                {extras.derives > 0 && (
                  <li className="flex items-center justify-between">
                    <span>{extras.derives} derived measure(s)</span>
                    <Badge variant="outline" className="text-[10px]">Edit in Workspace</Badge>
                  </li>
                )}
                {extras.compositionRefs.length > 0 && (
                  <li className="flex items-center justify-between">
                    <span>Composition refs: {extras.compositionRefs.slice(0, 3).join(', ')}</span>
                    <Badge variant="outline" className="text-[10px]">Edit in Workspace</Badge>
                  </li>
                )}
                {extras.hasWeight && (
                  <li className="flex items-center justify-between">
                    <span>Weighted aggregation</span>
                    <Badge variant="outline" className="text-[10px]">Edit in Workspace</Badge>
                  </li>
                )}
                {extras.hasComplexFilter && (
                  <li className="flex items-center justify-between">
                    <span>Complex filter (OR / cooccurs)</span>
                    <Badge variant="outline" className="text-[10px]">Edit in Workspace</Badge>
                  </li>
                )}
                {extras.hasSnippet && (
                  <li className="flex items-center justify-between">
                    <span>Snippet binding</span>
                    <Badge variant="outline" className="text-[10px]">Edit in Workspace</Badge>
                  </li>
                )}
              </ul>
              <div className="text-[10px] text-muted-foreground italic pt-1">
                Edit these in Workspace — they don't fit the per-type slots.
              </div>
            </div>
          )}
        </Section>
      </PopoverContent>
    </Popover>
  );
}
