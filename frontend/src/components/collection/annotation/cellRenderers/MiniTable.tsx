'use client';

import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import TruncatedText from './TruncatedText';
import { EntityCell, EntityArrayCell, type EntityValue } from './EntityCell';
import { JustificationCell, isJustificationShape } from './JustificationCell';
import type { Density } from './types';
import { getDensitySpec } from './types';

/* ── Preview-column auto-picker ─────────────────────────────────────────── */

/** Item-shape heuristic for picking up to N preview columns from an array of objects.
 *  Structural only — never inspects field names beyond uniqueness/length signals. */
export const pickPreviewColumns = (
  items: any[],
  itemSchemaProps: Record<string, any> | undefined,
  max = 3,
): string[] => {
  if (!items || items.length === 0) return [];

  // Build a coverage + average-length profile for every key seen in the sample.
  const profile = new Map<
    string,
    { count: number; totalLen: number; maxLen: number; declaredType?: string; hasEnum?: boolean; isJustification?: boolean }
  >();
  const sampleSize = Math.min(items.length, 25);
  for (let i = 0; i < sampleSize; i++) {
    const obj = items[i];
    if (!obj || typeof obj !== 'object') continue;
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      const len = typeof v === 'string' ? v.length : String(v).length;
      const entry = profile.get(k) ?? { count: 0, totalLen: 0, maxLen: 0 };
      entry.count += 1;
      entry.totalLen += len;
      if (len > entry.maxLen) entry.maxLen = len;
      const decl = itemSchemaProps?.[k];
      if (decl) {
        entry.declaredType = decl.type;
        if (Array.isArray(decl.enum)) entry.hasEnum = true;
      }
      // Justification objects render as a compact ?-button; they're an
      // affordance, not a content column. Mark them so the preview picker
      // pushes them to the side rather than treating them as primary data.
      if (v && typeof v === 'object' && !Array.isArray(v)
          && 'reasoning' in (v as object) && 'text_spans' in (v as object)) {
        entry.isJustification = true;
      }
      profile.set(k, entry);
    }
  }

  // Score each candidate. Higher = better preview column.
  const scored: { key: string; score: number }[] = [];
  for (const [key, p] of profile.entries()) {
    const coverage = p.count / sampleSize; // 0..1
    const avgLen = p.totalLen / Math.max(p.count, 1);
    const lenPenalty = Math.max(0, avgLen - 60) / 30; // strongly penalise long-text columns

    let score = coverage * 10 - lenPenalty;
    // Boosts for column types that summarise well.
    if (p.declaredType === 'boolean') score += 4;
    if (p.hasEnum) score += 4;
    if (p.declaredType === 'integer' || p.declaredType === 'number') score += 2;
    if (p.declaredType === 'string' && avgLen <= 32) score += 2;
    // Hard penalty for objects/arrays-of-objects in a preview column.
    if (p.declaredType === 'object' || p.declaredType === 'array') score -= 5;
    if (p.maxLen > 200) score -= 6;
    // Justification is an affordance (?-button), not a content column —
    // demote it well below structural fields so it's visible as a sidecar
    // in expanded mode but doesn't claim a preview slot.
    if (p.isJustification) score -= 12;

    scored.push({ key, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.key);
};

/* ── MiniTable ──────────────────────────────────────────────────────────── */

interface MiniTableProps {
  items: any[];
  itemSchemaProps?: Record<string, any>;
  density: Density;
  searchTerm?: string;
  onOpenDetail?: () => void;
}

const MiniTable: React.FC<MiniTableProps> = ({
  items,
  itemSchemaProps,
  density,
  searchTerm,
  onOpenDetail,
}) => {
  const spec = getDensitySpec(density);
  const [showAll, setShowAll] = useState(false);

  const previewKeys = useMemo(
    () => pickPreviewColumns(items, itemSchemaProps, 3),
    [items, itemSchemaProps],
  );

  // All keys present in the items (for "expand columns" mode at the row level).
  const allKeys = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => {
      if (it && typeof it === 'object') Object.keys(it).forEach((k) => set.add(k));
    });
    return Array.from(set);
  }, [items]);

  const visibleKeys = density === 'expanded' ? allKeys : previewKeys;
  const limit = spec.arrayPreviewRows;
  const visibleItems = showAll || items.length <= limit ? items : items.slice(0, limit);
  const hidden = items.length - visibleItems.length;

  if (visibleKeys.length === 0) {
    return (
      <Badge variant="outline" className="text-[10px] font-normal">
        {items.length} item{items.length !== 1 ? 's' : ''}
      </Badge>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="overflow-x-auto rounded border border-border/50 bg-background/40">
        {/* Auto layout + min-w-max keeps the table at its natural content width
            when the parent is narrower; the wrapping `overflow-x-auto` div
            scrolls horizontally rather than squeezing cells. `w-full` lets the
            table stretch to fill wider parents. */}
        <table className="w-full min-w-max text-xs border-collapse">
          <thead>
            <tr className="bg-muted/30">
              {visibleKeys.map((k) => (
                <th
                  key={k}
                  className="px-2 py-1 text-left font-medium text-[10px] text-muted-foreground border-b border-border/50 truncate"
                >
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item, i) => (
              <tr
                key={i}
                className="border-b border-border/30 last:border-0 hover:bg-muted/20 align-top"
              >
                {visibleKeys.map((k) => (
                  <MiniTableCell
                    key={k}
                    value={item?.[k]}
                    fieldDef={itemSchemaProps?.[k]}
                    density={density}
                    searchTerm={searchTerm}
                    onOpenDetail={onOpenDetail}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 py-0.5 text-[10px]"
          onClick={(e) => {
            e.stopPropagation();
            if (onOpenDetail && density !== 'expanded') {
              onOpenDetail();
            } else {
              setShowAll(true);
            }
          }}
        >
          +{hidden} more
        </Button>
      )}
      {showAll && hidden === 0 && items.length > limit && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 py-0.5 text-[10px]"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(false);
          }}
        >
          less
        </Button>
      )}
    </div>
  );
};

/* ── Mini-table cell (terse, density-aware, type-blind by design) ──────── */

const MiniTableCell: React.FC<{
  value: any;
  /** Per-cell JSON-Schema node — lets us detect entity shape at row depth. */
  fieldDef?: any;
  density: Density;
  searchTerm?: string;
  onOpenDetail?: () => void;
}> = ({ value, fieldDef, density, searchTerm, onOpenDetail }) => {
  if (value === null || value === undefined || value === '') {
    return <td className="px-2 py-1 text-muted-foreground/60">—</td>;
  }

  // Justification branch — inline `{reasoning, text_spans}` blocks attached
  // to each array<object> row. Render as an inspectable ?-button so analysts
  // can hover for the snippet preview and click through for full evidence
  // instead of seeing the {2} key-count placeholder.
  if (isJustificationShape(value)) {
    return (
      <td className="px-2 py-1 align-middle">
        <JustificationCell value={value} onSelect={onOpenDetail} />
      </td>
    );
  }

  // Entity branch — keep nested entity refs visually coherent with their
  // top-level vocabulary (e.g. `evidenz_einheiten[*].beguenstigte_firmen`
  // renders the same way as `firmen`). Compact density is forced here since
  // we're inside a mini-table row.
  const isSingleEntity = fieldDef?.['x-entityField'] === true;
  const isArrayEntity = fieldDef?.type === 'array' && fieldDef?.items?.['x-entityField'] === true;
  if (isSingleEntity && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <td className="px-2 py-1">
        <EntityCell value={value as EntityValue} density="compact" searchTerm={searchTerm} />
      </td>
    );
  }
  if (isArrayEntity && Array.isArray(value)) {
    return (
      <td className="px-2 py-1">
        <EntityArrayCell
          values={value as EntityValue[]}
          density="compact"
          searchTerm={searchTerm}
          onSelect={onOpenDetail}
        />
      </td>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <td className="px-2 py-1">
        {value ? (
          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
        ) : (
          <span className="text-muted-foreground">✗</span>
        )}
      </td>
    );
  }

  if (typeof value === 'number') {
    return <td className="px-2 py-1 text-right font-mono tabular-nums">{value}</td>;
  }

  if (Array.isArray(value)) {
    return (
      <td className="px-2 py-1">
        <Badge variant="outline" className="text-[10px] font-normal">
          {value.length} item{value.length !== 1 ? 's' : ''}
        </Badge>
      </td>
    );
  }

  if (typeof value === 'object') {
    return (
      <td className="px-2 py-1">
        <Badge variant="outline" className="text-[10px] font-normal">
          {`{${Object.keys(value).length}}`}
        </Badge>
      </td>
    );
  }

  return (
    <td className="px-2 py-1 max-w-[24ch]">
      <TruncatedText
        text={String(value)}
        density={density}
        searchTerm={searchTerm}
        onOpenDetail={onOpenDetail}
      />
    </td>
  );
};

export default MiniTable;
