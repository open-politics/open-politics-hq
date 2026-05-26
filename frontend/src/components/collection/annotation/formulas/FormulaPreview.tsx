'use client';

/**
 * FormulaPreview — inline preview pane for a live Formula.
 *
 * Fetches the formula's ``OutputRelation`` via ``/view`` ``formula`` phase
 * and renders the rows as a small table. Replaces the old three-column
 * ``ObserveColumn`` + ``SummarizeColumn`` from FormulaWorkspace — same
 * data, much leaner surface. Calls don't require a saved formula; pass
 * the in-memory body directly.
 *
 * Composable: drop it anywhere a Formula needs to be previewed (the
 * workspace row's expand-on-toggle slot is the canonical use, but a
 * chat message can preview a proposed formula here too).
 */

import React, { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { cn } from '@/lib/utils';
import type { Formula } from '@/client';

export interface FormulaPreviewProps {
  formula: Formula;
  infospaceId: number;
  runId: number;
  /** Max rows to show in the preview table. Backend caps at 5000. */
  limit?: number;
  /** Extra outer class — useful when embedding in a tight slot. */
  className?: string;
}

export function FormulaPreview({
  formula,
  infospaceId,
  runId,
  limit = 50,
  className,
}: FormulaPreviewProps) {
  const { data, isLoading, error } = useAnnotationView({
    infospaceId,
    runId,
    formula: formula as any,
    aggregate: {},
    enabled: !!formula?.id && !!runId,
    debounceMs: 250,
  });

  // The legacy "formula" phase is gone; aggregate-shape results now flow
  // through `data.aggregate`. The renderer reads the same OutputRelation
  // shape (rows + measure_names + output_keys).
  const rel = data?.aggregate;

  if (error) {
    return (
      <div className={cn('text-xs text-destructive font-mono', className)}>
        preview failed: {error.message}
      </div>
    );
  }

  if (isLoading && !rel) {
    return (
      <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
        <Loader2 className="h-3 w-3 animate-spin" /> computing…
      </div>
    );
  }

  if (!rel || rel.rows.length === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground italic', className)}>
        no rows
      </div>
    );
  }

  const keyCols = rel.output_keys.length > 0
    ? rel.output_keys
    : Object.keys(rel.rows[0]?.keys ?? {});
  const measureCols = rel.measure_names ?? [];

  return (
    <div className={cn('text-xs font-mono space-y-1', className)}>
      <div className="text-muted-foreground">
        {rel.total} {rel.total === 1 ? 'row' : 'rows'}
        {rel.has_more && ' (more)'}
        {rel.evidence_mode && ' · evidence mode'}
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="text-muted-foreground">
              {keyCols.map(k => (
                <th key={`k-${k}`} className="text-left px-2 py-1 font-medium border-b">
                  {k}
                </th>
              ))}
              {measureCols.map(m => (
                <th key={`m-${m}`} className="text-left px-2 py-1 font-medium border-b border-l">
                  {m}
                </th>
              ))}
              {rel.evidence_mode && (
                <th className="text-left px-2 py-1 font-medium border-b border-l">snippet</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rel.rows.slice(0, limit).map((row: any, i: number) => (
              <tr key={i} className="hover:bg-accent/30">
                {keyCols.map(k => (
                  <td key={`k-${k}`} className="px-2 py-0.5 border-b border-border/30">
                    {String(row.keys?.[k] ?? '')}
                  </td>
                ))}
                {measureCols.map(m => (
                  <td key={`m-${m}`} className="px-2 py-0.5 border-b border-l border-border/30">
                    {formatMeasure(row.measures?.[m])}
                  </td>
                ))}
                {rel.evidence_mode && (
                  <td className="px-2 py-0.5 border-b border-l border-border/30 max-w-md truncate text-muted-foreground">
                    {row.snippet ?? ''}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatMeasure(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === 'object') {
    // distribution: {label: count}
    const entries = Object.entries(v);
    if (entries.length <= 3) return entries.map(([k, c]) => `${k}:${c}`).join(', ');
    return `{${entries.length}}`;
  }
  return String(v);
}
