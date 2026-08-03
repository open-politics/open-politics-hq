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
import { Settings2, ChevronDown, ChevronRight, ChevronUp, AlertCircle, Maximize2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  UnifiedFilterControls,
  type FilterSet as UIFilterSet,
  FILTER_UI_OP_TO_BACKEND,
  FILTER_BACKEND_OP_TO_UI,
} from '../AnnotationFilterControls';
import { FieldRefPicker, type FieldRefPickerValue } from './FieldRefPicker';
import type { AnnotationSchemaRead } from '@/client';
import type { Panel, PieVizConfig } from '@/lib/annotations/types';
import type { PanelType } from '@/lib/annotations/panelEligibility';
import { inferFieldShape, type FieldShape } from '@/lib/annotations/fieldPaths';
import { isPanelConfigured } from '@/lib/annotations/panelCompile';
import { orderFacets, effectiveVisibleFacets } from '@/lib/annotations/pieFacets';

export interface PanelConfigPopoverProps {
  panel: Panel;
  schemas: AnnotationSchemaRead[];
  onUpdate: (next: Panel) => void;
  /** For faceted pie panels: the distinct facet values discovered in the
   *  fetched data, supplied by the renderer (the panel already fetched
   *  them). Drives the "which pies to show" toggle. */
  availableFacets?: string[];
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
  // map — a place is a NAME, and under the observation model that name almost
  // always arrives as an entity typed `Location`, singly (`document.at`) or as
  // a roster (`document.places[*]`). Accepting only `string`/`object` locked
  // the map out of every v2 schema: the geocode task has resolved entity dicts
  // and lists of them since it was written (`geocode.py:_emit_leaf`), and
  // `schema_map` already publishes those paths in `place_paths`. The picker was
  // the only thing that would not let you reach them.
  position:        ['string', 'array_string', 'entity', 'array_entity', 'object'],
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
  availableFacets = [],
}: {
  panel: Panel;
  schemas: AnnotationSchemaRead[];
  onUpdate: (p: Panel) => void;
  availableFacets?: string[];
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
          <PieSlicesSlot cfg={cfg} onChange={(next) => updateCfg({ max_slices: next })} />
          <label className="flex items-start gap-2 cursor-pointer pt-0.5">
            <Checkbox
              className="mt-0.5"
              checked={(cfg as PieVizConfig)?.show_slice_labels ?? true}
              onCheckedChange={(c) => updateCfg({ show_slice_labels: !!c })}
            />
            <span className="space-y-0.5">
              <span className="text-[11px] text-foreground/80 font-medium block">Label slices directly</span>
              <span className="text-[10px] text-muted-foreground/80 leading-tight block">
                Draws category names on the wedges. Replaces the legend — handy for small multiples, which have none.
              </span>
            </span>
          </label>
          {/* Pies-per-row + facet visibility / order / emphasis — only when
              faceting actually produced more than one pie. availableFacets
              comes from the rendered panel. */}
          {cfg?.facet && availableFacets.length > 1 && (
            <>
              <PieColumnsSlot
                cfg={cfg as PieVizConfig}
                onChange={(next) => updateCfg({ facet_columns: next })}
              />
              <PieFacetVisibilitySlot
                cfg={cfg as PieVizConfig}
                availableFacets={availableFacets}
                onUpdate={(patch) => updateCfg(patch)}
              />
            </>
          )}
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
      // Deliberately empty. A graph has no axes in the sense the other panels
      // do — no fixed role list, N projections rather than one field, and the
      // roles that matter live INSIDE a projection. What this branch used to
      // write was `cfg.source`, which `resolve_projections` treats as a
      // pre-projections fallback and ignores whenever derivation succeeds; it
      // also labelled a roster a "triplet". A control that is both ignored and
      // wrong is worse than none.
      //
      // The replacement is two surfaces in the panel's own toolbar:
      // `GraphAxesPopover` (three axes across four frames) and
      // `GraphLayersPopover` (the resolved layers, read off the wire).
      return null;
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

// ── Pie slices slot — caps the number of rendered slices ──────────────────

const PIE_SLICE_OPTIONS = [
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '15', label: 'Top 15' },
  { value: 'all', label: 'All' },
];

function PieSlicesSlot({
  cfg,
  onChange,
}: {
  cfg: any;
  onChange: (next: number | null) => void;
}) {
  // Sentinels mirror the renderer: undefined → default 10, null → "All",
  // number → cap.
  const current =
    cfg?.max_slices === undefined ? '10' : cfg.max_slices === null ? 'all' : String(cfg.max_slices);
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-foreground/80 font-medium block">Slices to show</label>
      <p className="text-[10px] text-muted-foreground/80 leading-tight">
        Caps the number of slices. The remainder rolls into a single “Other” slice.
      </p>
      <Select value={current} onValueChange={(v) => onChange(v === 'all' ? null : parseInt(v, 10))}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PIE_SLICE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Pies-per-row slot — fixes the small-multiples column count ────────────
//
// ``null`` → auto (as many as fit the width). A number forces that many
// columns; rows then stretch to fill the panel height, so e.g. 4 pies become
// a balanced 2×2 instead of a 1×4 strip with a dead row beneath.

const PIE_COLUMN_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '1', label: '1 per row' },
  { value: '2', label: '2 per row' },
  { value: '3', label: '3 per row' },
  { value: '4', label: '4 per row' },
];

function PieColumnsSlot({
  cfg,
  onChange,
}: {
  cfg: PieVizConfig;
  onChange: (next: number | null) => void;
}) {
  const current = cfg.facet_columns == null ? 'auto' : String(cfg.facet_columns);
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-foreground/80 font-medium block">Pies per row</label>
      <p className="text-[10px] text-muted-foreground/80 leading-tight">
        Auto fits as many as the width allows. Fixing it (e.g. 2) balances the grid and fills the panel height.
      </p>
      <Select value={current} onValueChange={(v) => onChange(v === 'auto' ? null : parseInt(v, 10))}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PIE_COLUMN_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Pie facet visibility / order / emphasis slot ──────────────────────────
//
// One row per facet value, with controls to:
//   • show / hide this pie        (checkbox     → ``visible_facets``)
//   • reorder it                  (up/down btns → ``facet_order``)
//   • enlarge it                  (enlarge btn  → ``emphasized_facets``)
//
// Only meaningful once a facet is set AND the data produced more than one
// pie. ``availableFacets`` comes from the renderer (the panel already
// fetched the data); this component is purely presentational. Ordering and
// visibility share their logic with the renderer via ``pieFacets.ts``.

function PieFacetVisibilitySlot({
  cfg,
  availableFacets,
  onUpdate,
}: {
  cfg: PieVizConfig;
  availableFacets: string[];
  onUpdate: (patch: Partial<PieVizConfig>) => void;
}) {
  // Rows render in the same order the renderer draws the pies.
  const orderedFacets = useMemo(
    () => orderFacets(availableFacets, cfg.facet_order),
    [availableFacets, cfg.facet_order],
  );

  // Effective "checked" set — matches AnnotationResultsPieChart.visibleFacetKeys.
  const checkedSet = useMemo(
    () => new Set(effectiveVisibleFacets(orderedFacets, cfg.visible_facets)),
    [orderedFacets, cfg.visible_facets],
  );

  const emphasizedSet = useMemo(
    () => new Set((cfg.emphasized_facets ?? []).filter((f) => availableFacets.includes(f))),
    [cfg.emphasized_facets, availableFacets],
  );

  const allChecked = checkedSet.size === availableFacets.length;

  const writeVisible = (next: Set<string>) =>
    // Covering every facet is the "all" sentinel — store null so the panel
    // stays clean and auto-includes any future facet values.
    next.size === availableFacets.length ? null : Array.from(next);

  const toggleVisible = (facet: string, checked: boolean) => {
    const next = new Set(checkedSet);
    if (checked) {
      next.add(facet);
      onUpdate({ visible_facets: writeVisible(next) });
    } else {
      next.delete(facet);
      // Don't let the user uncheck the last pie — that would blank the panel
      // (and the renderer would fall back to "all" anyway, which is jarring).
      if (next.size === 0) return;
      // A hidden pie can't be emphasized — drop it from the emphasis set too.
      const nextEmph = new Set(emphasizedSet);
      nextEmph.delete(facet);
      onUpdate({
        visible_facets: writeVisible(next),
        emphasized_facets: nextEmph.size === 0 ? null : Array.from(nextEmph),
      });
    }
  };

  const toggleEmphasis = (facet: string) => {
    const next = new Set(emphasizedSet);
    if (next.has(facet)) next.delete(facet); else next.add(facet);
    onUpdate({ emphasized_facets: next.size === 0 ? null : Array.from(next) });
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= orderedFacets.length) return;
    const next = [...orderedFacets];
    [next[index], next[target]] = [next[target], next[index]];
    // Persist the full explicit order; new facets append in natural order.
    onUpdate({ facet_order: next });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-foreground/80 font-medium block">
          Pies to show ({checkedSet.size}/{availableFacets.length})
        </label>
        {!allChecked && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
            onClick={() => onUpdate({ visible_facets: null })}
            title="Show every pie"
          >
            show all
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground/80 leading-tight">
        Uncheck to hide a pie, reorder with the arrows, or use <Maximize2 className="inline h-2.5 w-2.5 align-text-bottom" /> to enlarge one (wider cell — fills gaps and highlights it). Hidden pies don’t affect the data.
      </p>
      <div className="max-h-40 overflow-y-auto rounded border divide-y">
        {orderedFacets.map((facet, index) => {
          const checked = checkedSet.has(facet);
          const emphasized = emphasizedSet.has(facet);
          return (
            <div
              key={facet}
              className="flex items-center gap-1 px-2 py-1 text-[11px] hover:bg-muted/50"
            >
              <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => toggleVisible(facet, !!c)}
                />
                <span className="truncate" title={facet}>{facet}</span>
              </label>
              <div className="flex items-center flex-shrink-0">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  title="Move up"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={index === orderedFacets.length - 1}
                  onClick={() => move(index, 1)}
                  title="Move down"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={!checked}
                  onClick={() => toggleEmphasis(facet)}
                  title={emphasized ? 'Reset to normal size' : 'Enlarge this pie (wider cell)'}
                  className={cn(
                    'rounded p-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                    emphasized
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
  availableFacets,
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
    // Two shapes, one source of truth. The UI FilterSet (schemaId + fieldKey +
    // UI operator) is the lossless editing state — persist it verbatim in
    // settings.filterUIState. The Formula's filter is the compiled backend
    // shape ({path, operator, value}); derive it here so /view stays driven by
    // panel.formula.filter. ``fieldKey`` IS the path (the picker emits ``[*]``
    // natively); the operator routes through the UI→backend map. Inactive or
    // field-less rules are dropped from the compiled output (but kept in the UI
    // state so the user doesn't lose a half-built rule).
    const conditions = (next.rules ?? [])
      .filter((r) => r.isActive !== false && r.fieldKey)
      .map((r) => ({
        path: r.fieldKey!,
        operator: FILTER_UI_OP_TO_BACKEND[r.operator] ?? 'eq',
        value: r.value,
      }));
    onUpdate({
      ...panel,
      formula: {
        ...(panel.formula as any),
        filter: { logic: next.logic ?? 'and', conditions },
      },
      settings: { ...((panel as any).settings ?? {}), filterUIState: next },
    } as any);
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

  // Adapter for the existing UnifiedFilterControls. Prefer the lossless UI
  // state persisted in settings.filterUIState (carries schemaId + fieldKey +
  // UI operators). Fall back to reconstructing from the compiled Formula
  // filter for panels with no persisted UI state (e.g. Workspace-authored
  // formulas, or filters written before this round-trip existed): default the
  // schema, treat ``path`` as the field key, and reverse-map the operator.
  // Reconstruction always sets schemaId so the control never crashes on
  // ``schemaId.toString()``.
  const uiFilterSet: UIFilterSet = useMemo(() => {
    const saved = (panel as any).settings?.filterUIState as UIFilterSet | undefined;
    if (saved?.rules) return saved;

    const f = (panel.formula as any)?.filter;
    if (!f) return { logic: 'and', rules: [] };
    const defaultSchemaId =
      (panel.formula as any)?.schema_id ?? schemas[0]?.id ?? 0;
    return {
      logic: f.logic ?? 'and',
      rules: (f.conditions ?? []).map((c: any, i: number) => ({
        id: `filter_${i}`,
        schemaId: defaultSchemaId,
        fieldKey: c.path,
        operator: FILTER_BACKEND_OP_TO_UI[c.operator] ?? c.operator,
        value: c.value,
        isActive: true,
      })),
    };
  }, [panel.formula, (panel as any).settings?.filterUIState, schemas]);

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
          <RolesSection panel={panel} schemas={schemas} onUpdate={onUpdate} availableFacets={availableFacets} />
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
