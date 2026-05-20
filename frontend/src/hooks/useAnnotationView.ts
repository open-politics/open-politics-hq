/**
 * Data fetching hook for the /view endpoint.
 *
 * Each panel calls this hook with its own config. The hook merges local
 * filters + incoming scopes, picks the right materialization (rows,
 * aggregate, graph), and returns typed data ready to render.
 *
 * Supports both JSON mode (default) and SSE streaming (for large result
 * sets). Re-fetches automatically when any input param changes, with
 * debouncing for rapid scope cascades.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RunsService } from '@/client';
import type {
  ViewRequest,
  RowsConfig,
  AggregateViewConfig,
  GraphViewConfig as ClientGraphConfig,
  FormulaViewConfig,
  FilterSet,
  MergeMap,
} from '@/client';

/** Legacy `dossier` config — the backend retired this phase when the
 *  Formula engine settled. Kept here so legacy callers (NodeProjection-
 *  Dossier, EdgeDetailHUD, ProjectionPreview, …) still typecheck while we
 *  migrate them to the new ``formula`` phase. Passing it is a no-op
 *  against the wire; the call falls through to whichever other phase is
 *  set. Remove once those callers are gone. */
type DossierConfigLegacy = {
  projection?: any;
  limit?: number;
  allow_unresolved?: boolean;
};
import type { ViewResponse } from '@/lib/annotations/types';
import { connectSSE } from '@/lib/sse';
import { useStream } from './useStream';

export interface UseAnnotationViewParams {
  infospaceId: number;
  runId: number;
  // Materializations — include whichever the panel needs
  rows?: RowsConfig;
  aggregate?: AggregateViewConfig;
  /**
   * Multi-measure mode. When set (non-empty), the hook fans out one
   * ``/view`` request per entry in parallel, then merges returned buckets by
   * ``key`` so the result ``data.aggregate.buckets[*].stats`` carries every
   * measure's ``{path: {fn: value}}`` on the same bucket. Ignored when
   * ``aggregate`` (singular) is set — callers pick one mode.
   */
  aggregates?: AggregateViewConfig[];
  graph?: ClientGraphConfig;
  /** @deprecated legacy projection-driven dossier — backend phase
   *  retired with the Formula engine settlement. Callers should migrate
   *  to the ``formula`` phase. Keeping the param accepting a loose
   *  shape so legacy callers typecheck while they migrate. */
  dossier?: DossierConfigLegacy;
  /** Formula phase — runs an :class:`Formula` and returns its
   *  ``OutputRelation`` (group keys × measures + optional derives). The
   *  new intelligence-layer materialisation. ``data.formula`` carries the
   *  rows; the legacy ``dossier`` is for the projection path. */
  formula?: FormulaViewConfig;
  // Merged filters (local + scopes — caller uses mergeFiltersAndScopes)
  filters?: FilterSet;
  merge_maps?: MergeMap[];
  schema_ids?: number[];
  asset_ids?: number[];
  additional_run_ids?: number[];
  // Control
  enabled?: boolean;
  /** Use SSE streaming instead of JSON. Good for large result sets. */
  streaming?: boolean;
  /** Debounce delay in ms for re-fetches (default: 200) */
  debounceMs?: number;
}

export interface UseAnnotationViewResult {
  data: ViewResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Stable JSON serialization for dependency comparison.
 *
 * `JSON.stringify(obj, arrayReplacer)` filters object keys recursively — only
 * keys in the replacer array survive at any nesting level. So calling it with
 * `Object.keys(obj).sort()` serializes the top level but erases every nested
 * object to `{}`, meaning changes inside ``aggregate.interval`` (etc.) never
 * alter the returned string — and the debounced effect that depends on
 * ``paramsKey`` never refires when only nested fields change. We walk
 * manually: sort object keys deterministically and stringify the result.
 */
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
    rows,
    aggregate,
    aggregates,
    graph,
    dossier,
    formula,
    filters,
    merge_maps,
    schema_ids,
    asset_ids,
    additional_run_ids,
    enabled = true,
    streaming = false,
    debounceMs = 200,
  } = params;

  const [data, setData] = useState<ViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  // Build the request body
  const buildRequest = useCallback((): ViewRequest => {
    const req: ViewRequest = {};
    if (rows) req.rows = rows;
    if (aggregate) req.aggregate = aggregate;
    if (graph) req.graph = graph;
    // ``dossier`` is a no-op on the wire — backend phase retired. Legacy
    // callers (graph side panel) keep working at compile time but their
    // call returns no rows until they migrate to ``formula``.
    if (formula) req.formula = formula;
    if (filters && (filters.conditions?.length ?? 0) > 0) req.filters = filters;
    if (merge_maps && merge_maps.length > 0) req.merge_maps = merge_maps;
    if (schema_ids && schema_ids.length > 0) req.schema_ids = schema_ids;
    if (asset_ids && asset_ids.length > 0) req.asset_ids = asset_ids;
    if (additional_run_ids && additional_run_ids.length > 0) req.additional_run_ids = additional_run_ids;
    return req;
  }, [rows, aggregate, graph, dossier, formula, filters, merge_maps, schema_ids, asset_ids, additional_run_ids]);

  const fetchData = useCallback(async () => {
    const hasMulti = !!aggregates && aggregates.length > 1;
    // eslint-disable-next-line no-console
    console.log('[useAnnotationView] fetchData', {
      enabled, runId, infospaceId,
      hasRows: !!rows, hasAgg: !!aggregate, hasMulti, hasGraph: !!graph,
    });
    if (!enabled || !runId || !infospaceId) return;

    // Must request at least one materialization
    if (!rows && !aggregate && !hasMulti && !graph && !dossier && !formula) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const id = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    const requestBody = buildRequest();

    try {
      if (hasMulti) {
        // Fan out one ``/view`` request per measure. Each response carries
        // ``aggregate.buckets[].stats = {path: {fn: value}}`` for its one
        // measure. Merge them into a single aggregate phase keyed by
        // ``bucket.key`` so the caller sees one view with all measures
        // attached. ``count`` is taken from the first response (backends
        // return the same count for equal filter/group_by).
        const multi = aggregates!;
        const responses = await Promise.all(
          multi.map((ac) => {
            const body: ViewRequest = { ...requestBody, aggregate: ac };
            // eslint-disable-next-line no-console
            console.log('[useAnnotationView] /view multi', ac);
            return RunsService.viewRun({
              infospaceId,
              runId,
              requestBody: body,
            }) as unknown as Promise<ViewResponse>;
          }),
        );

        if (id !== fetchIdRef.current) return;

        const bucketMap = new Map<string, any>();
        let fieldPath = '';
        let interval: string | null | undefined = null;
        let totalCount = 0;
        let splitFieldPath: string | null | undefined = null;
        for (const resp of responses) {
          const agg = resp?.aggregate;
          if (!agg?.buckets) continue;
          fieldPath = fieldPath || agg.field_path;
          interval = interval ?? agg.interval;
          splitFieldPath = splitFieldPath ?? agg.split_field_path;
          for (const b of agg.buckets) {
            const prev = bucketMap.get(b.key);
            if (!prev) {
              bucketMap.set(b.key, {
                key: b.key,
                count: b.count,
                stats: b.stats ? { ...b.stats } : {},
                split_value: b.split_value,
              });
            } else {
              // Merge stats across measures; count stays — equal filters.
              if (b.stats) prev.stats = { ...prev.stats, ...b.stats };
            }
          }
        }
        totalCount = Array.from(bucketMap.values()).reduce((s, b) => s + b.count, 0);
        const merged: ViewResponse = {
          aggregate: {
            buckets: Array.from(bucketMap.values()),
            field_path: fieldPath,
            interval: interval ?? null,
            total_count: totalCount,
            split_field_path: splitFieldPath ?? null,
          },
        } as ViewResponse;
        setData(merged);
        setIsLoading(false);
      } else if (streaming) {
        // SSE mode — accumulate phases
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
              else if (event.type === 'dossier') partial.dossier = parsed;
              else if (event.type === 'formula') partial.formula = parsed;
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
        // JSON mode
        // eslint-disable-next-line no-console
        console.log('[useAnnotationView] /view', requestBody);
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
  }, [infospaceId, runId, enabled, streaming, buildRequest, rows, aggregate, aggregates, graph, dossier, formula]);

  // Debounced effect — re-fetches when any param changes
  const paramsKey = stableKey({
    infospaceId, runId, rows, aggregate, aggregates, graph, dossier, formula,
    filters, merge_maps, schema_ids, asset_ids, additional_run_ids,
    enabled, streaming,
  });

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setIsLoading(false);
      return;
    }

    // Mark loading immediately when params change so consumers don't render
    // stale `data` against a freshly-changed config (e.g. toggling Grouped
    // would otherwise render timeline buckets as categorical bars during
    // the 200ms debounce window).
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // ── Live family refresh ─────────────────────────────────────────────────
  // Subscribe to the run's presence stream. When an extension run completes
  // (or any descendant emits progress / terminal events), the backend mirrors
  // the event onto the parent's stream via FamilyStreamWriter — so panels
  // bound to ``runId`` automatically refetch the moment new annotations land,
  // without a manual reload button or polling.
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
      // Refetch only on terminal events. The existing polling path covers
      // mid-flight progress (rows fill in live as the parent processes); the
      // nudge here is the missing piece — telling panels to refetch when an
      // extension completes after the parent has long since hit COMPLETED.
      const t = event.type;
      if (t === 'completed' || t === 'completed_with_errors' || t === 'failed') {
        fetchData();
      }
    },
  });

  return { data, isLoading, error, refetch };
}
