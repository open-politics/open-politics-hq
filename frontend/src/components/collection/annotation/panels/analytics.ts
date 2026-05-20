/**
 * Client-side analytics helpers for timeline overlays (rolling avg, linear
 * regression, peak detection, bands). Operates on already-rendered chart
 * data — no backend calls. The math is deliberately simple: these overlays
 * are visual aids, not statistical claims.
 */

export interface PointWithCount {
  timestamp: number;
  count: number;
}

/** Centered rolling average with a configurable window (must be odd ≥ 1). */
export function rollingAverage(
  points: PointWithCount[],
  window: number,
): (number | null)[] {
  if (window < 1) return points.map(() => null);
  const half = Math.floor(window / 2);
  return points.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(points.length - 1, i + half);
    let sum = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      sum += points[j].count;
      n += 1;
    }
    return n > 0 ? sum / n : null;
  });
}

/** Simple OLS linear regression on (index, count). Returns y-values for each index. */
export function trendLine(points: PointWithCount[]): number[] {
  const n = points.length;
  if (n < 2) return points.map((p) => p.count);
  // Use index as x; the chart x-axis is evenly spaced here.
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += points[i].count;
    sumXX += i * i;
    sumXY += i * points[i].count;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  if (denom === 0) return points.map(() => meanY);
  const slope = (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  return points.map((_, i) => intercept + slope * i);
}

/** Detect local maxima / minima with a prominence threshold. */
export function findPeaks(
  points: PointWithCount[],
  kind: 'max' | 'min' = 'max',
  minProminenceRatio: number = 0.1,
): number[] {
  if (points.length < 3) return [];
  const values = points.map((p) => p.count);
  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const range = vmax - vmin || 1;
  const minProminence = range * minProminenceRatio;

  const peaks: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    const next = values[i + 1];
    if (kind === 'max' && cur > prev && cur > next && cur - Math.min(prev, next) >= minProminence) {
      peaks.push(i);
    }
    if (kind === 'min' && cur < prev && cur < next && Math.max(prev, next) - cur >= minProminence) {
      peaks.push(i);
    }
  }
  return peaks;
}

/** Mean, min, max, std-dev across the series. */
export function descriptiveStats(points: PointWithCount[]): {
  mean: number;
  min: number;
  max: number;
  stddev: number;
} {
  if (points.length === 0) return { mean: 0, min: 0, max: 0, stddev: 0 };
  const values = points.map((p) => p.count);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, min, max, stddev: Math.sqrt(variance) };
}
