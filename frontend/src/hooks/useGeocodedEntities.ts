'use client';

/**
 * useGeocodedEntities — seed the map panel with already-resolved coords on
 * mount so re-opening a dashboard doesn't show an empty map until the user
 * clicks "Geocode" again.
 *
 * Wraps ``RunsService.getGeocodedEntities`` so auth flows through the same
 * ``OpenAPI.HEADERS`` pipeline the rest of the app uses. Cache-hits only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RunsService } from '@/client';
import type { GeocodedEntityOut } from '@/client';

/** GeoJSON Polygon/MultiPolygon (or any geometry type Nominatim returns).
 *  Server simplifies coords to ~10m precision before persisting/emitting. */
export type GeocodedGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: string; coordinates: unknown };

export interface GeocodedEntity {
  entity_id: number;
  name: string;
  coords: [number, number]; // [lon, lat]
  display_name?: string | null;
  bbox?: [number, number, number, number] | null;
  /** Real polygon geometry from Nominatim. Preferred over bbox-derived rect
   *  when present — solves the "huge bbox because of overseas territories"
   *  problem because mainland and territories appear as separate parts. */
  geometry?: GeocodedGeometry | null;
}

function toGeocodedEntity(e: GeocodedEntityOut): GeocodedEntity {
  return {
    entity_id: e.entity_id,
    name: e.name,
    coords: (e.coords as unknown as [number, number]),
    display_name: e.display_name ?? null,
    bbox: (e.bbox as unknown as [number, number, number, number] | null | undefined) ?? null,
    geometry: (e.geometry as unknown as GeocodedGeometry | null | undefined) ?? null,
  };
}

export function useGeocodedEntities(args: {
  infospaceId: number | null | undefined;
  runId: number | null | undefined;
  fieldPath: string | null | undefined;
  enabled?: boolean;
}): {
  entities: GeocodedEntity[];
  isLoading: boolean;
  error: Error | null;
  /** Re-run the seed query against the DB. Used by callers (e.g. the map
   *  panel) to catch up after a geocoding action completes — SSE delivers
   *  ``resolved`` events live but the client may subscribe AFTER fast
   *  cache-hit runs already finished, so a follow-up DB read closes that
   *  race window. */
  refetch: () => Promise<void>;
} {
  const { infospaceId, runId, fieldPath, enabled = true } = args;
  const [entities, setEntities] = useState<GeocodedEntity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // ``refetch`` reads from the same scope as the current effect run.
  // Stash a ref so the returned callback always sees the latest args
  // without making the consumer re-pass them every call.
  const lastArgsRef = useRef({ infospaceId, runId, fieldPath, enabled });
  lastArgsRef.current = { infospaceId, runId, fieldPath, enabled };

  const fetchOnce = useCallback(async () => {
    const cur = lastArgsRef.current;
    if (!cur.enabled || !cur.infospaceId || !cur.runId || !cur.fieldPath) {
      setEntities([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // eslint-disable-next-line no-console
      console.log('[useGeocodedEntities] fetch', cur);
      const data = await RunsService.getGeocodedEntities({
        infospaceId: cur.infospaceId,
        runId: cur.runId,
        fieldPath: cur.fieldPath,
      });
      // eslint-disable-next-line no-console
      console.log('[useGeocodedEntities] response', {
        fieldPath: cur.fieldPath,
        count: Array.isArray(data) ? data.length : 0,
        sample: Array.isArray(data) ? data[0] : null,
      });
      setEntities(Array.isArray(data) ? data.map(toGeocodedEntity) : []);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error('[useGeocodedEntities] error', e);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !infospaceId || !runId || !fieldPath) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    fetchOnce().catch(() => {
      // already logged inside fetchOnce
    });
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [enabled, infospaceId, runId, fieldPath, fetchOnce]);

  return { entities, isLoading, error, refetch: fetchOnce };
}
