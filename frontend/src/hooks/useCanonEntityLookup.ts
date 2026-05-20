/**
 * useCanonEntityLookup — (label, entity_type) → canon entity id resolution.
 *
 * The projection dossier and EdgeDetailHUD consume canon entity ids; the
 * graph stream produces nodes keyed by label/slug. This hook fetches the
 * infospace's entity list once, builds a lower-case lookup map keyed by
 * either ``(label, entity_type)`` or ``label`` alone, and exposes a
 * ``findId`` resolver. Aliases are folded into the same map so click
 * surfaces resolve regardless of which surface name a user sees.
 *
 * The infospace's ``default_canon_id`` is the right scope for run-driven
 * graph clicks — the projection engine resolves against the same canon by
 * default. Caller can override.
 */

import { useEffect, useMemo, useState } from 'react';
import { EntitiesService } from '@/client';

export interface EntityLookupEntry {
  id: number;
  canonical_name: string;
  entity_type: string;
  aliases: string[];
}

export interface UseCanonEntityLookupResult {
  /** Resolve a graph node label to a canon entity id. ``entity_type`` narrows
   *  the lookup when set; otherwise the first match across all types wins. */
  findId: (label: string | undefined | null, entity_type?: string | null) => number | null;
  /** Raw entity list — used by surfaces that need to enumerate canon
   *  members (e.g. the comparison-split subject picker). */
  entities: EntityLookupEntry[];
  isLoading: boolean;
  error: Error | null;
  /** Total entities in the lookup, for debug indicators. */
  count: number;
}

export function useCanonEntityLookup(
  infospaceId: number | null | undefined,
  canonId?: number | null,
): UseCanonEntityLookupResult {
  const [entities, setEntities] = useState<EntityLookupEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!infospaceId) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    EntitiesService.listEntities({
      infospaceId,
      ...(canonId != null ? { canonId } : {}),
    })
      .then(rows => {
        if (cancelled) return;
        setEntities((rows as any[]).map(r => ({
          id: r.id,
          canonical_name: r.canonical_name ?? '',
          entity_type: r.entity_type ?? '',
          aliases: Array.isArray(r.aliases) ? r.aliases : [],
        })));
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [infospaceId, canonId]);

  const indexes = useMemo(() => {
    const byTypedKey = new Map<string, number>();
    const byLabel = new Map<string, number>();
    for (const e of entities) {
      const names = [e.canonical_name, ...e.aliases].filter(n => typeof n === 'string' && n.length > 0);
      for (const n of names) {
        const lower = n.toLowerCase();
        const typedKey = `${lower}\x00${(e.entity_type ?? '').toLowerCase()}`;
        if (!byTypedKey.has(typedKey)) byTypedKey.set(typedKey, e.id);
        if (!byLabel.has(lower)) byLabel.set(lower, e.id);
      }
    }
    return { byTypedKey, byLabel };
  }, [entities]);

  const findId = useMemo(() => {
    return (label: string | undefined | null, entity_type?: string | null): number | null => {
      if (!label) return null;
      const lower = label.toLowerCase();
      if (entity_type) {
        const typed = indexes.byTypedKey.get(`${lower}\x00${entity_type.toLowerCase()}`);
        if (typed != null) return typed;
      }
      return indexes.byLabel.get(lower) ?? null;
    };
  }, [indexes]);

  return { findId, entities, isLoading, error, count: entities.length };
}

