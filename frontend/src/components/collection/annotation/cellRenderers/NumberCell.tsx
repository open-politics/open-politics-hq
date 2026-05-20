'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { FieldDef, NumericRange, FieldRangeCache, Density } from './types';

/* ── Range inference (structural, no field-name guessing) ──────────────── */

/** Read declared bounds from the field's JSON-schema-ish definition. */
export const readDeclaredRange = (def: any): NumericRange | null => {
  if (!def || typeof def !== 'object') return null;
  const min = def.minimum;
  const max = def.maximum;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (max <= min) return null;
  return { min, max, source: 'declared', integer: def.type === 'integer' };
};

/**
 * Decide a bar range from observed values.
 *  - all integer in [1, 10]      → 10-segment bar (preferred — covers 1-10
 *                                  rating scales, which are the common case)
 *  - all in [0, 1] (any decimal) → continuous 0–1 bar
 *  - else                        → null (plain numeral)
 *
 * Priority matters when only one value is observed: a lone `1` fits BOTH
 * rules, but the user-intent is almost always "1 of 10" rather than "100% of
 * a 0-1 confidence". The segmented rule wins ties.
 */
export const inferRangeFromValues = (values: number[]): NumericRange | null => {
  if (values.length === 0) return null;
  let allUnit = true;       // all in [0,1] (decimals OK)
  let allTenScale = true;   // all integers in [1,10]
  let anyFraction = false;  // any non-integer value seen
  for (const v of values) {
    if (!Number.isFinite(v)) return null;
    if (v < 0 || v > 1) allUnit = false;
    if (!Number.isInteger(v)) anyFraction = true;
    if (!Number.isInteger(v) || v < 1 || v > 10) allTenScale = false;
    if (!allUnit && !allTenScale) return null;
  }
  // A fractional value can only be the 0-1 bar (no fractional 1-10 ratings).
  if (anyFraction && allUnit) return { min: 0, max: 1, source: 'observed', integer: false };
  // Pure integers in [1,10] → segmented bar.
  if (allTenScale) return { min: 1, max: 10, source: 'observed', integer: true };
  // Pure integers in [0,1] (e.g. {0,1} boolean-ish) — fall back to continuous.
  if (allUnit) return { min: 0, max: 1, source: 'observed', integer: false };
  return null;
};

/** True when a value still fits an existing range. */
export const valueFitsRange = (range: NumericRange, value: number): boolean => {
  if (!Number.isFinite(value)) return false;
  if (value < range.min || value > range.max) return false;
  if (range.integer && !Number.isInteger(value)) return false;
  return true;
};

/**
 * Walk loaded results, collect numeric samples, return a fresh inference.
 * Caller is responsible for caching + persisting.
 */
export const inferFieldRange = (
  field: FieldDef,
  results: { value: any }[],
  resolveValue: (value: any, key: string) => any,
): NumericRange | null => {
  const declared = readDeclaredRange(field.definition);
  if (declared) return declared;
  if (field.type !== 'number' && field.type !== 'integer') return null;

  const samples: number[] = [];
  for (const r of results) {
    const v = resolveValue(r.value, field.key);
    if (typeof v === 'number') samples.push(v);
  }
  return inferRangeFromValues(samples);
};

/* ── Cache helpers (used by AnnotationResultsTable) ────────────────────── */

export const getCachedRange = (
  cache: FieldRangeCache | undefined,
  schemaId: number,
  fieldKey: string,
): NumericRange | null | undefined => cache?.[String(schemaId)]?.[fieldKey];

export const writeCachedRange = (
  cache: FieldRangeCache,
  schemaId: number,
  fieldKey: string,
  range: NumericRange | null,
): FieldRangeCache => {
  const key = String(schemaId);
  return {
    ...cache,
    [key]: { ...(cache[key] ?? {}), [fieldKey]: range },
  };
};

/* ── NumberCell ────────────────────────────────────────────────────────── */

interface NumberCellProps {
  value: number;
  range: NumericRange | null;
  density: Density;
}

const formatNumber = (v: number): string => {
  if (Number.isInteger(v)) return v.toLocaleString();
  // Avoid trailing zeros for short fractions while keeping precision for long ones.
  const abs = Math.abs(v);
  if (abs > 0 && abs < 0.01) return v.toExponential(2);
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

const NumberCell: React.FC<NumberCellProps> = ({ value, range, density }) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return <span className="text-muted-foreground/60">—</span>;
  }

  if (!range || !valueFitsRange(range, value)) {
    return <span className="font-mono tabular-nums text-xs">{formatNumber(value)}</span>;
  }

  // Compact: just the number; bars hidden to keep one-line height.
  if (density === 'compact') {
    return <span className="font-mono tabular-nums text-xs">{formatNumber(value)}</span>;
  }

  const fraction = (value - range.min) / (range.max - range.min);
  const clamped = Math.max(0, Math.min(1, fraction));

  // Segmented bar for small integer ranges (≤ 10 buckets).
  const useSegments = range.integer && range.max - range.min + 1 <= 10;

  // Shared number-slot width keeps segmented + continuous bars aligned at the
  // same x across rows — value column reserves a fixed slot, bar starts after.
  // Left-aligned so the digit sits at the start of the value column, matching
  // where strings/lists values begin; tabular-nums keeps digit widths uniform
  // so the bar's start x stays constant across rows regardless.
  const numberSlot = 'font-mono tabular-nums text-xs w-8 text-left';

  if (useSegments) {
    const segments = range.max - range.min + 1;
    const filled = Math.round((value - range.min)); // value is integer; difference is segment count from min
    return (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className={numberSlot}>{value}</span>
        <span className="inline-flex gap-px" aria-hidden>
          {Array.from({ length: segments }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-2 w-1.5 rounded-sm',
                i <= filled ? 'bg-primary/70' : 'bg-muted',
              )}
            />
          ))}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={numberSlot}>{formatNumber(value)}</span>
      <span className="relative inline-block h-2 w-20 bg-muted rounded-sm overflow-hidden" aria-hidden>
        <span
          className="absolute inset-y-0 left-0 bg-primary/70"
          style={{ width: `${clamped * 100}%` }}
        />
      </span>
    </span>
  );
};

export default NumberCell;
