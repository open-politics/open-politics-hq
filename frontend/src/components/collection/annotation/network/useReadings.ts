'use client';

/**
 * useReadings — what each room is about, in words.
 *
 * A room's documents and the names inside it are asked of `…/network/describe`
 * once they hold still for a moment: nodes flowing in and out while the layout
 * runs ask again only when the room's contents settle. Each answer is kept by
 * what was asked, so a room that returns to what it held reads at once, and a
 * room keeps its last reading on show while the next one loads.
 */
import { useEffect, useRef, useState } from 'react';
import { NetworkService, type Reading } from '@/client';

export interface ReadingAsk {
  documents: readonly number[];
  names: readonly string[];
}

/** How long a room's contents hold still before they are read. */
const SETTLE_MS = 900;

/** A short key for what is asked — FNV-1a over the ids and names. */
function keyOf(ask: ReadingAsk): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => { h ^= n; h = Math.imul(h, 0x01000193); };
  for (const d of ask.documents) mix(d);
  mix(-1);
  for (const n of ask.names) for (let k = 0; k < n.length; k++) mix(n.charCodeAt(k));
  return `${ask.documents.length}:${ask.names.length}:${(h >>> 0).toString(36)}`;
}

export function useReadings({
  infospaceId, runId, asks,
}: {
  infospaceId: number; runId: number;
  /** Per room (its set's id), what it holds now. */
  asks: ReadonlyMap<string, ReadingAsk>;
}) {
  const [answers, setAnswers] = useState<ReadonlyMap<string, Reading>>(new Map());
  const [shown, setShown] = useState<ReadonlyMap<string, string>>(new Map());
  const asking = useRef(new Set<string>());
  useEffect(() => { setAnswers(new Map()); setShown(new Map()); asking.current = new Set(); }, [infospaceId, runId]);

  const keys = new Map([...asks].map(([id, ask]) => [id, keyOf(ask)]));
  const signature = [...keys].map(([id, k]) => `${id}=${k}`).sort().join(',');
  useEffect(() => {
    const t = setTimeout(() => {
      for (const [id, ask] of asks) {
        const key = keys.get(id)!;
        if (answers.has(key)) { setShown((m) => (m.get(id) === key ? m : new Map(m).set(id, key))); continue; }
        if (asking.current.has(key) || !ask.documents.length) continue;
        asking.current.add(key);
        NetworkService.networkDescribe({
          infospaceId, runId,
          requestBody: { documents: [...ask.documents], labels: [...ask.names], passages: 3, terms: 8 },
        }).then((r) => {
          setAnswers((m) => new Map(m).set(key, r));
          setShown((m) => new Map(m).set(id, key));
        }).catch(() => { /* the room keeps its last reading */ }).finally(() => asking.current.delete(key));
      }
    }, SETTLE_MS);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, answers, infospaceId, runId]);

  /** The room's reading, and whether it reads what the room holds now. */
  return (id: string): { reading: Reading | undefined; current: boolean } => {
    const key = shown.get(id);
    return { reading: key ? answers.get(key) : undefined, current: key != null && key === keys.get(id) };
  };
}
