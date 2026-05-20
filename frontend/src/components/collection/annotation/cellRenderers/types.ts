import type { AnnotationSchemaRead } from '@/client';

/* ── Density ───────────────────────────────────────────────────────────── */

export type Density = 'compact' | 'comfortable' | 'expanded';

export interface DensitySpec {
  /** Max height for a row container before content scrolls internally. */
  rowMaxHeight: number;
  /** Char limit before strings get clipped with show-more. */
  stringClip: number;
  /** Max array-of-object preview rows in a mini-table before "+N more". */
  arrayPreviewRows: number;
  /** Max array-of-primitive chips before "+N". */
  arrayPrimitivePreview: number;
  /** Whether to show field labels in group mode. */
  showLabels: boolean;
  /** How arrays of objects render. */
  arrayObjectMode: 'chip' | 'mini-table' | 'full';
}

export const DENSITY_SPECS: Record<Density, DensitySpec> = {
  compact: {
    // Compact is the only tier with a hard row-height cap — that's the whole
    // point. The other tiers let rows grow to fit their content so users
    // never have to chase content with an inner scrollbar.
    rowMaxHeight: 36,
    stringClip: 60,
    arrayPreviewRows: 0,
    arrayPrimitivePreview: 2,
    showLabels: false,
    arrayObjectMode: 'chip',
  },
  comfortable: {
    rowMaxHeight: Number.POSITIVE_INFINITY,
    // Tighter clipping at comfortable: row height is driven by the truncation
    // limits below (no scroll), so we keep them aggressive enough that rows
    // stay readable. Switching to expanded removes all caps.
    stringClip: 400,
    arrayPreviewRows: 2,
    arrayPrimitivePreview: 6,
    showLabels: true,
    arrayObjectMode: 'mini-table',
  },
  expanded: {
    rowMaxHeight: Number.POSITIVE_INFINITY,
    stringClip: Number.POSITIVE_INFINITY,
    arrayPreviewRows: Number.POSITIVE_INFINITY,
    arrayPrimitivePreview: Number.POSITIVE_INFINITY,
    showLabels: true,
    arrayObjectMode: 'full',
  },
};

export const getDensitySpec = (density: Density): DensitySpec =>
  DENSITY_SPECS[density] ?? DENSITY_SPECS.comfortable;

/* ── Field shape ───────────────────────────────────────────────────────── */

/** A schema field as we receive it from the backend's JSON-schema-ish output_contract. */
export interface FieldDef {
  /** Dot path within the result value, e.g. "document.summary". */
  key: string;
  /** Display name. */
  name: string;
  /** Declared JSON-schema type. */
  type: string;
  /** Full raw definition from the schema (carries minimum/maximum/enum/items/etc.). */
  definition?: any;
}

/* ── Numeric range inference state (persisted) ─────────────────────────── */

export interface NumericRange {
  min: number;
  max: number;
  /** "declared" = from schema min/max, "observed" = inferred from loaded data. */
  source: 'declared' | 'observed';
  /** True when all observed values are integers. */
  integer: boolean;
}

/** Per-(schema, field) cache of inferred numeric ranges, persisted in panel settings. */
export type FieldRangeCache = Record<string, Record<string, NumericRange | null>>;

/* ── Cell renderer contract ────────────────────────────────────────────── */

export interface TypedCellProps {
  field: FieldDef;
  value: any;
  density: Density;
  schema: AnnotationSchemaRead;
  /** Active search term used for inline highlighting. */
  searchTerm?: string;
  /** Specific value to ring-highlight (e.g. when click-jumping from a chart). */
  highlightValue?: string;
  /** Cached numeric ranges for bar inference. */
  rangeCache?: FieldRangeCache;
  /** Click → open detail overlay. */
  onSelect?: () => void;
  /** Cross-panel handlers. */
  onTimestampClick?: (timestamp: Date, fieldKey: string) => void;
  onLocationClick?: (location: string, fieldKey: string) => void;
}
