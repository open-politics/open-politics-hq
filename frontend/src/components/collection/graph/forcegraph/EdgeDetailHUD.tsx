'use client';

/**
 * EdgeDetailHUD — dossier panel for one (actor, subject) edge.
 *
 * Opens when the user clicks an edge on a graph panel that has a
 * projection with entity-typed roles. Pulls the same dossier as
 * NodeProjectionDossier but filters client-side to rows where
 * ``role_bindings[actorRole] === actorEntityId`` AND
 * ``role_bindings[subjectRole] === subjectEntityId``.
 *
 * Anchored top-right by default to coexist with a possibly-open
 * NodeDetailHUD (anchored center+left). Closeable via ``onClose``.
 */

import React, { useMemo } from 'react';
import { Quote, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNodeRoleSummary } from '@/hooks/useNodeRoleSummary';
import type { PanelProjection, ViewDossierRow } from '@/lib/annotations/types';

export interface EdgeDetailHUDProps {
  infospaceId: number;
  runId: number;
  /** Active panel's projection. Must declare entity-typed actor and subject roles. */
  projection: PanelProjection | null | undefined;
  /** Role names on the projection that play the edge endpoints. */
  actorRole?: string;
  subjectRole?: string;
  /** Edge endpoints — canon entity ids. */
  actorEntityId: number | null;
  subjectEntityId: number | null;
  /** Display labels for the header. */
  actorLabel?: string;
  subjectLabel?: string;
  /** Close handler. */
  onClose?: () => void;
  /** Click handler for an individual dossier row (e.g. open the asset). */
  onRowClick?: (row: ViewDossierRow) => void;
  /** Cite handler — frozen-snapshot to the active case (Phase 2+; no-op for now). */
  onCiteRow?: (row: ViewDossierRow) => void;
  /** Override per-page limit. */
  limit?: number;
}

export const EdgeDetailHUD: React.FC<EdgeDetailHUDProps> = ({
  infospaceId,
  runId,
  projection,
  actorRole = 'actor',
  subjectRole = 'subject',
  actorEntityId,
  subjectEntityId,
  actorLabel,
  subjectLabel,
  onClose,
  onRowClick,
  onCiteRow,
  limit,
}) => {
  // useNodeRoleSummary fetches the full dossier and groups by role; we
  // re-filter on the actor side here to grab only the rows on this edge.
  const { groups, isLoading, totalRows, unresolvedRows } = useNodeRoleSummary({
    infospaceId,
    runId,
    entityId: actorEntityId,
    projection,
    surfaceRoles: [actorRole],
    bucketRoleByRole: { [actorRole]: subjectRole },
    limit: limit ?? 500,
    enabled: !!actorEntityId && !!subjectEntityId,
  });

  const edgeRows: ViewDossierRow[] = useMemo(() => {
    const actorGroup = groups.find(g => g.role === actorRole);
    if (!actorGroup) return [];
    const bucket = actorGroup.buckets.find(b => b.entity_id === subjectEntityId);
    return bucket?.rows ?? [];
  }, [groups, actorRole, subjectEntityId]);

  // Aggregate counts for the header.
  const stats = useMemo(() => {
    const n = edgeRows.length;
    let primarySum = 0, primaryN = 0, confSum = 0, confN = 0;
    const enforcement: Record<string, number> = {};
    const predicateMix: Record<string, number> = {};
    const belastbarkeit: Record<string, number> = {};
    for (const r of edgeRows) {
      const p = Number(r.scalars?.primary);
      if (Number.isFinite(p)) { primarySum += p; primaryN += 1; }
      const c = Number(r.scalars?.confidence);
      if (Number.isFinite(c)) { confSum += c; confN += 1; }
      for (const e of r.edges ?? []) {
        if (e.predicate) predicateMix[e.predicate] = (predicateMix[e.predicate] ?? 0) + 1;
      }
      const enf = r.scalars?.enforcement;
      if (typeof enf === 'string') enforcement[enf] = (enforcement[enf] ?? 0) + 1;
      const bel = r.role_raw?.belastbarkeit ?? r.scalars?.belastbarkeit;
      if (typeof bel === 'string') belastbarkeit[bel] = (belastbarkeit[bel] ?? 0) + 1;
    }
    return {
      n,
      primaryMean: primaryN ? primarySum / primaryN : null,
      confMean: confN ? confSum / confN : null,
      enforcement,
      predicateMix,
      belastbarkeit,
    };
  }, [edgeRows]);

  if (!projection?.roles || !actorEntityId || !subjectEntityId) return null;

  return (
    <div
      className={cn(
        'absolute top-12 right-2 z-30',
        'w-[460px] max-w-[55%] max-h-[calc(100%-12rem)]',
        'rounded-md border bg-background/95 backdrop-blur-sm shadow-md',
        'flex flex-col overflow-hidden',
      )}
      style={{ pointerEvents: 'auto' }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate">
            {actorLabel ?? '(actor)'}{' '}
            <span className="text-muted-foreground">→</span>{' '}
            {subjectLabel ?? '(subject)'}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5 flex items-center gap-2">
            <span>{isLoading ? 'loading…' : `${stats.n} rows`}</span>
            {stats.primaryMean != null && <span>· primary {stats.primaryMean.toFixed(1)}</span>}
            {stats.confMean != null && <span>· conf {stats.confMean.toFixed(2)}</span>}
            {unresolvedRows > 0 && (
              <span className="text-amber-600 dark:text-amber-400">· {unresolvedRows} unresolved</span>
            )}
          </div>
          <PredicateMixRow mix={stats.predicateMix} />
          <CategoricalRow label="durchgesetzt" counts={stats.enforcement} />
          <CategoricalRow label="belastbarkeit" counts={stats.belastbarkeit} />
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6 shrink-0">
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-1">
          {edgeRows.map(row => (
            <EdgeDossierRow
              key={`${row.provenance.annotation_id}-${row.provenance.source_branch}-${row.provenance.branch_ord}`}
              row={row}
              onClick={() => onRowClick?.(row)}
              onCite={onCiteRow ? () => onCiteRow(row) : undefined}
            />
          ))}
          {!isLoading && edgeRows.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic px-2 py-4">
              No projection rows for this edge.
            </div>
          )}
        </div>
      </ScrollArea>
      {totalRows > 0 && (
        <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground tabular-nums">
          {edgeRows.length} of {totalRows} dossier rows shown
        </div>
      )}
    </div>
  );
};

const PredicateMixRow: React.FC<{ mix: Record<string, number> }> = ({ mix }) => {
  const entries = Object.entries(mix);
  if (entries.length === 0) return null;
  return (
    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
      <span className="font-medium">predicate:</span>{' '}
      {entries.map(([k, v]) => (
        <span key={k} className="mr-2">
          {k}: <span className="tabular-nums">{v}</span>
        </span>
      ))}
    </div>
  );
};

const CategoricalRow: React.FC<{ label: string; counts: Record<string, number> }> = ({ label, counts }) => {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return (
    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
      <span className="font-medium">{label}:</span>{' '}
      {entries.map(([k, v]) => (
        <span key={k} className="mr-2">
          {k}: <span className="tabular-nums">{v}</span>
        </span>
      ))}
    </div>
  );
};

const EdgeDossierRow: React.FC<{
  row: ViewDossierRow;
  onClick?: () => void;
  onCite?: () => void;
}> = ({ row, onClick, onCite }) => {
  const verbatim = row.snippet?.verbatim;
  const fallback = row.snippet?.fallback;
  const text = verbatim ?? fallback;
  const primary = row.scalars?.primary;
  const confidence = row.scalars?.confidence;
  const predicate = row.edges?.[0]?.predicate;

  return (
    <div className="rounded border bg-card hover:bg-accent/30 transition-colors">
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="w-full text-left px-2 py-1.5 flex gap-2 items-start"
      >
        <Quote className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {text ? (
            <div className="text-[11px] leading-snug" title={text}>{text}</div>
          ) : (
            <div className="text-[11px] italic text-muted-foreground">
              (no snippet)
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            {predicate && <span className="mr-2">{predicate}</span>}
            {primary != null && <span className="mr-2">primary {String(primary)}</span>}
            {confidence != null && <span className="mr-2">conf {String(confidence)}</span>}
            <span>{row.provenance.source_branch}</span>
          </div>
        </div>
      </button>
      {onCite && (
        <div className="border-t px-2 py-0.5 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCite}
            className="h-5 text-[10px] px-2"
          >
            cite
          </Button>
        </div>
      )}
    </div>
  );
};
