'use client';

/**
 * ObservationCard — frozen-snapshot surface for an Observation.
 *
 * Deliberately separate from FormulaMathLine / FormulaRow so the
 * live-vs-frozen distinction reads at a glance:
 *
 *  - A FormulaRow shows a *live* program (math line, click-to-edit, prompt
 *    history, will recompute when the corpus changes).
 *  - An ObservationCard shows a *frozen* result (formula body inlined,
 *    computed-at timestamp visible, no edit affordances — only ``view rows /
 *    cite / push to panel / delete``).
 *
 * Compose anywhere: the dashboard's observation list, beside the dossier
 * notes, in a chat reply, or as the body of a Panel bound to an
 * ``observation_id`` (the renderer would short-circuit live fetch and
 * show the frozen ``output_blob`` instead).
 */

import React from 'react';
import { Snowflake, Quote, Trash2, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FormulaMathLine } from './FormulaMathLine';
import type { Formula } from '@/client';

/** Wire-shape of an Observation as persisted on
 *  ``DashboardConfig.observations[]``. The full backend Pydantic model
 *  lives in ``backend/app/api/modules/annotation/snapshots.py`` —
 *  duplicated minimally here so we don't need an extra import. */
export interface Observation {
  id: string;
  formula_inline: Formula;
  formula_name: string;
  computed_at: string;
  output_blob: any[];
  output_keys: string[];
  run_id: number;
  schema_id_snapshot?: number | null;
  notes?: string | null;
}

export interface ObservationCardProps {
  observation: Observation;
  /** Open the rows preview drawer / panel side-pane. Caller decides where
   *  the rows land. */
  onViewRows?: () => void;
  /** Append a ``@cite[<obs_id>, key:(...)]`` marker to the dossier notes
   *  in the run's main edit surface. */
  onCite?: () => void;
  /** Bind a panel to this frozen snapshot (panel reads ``output_blob``
   *  instead of refetching). */
  onPushToPanel?: () => void;
  /** Remove the snapshot from the run's dashboard. */
  onDelete?: () => void;
  /** Extra class for the outer container — keep card sizing flexible. */
  className?: string;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function ObservationCard({
  observation,
  onViewRows,
  onCite,
  onPushToPanel,
  onDelete,
  className,
}: ObservationCardProps) {
  const rowCount = observation.output_blob?.length ?? 0;

  return (
    <div
      className={cn(
        // Frozen visual: slightly chillier background, faint frost badge,
        // muted border so it never competes with a live FormulaRow next to it.
        'rounded border border-sky-200 dark:border-sky-900/40',
        'bg-sky-50/40 dark:bg-sky-950/20',
        'px-3 py-2 space-y-1.5',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300">
        <Snowflake className="h-3 w-3" />
        <span className="font-medium">frozen</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{formatTime(observation.computed_at)}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{rowCount} {rowCount === 1 ? 'row' : 'rows'}</span>
      </div>

      <FormulaMathLine formula={observation.formula_inline} editable={false} />

      {observation.notes && (
        <div className="text-xs text-muted-foreground italic border-l-2 border-sky-300 dark:border-sky-700 pl-2">
          {observation.notes}
        </div>
      )}

      <div className="flex items-center gap-1 pt-1">
        {onViewRows && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onViewRows}>
            <FileText className="h-3 w-3 mr-1" /> view rows
          </Button>
        )}
        {onCite && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onCite}>
            <Quote className="h-3 w-3 mr-1" /> cite
          </Button>
        )}
        {onPushToPanel && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onPushToPanel}>
            <ArrowRight className="h-3 w-3 mr-1" /> push to panel
          </Button>
        )}
        <div className="flex-1" />
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete snapshot"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
