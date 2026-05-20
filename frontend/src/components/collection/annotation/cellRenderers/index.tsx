'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { highlightTextInValue } from '@/lib/annotations/search';

import TruncatedText from './TruncatedText';
import MiniTable from './MiniTable';
import NumberCell, { getCachedRange, readDeclaredRange } from './NumberCell';
import { EntityCell, EntityArrayCell, type EntityValue } from './EntityCell';
import { JustificationCell, isJustificationShape } from './JustificationCell';

import type { Density, FieldDef, TypedCellProps } from './types';
import { getDensitySpec } from './types';

export type { Density, FieldDef, NumericRange, FieldRangeCache, TypedCellProps } from './types';
export { DENSITY_SPECS, getDensitySpec } from './types';
export { EntityCell, EntityArrayCell } from './EntityCell';
export type { EntityValue } from './EntityCell';
export { JustificationCell, isJustificationShape } from './JustificationCell';
export type { JustificationValue } from './JustificationCell';
export {
  inferFieldRange,
  inferRangeFromValues,
  readDeclaredRange,
  valueFitsRange,
  getCachedRange,
  writeCachedRange,
} from './NumberCell';
export { default as MiniTable, pickPreviewColumns } from './MiniTable';
export { default as TruncatedText } from './TruncatedText';

/* ── Stable color hashing for enum chips ───────────────────────────────── */

const ENUM_PALETTE: { bg: string; text: string; border: string }[] = [
  { bg: 'bg-blue-100 dark:bg-blue-950/40', text: 'text-blue-800 dark:text-blue-200', border: 'border-blue-200 dark:border-blue-900' },
  { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-emerald-200 dark:border-emerald-900' },
  { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-900 dark:text-amber-200', border: 'border-amber-200 dark:border-amber-900' },
  { bg: 'bg-violet-100 dark:bg-violet-950/40', text: 'text-violet-800 dark:text-violet-200', border: 'border-violet-200 dark:border-violet-900' },
  { bg: 'bg-rose-100 dark:bg-rose-950/40', text: 'text-rose-800 dark:text-rose-200', border: 'border-rose-200 dark:border-rose-900' },
  { bg: 'bg-cyan-100 dark:bg-cyan-950/40', text: 'text-cyan-800 dark:text-cyan-200', border: 'border-cyan-200 dark:border-cyan-900' },
  { bg: 'bg-lime-100 dark:bg-lime-950/40', text: 'text-lime-900 dark:text-lime-200', border: 'border-lime-200 dark:border-lime-900' },
  { bg: 'bg-fuchsia-100 dark:bg-fuchsia-950/40', text: 'text-fuchsia-800 dark:text-fuchsia-200', border: 'border-fuchsia-200 dark:border-fuchsia-900' },
];

const hashString = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const colorClassesFor = (value: string) => ENUM_PALETTE[hashString(value) % ENUM_PALETTE.length];

/* ── Date detection + smart display (structural) ───────────────────────── */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export const looksLikeDate = (s: string): boolean => {
  if (s.length < 8 || s.length > 35) return false;
  if (!ISO_DATE_RE.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
};

/**
 * Display a raw ISO date string with the time portion dropped iff time is
 * exactly midnight (00:00, 00:00:00, 00:00:00.0…), regardless of timezone
 * suffix. Non-zero times are preserved verbatim. Pure string-level work — no
 * timezone conversion, so a midnight in input stays a midnight in output.
 */
export const smartIsoDisplay = (iso: string): string => {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T00:00(:00(\.0+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  return m ? m[1] : iso;
};

const formatRelative = (date: Date): string => {
  const diffMs = Date.now() - date.getTime();
  const absSec = Math.abs(diffMs) / 1000;
  const future = diffMs < 0;
  const fmt = (v: number, unit: string) =>
    `${future ? 'in ' : ''}${Math.round(v)}${unit}${future ? '' : ' ago'}`;
  if (absSec < 60) return future ? 'soon' : 'just now';
  if (absSec < 3600) return fmt(absSec / 60, 'm');
  if (absSec < 86400) return fmt(absSec / 3600, 'h');
  if (absSec < 86400 * 30) return fmt(absSec / 86400, 'd');
  if (absSec < 86400 * 365) return fmt(absSec / (86400 * 30), 'mo');
  return fmt(absSec / (86400 * 365), 'y');
};

/* ── Small inline renderers (each one or two lines of UI) ──────────────── */

const BoolCell: React.FC<{ value: boolean; density: Density }> = ({ value, density }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 text-xs',
      value ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
    )}
    title={value ? 'true' : 'false'}
  >
    <span className="font-bold">{value ? '✓' : '✗'}</span>
    {density !== 'compact' && <span>{value ? 'true' : 'false'}</span>}
  </span>
);

const EnumChip: React.FC<{ value: string; searchTerm?: string; highlight?: boolean }> = ({
  value,
  searchTerm,
  highlight,
}) => {
  const c = colorClassesFor(value);
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[11px] px-1.5 py-0 font-medium whitespace-nowrap max-w-full truncate inline-block align-baseline',
        c.bg,
        c.text,
        c.border,
        highlight && 'ring-2 ring-offset-1 ring-primary',
      )}
      title={value}
    >
      {searchTerm ? highlightTextInValue(value, searchTerm) : value}
    </Badge>
  );
};

const DateCell: React.FC<{
  iso: string;
  density: Density;
  onClick?: (d: Date, fieldKey: string) => void;
  fieldKey: string;
}> = ({ iso, density, onClick, fieldKey }) => {
  const d = new Date(iso);
  const rel = formatRelative(d);
  const display = smartIsoDisplay(iso);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      title={`${rel} — ${iso}`}
      onClick={
        onClick
          ? (e: React.MouseEvent) => {
              e.stopPropagation();
              onClick(d, fieldKey);
            }
          : undefined
      }
      className={cn(
        'text-xs whitespace-nowrap tabular-nums',
        onClick && 'underline decoration-dotted underline-offset-2 hover:text-primary cursor-pointer',
      )}
    >
      {density === 'compact' ? rel : display}
    </Tag>
  );
};

const ArrayPrimitiveCell: React.FC<{
  values: any[];
  field: FieldDef;
  density: Density;
  searchTerm?: string;
  highlightValue?: string;
}> = ({ values, field, density, searchTerm, highlightValue }) => {
  const spec = getDensitySpec(density);
  const limit = spec.arrayPrimitivePreview;
  const isEnum =
    Array.isArray(field.definition?.items?.enum) || field.definition?.items?.type === 'string';
  // Stable display order: alphabetical by stringified value. Doesn't touch the
  // underlying data — sort is purely for the chip strip.
  const sorted = useMemo(
    () => [...values].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })),
    [values],
  );
  const visible = sorted.slice(0, limit);
  const hidden = sorted.length - visible.length;

  if (density === 'compact' && values.length > 0) {
    // Just count + first item preview as a chip.
    const sample = String(values[0]);
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">
          {values.length}
        </Badge>
        <span className="text-muted-foreground truncate max-w-[18ch]">{sample}</span>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 items-center min-w-0">
      {visible.map((v, i) => {
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        const highlight = highlightValue !== undefined && String(highlightValue) === String(v);
        return isEnum ? (
          <EnumChip key={i} value={text} searchTerm={searchTerm} highlight={highlight} />
        ) : (
          <Badge
            key={i}
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 font-normal whitespace-nowrap max-w-full truncate inline-block align-baseline',
              highlight && 'ring-2 ring-offset-1 ring-primary',
            )}
            title={text}
          >
            {searchTerm ? highlightTextInValue(text, searchTerm) : text}
          </Badge>
        );
      })}
      {hidden > 0 && (
        <span className="text-[10px] text-muted-foreground">+{hidden}</span>
      )}
    </div>
  );
};

const ObjectCell: React.FC<{
  value: Record<string, any>;
  density: Density;
  onOpenDetail?: () => void;
  searchTerm?: string;
}> = ({ value, density, onOpenDetail, searchTerm }) => {
  const entries = Object.entries(value).filter(([_, v]) => v !== null && v !== undefined);

  if (density === 'compact' || (density === 'comfortable' && entries.length > 6)) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetail?.();
        }}
      >
        <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">
          {`{${entries.length}}`}
        </Badge>
      </button>
    );
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs min-w-0">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <span className="text-muted-foreground font-medium truncate">{k}</span>
          <span className="min-w-0 truncate">
            {typeof v === 'string'
              ? searchTerm
                ? highlightTextInValue(v, searchTerm)
                : v
              : typeof v === 'number' || typeof v === 'boolean'
                ? String(v)
                : Array.isArray(v)
                  ? `[${v.length}]`
                  : typeof v === 'object'
                    ? `{${Object.keys(v).length}}`
                    : String(v)}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};

/* ── Missing-value detection (shared with formatFieldValue) ────────────── */

/** A value should render as "missing" when it's null/undefined/empty/`<UNKNOWN>`
 *  (case-insensitive). Arrays are missing when empty after filtering out
 *  `<UNKNOWN>` items. Objects when they have no own keys. */
export const isUnknownToken = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return /^<unknown>$/i.test(s);
};

export const isMissingValue = (v: unknown): boolean => {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && (v === '' || isUnknownToken(v))) return true;
  if (Array.isArray(v)) {
    const meaningful = v.filter((item) => !isMissingValue(item));
    return meaningful.length === 0;
  }
  if (typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).length === 0;
  }
  return false;
};

/* ── TypedCell — main dispatcher ───────────────────────────────────────── */

export const TypedCell: React.FC<TypedCellProps> = ({
  field,
  value,
  density,
  schema,
  searchTerm,
  highlightValue,
  rangeCache,
  onSelect,
  onTimestampClick,
  onLocationClick,
}) => {
  // Null / empty / <UNKNOWN> — render as the same muted × the parent
  // formatFieldValue does, so missing-state is uniform across the table.
  if (isMissingValue(value)) {
    return <span className="text-muted-foreground/50 text-xs" title="No value">×</span>;
  }

  const declaredType = field.type;
  const def = field.definition;

  // Justification branch — per-row inline justification on `array<object>`
  // items lands as `{reasoning, text_spans: [...]}`. The generic ObjectCell
  // would render this as `{2}` (key count), which is useless. Render an
  // inspectable ?-button instead. Detection is structural; works for both
  // the canonical `justification` field and any nested-row variant.
  if (isJustificationShape(value)) {
    return <JustificationCell value={value} onSelect={onSelect} />;
  }

  // Entity branch — single source of truth for entity rendering whether the
  // field is a top-level vocabulary or a nested participant slot. Both expand
  // to the same `x-entityField` shape via `x-ref`, so detecting either side
  // and dispatching to EntityCell keeps the same name/type/icon visual
  // identity at every nesting level.
  const isSingleEntity = def?.['x-entityField'] === true;
  const isArrayEntity = def?.type === 'array' && def?.items?.['x-entityField'] === true;
  if (isSingleEntity) {
    return <EntityCell value={value as EntityValue} density={density} searchTerm={searchTerm} />;
  }
  if (isArrayEntity && Array.isArray(value)) {
    return (
      <EntityArrayCell
        values={value as EntityValue[]}
        density={density}
        searchTerm={searchTerm}
        onSelect={onSelect}
      />
    );
  }

  // Boolean (declared or actual)
  if (declaredType === 'boolean' || typeof value === 'boolean') {
    return <BoolCell value={Boolean(value)} density={density} />;
  }

  // Number / integer
  if (declaredType === 'number' || declaredType === 'integer' || typeof value === 'number') {
    const range =
      readDeclaredRange(def) ??
      getCachedRange(rangeCache, schema.id, field.key) ??
      null;
    return <NumberCell value={Number(value)} range={range} density={density} />;
  }

  // Array
  if (declaredType === 'array' || Array.isArray(value)) {
    if (!Array.isArray(value)) {
      return <span className="text-muted-foreground italic text-xs">empty</span>;
    }
    if (value.length === 0) {
      return <span className="text-muted-foreground/50 text-xs" title="No value">×</span>;
    }
    // Filter out <UNKNOWN> tokens — backend sentinel for "model couldn't fill
    // this slot". They're noise, not data.
    const cleaned = value.filter((item) => !isUnknownToken(item));
    if (cleaned.length === 0) {
      return <span className="text-muted-foreground/50 text-xs" title="No value">×</span>;
    }
    const itemType = def?.items?.type;
    const isObjectArray = itemType === 'object' || (itemType == null && typeof value[0] === 'object' && !Array.isArray(value[0]));

    if (isObjectArray) {
      const spec = getDensitySpec(density);
      if (spec.arrayObjectMode === 'chip') {
        return (
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.();
            }}
          >
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
              {value.length} item{value.length !== 1 ? 's' : ''}
            </Badge>
          </button>
        );
      }
      return (
        <MiniTable
          items={value}
          itemSchemaProps={def?.items?.properties}
          density={density}
          searchTerm={searchTerm}
          onOpenDetail={onSelect}
        />
      );
    }

    return (
      <ArrayPrimitiveCell
        values={value}
        field={field}
        density={density}
        searchTerm={searchTerm}
        highlightValue={highlightValue}
      />
    );
  }

  // Object
  if (declaredType === 'object' || (typeof value === 'object' && !Array.isArray(value))) {
    return (
      <ObjectCell
        value={value as Record<string, any>}
        density={density}
        onOpenDetail={onSelect}
        searchTerm={searchTerm}
      />
    );
  }

  // String — branch on content shape
  const str = String(value);

  // Enum chip when declared
  if (Array.isArray(def?.enum) && def.enum.includes(str)) {
    return (
      <EnumChip
        value={str}
        searchTerm={searchTerm}
        highlight={highlightValue !== undefined && highlightValue === str}
      />
    );
  }

  // Date when shape matches
  if (looksLikeDate(str)) {
    return (
      <DateCell iso={str} density={density} onClick={onTimestampClick} fieldKey={field.key} />
    );
  }

  // Plain string — clip via TruncatedText
  return (
    <TruncatedText
      text={str}
      density={density}
      searchTerm={searchTerm}
      onOpenDetail={onSelect}
    />
  );
};

export default TypedCell;
