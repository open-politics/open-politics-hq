'use client';

/**
 * Tight d3-driven distribution primitives for the Formula workspace.
 *
 * All four shapes share one design:
 *   - inline SVG, no card chrome, no padding inheritance
 *   - the bar is the data — labels are tabular-nums, the bar is sized to it
 *   - hover surfaces exact counts via title attribute (no tooltip lib)
 *   - fixed widths so columns of distributions line up vertically
 *
 * Components:
 *   - <RankedBars>     ranked entity/predicate breakdown (top-N)
 *   - <Histogram>      numeric histogram (1-10 buckets, fixed scale)
 *   - <Sparkline>      time-binned counts (rows/month or rows/quarter)
 *   - <CategoricalMix> proportional fill (for confidence enums, enforcement)
 */
import React, { useMemo } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';

const BAR_W = 180;
const ROW_H = 14;

// ─── RankedBars ────────────────────────────────────────────────────────────

export interface RankedBarsProps {
  data: Array<{ key: string; count: number; primary?: number | null; conf?: number | null }>;
  topN?: number;
  className?: string;
  onRowClick?: (key: string) => void;
}

export const RankedBars: React.FC<RankedBarsProps> = ({ data, topN = 8, className, onRowClick }) => {
  const top = useMemo(() => [...data].sort((a, b) => b.count - a.count).slice(0, topN), [data, topN]);
  const max = useMemo(() => Math.max(1, ...top.map(d => d.count)), [top]);
  if (top.length === 0) {
    return <div className="text-[10px] italic text-muted-foreground">no data</div>;
  }
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {top.map(d => {
        const pct = (d.count / max) * 100;
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onRowClick?.(d.key)}
            disabled={!onRowClick}
            className={cn(
              'group flex items-center gap-2 text-[11px] tabular-nums',
              onRowClick && 'hover:text-foreground cursor-pointer',
              !onRowClick && 'cursor-default',
            )}
            title={`${d.key} · ${d.count} rows${d.primary != null ? ` · prim ${d.primary.toFixed(1)}` : ''}${d.conf != null ? ` · conf ${d.conf.toFixed(2)}` : ''}`}
          >
            <span className="w-32 truncate text-left text-foreground/80 group-hover:text-foreground">{d.key}</span>
            <div className="relative bg-muted/40" style={{ width: BAR_W, height: ROW_H }}>
              <div
                className="absolute inset-y-0 left-0 bg-foreground/70 group-hover:bg-foreground"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-8 text-right text-muted-foreground">{d.count}</span>
            {d.primary != null && <span className="w-8 text-right text-muted-foreground">{d.primary.toFixed(1)}</span>}
            {d.conf != null && <span className="w-9 text-right text-muted-foreground">c{d.conf.toFixed(2)}</span>}
          </button>
        );
      })}
    </div>
  );
};

// ─── Histogram ──────────────────────────────────────────────────────────────

export interface HistogramProps {
  values: number[];
  min?: number;
  max?: number;
  buckets?: number;
  className?: string;
}

export const Histogram: React.FC<HistogramProps> = ({
  values,
  min = 1,
  max = 10,
  buckets = 5,
  className,
}) => {
  const bins = useMemo(() => {
    const step = (max - min) / buckets;
    const out = Array.from({ length: buckets }, (_, i) => ({
      lo: min + i * step,
      hi: min + (i + 1) * step,
      count: 0,
    }));
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((v - min) / step)));
      out[idx].count += 1;
    }
    return out;
  }, [values, min, max, buckets]);
  const maxCount = Math.max(1, ...bins.map(b => b.count));
  if (values.length === 0) {
    return <div className="text-[10px] italic text-muted-foreground">no data</div>;
  }
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {bins.map((b, i) => {
        const pct = (b.count / maxCount) * 100;
        return (
          <div key={i} className="flex items-center gap-2 text-[11px] tabular-nums">
            <span className="w-12 text-right text-muted-foreground">
              {b.lo.toFixed(0)}–{b.hi.toFixed(0)}
            </span>
            <div className="relative bg-muted/40 flex-1" style={{ height: ROW_H }} title={`${b.count} rows`}>
              <div className="absolute inset-y-0 left-0 bg-foreground/70" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-8 text-right text-muted-foreground">{b.count}</span>
          </div>
        );
      })}
    </div>
  );
};

// ─── Sparkline ──────────────────────────────────────────────────────────────

export interface SparklineProps {
  /** ISO date strings — one per row. */
  dates: (string | null | undefined)[];
  binBy?: 'month' | 'quarter' | 'year';
  className?: string;
  height?: number;
  width?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({
  dates,
  binBy = 'month',
  className,
  height = 28,
  width = 240,
}) => {
  const bins = useMemo(() => {
    const counts = new Map<string, { date: Date; count: number }>();
    for (const d of dates) {
      if (!d) continue;
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) continue;
      let key: string;
      let bucketStart: Date;
      if (binBy === 'year') {
        key = `${dt.getUTCFullYear()}`;
        bucketStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      } else if (binBy === 'quarter') {
        const q = Math.floor(dt.getUTCMonth() / 3);
        key = `${dt.getUTCFullYear()}-Q${q + 1}`;
        bucketStart = new Date(Date.UTC(dt.getUTCFullYear(), q * 3, 1));
      } else {
        key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
        bucketStart = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
      }
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { date: bucketStart, count: 1 });
    }
    return Array.from(counts.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [dates, binBy]);

  if (bins.length === 0) {
    return <div className="text-[10px] italic text-muted-foreground">no dated rows</div>;
  }

  const maxCount = Math.max(1, ...bins.map(b => b.count));
  const x = d3.scaleLinear().domain([0, Math.max(1, bins.length - 1)]).range([0, width]);
  const y = d3.scaleLinear().domain([0, maxCount]).range([height, 0]);
  const line = d3.line<{ date: Date; count: number }>()
    .x((_, i) => x(i))
    .y(d => y(d.count))
    .curve(d3.curveMonotoneX);
  const area = d3.area<{ date: Date; count: number }>()
    .x((_, i) => x(i))
    .y0(height)
    .y1(d => y(d.count))
    .curve(d3.curveMonotoneX);

  return (
    <div className={cn('flex flex-col', className)}>
      <svg width={width} height={height} className="overflow-visible">
        <path d={area(bins) ?? undefined} fill="currentColor" fillOpacity={0.15} />
        <path d={line(bins) ?? undefined} fill="none" stroke="currentColor" strokeWidth={1} strokeOpacity={0.85} />
      </svg>
      <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums mt-0.5">
        <span>{labelForBin(bins[0]?.date, binBy)}</span>
        <span>{labelForBin(bins[bins.length - 1]?.date, binBy)}</span>
      </div>
    </div>
  );
};

function labelForBin(d: Date | undefined, binBy: 'month' | 'quarter' | 'year'): string {
  if (!d) return '';
  if (binBy === 'year') return `${d.getUTCFullYear()}`;
  if (binBy === 'quarter') return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ─── CategoricalMix ─────────────────────────────────────────────────────────

export interface CategoricalMixProps {
  data: Array<{ key: string; count: number }>;
  className?: string;
  showCounts?: boolean;
}

export const CategoricalMix: React.FC<CategoricalMixProps> = ({ data, className, showCounts = true }) => {
  const total = useMemo(() => data.reduce((s, d) => s + d.count, 0), [data]);
  if (total === 0) {
    return <div className="text-[10px] italic text-muted-foreground">no data</div>;
  }
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {data.map(d => {
        const pct = (d.count / total) * 100;
        return (
          <div
            key={d.key}
            className="flex items-center gap-2 text-[11px] tabular-nums"
            title={`${d.key}: ${d.count} (${pct.toFixed(0)}%)`}
          >
            <span className="w-24 truncate text-foreground/80">{d.key}</span>
            <div className="relative bg-muted/40 flex-1" style={{ height: ROW_H }}>
              <div className="absolute inset-y-0 left-0 bg-foreground/70" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-9 text-right text-muted-foreground">{pct.toFixed(0)}%</span>
            {showCounts && <span className="w-8 text-right text-muted-foreground">{d.count}</span>}
          </div>
        );
      })}
    </div>
  );
};
