/**
 * Data fetching hook for the /view endpoint.
 *
 * Each panel calls this hook with its own Formula + per-phase params.
 * The hook constructs the unified :class:`ViewRequest`, posts to
 * ``/view``, and returns the typed multi-phase response.
 *
 * Pipeline (single boundary, one Formula, multiple view packings):
 *
 * .. code-block::
 *
 *     [Frontend] → Formula → /view (FormulaQuery)
 *                              ├── rows view
 *                              ├── aggregate view
 *                              └── graph view
 *
 * Supports both JSON mode (default) and SSE streaming (for large
 * result sets). Re-fetches automatically when any input changes, with
 * debouncing for rapid scope cascades.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RunsService } from '@/client';
import type {
  ViewRequest,
  RowsParams,
  GraphParams,
  Formula,
  Scope,
  MergeMap,
  AnnotationSchemaRead,
} from '@/client';
import type { Panel, ViewResponse } from '@/lib/annotations/types';
import { compileForPanel } from '@/lib/annotations/panelCompile';
import { connectSSE } from '@/lib/sse';
import { useStream } from './useStream';

export interface UseAnnotationViewParams {
  infospaceId: number;
  runId: number;
  /** Either pass a Panel (preferred; compiled internally via panelCompile)
   *  OR a raw Formula. Workspace / EvidenceDrawer / dialogs that build
   *  transient formulas without a Panel use the Formula form. */
  panel?: Panel;
  schemas?: AnnotationSchemaRead[];
  /** Raw Formula — only used when ``panel`` is not provided. */
  formula?: Formula;
  /** Projection list (value-blob paths to ship per rows-view row). */
  fields?: string[];
  /** Cross-panel filter contributions composed into the effective filter. */
  incoming_scopes?: Scope[];
  /** Panel-local value aliases. Run-wide aliases live on the server's
   *  ``views_config.aliases`` and are loaded by the route. */
  merge_maps?: MergeMap[];
  /** Additional run ids to roll up alongside ``runId``. */
  additional_run_ids?: number[];

  // ── Per-phase toggles (presence = request that packing) ─────────────
  rows?: RowsParams;
  /** Empty ``{}`` toggles the aggregate phase; the Formula's
   *  group + measures drive the actual computation. */
  aggregate?: Record<string, unknown> | null;
  graph?: GraphParams;

  // ── Control ─────────────────────────────────────────────────────────
  enabled?: boolean;
  /** Use SSE streaming instead of JSON. Good for large result sets. */
  streaming?: boolean;
  /** Debounce delay in ms for re-fetches (default: 200). */
  debounceMs?: number;
}

export interface UseAnnotationViewResult {
  data: ViewResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Stable JSON serialization for dependency comparison. */
function stableKey(obj: any): string {
  const sortDeep = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(sortDeep);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  };
  return JSON.stringify(sortDeep(obj));
}

export function useAnnotationView(params: UseAnnotationViewParams): UseAnnotationViewResult {
  const {
    infospaceId,
    runId,
    panel,
    schemas,
    formula: rawFormula,
    fields,
    incoming_scopes,
    merge_maps,
    additional_run_ids,
    rows,
    aggregate,
    graph,
    enabled = true,
    streaming = false,
    debounceMs = 200,
  } = params;

  // Compile panel → Formula at the request boundary. Pure derivation;
  // any change to panel.panel_config or panel.formula yields a fresh
  // request body. When called with a raw ``formula`` (Workspace,
  // EvidenceDrawer), use that directly.
  const formula: Formula | undefined = useMemo(() => {
    if (panel && schemas) return compileForPanel(panel, schemas);
    return rawFormula;
  }, [panel, schemas, rawFormula]);

  const [data, setData] = useState<ViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  const buildRequest = useCallback((): ViewRequest => {
    if (!formula) {
      throw new Error('useAnnotationView: neither panel+schemas nor formula provided');
    }
    const req: ViewRequest = { formula };
    if (fields && fields.length > 0) req.fields = fields;
    if (incoming_scopes && incoming_scopes.length > 0) req.incoming_scopes = incoming_scopes;
    if (merge_maps && merge_maps.length > 0) req.merge_maps = merge_maps;
    if (additional_run_ids && additional_run_ids.length > 0) req.additional_run_ids = additional_run_ids;
    if (rows) req.rows = rows;
    if (aggregate !== undefined && aggregate !== null) req.aggregate = aggregate;
    if (graph) req.graph = graph;
    return req;
  }, [formula, fields, incoming_scopes, merge_maps, additional_run_ids, rows, aggregate, graph]);

  const fetchData = useCallback(async () => {
    if (!enabled || !runId || !infospaceId || !formula) return;

    // Must request at least one phase.
    if (!rows && aggregate === undefined && !graph) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const id = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    const requestBody = buildRequest();

    try {
      if (streaming) {
        const partial: ViewResponse = {};
        await connectSSE({
          url: `/api/v1/infospaces/${infospaceId}/runs/${runId}/view`,
          method: 'POST',
          body: requestBody,
          signal: controller.signal,
          onEvent: (event) => {
            try {
              const parsed = JSON.parse(event.data);
              if (event.type === 'rows') partial.rows = parsed;
              else if (event.type === 'aggregate') partial.aggregate = parsed;
              else if (event.type === 'graph') partial.graph = parsed;
            } catch { /* skip malformed events */ }
          },
          onError: (err) => {
            if (id === fetchIdRef.current) setError(err);
          },
        });
        if (id === fetchIdRef.current) {
          setData(partial);
          setIsLoading(false);
        }
      } else {
        const response = await RunsService.viewRun({
          infospaceId,
          runId,
          requestBody,
        }) as unknown as ViewResponse;

        if (id === fetchIdRef.current) {
          setData(response);
          setIsLoading(false);
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (id === fetchIdRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    }
  }, [infospaceId, runId, enabled, streaming, buildRequest, rows, aggregate, graph]);

  // Debounced effect — re-fetches when any param changes
  const paramsKey = stableKey({
    infospaceId, runId, formula, fields, incoming_scopes, merge_maps,
    additional_run_ids, rows, aggregate, graph, enabled, streaming,
  });

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData();
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Live family refresh — subscribe to the run's presence stream.
  // When an extension run completes, refetch automatically so panels
  // bound to the parent see new annotations without a manual reload.
  useStream<{
    run_id?: number;
    parent_run_id?: number | null;
    progress_current?: number;
    progress_total?: number;
    status?: string;
  }>({
    infospaceId: infospaceId ?? 0,
    topic: 'annotation_run',
    resourceId: runId ?? 0,
    enabled: enabled && !!infospaceId && !!runId,
    onEvent: (event) => {
      const t = event.type;
      if (t === 'completed' || t === 'completed_with_errors' || t === 'failed') {
        fetchData();
      }
    },
  });

  return { data, isLoading, error, refetch };
}
