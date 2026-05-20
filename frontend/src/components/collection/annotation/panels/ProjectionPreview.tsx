'use client';

/**
 * ProjectionPreview — live row-count + sample-rows preview while authoring
 * a panel projection.
 *
 * Mounts inside the panel-config editor below the RolePicker. POSTs the
 * in-flight projection to ``/view`` with a small ``dossier`` page,
 * debounced. Renders:
 *   - Total row count + unresolved count from the canon-resolution gate.
 *   - First few sample rows (role bindings + scalars + snippet preview).
 *
 * Helps the analyst see the projection landing immediately as they bind
 * paths — no need to save and re-render the whole panel.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import type { PanelProjection } from '@/lib/annotations/types';
import type { DossierConfig } from '@/client';

export interface ProjectionPreviewProps {
  infospaceId: number;
  runId: number;
  /** The in-flight panel projection. Null/incomplete → render nothing. */
  projection: PanelProjection | null | undefined;
  /** Sample size for the preview. Default 5. */
  sampleSize?: number;
  /** Compact mode — minimal vertical chrome for inline use. */
  compact?: boolean;
}

function projectionIsRunnable(p: PanelProjection | null | undefined): boolean {
  if (!p?.roles) return false;
  // At least one role with at least one path bound.
  return Object.values(p.roles).some(rb => (rb.paths?.length ?? 0) > 0);
}

export const ProjectionPreview: React.FC<ProjectionPreviewProps> = ({
  infospaceId,
  runId,
  projection,
  sampleSize = 5,
  compact = false,
}) => {
  const dossier: DossierConfig | undefined = projectionIsRunnable(projection)
    ? {
        projection: {
          field_mappings: projection!.field_mappings ?? {},
          explosion: projection!.explosion ?? null,
          roles: projection!.roles ?? {},
          scalars: projection!.scalars ?? {},
          snippet: projection!.snippet ?? null,
          edges: projection!.edges ?? [],
          joint_roles: projection!.joint_roles ?? [],
        } as DossierConfig['projection'],
        limit: sampleSize,
        // Surface unresolved rows so the analyst sees canon-coverage gaps.
        allow_unresolved: true,
      }
    : undefined;

  const { data, isLoading, error } = useAnnotationView({
    infospaceId,
    runId,
    dossier,
    enabled: !!dossier,
  });

  if (!projection) return null;
  if (!projectionIsRunnable(projection)) {
    return (
      <div className="text-[11px] text-muted-foreground italic px-2 py-1.5">
        Bind at least one role to a path to see a projection preview.
      </div>
    );
  }

  return (
    <div className={cn('rounded border bg-muted/40', compact ? 'p-1.5' : 'p-2')}>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="font-medium">Projection preview</span>
        <span className="text-muted-foreground tabular-nums flex items-center gap-1">
          {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          {error ? (
            <span className="text-destructive">error</span>
          ) : data?.dossier ? (
            <>
              <span>{data.dossier.items.length} sample{data.dossier.items.length === 1 ? '' : 's'}</span>
              {data.dossier.unresolved_rows > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  · {data.dossier.unresolved_rows} unresolved
                </span>
              )}
            </>
          ) : null}
        </span>
      </div>
      {data?.dossier?.items?.length ? (
        <ul className="text-[10px] space-y-0.5 font-mono leading-relaxed">
          {data.dossier.items.slice(0, sampleSize).map((row, idx) => (
            <li key={idx} className="truncate">
              <span className="text-muted-foreground">
                #{row.provenance.annotation_id}/{row.provenance.source_branch}/{row.provenance.branch_ord}
              </span>{' '}
              {Object.entries(row.role_names).map(([role, name]) => (
                <span key={role} className="mr-1">
                  <span className="text-muted-foreground">{role}=</span>
                  <span className={cn(name === '<unresolved>' && 'italic text-amber-600 dark:text-amber-400')}>
                    {name}
                  </span>
                </span>
              ))}
              {Object.entries(row.scalars ?? {}).slice(0, 2).map(([k, v]) => (
                <span key={k} className="mr-1 text-muted-foreground">
                  {k}={String(v)}
                </span>
              ))}
            </li>
          ))}
        </ul>
      ) : data?.dossier ? (
        <div className="text-[11px] italic text-muted-foreground">
          Projection produced no rows.
        </div>
      ) : null}
      {error && (
        <div className="text-[11px] text-destructive mt-1">
          {error.message}
        </div>
      )}
    </div>
  );
};
