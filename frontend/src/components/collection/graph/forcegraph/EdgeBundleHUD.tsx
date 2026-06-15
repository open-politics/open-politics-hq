'use client';

/**
 * EdgeBundleHUD — the inspector for one bundled connection.
 *
 * Opens on a click of a bundled edge (every relationship between a node
 * pair collapsed into one canvas link). It unrolls that bundle:
 *
 *   - a per-predicate breakdown, sorted strongest-first, where each row is
 *     a *filter toggle* (click to scope the evidence + canvas highlight to
 *     that relationship type),
 *   - the evidence (triplet descriptions) behind the active selection,
 *   - the source documents the pair was extracted from,
 *   - a "focus subgraph" lens and the cross-panel "scope to A ↔ B" gesture.
 *
 * Purely presentational — the panel computes every list and owns the
 * predicate-filter state; this component renders and dispatches.
 */

import React from 'react';
import { X, ArrowRight, ArrowLeftRight, Quote, FileText, Target, Focus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resolveEntityColor, resolvePredicateColor, type ColorOverrides } from '@/lib/annotations/colors';

export interface EdgeBundlePredicateRow {
  predicate: string;
  count: number;
  weight: number;
}

export interface EdgeBundleEvidenceItem {
  predicate: string;
  reasoning: string;
  confidence?: number;
  assetId: number;
  /** ``forward`` = source→target (sentence reads sourceLabel → targetLabel). */
  direction: 'forward' | 'backward';
}

export interface EdgeBundleDocChip {
  assetId: number;
  title?: string;
  count: number;
}

export interface EdgeBundleHUDProps {
  sourceLabel: string;
  targetLabel: string;
  sourceType?: string;
  targetType?: string;
  directionMix: 'forward' | 'backward' | 'both';
  totalWeight: number;
  memberCount: number;
  predicateRows: EdgeBundlePredicateRow[];
  evidence: EdgeBundleEvidenceItem[];
  documents: EdgeBundleDocChip[];
  colorOverrides?: ColorOverrides;
  /** Active predicate filter. Empty ⇒ all predicates shown. */
  activePredicates: Set<string>;
  onTogglePredicate: (predicate: string) => void;
  onClearPredicateFilter: () => void;
  onClose: () => void;
  onAssetClick?: (assetId: number) => void;
  onFocusSubgraph?: () => void;
  isSubgraphFocused?: boolean;
  onScopeDashboard?: () => void;
  canScopeDashboard?: boolean;
  scopeHint?: string;
}

const fmtWeight = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

export const EdgeBundleHUD: React.FC<EdgeBundleHUDProps> = ({
  sourceLabel,
  targetLabel,
  sourceType,
  targetType,
  directionMix,
  totalWeight,
  memberCount,
  predicateRows,
  evidence,
  documents,
  colorOverrides,
  activePredicates,
  onTogglePredicate,
  onClearPredicateFilter,
  onClose,
  onAssetClick,
  onFocusSubgraph,
  isSubgraphFocused = false,
  onScopeDashboard,
  canScopeDashboard = false,
  scopeHint,
}) => {
  const filterActive = activePredicates.size > 0;
  const visibleEvidence = filterActive
    ? evidence.filter(e => activePredicates.has(e.predicate))
    : evidence;

  const DirIcon = directionMix === 'both' ? ArrowLeftRight : ArrowRight;
  const srcColor = resolveEntityColor(sourceType ?? '', colorOverrides);
  const tgtColor = resolveEntityColor(targetType ?? '', colorOverrides);

  return (
    <div
      className={cn(
        'absolute top-2 right-12 z-30',
        'w-[340px] max-w-[44%] max-h-[calc(100%-1.5rem)]',
        'rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg',
        'flex flex-col overflow-hidden',
      )}
      style={{ pointerEvents: 'auto' }}
    >
      {/* Header — the pair + aggregate counts */}
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium min-w-0">
            <span className="inline-flex items-center gap-1 min-w-0">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: srcColor }} />
              <span className="truncate" title={sourceLabel}>{sourceLabel}</span>
            </span>
            <DirIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="inline-flex items-center gap-1 min-w-0">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: tgtColor }} />
              <span className="truncate" title={targetLabel}>{targetLabel}</span>
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
            {memberCount} relationship{memberCount === 1 ? '' : 's'} · weight {fmtWeight(totalWeight)}
            {documents.length > 0 && <> · {documents.length} document{documents.length === 1 ? '' : 's'}</>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onFocusSubgraph && (
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-6 w-6', isSubgraphFocused && 'text-amber-600 dark:text-amber-400')}
              onClick={onFocusSubgraph}
              title={isSubgraphFocused ? 'Subgraph focused — click to clear' : 'Focus this pair on the canvas'}
            >
              <Focus className="h-3 w-3" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* Predicate breakdown — each row a filter toggle */}
        <div className="px-2 py-2 border-b">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Connection types
            </span>
            {filterActive && (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                onClick={onClearPredicateFilter}
              >
                show all
              </button>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {predicateRows.map(({ predicate, count, weight }) => {
              const active = activePredicates.has(predicate);
              const dimmed = filterActive && !active;
              const pColor = resolvePredicateColor(predicate, colorOverrides);
              return (
                <button
                  key={predicate}
                  type="button"
                  onClick={() => onTogglePredicate(predicate)}
                  className={cn(
                    'flex items-center gap-2 px-1.5 py-1 rounded text-[11px] text-left transition-colors',
                    'hover:bg-accent/50',
                    active && 'bg-accent',
                    dimmed && 'opacity-40',
                  )}
                  title={active ? `Stop filtering by "${predicate}"` : `Filter to "${predicate}"`}
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: pColor }} />
                  <span className="flex-1 truncate font-medium">{predicate}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {count === weight ? count : `${count}· w${fmtWeight(weight)}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Evidence — triplet descriptions behind the active selection */}
        <div className="px-2 py-2 border-b">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">
            Evidence{filterActive ? ` (${visibleEvidence.length})` : ''}
          </div>
          {visibleEvidence.length === 0 ? (
            <div className="text-[11px] italic text-muted-foreground px-1 py-2">
              No evidence text on these triplets.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {visibleEvidence.map((e, i) => (
                <button
                  key={`${e.assetId}-${e.predicate}-${i}`}
                  type="button"
                  onClick={() => onAssetClick?.(e.assetId)}
                  disabled={!onAssetClick}
                  className="rounded border bg-card hover:bg-accent/30 transition-colors text-left px-2 py-1.5 flex gap-2 items-start"
                >
                  <Quote className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] leading-snug">{e.reasoning}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums flex items-center gap-1.5">
                      <span className="truncate">{e.predicate}</span>
                      {e.direction === 'backward' && <span title="reverse direction">←</span>}
                      {e.confidence != null && <span>· conf {e.confidence}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Source documents */}
        {documents.length > 0 && (
          <div className="px-2 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">
              Appears in documents
            </div>
            <div className="flex flex-wrap gap-1">
              {documents.map(d => (
                <button
                  key={d.assetId}
                  type="button"
                  onClick={() => onAssetClick?.(d.assetId)}
                  disabled={!onAssetClick}
                  className="inline-flex items-center gap-1 max-w-full px-1.5 py-0.5 rounded border bg-muted/50 hover:bg-muted text-[10px] transition-colors"
                  title={d.title ?? `Asset #${d.assetId}`}
                >
                  <FileText className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                  <span className="truncate max-w-[140px]">{d.title ?? `#${d.assetId}`}</span>
                  {d.count > 1 && <span className="text-muted-foreground tabular-nums">{d.count}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Cross-panel scope gesture */}
      {onScopeDashboard && (
        <div className="px-2 py-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs gap-1.5"
            onClick={onScopeDashboard}
            disabled={!canScopeDashboard}
            title={scopeHint}
          >
            <Target className="h-3 w-3" />
            Scope dashboard to {sourceLabel} ↔ {targetLabel}
          </Button>
        </div>
      )}
    </div>
  );
};
