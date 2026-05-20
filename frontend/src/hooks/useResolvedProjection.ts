/**
 * useResolvedProjection — collapse the panel's `formula_id` reference
 * to the actual `PanelProjection`, falling back to the panel's inline
 * projection when no formula is bound.
 *
 * Lets panel hosts read one source of truth without caring whether the
 * projection lives inline (legacy) or in `dashboardConfig.formulas[]`.
 *
 * Renamed from observation→formula in M2 of the intelligence-primitive
 * plan. The legacy `observation_id` key is honoured as a fallback so
 * panels mid-migration still resolve correctly.
 */

import { useMemo } from 'react';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { useShallow } from 'zustand/react/shallow';
import type { PanelConfig, PanelProjection } from '@/lib/annotations/types';

export interface UseResolvedProjectionResult {
  projection: PanelProjection;
  /** When non-null, the projection came from this formula. Useful for
   *  rendering "Bound to: <name>" indicators. */
  formulaName: string | null;
  formulaId: string | null;
  /** @deprecated legacy alias for formulaName, kept so consumers mid-rename still typecheck. */
  observationName: string | null;
  /** @deprecated legacy alias for formulaId. */
  observationId: string | null;
}

const EMPTY_FORMULAS: readonly never[] = [];

export function useResolvedProjection(panel: PanelConfig): UseResolvedProjectionResult {
  const formulas = useAnnotationRunStore(
    useShallow(s => s.dashboardConfig?.formulas ?? EMPTY_FORMULAS),
  );
  return useMemo(() => {
    // Prefer the new `formula_id` key; honour the legacy `observation_id`
    // as a fallback for panels mid-migration. The dashboard migrator
    // rewrites the legacy key on load, so this fallback should rarely fire.
    const fId = (panel as any).formula_id ?? (panel as any).observation_id ?? null;
    if (!fId) {
      return {
        projection: panel.projection,
        formulaName: null,
        formulaId: null,
        observationName: null,
        observationId: null,
      };
    }
    const f = formulas.find(o => o.id === fId);
    if (!f) {
      return {
        projection: panel.projection,
        formulaName: null,
        formulaId: fId,
        observationName: null,
        observationId: fId,
      };
    }
    return {
      projection: f.projection as PanelProjection,
      formulaName: f.name,
      formulaId: f.id,
      observationName: f.name,
      observationId: f.id,
    };
  }, [panel, formulas]);
}
