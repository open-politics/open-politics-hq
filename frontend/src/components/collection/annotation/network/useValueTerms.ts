'use client';

/**
 * useValueTerms — the documents behind a set's value terms.
 *
 * `sentiment = negative` is the one kind of term the network cannot answer
 * itself: it is about the documents' annotations, of any of the run's
 * schemas, not the graph. The run answers it (`POST …/network/where`) with
 * the assets that carry the value; a set gathers the nodes those assets
 * produced (`plane/sets.ts`). A graded term — a number read as a degree —
 * is asked of `…/network/weigh` instead, and answers with a weight per
 * annotation and the scale it was read on. Each distinct term is asked once
 * per version of the network — a live run's next graph asks again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NetworkService, type Weights } from '@/client';
import type { Term } from '@/components/collection/graph/plane';

/** `≠` is asked as `=` — the set takes the answer away. */
const asked = (t: Term) => (t.op === '~' ? '~' : '=') as '=' | '~';
export const valueKey = (t: Term) => t.measure
  ? `${t.field ?? ''}\u0001measure`
  : `${t.field ?? ''}\u0001${asked(t)}\u0001${[...t.values].sort().join('\u0002')}`;

export function useValueTerms({
  infospaceId, runId, terms, version,
}: { infospaceId: number; runId: number; terms: readonly Term[]; version: string | number | null }) {
  const [found, setFound] = useState<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
  const [weighed, setWeighed] = useState<ReadonlyMap<string, Weights>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const asking = useRef(new Set<string>());
  // Answers to an earlier network are dropped on arrival.
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setFound(new Map());
    setWeighed(new Map());
    asking.current = new Set();
  }, [infospaceId, runId, version]);

  const wanted = terms.filter((t) => t.kind === 'value' && t.field && (t.values.length || t.measure));
  const keys = [...new Set(wanted.map(valueKey))].sort().join('\n');
  useEffect(() => {
    const gen = generation.current;
    for (const t of wanted) {
      const key = valueKey(t);
      if (found.has(key) || weighed.has(key) || asking.current.has(key)) continue;
      asking.current.add(key);
      if (t.measure) {
        NetworkService.networkWeigh({
          infospaceId, runId, requestBody: { path: t.field!, operator: 'value' },
        }).then((r) => {
          if (gen !== generation.current) return;
          setWeighed((m) => new Map(m).set(key, r));
          setError(null);
        }).catch((err: any) => {
          if (gen !== generation.current) return;
          asking.current.delete(key);
          setError(err?.body?.detail ?? err?.message ?? 'Could not read the scores');
        });
        continue;
      }
      NetworkService.networkWhere({
        infospaceId, runId, requestBody: { path: t.field!, op: asked(t), values: t.values },
      }).then((r) => {
        if (gen !== generation.current) return;
        setFound((m) => new Map(m).set(key, new Set(r.assets)));
        setError(null);
      }).catch((err: any) => {
        if (gen !== generation.current) return;
        asking.current.delete(key);
        setError(err?.body?.detail ?? err?.message ?? 'Could not read the values');
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, found, weighed, infospaceId, runId]);

  const lookup = useCallback((t: Term) => found.get(valueKey(t)), [found]);
  /** A graded term's weights per annotation and their scale; undefined while
   *  they load. */
  const weights = useCallback((t: Term) => weighed.get(valueKey(t)), [weighed]);
  return { lookup, weights, error };
}
