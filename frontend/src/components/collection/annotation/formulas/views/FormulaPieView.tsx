'use client';

/**
 * FormulaPieView — pie rendering of a Formula's OutputRelation.
 *
 * Mapping: each ``OutputRow`` becomes one slice. ``name`` is the
 * row's first group dim (or ``settings.name_dim`` if set); ``value`` is
 * the first measure (or ``settings.value_measure`` if set). Beyond
 * ``settings.max_slices`` (default 10) extra slices fold into "Other".
 *
 * Eligibility (mirrors ``eligible_panels``): one categorical/entity
 * dim + a numeric measure. The renderer doesn't enforce this — the
 * panel-type picker is responsible — but degrades gracefully when
 * the shape is wrong (empty state with a hint).
 */

import React, { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { OutputRow } from '@/client';

const PIE_COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#A4DE6C', '#D0ED57', '#FFC658', '#FF6B6B',
  '#4BC0C0', '#9966FF', '#FF9F40', '#36A2EB', '#F7786B',
];

export interface FormulaPieViewProps {
  rows: OutputRow[];
  /** Dim names in the relation's output order (first is the default label). */
  outputKeys: string[];
  /** Measure names in the relation's order (first is the default value). */
  measureNames: string[];
  /** Optional render-config (Panel.settings). */
  settings?: {
    name_dim?: string;
    value_measure?: string;
    max_slices?: number;
  };
  className?: string;
}

export function FormulaPieView({
  rows,
  outputKeys,
  measureNames,
  settings,
  className,
}: FormulaPieViewProps) {
  const nameDim = settings?.name_dim ?? outputKeys[0] ?? Object.keys(rows[0]?.keys ?? {})[0];
  const valueMeasure = settings?.value_measure
    ?? measureNames[0]
    ?? Object.keys(rows[0]?.measures ?? {})[0];
  const maxSlices = settings?.max_slices ?? 10;

  const sliceData = useMemo(() => {
    if (!nameDim || !valueMeasure) return [];
    const slices = rows
      .map(r => {
        const name = String((r as any).keys?.[nameDim] ?? '');
        const raw = (r as any).measures?.[valueMeasure];
        const value = typeof raw === 'number'
          ? raw
          : Number(raw);
        return { name, value: Number.isFinite(value) ? value : 0 };
      })
      .filter(s => s.name !== '' && s.value > 0)
      .sort((a, b) => b.value - a.value);

    if (slices.length <= maxSlices) return slices;
    const top = slices.slice(0, maxSlices);
    const other = slices.slice(maxSlices)
      .reduce((acc, s) => acc + s.value, 0);
    if (other > 0) top.push({ name: 'Other', value: other });
    return top;
  }, [rows, nameDim, valueMeasure, maxSlices]);

  if (!nameDim || !valueMeasure) {
    return (
      <div className={`text-xs text-muted-foreground italic p-3 ${className ?? ''}`}>
        Pie needs one group dim and a numeric measure. Configure the formula above.
      </div>
    );
  }

  if (sliceData.length === 0) {
    return (
      <div className={`text-xs text-muted-foreground italic p-3 ${className ?? ''}`}>
        No data to plot.
      </div>
    );
  }

  return (
    <div className={`w-full h-full min-h-0 ${className ?? ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={sliceData}
            cx="50%"
            cy="50%"
            outerRadius="75%"
            dataKey="value"
            nameKey="name"
            labelLine={false}
            isAnimationActive={false}
          >
            {sliceData.map((entry, idx) => (
              <Cell
                key={`cell-${idx}`}
                fill={PIE_COLORS[idx % PIE_COLORS.length]}
              />
            ))}
          </Pie>
          <RechartsTooltip
            formatter={(value: any, name: any) => [String(value), String(name)]}
          />
          <Legend
            verticalAlign="bottom"
            iconSize={8}
            wrapperStyle={{ fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
