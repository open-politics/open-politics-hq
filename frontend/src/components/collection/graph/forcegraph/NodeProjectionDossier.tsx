'use client';

/**
 * NodeProjectionDossier — role-grouped projection summary for the focused node.
 *
 * Sibling to NodeDetailHUD. When the active graph panel has a projection
 * with entity-typed roles, this rail shows "AS ACTOR — N obs across M
 * entities" sections per role, with ranked buckets and per-row dossier
 * preview on expansion.
 *
 * Mounts as an additional overlay on the graph canvas (not inside
 * NodeDetailHUD) so the existing HUD layout stays untouched. Rendered
 * conditionally — present iff the active panel's projection declares at
 * least one entity-typed role AND a node is focused.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNodeRoleSummary, type RoleBucket, type RoleGroup } from '@/hooks/useNodeRoleSummary';
import type { PanelProjection, ViewDossierRow } from '@/lib/annotations/types';

export interface NodeProjectionDossierProps {
  infospaceId: number;
  runId: number;
  /** Canon entity id of the focused node. Null → render nothing. */
  entityId: number | null;
  /** Display name of the focused node, used in the rail header. */
  entityLabel?: string;
  /** Active panel's projection. Null → render nothing. */
  projection: PanelProjection | null | undefined;
  /** Callback when the user clicks a bucket — typically push as a scope to
   *  peer panels (cooccurs filter narrowing the dashboard to this pair). */
  onBucketClick?: (group: RoleGroup, bucket: RoleBucket) => void;
  /** Callback when the user clicks a single dossier row — typically open
   *  the source asset / focus the underlying annotation. */
  onRowClick?: (row: ViewDossierRow) => void;
  /** When true, render `<unresolved>` rows (sentinel id -1) instead of dropping. */
  allowUnresolved?: boolean;
  /** Override the row limit. Default 500 — enough for one node at run scale. */
  limit?: number;
}

export const NodeProjectionDossier: React.FC<NodeProjectionDossierProps> = ({
  infospaceId,
  runId,
  entityId,
  entityLabel,
  projection,
  onBucketClick,
  onRowClick,
  allowUnresolved,
  limit,
}) => {
  const { groups, unresolvedRows, isLoading, totalRows } = useNodeRoleSummary({
    infospaceId,
    runId,
    entityId,
    projection,
    allowUnresolved,
    limit,
    enabled: !!entityId,
  });

  if (!entityId || !projection?.roles) return null;
  if (!isLoading && groups.length === 0) return null;

  return (
    <div
      className={cn(
        'absolute top-12 left-1/2 -translate-x-1/2 mt-12 z-30',
        'w-[420px] max-w-[80%] max-h-[calc(100%-12rem)]',
        'rounded-md border bg-background/95 backdrop-blur-sm shadow-sm',
        'flex flex-col overflow-hidden',
      )}
      style={{ pointerEvents: 'auto' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="text-xs font-medium tabular-nums">
          Projection dossier
          {entityLabel && (
            <span className="ml-1 text-muted-foreground">· {entityLabel}</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {isLoading ? 'loading…' : `${totalRows} rows`}
          {unresolvedRows > 0 && (
            <span className="ml-1 text-amber-600 dark:text-amber-400" title="Rows whose roles didn't canon-resolve">
              · {unresolvedRows} unresolved
            </span>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-3">
          {groups.map(group => (
            <RoleGroupSection
              key={group.role}
              group={group}
              onBucketClick={onBucketClick}
              onRowClick={onRowClick}
            />
          ))}
          {!isLoading && groups.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic px-2 py-4">
              No projection rows for this node under the current panel projection.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// ─── Role group section ─────────────────────────────────────────────────────

const RoleGroupSection: React.FC<{
  group: RoleGroup;
  onBucketClick?: (group: RoleGroup, bucket: RoleBucket) => void;
  onRowClick?: (row: ViewDossierRow) => void;
}> = ({ group, onBucketClick, onRowClick }) => {
  const [collapsed, setCollapsed] = useState(false);
  const distinctEntities = group.buckets.length;
  const Icon = collapsed ? ChevronRight : ChevronDown;
  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1 px-1 py-0.5 rounded hover:bg-muted text-left"
      >
        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          AS {group.role}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums ml-1">
          {group.total} obs · {distinctEntities} {distinctEntities === 1 ? 'entity' : 'entities'}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-1 mt-1">
          {group.buckets.map(bucket => (
            <BucketRow
              key={bucket.entity_id}
              group={group}
              bucket={bucket}
              onBucketClick={onBucketClick}
              onRowClick={onRowClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── One bucket row ─────────────────────────────────────────────────────────

const BucketRow: React.FC<{
  group: RoleGroup;
  bucket: RoleBucket;
  onBucketClick?: (group: RoleGroup, bucket: RoleBucket) => void;
  onRowClick?: (row: ViewDossierRow) => void;
}> = ({ group, bucket, onBucketClick, onRowClick }) => {
  const [expanded, setExpanded] = useState(false);
  const primary = bucket.primary_mean != null ? bucket.primary_mean.toFixed(1) : null;
  const conf = bucket.confidence_mean != null ? bucket.confidence_mean.toFixed(2) : null;
  const isUnresolved = bucket.entity_id === -1;

  // Bar visualisation of primary mean (assumes 1..10 scale).
  const barPct = bucket.primary_mean != null
    ? Math.max(0, Math.min(100, (bucket.primary_mean / 10) * 100))
    : 0;

  return (
    <div className={cn('rounded border', expanded ? 'bg-muted/40' : 'bg-transparent')}>
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label={expanded ? 'Collapse rows' : 'Expand rows'}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => onBucketClick?.(group, bucket)}
          className={cn(
            'flex-1 text-left text-xs truncate hover:underline',
            isUnresolved && 'italic text-amber-600 dark:text-amber-400',
          )}
          title={onBucketClick ? 'Push as scope to peer panels' : undefined}
        >
          {bucket.label}
        </button>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          × {bucket.count}
        </span>
        <div className="w-12 h-1 rounded bg-muted overflow-hidden shrink-0" title={primary ? `mean primary ${primary}` : 'no primary scalar'}>
          {primary != null && (
            <div
              className="h-full bg-primary/70"
              style={{ width: `${barPct}%` }}
            />
          )}
        </div>
        {primary != null && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-8 text-right">
            {primary}
          </span>
        )}
        {conf != null && (
          <span
            className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-9 text-right"
            title="confidence (enum_weights mean)"
          >
            c{conf}
          </span>
        )}
      </div>
      {expanded && (
        <div className="px-2 pb-2 space-y-1 border-t pt-1">
          {Object.entries(bucket.categorical).map(([scalarName, counts]) => (
            <div key={scalarName} className="text-[10px] text-muted-foreground">
              <span className="font-medium">{scalarName}:</span>{' '}
              {Object.entries(counts).map(([k, v]) => (
                <span key={k} className="mr-2">
                  {k}: <span className="tabular-nums">{v}</span>
                </span>
              ))}
            </div>
          ))}
          {bucket.rows.slice(0, 5).map(row => (
            <DossierRowPreview
              key={`${row.provenance.annotation_id}-${row.provenance.source_branch}-${row.provenance.branch_ord}`}
              row={row}
              onClick={() => onRowClick?.(row)}
            />
          ))}
          {bucket.rows.length > 5 && (
            <div className="text-[10px] text-muted-foreground px-1">
              +{bucket.rows.length - 5} more
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Dossier row preview ───────────────────────────────────────────────────

const DossierRowPreview: React.FC<{
  row: ViewDossierRow;
  onClick?: () => void;
}> = ({ row, onClick }) => {
  const verbatim = row.snippet?.verbatim;
  const fallback = row.snippet?.fallback;
  const text = verbatim ?? fallback ?? null;
  const primary = row.scalars?.primary;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'w-full text-left px-1.5 py-1 rounded text-[11px] flex gap-1.5',
        'border border-transparent',
        onClick && 'hover:bg-background hover:border-muted',
      )}
    >
      <Quote className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {text ? (
          <div className="truncate" title={text}>
            {text}
          </div>
        ) : (
          <div className="italic text-muted-foreground">
            (no snippet)
          </div>
        )}
        <div className="text-[9px] text-muted-foreground mt-0.5 tabular-nums">
          {row.provenance.source_branch}
          {primary != null && (
            <span className="ml-1">· primary {String(primary)}</span>
          )}
        </div>
      </div>
    </button>
  );
};
