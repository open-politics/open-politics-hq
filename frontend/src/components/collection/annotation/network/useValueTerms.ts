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
 * annotation and the scale it was read on. A meaning (`≈`) is asked there
 * too, `about` its phrases, with the network's names: the answer weighs the
 * documents by their chunks and the names by their own vectors. A meaning
 * like some nodes — a held room — goes as the documents mostly about them
 * (`plane/rooms.roomDocuments`). Each
 * distinct term is asked once per version of the network — a live run's
 * next graph asks again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NetworkService, type Weights } from '@/client';
import type { Term } from '@/components/collection/graph/plane';

/** `≠` is asked as `=` — the set takes the answer away; a comparison as
 *  itself. */
const asked = (t: Term) => t.cmp ?? (t.op === '~' ? '~' : '=');
/** One answer per question: a meaning's reach, basis and strength are read
 *  from the same answer. */
export const valueKey = (t: Term) => t.kind === 'about'
  ? `\u0001about\u0001${[...t.values].sort().join('\u0002')}\u0003${[...(t.like ?? [])].sort().join('\u0002')}`
  : t.measure
    ? `${t.field ?? ''}\u0001measure`
    : `${t.field ?? ''}\u0001${asked(t)}\u0001${[...t.values].sort().join('\u0002')}`;

export function useValueTerms({
  infospaceId, runId, terms, version, names, documentsOf,
}: {
  infospaceId: number; runId: number; terms: readonly Term[]; version: string | number | null;
  /** The network's node names — what a meaning weighs on the *said* basis. */
  names?: readonly string[];
  /** The documents a meaning like these nodes is made of. */
  documentsOf?: (ids: readonly string[]) => number[];
}) {
  const [found, setFound] = useState<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
  const [weighed, setWeighed] = useState<ReadonlyMap<string, Weights>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const asking = useRef(new Set<string>());
  // Answers to an earlier network are dropped on arrival.
  const generation = useRef(0);

  // A new run starts from nothing. A new version of the same run asks every
  // term again but keeps the last answers until the new ones land, so a live
  // run's sets and grounds do not blink empty on each refresh.
  const answered = useRef(new Set<string>());
  useEffect(() => {
    generation.current++;
    setFound(new Map());
    setWeighed(new Map());
    asking.current = new Set();
    answered.current = new Set();
  }, [infospaceId, runId]);
  useEffect(() => {
    generation.current++;
    asking.current = new Set();
    answered.current = new Set();
  }, [version]);

  const wanted = terms.filter((t) => (t.kind === 'value' && t.field && (t.values.length || t.measure))
    || (t.kind === 'about' && (t.values.length || (t.like?.length && documentsOf))));
  const keys = [...new Set(wanted.map(valueKey))].sort().join('\n');
  useEffect(() => {
    const gen = generation.current;
    for (const t of wanted) {
      const key = valueKey(t);
      if (answered.current.has(key) || asking.current.has(key)) continue;
      asking.current.add(key);
      if (t.measure || t.kind === 'about') {
        NetworkService.networkWeigh({
          infospaceId, runId, requestBody: t.kind === 'about'
            ? {
              path: '$', operator: 'about', value: t.values, labels: names ? [...new Set(names)] : null,
              like: t.like?.length && documentsOf ? documentsOf(t.like) : null,
            }
            : { path: t.field!, operator: 'value' },
        }).then((r) => {
          if (gen !== generation.current) return;
          answered.current.add(key);
          asking.current.delete(key);
          setWeighed((m) => new Map(m).set(key, r));
          setError(null);
        }).catch((err: any) => {
          if (gen !== generation.current) return;
          asking.current.delete(key);
          setError(err?.body?.detail ?? err?.message ?? (t.kind === 'about' ? 'Could not read the meaning' : 'Could not read the scores'));
        });
        continue;
      }
      NetworkService.networkWhere({
        infospaceId, runId, requestBody: { path: t.field!, op: asked(t), values: t.values },
      }).then((r) => {
        if (gen !== generation.current) return;
        answered.current.add(key);
        asking.current.delete(key);
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
