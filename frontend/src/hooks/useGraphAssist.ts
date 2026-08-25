'use client';

/**
 * useGraphAssist — natural language into the query bar's draft.
 *
 * Two properties, and both are about what the model is *not* allowed to do.
 *
 * **It proposes into the draft.** The existing MCP path called
 * `setGraphQuery` — the applied value — so the model committed on the
 * analyst's behalf and the panel changed under them. A query that ran itself
 * is a finding nobody chose to look for. Everything here returns a string for
 * the bar to hold until a person presses Enter.
 *
 * **It is re-parsed before it is shown.** GQL never raises: an unrecognised
 * token degrades to a free-text substring match on node names. That is the
 * right behaviour for a half-typed human and a dangerous one for a model,
 * because a hallucinated `sector:finance` comes back with a plausible handful
 * of nodes and no indication anything went wrong. Validation turns that into
 * an amber pill, which keeps both readings.
 *
 * **Through the generated client, never raw `fetch`.** These routes answer an
 * unauthenticated caller with **404**, not 401 — so a bare `fetch` missing the
 * auth header is indistinguishable from a missing endpoint, which is a
 * debugging session nobody should have to have. `RunsService` carries the
 * credential chain and the package-token header with it.
 */
import { useCallback, useEffect, useState } from 'react';
import { RunsService } from '@/client';
import type { QueryWarning } from '@/components/collection/graph/panes';

interface GraphContext {
  grammar: string;
  declared: Record<string, any>;
  instantiated: Record<string, any>;
}

export function useGraphAssist(infospaceId?: number | null, runId?: number | null) {
  const [context, setContext] = useState<GraphContext | null>(null);
  const [warnings, setWarnings] = useState<QueryWarning[]>([]);

  // Fetched once per run. Tier A is identical everywhere and tier B is derived
  // from declarations, so nothing here changes while a panel is open.
  useEffect(() => {
    if (!infospaceId || !runId) return;
    let cancelled = false;
    RunsService.graphContext({ infospaceId, runId })
      .then(d => { if (!cancelled && d) setContext(d as unknown as GraphContext); })
      .catch(() => { /* the bar works without it; it just teaches less */ });
    return () => { cancelled = true; };
  }, [infospaceId, runId]);

  /** Re-parse a query against this run and report what it cannot answer. */
  const validate = useCallback(async (q: string): Promise<QueryWarning[]> => {
    if (!infospaceId || !runId || !q.trim()) { setWarnings([]); return []; }
    try {
      const data: any = await RunsService.graphValidate({
        infospaceId, runId, requestBody: { q },
      });
      const next: QueryWarning[] = [
        ...(data?.unknown ?? []), ...(data?.empty_risk ?? []),
      ].map((w: any) => ({
        token: w.token,
        why: w.why,
        didYouMean: w.did_you_mean,
      }));
      setWarnings(next);
      return next;
    } catch {
      // A validation outage must not stop someone querying — the amber pills
      // are an aid, and the query runs perfectly well without them.
      return [];
    }
  }, [infospaceId, runId]);

  /**
   * Prose → a proposed query.
   *
   * Validated before it is handed back, so the amber pills appear on the
   * model's output rather than only on a human's typo.
   */
  const ask = useCallback(async (prose: string): Promise<string> => {
    if (!infospaceId || !runId) return '';
    const res: any = await RunsService.graphAssist({
      infospaceId, runId, requestBody: { prose },
    });
    const q = res?.q ?? '';
    await validate(q);
    return q;
  }, [infospaceId, runId, validate]);

  return { context, warnings, validate, ask };
}
