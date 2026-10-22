'use client';

/**
 * useResolution — a run's live resolver, as the network panel reads it.
 *
 *   state     running · scope · threshold · counts       GET, and on `state`
 *   effect    every merge in effect — what the network folds
 *   current   the group on stage: being judged, or just decided
 *   seeding   the run's graph is being read for pairs
 *   history   the log, newest first, paged on demand
 *
 * Live over the run's `resolution` stream (`graph/tasks/decide.py`):
 * `judging` puts a group on stage — a head and the labels that might be it —
 * and each member's `decided` lands its verdict — into the effect when it
 * merged, out of it when it did not — and the counts follow; the group is
 * decided once every member is. A person's change (`rollback`, `change`,
 * `merge`) goes through the same stream and takes the stage on its own, so
 * every open panel sees the same thing happen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResolutionService, type EntityDecisionOut, type ManualDecision, type ManualMerge, type ResolverPatch,
  type ResolverState,
} from '@/client';
import { useStream } from './useStream';

export type Phase = 'judging' | 'decided';

export interface OnStage {
  /** The group's rows; the head is every row's `a`. */
  decisions: EntityDecisionOut[];
  phase: Phase;
  /** When it entered this phase — what an animation keys on. */
  at: number;
}

export interface UseResolutionResult {
  state: ResolverState | null;
  effect: EntityDecisionOut[];
  current: OnStage | null;
  /** The run's graph is being read for pairs. */
  seeding: boolean;
  history: EntityDecisionOut[];
  historyTotal: number | null;
  loadHistory: (status?: string | null, more?: boolean) => Promise<void>;
  setResolver: (patch: ResolverPatch) => Promise<void>;
  rollback: (id: number) => Promise<void>;
  change: (id: number, body: ManualDecision) => Promise<void>;
  /** Labels a person picked, merged into `keep` — one decision per label. */
  merge: (body: ManualMerge) => Promise<boolean>;
  error: string | null;
}

const message = (err: any, fallback: string) => err?.body?.detail ?? err?.message ?? fallback;

export function useResolution({
  infospaceId, runId, enabled = true,
}: { infospaceId: number; runId: number; enabled?: boolean }): UseResolutionResult {
  const [state, setState] = useState<ResolverState | null>(null);
  const [effect, setEffect] = useState<EntityDecisionOut[]>([]);
  const [current, setCurrent] = useState<OnStage | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [history, setHistory] = useState<EntityDecisionOut[]>([]);
  const [historyTotal, setHistoryTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filter = useRef<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshState = useCallback(() => {
    // Coalesced: a resolver deciding every few seconds should not fetch
    // counts every few seconds per panel.
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(async () => {
      refreshTimer.current = null;
      try { setState(await ResolutionService.getResolver({ infospaceId, runId })); } catch { /* next event retries */ }
    }, 1200);
  }, [infospaceId, runId]);

  useEffect(() => {
    if (!enabled || !infospaceId || !runId) return;
    let live = true;
    setEffect([]); setHistory([]); setHistoryTotal(null); setCurrent(null);
    Promise.all([
      ResolutionService.getResolver({ infospaceId, runId }),
      ResolutionService.entityDecisionsInEffect({ infospaceId, runId }),
    ]).then(([s, e]) => {
      if (!live) return;
      setState(s);
      setEffect(e);
    }).catch((err) => live && setError(message(err, 'The resolver could not be read')));
    return () => { live = false; };
  }, [enabled, infospaceId, runId]);

  /** A verdict landed — wherever it came from. */
  const land = useCallback((d: EntityDecisionOut) => {
    setEffect((xs) => {
      const rest = xs.filter((x) => x.id !== d.id);
      return d.status === 'merged' ? [...rest, d] : rest;
    });
    setHistory((xs) => {
      if (filter.current && filter.current !== d.status) return xs.filter((x) => x.id !== d.id);
      return [d, ...xs.filter((x) => x.id !== d.id)];
    });
    refreshState();
  }, [refreshState]);

  useStream<any>({
    infospaceId,
    topic: 'resolution',
    resourceId: runId,
    enabled: enabled && !!runId,
    onEvent: (e) => {
      if (e.type === 'seeding') setSeeding(true);
      else if (e.type === 'judging') {
        setSeeding(false);
        setCurrent({ decisions: (e.data as { decisions: EntityDecisionOut[] }).decisions, phase: 'judging', at: Date.now() });
      }
      else if (e.type === 'decided') {
        const d = e.data as EntityDecisionOut;
        setCurrent((cur) => {
          if (!cur?.decisions.some((x) => x.id === d.id)) return { decisions: [d], phase: 'decided', at: Date.now() };
          const decisions = cur.decisions.map((x) => (x.id === d.id ? d : x));
          return decisions.some((x) => x.status === 'pending')
            ? { ...cur, decisions }
            : { decisions, phase: 'decided', at: Date.now() };
        });
        land(d);
      } else if (e.type === 'state') setState(e.data as ResolverState);
      else if (e.type === 'seeded') { setSeeding(false); refreshState(); }
    },
  });

  const loadHistory = useCallback(async (status: string | null = null, more = false) => {
    filter.current = status;
    try {
      const page = await ResolutionService.listEntityDecisions({
        infospaceId, runId, status, offset: more ? history.length : 0, limit: 50,
      });
      setHistory((xs) => (more ? [...xs, ...page.items] : page.items));
      setHistoryTotal(page.total);
    } catch (err) {
      setError(message(err, 'The history could not be read'));
    }
  }, [infospaceId, runId, history.length]);

  const setResolver = useCallback(async (patch: ResolverPatch) => {
    try {
      setState(await ResolutionService.patchResolver({ infospaceId, runId, requestBody: patch }));
      setError(null);
    } catch (err) {
      setError(message(err, 'The resolver could not be changed'));
    }
  }, [infospaceId, runId]);

  const rollback = useCallback(async (id: number) => {
    try { land(await ResolutionService.rollbackEntityDecision({ infospaceId, runId, decisionId: id })); }
    catch (err) { setError(message(err, 'Could not roll back')); }
  }, [infospaceId, runId, land]);

  const change = useCallback(async (id: number, body: ManualDecision) => {
    try { land(await ResolutionService.changeEntityDecision({ infospaceId, runId, decisionId: id, requestBody: body })); }
    catch (err) { setError(message(err, 'Could not change the decision')); }
  }, [infospaceId, runId, land]);

  const merge = useCallback(async (body: ManualMerge) => {
    try {
      const rows = await ResolutionService.mergeLabels({ infospaceId, runId, requestBody: body });
      rows.forEach(land);
      setError(null);
      return true;
    } catch (err) {
      setError(message(err, 'Could not merge'));
      return false;
    }
  }, [infospaceId, runId, land]);

  return {
    state, effect, current, seeding, history, historyTotal, loadHistory, setResolver, rollback, change, merge, error,
  };
}
