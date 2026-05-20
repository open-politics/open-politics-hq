// frontend/src/components/collection/infospaces/annotation/AnnotationResultsMap.tsx
'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import mapboxgl, { Map as MapboxMap, LngLatLike, Popup, Marker, LngLatBounds } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from 'next-themes';
import { AnnotationSchemaRead, AssetRead } from '@/client';
import { FormattedAnnotation, TimeAxisConfig, PanelConfig, AnnotationResultRow } from '@/lib/annotations/types';
import { getAnnotationFieldValue, getAnnotationFieldValuesExploded, getTargetKeysForScheme, formatFieldNameForDisplay } from '@/lib/annotations/utils';
import { inferRangeFromValues, readDeclaredRange } from './cellRenderers/NumberCell';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { mergeFiltersAndScopes, createScopeFromSelection } from '@/lib/annotations/scopes';
import type { Scope } from '@/lib/annotations/types';
import { EvidenceDrawer } from './panels/EvidenceDrawer';
import { debounce } from 'lodash';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Badge } from '@/components/ui/badge';
import { Loader2, Globe, Map as MapIcon, MapPin, X, Eye, EyeOff, Sun, Moon, Hexagon, Pin, CircleDotDashed, GitBranchPlus, Spline, List, Search, Palette, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VariableSplittingConfig, applySplittingToResults } from './VariableSplittingControls';
import { type RolePickerValue } from './panels/RolePicker';
import { RolePickerPopover } from './panels/RolePickerPopover';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import { PanelFormulaBinder } from './formulas/PanelFormulaBinder';
import { useResolvedProjection } from '@/hooks/useResolvedProjection';
import { EmptyStateCard } from './panels/EmptyStateCard';
import { PANEL_ROLE_SCHEMAS } from '@/lib/annotations/panelRoleSchema';
import { useGeocodeAction } from '@/hooks/useGeocodeAction';
import { useActionWatch } from '@/hooks/useActionWatch';
import { useGeocodedEntities } from '@/hooks/useGeocodedEntities';
import { TypedCell, type FieldDef } from './cellRenderers';
import { AssetKindBadge } from '@/components/collection/assets/AssetKindBadge';

/** GeoJSON Polygon/MultiPolygon — what Nominatim returns for admin boundaries. */
type MapGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: string; coordinates: unknown };

/** Event payload from the geocode @task: one location resolved to coords. */
interface GeocodeResolvedPayload {
  entity_id: number;
  name: string;
  coords: [number, number]; // [lon, lat]
  display_name?: string | null;
  bbox?: [number, number, number, number] | null;
  /** Real polygon geometry from Nominatim, simplified server-side. */
  geometry?: MapGeometry | null;
  cached?: boolean;
}

interface GeocodeStartedPayload { count: number }
interface GeocodeDonePayload { total: number; resolved: number; skipped: number }

// Define the structure for points passed to the map
export interface MapPoint {
  id: string;
  /** Display label — often the geocoder's verbose string. */
  locationString: string;
  /**
   * Raw value the user/annotations referenced (e.g. ``"EU"``) — used to match
   * annotations against this marker. When absent, ``locationString`` is used
   * as the match key, which usually fails against the verbose display form.
   */
  canonicalName?: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  documentIds: number[];
  bbox?: [number, number, number, number];
  /**
   * Real polygon geometry from OSM/Nominatim. When present the polygon
   * renderer prefers this over bbox-derived rectangles — gives accurate
   * shapes (mainland + overseas territories rendered as separate parts of a
   * MultiPolygon, no Atlantic-spanning rectangles for France).
   */
  geometry?: MapGeometry | null;
  type?: string;
  splitValue?: string; // NEW: Split value for variable splitting
}

// Time filtering utility function (copied from AnnotationResultsChart.tsx)
const getTimestamp = (result: FormattedAnnotation, assetsMap: Map<number, AssetRead>, timeAxisConfig: TimeAxisConfig | null): Date | null => {
  if (!timeAxisConfig) return null;

  switch (timeAxisConfig.type) {
    case 'default':
      return new Date(result.timestamp);
    case 'schema':
      if (result.schema_id === timeAxisConfig.schemaId && timeAxisConfig.fieldKey) {
        const fieldValue = getAnnotationFieldValue(result.value, timeAxisConfig.fieldKey);
        if (fieldValue && (typeof fieldValue === 'string' || fieldValue instanceof Date)) {
          try {
            return new Date(fieldValue);
          } catch {
            return null;
          }
        }
      }
      return null;
    case 'event':
      const asset = assetsMap.get(result.asset_id);
      if (asset?.event_timestamp) {
        try {
          return new Date(asset.event_timestamp);
        } catch {
          return null;
        }
      }
      return null;
    default:
      return new Date(result.timestamp);
  }
};

interface AnnotationResultsMapProps {
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  panelConfig: PanelConfig;
  onUpdatePanel: (updates: Partial<PanelConfig>) => void;
  /**
   * Legacy prop — PanelRenderer used to pipe pre-geocoded points in. The map
   * panel now owns its marker lifecycle (kick geocode action + watch SSE), so
   * this is optional and only honored as a fallback seed.
   */
  points?: MapPoint[];
  onPointClick?: (point: MapPoint) => void;
  onResultSelect?: (result: FormattedAnnotation) => void;
  highlightLocation?: { location: string; fieldKey: string } | null;
}

// Define a specific type for our label features
interface LabelGeoJsonFeature extends GeoJSON.Feature {
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    /** Originating MapPoint id — lets the focus-dim effect target this
     *  label's opacity by pointId match. */
    pointId: string;
    /** Primary location name. */
    nameText: string;
    /** Optional stacked field-derived labels. Empty string when none. */
    dataText: string;
    /** True for polygon-rendered points (centroid anchor); false for pins. */
    isPolygon: boolean;
  };
}

/**
 * Longest array prefix shared by two field paths.
 *
 * `document.orte[*].name` + `document.orte[*].type` → `document.orte[*]`
 * `document.orte[*].name` + `document.summary`      → null
 *
 * Used to detect when location and label fields traverse the SAME
 * array-of-objects, in which case label values must be picked by paired
 * index — picking the first label value (the default ``getAnnotationFieldValue``
 * behavior) cross-pollinates labels between markers (Canada showing "Koblenz").
 */
function findCommonArrayPrefix(a: string, b: string): string | null {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const acc: string[] = [];
  const n = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < n; i++) {
    if (partsA[i] !== partsB[i]) break;
    acc.push(partsA[i]);
    if (partsA[i].endsWith('[*]')) return acc.join('.');
  }
  return null;
}

const _normalizeMatch = (s: any): string => String(s ?? '').trim().toLowerCase();

/**
 * Pull every label value belonging to *this* marker's location from a single
 * annotation result. Two cases:
 *
 *   1. Location & label share an array prefix (the common case for nested
 *      structures like ``document.orte[*]``): pair values by array index.
 *      Only emit the label whose paired location element matches the marker.
 *
 *   2. Label is at a flat / different path (e.g. ``document.summary``): the
 *      label applies to the document as a whole, so emit it whenever the
 *      result mentions this marker's location at all.
 */
function extractLabelValuesForMarker(
  resultValue: any,
  markerKey: string,
  locationField: string,
  labelField: string,
): any[] {
  if (!markerKey) return [];

  const sharedPrefix = findCommonArrayPrefix(locationField, labelField);
  if (sharedPrefix) {
    const locs = getAnnotationFieldValuesExploded(resultValue, locationField);
    const labs = getAnnotationFieldValuesExploded(resultValue, labelField);
    const out: any[] = [];
    const m = Math.min(locs.length, labs.length);
    for (let i = 0; i < m; i++) {
      if (_normalizeMatch(locs[i]) === markerKey) out.push(labs[i]);
    }
    return out;
  }

  const allLocs = getAnnotationFieldValuesExploded(resultValue, locationField);
  const matched = allLocs.some((l) => _normalizeMatch(l) === markerKey);
  if (!matched) return [];

  if (labelField.includes('[*]')) {
    return getAnnotationFieldValuesExploded(resultValue, labelField);
  }
  const v = getAnnotationFieldValue(resultValue, labelField);
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/* ── Color scales ─────────────────────────────────────────────────────── */

/**
 * Sequential gradient for numeric color fields. Five-stop palette so a
 * marker at the low end is visually distinct from one at the high end in
 * both light and dark themes.
 */
const NUMERIC_COLOR_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0.0, '#440154'],
  [0.25, '#3b528b'],
  [0.5, '#21918c'],
  [0.75, '#5ec962'],
  [1.0, '#fde725'],
];

function _mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
  const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

function numericGradientColor(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  for (let i = 1; i < NUMERIC_COLOR_STOPS.length; i++) {
    const [t1, c1] = NUMERIC_COLOR_STOPS[i];
    const [t0, c0] = NUMERIC_COLOR_STOPS[i - 1];
    if (f <= t1) {
      const local = (f - t0) / (t1 - t0);
      return _mixHex(c0, c1, local);
    }
  }
  return NUMERIC_COLOR_STOPS[NUMERIC_COLOR_STOPS.length - 1][1];
}

const CATEGORICAL_COLORS: ReadonlyArray<string> = [
  '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#F97316', '#14B8A6', '#6366F1', '#F43F5E',
  '#84CC16', '#EF4444', '#A855F7',
];

function categoricalColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return CATEGORICAL_COLORS[Math.abs(h) % CATEGORICAL_COLORS.length];
}

/**
 * Walk the schema's output_contract to find the declared definition for a
 * field path so we can pull declared minimum/maximum bounds. Mirrors the
 * traversal in ``getTargetKeysForScheme`` so paths like
 * ``document.score`` and ``document.orte[*].rating`` both resolve.
 */
function findFieldDefinition(schema: AnnotationSchemaRead | undefined, fieldKey: string): any | null {
  if (!schema || !schema.output_contract || !fieldKey) return null;
  const props: any = (schema.output_contract as any).properties;
  if (!props) return null;
  const segments = fieldKey.split('.');
  let cursor: any = props;
  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i];
    const isArrayStep = raw.endsWith('[*]');
    const key = isArrayStep ? raw.slice(0, -3) : raw;
    if (!cursor || typeof cursor !== 'object') return null;
    const def = cursor[key];
    if (!def) return null;
    if (i === segments.length - 1) return def;
    if (isArrayStep) {
      cursor = def?.items?.properties;
    } else if (def.type === 'object' && def.properties) {
      cursor = def.properties;
    } else {
      return def;
    }
  }
  return null;
}

/** Compute the bbox of a single linear ring (outer ring of a polygon). */
function _ringBbox(ring: number[][]): [number, number, number, number] | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(maxLat)) return null;
  return [minLat, maxLat, minLon, maxLon]; // [south, north, west, east]
}

/**
 * Pick the bbox of the largest part of a Polygon/MultiPolygon. Used to
 * anchor labels and frame the camera over the *main* territory of a
 * country, ignoring overseas territories. Falls back to ``null`` when
 * the geometry is missing or unusable.
 *
 * Why "largest by bbox area" and not by polygon area: bbox area is good
 * enough — for almost every country, the mainland is the largest part by
 * any reasonable measure, and bbox area is computable in one ring-walk
 * without a triangulation library.
 */
function _largestPartBbox(geom: MapGeometry | null | undefined): [number, number, number, number] | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    const ring = (geom.coordinates as number[][][])?.[0];
    return _ringBbox(ring);
  }
  if (geom.type === 'MultiPolygon') {
    let best: [number, number, number, number] | null = null;
    let bestArea = -Infinity;
    for (const poly of (geom.coordinates as number[][][][]) ?? []) {
      const bb = _ringBbox(poly?.[0]);
      if (!bb) continue;
      const [s, n, w, e] = bb;
      const area = Math.abs((n - s) * (e - w));
      if (area > bestArea) {
        bestArea = area;
        best = bb;
      }
    }
    return best;
  }
  return null;
}

const AnnotationResultsMap: React.FC<AnnotationResultsMapProps> = ({
  infospaceId,
  runId,
  schemas,
  panelConfig,
  onUpdatePanel,
  points,
  onPointClick,
  onResultSelect,
  highlightLocation,
}) => {
  // Server-side data fetching for map row data
  const mergedFilters = useMemo(
    () => mergeFiltersAndScopes(panelConfig.local_filters, panelConfig.incoming_scopes),
    [panelConfig.local_filters, panelConfig.incoming_scopes],
  );

  // --- RolePicker wiring ----------------------------------------------------
  // `location` → field that geocodes; persisted both in
  // projection.field_mappings.location (new) and settings.geocodeSource.fieldKey
  // (back-compat so older dashboards keep working). `label` → optional marker
  // label field. Schema id stays on settings.selectedSchemaId.
  const selectedSchemaId = (panelConfig.settings?.selectedSchemaId ?? null) as number | null;
  const locationFieldFromMappings = (
    panelConfig.projection?.field_mappings?.['location'] as string | string[] | undefined
  );
  const locationField: string | undefined =
    (Array.isArray(locationFieldFromMappings) ? locationFieldFromMappings[0] : locationFieldFromMappings)
    ?? panelConfig.settings?.geocodeSource?.fieldKey;

  const panelConfigRef = useRef(panelConfig);
  panelConfigRef.current = panelConfig;

  const rolePickerValue = useMemo<RolePickerValue>(() => {
    const mappings = panelConfig.projection?.field_mappings ?? {};
    const fieldsByRole: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(mappings)) {
      if (Array.isArray(val)) fieldsByRole[key] = val.map(String);
      else if (typeof val === 'string' && val.length > 0) fieldsByRole[key] = [val];
    }
    // Back-compat: hydrate `location` role from legacy settings if projection
    // hasn't been populated yet.
    if (!fieldsByRole['location'] && panelConfig.settings?.geocodeSource?.fieldKey) {
      fieldsByRole['location'] = [panelConfig.settings.geocodeSource.fieldKey];
    }
    if (!fieldsByRole['label'] && panelConfig.settings?.labelSource?.fieldKey) {
      fieldsByRole['label'] = [panelConfig.settings.labelSource.fieldKey];
    }
    return {
      schemaId: selectedSchemaId ?? null,
      fieldsByRole,
      explosionByRole: {},
      aggregation: panelConfig.aggregation ?? {},
    };
  }, [panelConfig.projection, panelConfig.aggregation, panelConfig.settings, selectedSchemaId]);

  const handleRolePickerChange = useCallback((next: RolePickerValue) => {
    const field_mappings: Record<string, string | string[]> = {};
    for (const [role, paths] of Object.entries(next.fieldsByRole)) {
      if (paths.length === 0) continue;
      field_mappings[role] = paths.length > 1 ? paths : paths[0];
    }
    const newLocation = next.fieldsByRole['location']?.[0];
    // Legacy ``labelSource`` mirrors only the first picked field — the
    // canonical source of truth is ``field_mappings.label`` (string or
    // string[]). When the user picks multiple, ``labelSource`` carries the
    // first one so older code paths still see *something*.
    const newLabel = next.fieldsByRole['label']?.[0];
    const pc = panelConfigRef.current;
    onUpdatePanel({
      projection: {
        field_mappings,
        explosion: Object.values(next.explosionByRole).find((e) => !!e) ?? null,
      },
      aggregation: {
        ...(pc.aggregation ?? {}),
        ...(next.aggregation ?? {}),
      },
      settings: {
        ...(pc.settings ?? {}),
        selectedSchemaId: next.schemaId ?? undefined,
        // Back-compat mirror so older panel configs keep working during the
        // migration window. undefined (not null) matches the PanelSettings type.
        geocodeSource: newLocation
          ? { schemaId: next.schemaId ?? 0, fieldKey: newLocation }
          : undefined,
        labelSource: newLabel && next.schemaId
          ? { schemaId: next.schemaId, fieldKey: newLabel }
          : (pc.settings?.labelSource ?? undefined),
      },
    });
  }, [onUpdatePanel]);

  // --- Geocode action + marker accumulator ---------------------------------
  // The map panel owns its marker lifecycle now. Pressing "Geocode" kicks
  // the backend @task; the watch_url SSE feeds `resolved` events which we
  // accumulate into local state. Each entity_id is deduped so re-running
  // is safe (backend cache-hits return instantly too).
  const { watchUrl, isPending: isGeocoding, error: geocodeError, kick: kickGeocode, reset: resetGeocode } = useGeocodeAction();
  const [accumulatedPoints, setAccumulatedPoints] = useState<MapPoint[]>([]);
  const [isGeocodingActive, setIsGeocodingActive] = useState(false);

  // Forward-declared ref so the SSE callbacks below can call the seed
  // refetch defined further down. The seed query reads coords + bbox
  // straight from the DB, which is the durable backstop when the SSE
  // stream subscribes AFTER fast cache-hit ``geocode`` runs already
  // emitted all their ``resolved`` events. Without this, a re-run on
  // a fully-cached set of locations produces no client-visible change.
  const refetchSeedRef = useRef<(() => Promise<void>) | null>(null);

  useActionWatch<GeocodeResolvedPayload | GeocodeStartedPayload | GeocodeDonePayload>(watchUrl, {
    enabled: !!watchUrl,
    onEvent: (event) => {
      if (event.type === 'started') {
        setIsGeocodingActive(true);
      } else if (event.type === 'resolved') {
        const r = event.data as GeocodeResolvedPayload;
        if (!r?.coords || r.coords.length !== 2) return;
        setAccumulatedPoints((prev) => {
          const entityKey = `e${r.entity_id}`;
          const incomingBbox = (r.bbox && r.bbox.length === 4
            ? (r.bbox as [number, number, number, number])
            : undefined);
          const incomingGeometry = r.geometry ?? undefined;
          const idx = prev.findIndex((p) => p.id === entityKey);
          if (idx >= 0) {
            // Already seeded (most often by /geocoded_entities on mount).
            // Don't drop the event: a second-pass resolve typically carries
            // a bbox/geometry that the seed didn't have (legacy entities
            // geocoded before that field landed). Merge in the new fields,
            // letting the seed's documentIds win unless the event brings
            // something the existing entry lacks.
            const existing = prev[idx];
            const next: MapPoint = {
              ...existing,
              locationString: existing.locationString || (r.display_name ?? r.name ?? String(r.entity_id)),
              canonicalName: existing.canonicalName ?? r.name,
              bbox: existing.bbox ?? incomingBbox,
              geometry: existing.geometry ?? incomingGeometry,
            };
            // Skip the React update if nothing actually changed — avoids a
            // no-op rerender on every cached replay.
            if (
              next.bbox === existing.bbox
              && next.geometry === existing.geometry
              && next.locationString === existing.locationString
              && next.canonicalName === existing.canonicalName
            ) {
              return prev;
            }
            const copy = prev.slice();
            copy[idx] = next;
            return copy;
          }
          return [...prev, {
            id: entityKey,
            locationString: r.display_name ?? r.name ?? String(r.entity_id),
            canonicalName: r.name,
            coordinates: { longitude: r.coords[0], latitude: r.coords[1] },
            documentIds: [],
            bbox: incomingBbox,
            geometry: incomingGeometry,
          }];
        });
      } else if (event.type === 'done' || event.type === 'completed') {
        setIsGeocodingActive(false);
        // Backstop the SSE-race: after the task finishes, pull the
        // freshly-persisted entities from the DB so we don't depend on
        // the live event delivery to populate ``accumulatedPoints``.
        void refetchSeedRef.current?.();
      } else if (event.type === 'error' || event.type === 'failed') {
        setIsGeocodingActive(false);
      }
    },
    onDone: () => {
      setIsGeocodingActive(false);
      // ``onDone`` fires when the SSE stream itself closes (whether or
      // not we saw a ``done`` event). This second refetch covers the
      // case where the task finished BEFORE the SSE subscription even
      // opened — the most common cause of "I clicked geocode and
      // nothing changed" with cache-hit-heavy runs.
      void refetchSeedRef.current?.();
    },
  });

  // Reset accumulator when the location field *value* changes — stale
  // coords from a previous field would otherwise persist. Use a ref to
  // track the previous value so the first mount doesn't wipe an
  // already-populated accumulator (caused the "boxes never appear"
  // regression: every time the parent passed a new ``panelConfig``
  // reference React saw the reset deps as fresh and cleared the seed).
  const prevLocationFieldRef = useRef<string | undefined>(locationField);
  useEffect(() => {
    const prev = prevLocationFieldRef.current;
    prevLocationFieldRef.current = locationField;
    // First commit: if there's already a value, keep it as the baseline
    // and do nothing (seed will populate). If it's still undefined, also
    // do nothing — there's no stale state to clear.
    if (prev === locationField) return;
    if (prev === undefined) return;
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[map.reset] locationField changed', { from: prev, to: locationField });
    }
    setAccumulatedPoints([]);
    resetGeocode();
  }, [locationField, resetGeocode]);

  // Seed already-resolved coords on mount / when the field changes so
  // re-opening a previously geocoded dashboard doesn't show an empty map.
  const { entities: seededEntities, refetch: refetchSeed } = useGeocodedEntities({
    infospaceId,
    runId,
    fieldPath: locationField ?? null,
    enabled: !!infospaceId && !!runId && !!locationField,
  });
  // Wire the seed refetch into the forward-declared ref so SSE
  // callbacks (declared earlier) can reach it.
  refetchSeedRef.current = refetchSeed;
  useEffect(() => {
    if (!seededEntities || seededEntities.length === 0) return;
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[map.seed] merging seeded entities into accumulated', {
        seededCount: seededEntities.length,
        firstSample: seededEntities[0],
      });
    }
    setAccumulatedPoints((prev) => {
      const byId = new Map<string, MapPoint>();
      prev.forEach((p) => byId.set(p.id, p));
      seededEntities.forEach((e) => {
        const key = `e${e.entity_id}`;
        if (!e.coords || e.coords.length !== 2) return;
        const incomingBbox = (e.bbox as [number, number, number, number] | undefined) ?? undefined;
        const incomingGeometry = (e.geometry as MapGeometry | undefined) ?? undefined;
        const existing = byId.get(key);
        if (existing) {
          // Merge: refetch can carry a freshly-persisted bbox/geometry for
          // an entity that was already in ``accumulatedPoints`` (seeded
          // earlier without those fields, or pushed via SSE without them).
          // Prefer existing fields, only fill in what's missing.
          byId.set(key, {
            ...existing,
            bbox: existing.bbox ?? incomingBbox,
            geometry: existing.geometry ?? incomingGeometry,
            canonicalName: existing.canonicalName ?? e.name,
            locationString: existing.locationString || (e.display_name ?? e.name),
          });
          return;
        }
        byId.set(key, {
          id: key,
          locationString: e.display_name ?? e.name,
          canonicalName: e.name,
          coordinates: { longitude: e.coords[0], latitude: e.coords[1] },
          documentIds: [],
          bbox: incomingBbox,
          geometry: incomingGeometry,
        });
      });
      return Array.from(byId.values());
    });
  }, [seededEntities]);

  const handleKickGeocode = useCallback(async () => {
    if (!locationField) return;
    await kickGeocode({ infospaceId, runId, fieldPath: locationField });
    // Backstop the SSE-race window: cache-hit-heavy runs finish in ~100ms,
    // long before the SSE subscription opens, so all ``resolved`` events
    // are gone by the time we'd hear them. The @task persists everything
    // to the DB regardless, so we poll the seed endpoint a few times
    // post-dispatch and merge whatever's there. Spaced timings cover
    // both fast (cache-hit) and slow (live-geocoding) runs.
    const refetch = () => refetchSeedRef.current?.();
    setTimeout(() => { void refetch(); }, 800);   // cache-hit completion
    setTimeout(() => { void refetch(); }, 3000);  // small-batch live geocode
    setTimeout(() => { void refetch(); }, 8000);  // larger live geocode
  }, [locationField, infospaceId, runId, kickGeocode]);

  const { data: viewData } = useAnnotationView({
    infospaceId,
    runId,
    rows: { limit: 500 },
    filters: {
      logic: 'and',
      conditions: [
        ...(mergedFilters.conditions || []),
        ...(locationField ? [{ path: locationField, operator: 'exists' as const }] : []),
      ],
    },
    merge_maps: panelConfig.merge_maps,
    enabled: !!runId && !!infospaceId && !!locationField,
  });

  // Map server response to the component's expected formats
  const results = useMemo<FormattedAnnotation[]>(() => {
    if (!viewData?.rows?.items) return [];
    return viewData.rows.items.map(row => ({
      id: row.annotation_id,
      asset_id: row.asset_id,
      schema_id: row.schema_id,
      run_id: row.run_id,
      value: row.value,
      timestamp: row.timestamp,
      status: row.status as any,
    }));
  }, [viewData?.rows?.items]);

  const assets = useMemo<AssetRead[]>(() => {
    if (!viewData?.rows?.assets) return [];
    return Object.values(viewData.rows.assets).map(s => ({
      id: s.id, title: s.title, kind: s.kind as any,
      parent_asset_id: s.parent_asset_id,
      uuid: '', infospace_id: 0, source_id: null,
      created_at: '', updated_at: '', is_container: false,
      stub: false, part_index: null,
    } as AssetRead));
  }, [viewData?.rows?.assets]);

  // Compatibility shims
  // ``labelConfig`` (singular) — legacy single-label entry point. The map
  // role picker now persists ``projection.field_mappings.label`` as a
  // string OR string[] (multi-pick). ``labelConfigs`` is the multi-aware
  // derivation; ``labelConfig`` is kept around as the first item only
  // (back-compat for any code path still reading it directly).
  const labelConfigs = useMemo<{ schemaId: number; fieldKey: string }[]>(() => {
    const sid = (panelConfig.settings?.selectedSchemaId ?? null) as number | null;
    const raw = panelConfig.projection?.field_mappings?.['label'] as string | string[] | undefined;
    const paths: string[] = Array.isArray(raw)
      ? raw.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : (typeof raw === 'string' && raw.length > 0 ? [raw] : []);
    if (paths.length > 0 && sid != null) {
      return paths.map((fieldKey) => ({ schemaId: sid, fieldKey }));
    }
    // Legacy fallback: settings.labelSource (single).
    const legacy = panelConfig.settings?.labelSource;
    return legacy ? [{ schemaId: legacy.schemaId, fieldKey: legacy.fieldKey }] : [];
  }, [panelConfig.projection?.field_mappings, panelConfig.settings?.labelSource, panelConfig.settings?.selectedSchemaId]);
  const labelConfig = labelConfigs[0];
  const [timeAxisConfig] = useState<TimeAxisConfig | null>(null);
  const [variableSplittingConfig] = useState<VariableSplittingConfig | null>(null);
  const onVariableSplittingChange: ((config: VariableSplittingConfig | null) => void) | undefined = undefined;
  const mapSettingsRef = useRef(panelConfig.settings);
  mapSettingsRef.current = panelConfig.settings;
  const onSettingsChange = useCallback((settings: any) => {
    onUpdatePanel({ settings: { ...mapSettingsRef.current, ...settings } });
  }, [onUpdatePanel]);
  const initialSettings = panelConfig.settings;
  const selectedFieldsPerScheme = panelConfig.settings?.selectedFieldsPerScheme;
  const onSelectedFieldsChange = useCallback((fields: Record<number, string[]>) => {
    onUpdatePanel({ settings: { ...mapSettingsRef.current, selectedFieldsPerScheme: fields } });
  }, [onUpdatePanel]);
  // ``viewMode`` controls how marker geometry is rendered:
  //   - ``'pointer'`` (default): pin markers, no polygons.
  //   - ``'polygon'``: render bbox polygons for points that have meaningful
  //     bounding boxes; pin markers are hidden for those points (markers
  //     for points without bbox stay so users don't lose data points).
  // Older panel configs persisted ``showAreas`` instead — we read it as a
  // back-compat fallback so existing dashboards keep their visual.
  const viewMode: 'pointer' | 'polygon' =
    (panelConfig.settings?.viewMode as 'pointer' | 'polygon' | undefined)
    ?? (panelConfig.settings?.showAreas ? 'polygon' : 'pointer');
  const showAreas = viewMode === 'polygon';
  const setViewMode = useCallback((next: 'pointer' | 'polygon') => {
    onUpdatePanel({
      settings: {
        ...mapSettingsRef.current,
        viewMode: next,
        // Keep showAreas in sync so any older code paths still see the
        // right value during the migration window.
        showAreas: next === 'polygon',
      },
    });
  }, [onUpdatePanel]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceScope, setEvidenceScope] = useState<Scope | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  // Bumped on every ``style.load`` (initial load + each subsequent
  // ``setStyle``). Mapbox-native sources/layers (labels, areas) are wiped
  // on style change, so the effects that own them depend on this counter
  // to know when to re-add their layers. HTML ``mapboxgl.Marker`` instances
  // survive ``setStyle`` and don't need it.
  const [styleVersion, setStyleVersion] = useState(0);
  const [isGlobeView, setIsGlobeView] = useState(false);
  // Left-side locations panel — toggleable via the locations chip in the
  // toolbar. Search query lives here too so opening/closing the panel
  // doesn't lose what the user typed.
  const [locationsPanelOpen, setLocationsPanelOpen] = useState(false);
  const [locationsSearch, setLocationsSearch] = useState('');
  const { theme: pageTheme } = useTheme();
  // Map theme is independent from the page theme. Persisted on the panel
  // so it survives reloads, defaults to whatever the page theme was the
  // first time the panel rendered. Toggling the in-map theme button only
  // flips this — it does NOT call ``setTheme`` from next-themes anymore,
  // so the rest of the page stays put.
  const mapTheme: 'light' | 'dark' = (() => {
    const stored = panelConfig.settings?.mapTheme as 'light' | 'dark' | undefined;
    if (stored === 'light' || stored === 'dark') return stored;
    return pageTheme === 'dark' ? 'dark' : 'light';
  })();
  // Captures the map theme at mount so the create-effect can pick the
  // initial Mapbox style without rebuilding the whole map on every toggle.
  const themeRef = useRef(mapTheme);
  themeRef.current = mapTheme;

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiamltdnciLCJhIjoiY20xd2U3Z2pqMGprdDJqczV2OXJtMTBoayJ9.hlSx0Nc19j_Z1NRgyX7HHg';

  // NEW: Apply time frame filtering and variable splitting
  const assetsMap = useMemo(() => new Map((assets || []).map(asset => [asset.id, asset])), [assets]);
  
  const timeFilteredResults = useMemo(() => {
    if (!timeAxisConfig?.timeFrame?.enabled || !timeAxisConfig.timeFrame.startDate || !timeAxisConfig.timeFrame.endDate) {
      return results;
    }

    const { startDate, endDate } = timeAxisConfig.timeFrame;
    
    return results.filter(result => {
      const timestamp = getTimestamp(result, assetsMap, timeAxisConfig);
      if (!timestamp) return false;
      
      return timestamp >= startDate && timestamp <= endDate;
    });
  }, [results, timeAxisConfig, assetsMap]);

  const processedResults = useMemo(() => {
    if (variableSplittingConfig?.enabled) {
      return applySplittingToResults(timeFilteredResults, variableSplittingConfig);
    }
    return { all: timeFilteredResults };
  }, [timeFilteredResults, variableSplittingConfig]);

  // Merge legacy seed points (from PanelRenderer) with the SSE accumulator.
  // The accumulator wins on dedup by id so re-runs stay stable.
  const mergedPoints = useMemo<MapPoint[]>(() => {
    const seed = points ?? [];
    if (accumulatedPoints.length === 0) return seed;
    const byId = new Map<string, MapPoint>();
    seed.forEach((p) => byId.set(p.id, p));
    accumulatedPoints.forEach((p) => byId.set(p.id, p));
    return Array.from(byId.values());
  }, [points, accumulatedPoints]);

  // Enrich markers with the annotations whose location value matches the
  // marker's canonical name. Without this step every marker shows "0 docs"
  // because the seed/resolve events carry an empty ``documentIds``. Matching
  // walks:
  //   - flat / nested / unwrapped ``document.*`` conventions
  //   - ``[*]`` segments (the path may go through an array-of-objects like
  //     ``document.triplets[*].location``; we iterate all elements)
  //   - leaves that are arrays of strings (``locations`` as ``string[]``)
  // Case-insensitive so Nominatim's capitalization doesn't break equality.
  const markersWithDocuments = useMemo<MapPoint[]>(() => {
    if (!locationField || results.length === 0) return mergedPoints;

    const parsePath = (p: string): string[] => p.split('.');
    const parts = parsePath(locationField);
    const unwrapped = parts[0] === 'document' ? parts.slice(1) : null;

    // Walk the leaf and emit zero-or-more lowercase location strings.
    // Mirrors the backend's ``_extract_location_strings`` so frontend
    // marker→annotation matching covers the same shapes the geocoder
    // resolves: plain strings, arrays of strings, entity dicts (``{name,
    // ...}``), and arrays of entity dicts.
    const emitLeaf = (node: any, out: string[]) => {
      if (typeof node === 'string') {
        const s = node.trim().toLowerCase();
        if (s) out.push(s);
        return;
      }
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const name = (node as any).name;
        if (typeof name === 'string') {
          const s = name.trim().toLowerCase();
          if (s) out.push(s);
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) emitLeaf(item, out);
      }
    };

    const extract = (value: any, path: string[]): string[] => {
      const out: string[] = [];
      const visit = (node: any, i: number) => {
        if (node == null) return;
        if (i === path.length) {
          emitLeaf(node, out);
          return;
        }
        const seg = path[i];
        const isArrayStep = seg.endsWith('[*]');
        const key = isArrayStep ? seg.slice(0, -3) : seg;
        const next = typeof node === 'object' ? (node as any)[key] : undefined;
        if (isArrayStep) {
          if (Array.isArray(next)) {
            for (const item of next) visit(item, i + 1);
          }
        } else {
          visit(next, i + 1);
        }
      };
      visit(value, 0);
      return out;
    };

    const byLocation = new Map<string, Set<number>>();
    for (const r of results) {
      const primary = extract(r.value, parts);
      const fallback = primary.length === 0 && unwrapped
        ? extract(r.value, unwrapped)
        : [];
      const all = primary.length > 0 ? primary : fallback;
      for (const v of all) {
        let bucket = byLocation.get(v);
        if (!bucket) {
          bucket = new Set();
          byLocation.set(v, bucket);
        }
        bucket.add(r.asset_id);
      }
    }

    return mergedPoints.map((p) => {
      // Match by canonical name (raw value in annotations); display name is
      // the verbose geocoder form that wouldn't match.
      const key = (p.canonicalName ?? p.locationString ?? '').trim().toLowerCase();
      const ids = byLocation.get(key);
      if (!ids || ids.size === 0) return p;
      return { ...p, documentIds: Array.from(ids) };
    });
  }, [mergedPoints, results, locationField]);

  // NEW: Process points to handle variable splitting
  const processedPoints = useMemo(() => {
    if (variableSplittingConfig?.enabled && Object.keys(processedResults).length > 1) {
      // Create split-specific points
      const splitPoints: MapPoint[] = [];

      Object.entries(processedResults).forEach(([splitValue, splitResults]) => {
        if (splitResults.length > 0) {
          // Group results by location for this split
          const locationGroups = new Map<string, number[]>();

          splitResults.forEach(result => {
            const point = mergedPoints.find(p => p.documentIds.includes(result.asset_id));
            if (point) {
              const locationKey = `${point.coordinates.latitude},${point.coordinates.longitude}`;
              if (!locationGroups.has(locationKey)) {
                locationGroups.set(locationKey, []);
              }
              if (!locationGroups.get(locationKey)!.includes(result.asset_id)) {
                locationGroups.get(locationKey)!.push(result.asset_id);
              }
            }
          });

          // Create points for each location with split identifiers
          locationGroups.forEach((documentIds, locationKey) => {
            const originalPoint = mergedPoints.find(p =>
              documentIds.some(docId => p.documentIds.includes(docId))
            );

            if (originalPoint) {
              splitPoints.push({
                ...originalPoint,
                id: `${originalPoint.id}_split_${splitValue}`,
                locationString: `${originalPoint.locationString} (${splitValue})`,
                documentIds: documentIds,
                splitValue: splitValue !== 'all' ? splitValue : undefined
              });
            }
          });
        }
      });

      return splitPoints;
    }

    // Return enriched points if no splitting
    return markersWithDocuments;
  }, [markersWithDocuments, mergedPoints, processedResults, variableSplittingConfig]);

  // Use processed results and points for display
  const resultsForMap = useMemo(() => {
    return processedResults.all || timeFilteredResults;
  }, [processedResults, timeFilteredResults]);

  // ``group_by`` role from the role picker. Numeric fields use a sequential
  // gradient (range from declared minimum/maximum, otherwise the same
  // ``inferRangeFromValues`` rules the table's NumberCell uses); strings/enums
  // use a deterministic categorical palette so the same value always picks
  // the same hex across panel renders.
  const colorField: string | undefined = (() => {
    const m = panelConfig.projection?.field_mappings?.['group_by'];
    return Array.isArray(m) ? m[0] : (typeof m === 'string' ? m : undefined);
  })();
  const colorSchemaId = selectedSchemaId;

  // Optional per-value color override map, persisted on the panel so
  // user picks survive reload. Keyed off the field path so different
  // ``group_by`` selections don't trample each other.
  const colorOverridesForField = useMemo<Record<string, string>>(() => {
    const all = (panelConfig.settings?.colorOverrides ?? {}) as Record<string, Record<string, string>>;
    if (!colorField) return {};
    return all[colorField] ?? {};
  }, [panelConfig.settings?.colorOverrides, colorField]);

  // Hidden color-values: when set, points whose group_by value falls in
  // this set are dropped from the rendered map (kept in the locations
  // list so the user can still see them). Keyed per field for the same
  // reason as the override map.
  const hiddenColorValues = useMemo<Set<string>>(() => {
    const all = (panelConfig.settings?.hiddenColorValues ?? {}) as Record<string, string[]>;
    if (!colorField) return new Set();
    return new Set(all[colorField] ?? []);
  }, [panelConfig.settings?.hiddenColorValues, colorField]);

  // ``pointToColorValue`` — for each point, the first non-empty
  // categorical value at ``colorField``. Used both by the visiblePoints
  // filter (drop points whose value is in ``hiddenColorValues``) and by
  // ``colorBundle`` below (assign hex + build legend rows). Numeric
  // group_by leaves this map empty since the legend doesn't apply.
  const pointToColorValue = useMemo<Map<string, string>>(() => {
    const out = new Map<string, string>();
    if (!colorField || !colorSchemaId || processedPoints.length === 0) return out;
    const targetKeys = getTargetKeysForScheme(colorSchemaId, schemas, { includeArrayItemFields: true });
    const fieldInfo = targetKeys.find((tk) => tk.key === colorField);
    const isNumeric = !!fieldInfo && (fieldInfo.type === 'integer' || fieldInfo.type === 'number');
    if (isNumeric) return out; // gradient mode — categorical values don't apply
    for (const p of processedPoints) {
      const markerKey = _normalizeMatch(p.canonicalName ?? p.locationString);
      let firstVal: string | undefined;
      for (const r of resultsForMap) {
        if (!p.documentIds.includes(r.asset_id)) continue;
        if (r.schema_id !== colorSchemaId) continue;
        const matches = locationField
          ? extractLabelValuesForMarker(r.value, markerKey, locationField, colorField)
          : (() => {
              if (colorField.includes('[*]')) {
                return getAnnotationFieldValuesExploded(r.value, colorField);
              }
              const v = getAnnotationFieldValue(r.value, colorField);
              if (v == null) return [];
              return Array.isArray(v) ? v : [v];
            })();
        for (const v of matches) {
          if (v == null) continue;
          const s = String(v).trim();
          if (!s) continue;
          firstVal = s;
          break;
        }
        if (firstVal != null) break;
      }
      if (firstVal != null) out.set(p.id, firstVal);
    }
    return out;
  }, [colorField, colorSchemaId, processedPoints, resultsForMap, schemas, locationField]);

  // Per-point visibility (persisted on panel settings as ``hiddenPointIds``).
  // Used to hide world-spanning bboxes (e.g. "Russia") that would otherwise
  // dominate the canvas, without yanking the row out of the locations list.
  const hiddenPointIds = useMemo<Set<string>>(() => {
    const arr = panelConfig.settings?.hiddenPointIds;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  }, [panelConfig.settings?.hiddenPointIds]);

  const togglePointHidden = useCallback((pointId: string) => {
    const cur = new Set(
      Array.isArray(mapSettingsRef.current?.hiddenPointIds)
        ? (mapSettingsRef.current.hiddenPointIds as string[])
        : []
    );
    if (cur.has(pointId)) cur.delete(pointId);
    else cur.add(pointId);
    onUpdatePanel({
      settings: {
        ...mapSettingsRef.current,
        hiddenPointIds: Array.from(cur),
      },
    });
  }, [onUpdatePanel]);

  // ``visiblePoints`` is what the map actually renders (markers, polygons,
  // labels). The locations list still iterates the full ``processedPoints``
  // so users can see — and unhide — points they've toggled off. Two
  // independent filters live here:
  //   - ``hiddenPointIds`` — per-point eye toggle in the locations list
  //   - ``hiddenColorValues`` — legend toggle: drop every point whose
  //     ``group_by`` value is ticked off
  const visiblePoints = useMemo<MapPoint[]>(() => {
    const hidByPid = hiddenPointIds.size > 0;
    const hidByColor = hiddenColorValues.size > 0;
    if (!hidByPid && !hidByColor) return processedPoints;
    return processedPoints.filter((p) => {
      if (hidByPid && hiddenPointIds.has(p.id)) return false;
      if (hidByColor) {
        const v = pointToColorValue.get(p.id);
        if (v != null && hiddenColorValues.has(v)) return false;
      }
      return true;
    });
  }, [processedPoints, hiddenPointIds, hiddenColorValues, pointToColorValue]);

  // Points eligible for polygon rendering. A point qualifies if it has
  // either:
  //   1. A real GeoJSON ``geometry`` (Polygon/MultiPolygon) from Nominatim —
  //      preferred; gives mainland + overseas territories as separate parts
  //      so France doesn't span the Atlantic.
  //   2. A bbox with non-trivial area as fallback for entries geocoded
  //      before geometry persistence landed.
  // Driven off ``visiblePoints`` so a hidden point's polygon disappears
  // alongside its marker. Coerces stringified bbox values — legacy entries
  // written before the provider was hardened can carry ``["35.6", ...]``
  // which would otherwise NaN out and silently reject every polygon.
  const pointsWithMeaningfulAreas = useMemo(() => {
    const AREA_THRESHOLD = 0.001; // Minimum bbox area in square degrees (~100km²)

    return visiblePoints.filter((point) => {
      // Real geometry wins regardless of bbox. POIs without geometry but
      // with a bbox still get rect rendering.
      if (point.geometry && (point.geometry.type === 'Polygon' || point.geometry.type === 'MultiPolygon')) {
        return true;
      }
      if (!point.bbox || point.bbox.length !== 4) return false;
      const south = Number(point.bbox[0]);
      const north = Number(point.bbox[1]);
      const west = Number(point.bbox[2]);
      const east = Number(point.bbox[3]);
      if (![south, north, west, east].every(Number.isFinite)) return false;
      const area = Math.abs((north - south) * (east - west));
      return area >= AREA_THRESHOLD;
    });
  }, [visiblePoints]);

  // In polygon mode, suppress the centroid pin for any point that already
  // renders as a polygon — the polygon IS the visual, a pin on top is just
  // noise. Points without a meaningful bbox keep their pin so they stay
  // findable. Pointer mode always shows pins.
  const markerPoints = useMemo<MapPoint[]>(() => {
    if (viewMode === 'pointer') return visiblePoints;
    const polygonIds = new Set(pointsWithMeaningfulAreas.map((p) => p.id));
    return visiblePoints.filter((p) => !polygonIds.has(p.id));
  }, [visiblePoints, viewMode, pointsWithMeaningfulAreas]);

  // Quick lookup: is this point being rendered as a polygon right now?
  // Used by the label layout so polygon-covered labels sit on the lower
  // edge of the bbox, while plain-marker labels stay at the centroid.
  const polygonRenderedIds = useMemo<Set<string>>(() => {
    if (!showAreas) return new Set();
    return new Set(pointsWithMeaningfulAreas.map((p) => p.id));
  }, [showAreas, pointsWithMeaningfulAreas]);

  // Bundle: ``colorMap`` (pointId → hex), ``entries`` (legend rows), and
  // a flag telling the legend whether to render swatches (categorical)
  // or skip itself (numeric — a gradient bar is a different UI). Reads
  // the per-point value from ``pointToColorValue`` so the work upstream
  // isn't duplicated; numeric mode walks results directly since it
  // needs every numeric value (not just the first) for averaging.
  const colorBundle = useMemo<{
    colorMap: Map<string, string>;
    entries: { value: string; color: string; count: number }[];
    isNumeric: boolean;
  }>(() => {
    const colorMap = new Map<string, string>();
    const entries: { value: string; color: string; count: number }[] = [];
    if (!colorField || !colorSchemaId || processedPoints.length === 0) {
      return { colorMap, entries, isNumeric: false };
    }

    const schema = schemas.find((s) => s.id === colorSchemaId);
    const targetKeys = getTargetKeysForScheme(colorSchemaId, schemas, { includeArrayItemFields: true });
    const fieldInfo = targetKeys.find((tk) => tk.key === colorField);
    const isNumeric = !!fieldInfo && (fieldInfo.type === 'integer' || fieldInfo.type === 'number');

    if (isNumeric) {
      const declaredDef = findFieldDefinition(schema, colorField);
      let range = readDeclaredRange(declaredDef);
      const valuesPerPoint = new Map<string, number[]>();
      for (const p of processedPoints) {
        const markerKey = _normalizeMatch(p.canonicalName ?? p.locationString);
        const nums: number[] = [];
        for (const r of resultsForMap) {
          if (!p.documentIds.includes(r.asset_id)) continue;
          if (r.schema_id !== colorSchemaId) continue;
          const matches = locationField
            ? extractLabelValuesForMarker(r.value, markerKey, locationField, colorField)
            : (() => {
                if (colorField.includes('[*]')) {
                  return getAnnotationFieldValuesExploded(r.value, colorField);
                }
                const v = getAnnotationFieldValue(r.value, colorField);
                if (v == null) return [];
                return Array.isArray(v) ? v : [v];
              })();
          for (const v of matches) {
            const n = Number(v);
            if (Number.isFinite(n)) nums.push(n);
          }
        }
        if (nums.length > 0) valuesPerPoint.set(p.id, nums);
      }
      if (!range) {
        const flat: number[] = [];
        for (const arr of valuesPerPoint.values()) for (const n of arr) flat.push(n);
        range = inferRangeFromValues(flat);
        if (!range && flat.length > 0) {
          const min = Math.min(...flat);
          const max = Math.max(...flat);
          if (max > min) range = { min, max, source: 'observed', integer: false };
        }
      }
      if (range && range.max > range.min) {
        for (const [pid, nums] of valuesPerPoint.entries()) {
          const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
          const f = (avg - range.min) / (range.max - range.min);
          colorMap.set(pid, numericGradientColor(f));
        }
      }
      return { colorMap, entries, isNumeric: true };
    }

    // Categorical: assign each point its first non-empty value (already
    // computed in ``pointToColorValue``), run that value through the
    // deterministic palette, then allow per-value overrides to win.
    // Build the legend from per-value document counts so the legend
    // reflects the same information the marker count badges do.
    const valueCount = new Map<string, number>();
    for (const p of processedPoints) {
      const valueKey = pointToColorValue.get(p.id);
      if (!valueKey) continue;
      const baseColor = categoricalColor(valueKey);
      const finalColor = colorOverridesForField[valueKey] ?? baseColor;
      colorMap.set(p.id, finalColor);
      valueCount.set(valueKey, (valueCount.get(valueKey) ?? 0) + p.documentIds.length);
    }
    const sortedValues = Array.from(valueCount.entries()).sort((a, b) => b[1] - a[1]);
    for (const [value, count] of sortedValues) {
      const baseColor = categoricalColor(value);
      const finalColor = colorOverridesForField[value] ?? baseColor;
      entries.push({ value, color: finalColor, count });
    }

    return { colorMap, entries, isNumeric: false };
  }, [colorField, colorSchemaId, processedPoints, resultsForMap, schemas, locationField, colorOverridesForField, pointToColorValue]);

  const colorMap = colorBundle.colorMap;
  const colorEntries = colorBundle.entries;
  const colorIsNumeric = colorBundle.isNumeric;

  // Persist a per-value color override (or clear it). Drives the
  // <input type="color"> in the legend. Stored under
  // ``settings.colorOverrides[colorField][value]`` so multiple group_by
  // selections each keep their own palette state.
  const setColorOverride = useCallback((value: string, hex: string | null) => {
    if (!colorField) return;
    const all = { ...((mapSettingsRef.current?.colorOverrides ?? {}) as Record<string, Record<string, string>>) };
    const forField = { ...(all[colorField] ?? {}) };
    if (hex == null) delete forField[value];
    else forField[value] = hex;
    if (Object.keys(forField).length === 0) delete all[colorField];
    else all[colorField] = forField;
    onUpdatePanel({
      settings: { ...mapSettingsRef.current, colorOverrides: all },
    });
  }, [colorField, onUpdatePanel]);

  // Toggle one value in the hidden-set, or set the hidden-set wholesale
  // (used for the toggle-all button).
  const toggleColorValueHidden = useCallback((value: string) => {
    if (!colorField) return;
    const all = { ...((mapSettingsRef.current?.hiddenColorValues ?? {}) as Record<string, string[]>) };
    const cur = new Set(all[colorField] ?? []);
    if (cur.has(value)) cur.delete(value);
    else cur.add(value);
    if (cur.size === 0) delete all[colorField];
    else all[colorField] = Array.from(cur);
    onUpdatePanel({
      settings: { ...mapSettingsRef.current, hiddenColorValues: all },
    });
  }, [colorField, onUpdatePanel]);

  const setColorValuesHidden = useCallback((values: string[]) => {
    if (!colorField) return;
    const all = { ...((mapSettingsRef.current?.hiddenColorValues ?? {}) as Record<string, string[]>) };
    if (values.length === 0) delete all[colorField];
    else all[colorField] = values;
    onUpdatePanel({
      settings: { ...mapSettingsRef.current, hiddenColorValues: all },
    });
  }, [colorField, onUpdatePanel]);

  // Legend visibility + collapsed state. Collapsed = single tiny chip
  // that expands on click; hidden = nothing on screen at all (toolbar
  // button can bring it back).
  const legendVisible: boolean = panelConfig.settings?.legendVisible !== false;
  const legendCollapsed: boolean = !!panelConfig.settings?.legendCollapsed;
  const setLegendVisible = useCallback((v: boolean) => {
    onUpdatePanel({ settings: { ...mapSettingsRef.current, legendVisible: v } });
  }, [onUpdatePanel]);
  const setLegendCollapsed = useCallback((v: boolean) => {
    onUpdatePanel({ settings: { ...mapSettingsRef.current, legendCollapsed: v } });
  }, [onUpdatePanel]);

  const toggleProjection = useCallback(() => {
    if (mapRef.current && mapLoaded) {
      const newProjection = isGlobeView ? 'mercator' : 'globe';
      mapRef.current.setProjection(newProjection as any);
      setIsGlobeView(!isGlobeView);
    }
  }, [isGlobeView, mapLoaded]);

  const toggleTheme = useCallback(() => {
    onUpdatePanel({
      settings: {
        ...mapSettingsRef.current,
        mapTheme: mapTheme === 'dark' ? 'light' : 'dark',
      },
    });
  }, [mapTheme, onUpdatePanel]);

  // Two-tier click flow:
  //   - First click on a marker/polygon → opens the lightweight preview
  //     card via ``setSelectedPoint``. The card surfaces the location
  //     name, doc/result counts, coordinates, and a CTA.
  //   - "Open details" CTA on the preview → fires ``openEvidenceForPoint``
  //     which builds the scope and opens the EvidenceDrawer.
  // The previous behavior (always opening the drawer on click) was too
  // noisy for casual scanning; the preview gives a fast sniff before the
  // user commits to the heavyweight drill.
  const handlePointClick = useCallback((point: MapPoint) => {
    setSelectedPoint(point);
  }, []);

  const openEvidenceForPoint = useCallback((point: MapPoint) => {
    if (!locationField) return;
    const matchValue = point.canonicalName ?? point.locationString;
    if (!matchValue) return;
    const scope = createScopeFromSelection(
      panelConfigRef.current.id,
      { type: 'click', fieldPath: locationField, data: matchValue },
      panelConfigRef.current,
      'push',
    );
    setEvidenceScope(scope);
    setEvidenceOpen(true);
  }, [locationField]);

  const handleClosePopup = useCallback(() => {
    setSelectedPoint(null);
  }, []);

  // Map resize effect removed since overlay is now opaque and doesn't require map resizing

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: themeRef.current === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [13.4050, 52.5200], // Center of Berlin
      zoom: 3,
      projection: 'mercator' as any // Start with flat view
    });

    map.on('load', () => {
      setMapLoaded(true);
    });
    // Fires on initial load AND after every ``setStyle`` (e.g. theme toggle).
    // Bumping ``styleVersion`` re-triggers label/area effects so they re-add
    // their sources/layers — those are wiped when Mapbox swaps the style.
    map.on('style.load', () => {
      setStyleVersion((v) => v + 1);
    });

    mapRef.current = map;

    // Set up ResizeObserver to handle container resize
    if (mapContainerRef.current && 'ResizeObserver' in window) {
      resizeObserverRef.current = new ResizeObserver(
        debounce(() => {
          if (mapRef.current) {
            // Trigger map resize after a short delay to ensure container has finished resizing
            setTimeout(() => {
              if (mapRef.current) {
                mapRef.current.resize();
              }
            }, 100);
          }
        }, 250)
      );
      
      resizeObserverRef.current.observe(mapContainerRef.current);
    }

    return () => {
      // Clean up resize observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      
      // Clean up markers when map is removed
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      map.remove();
    };
    // Only recreate the map if the token changes. Theme is handled by the
    // dedicated ``setStyle`` effect below — recreating the whole map on
    // every toggle would wipe markers and force a re-fitBounds.
  }, [MAPBOX_TOKEN]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    
    // Function to add markers when style is ready
    const addMarkers = () => {
      // Safety check - make sure map is still valid
      if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
        return;
      }

      try {
        // Clean up existing markers
        markersRef.current.forEach(marker => marker.remove());
        markersRef.current = [];

        const bounds = new mapboxgl.LngLatBounds();

        // Frame the camera around the visible points only — hiding a
        // world-spanning bbox should actually relax the framing, not still
        // force "fit the entire globe".
        visiblePoints.forEach((p) => {
          bounds.extend([p.coordinates.longitude, p.coordinates.latitude]);
        });

        // Minimal triangle markers — downward-pointing apex sits exactly
        // at the location coord (``anchor: 'bottom'``). Quieter than
        // Mapbox's teardrop and reads as "marker pointing here" without
        // the visual weight. Color comes from ``colorMap`` (group_by
        // role) when set, otherwise theme-default blue.
        //
        // Hover scale lives on an INNER element so it doesn't fight
        // Mapbox's positioning transform on the wrapper — applying
        // ``transform: scale()`` to the wrapper overwrites Mapbox's
        // ``transform: translate(...)`` and snaps the marker to (0,0).
        const ringColor = mapTheme === 'dark' ? '#0f172a' : '#ffffff';
        const defaultMarkerColor = mapTheme === 'dark' ? '#60a5fa' : '#2563eb';

        markerPoints.forEach((point) => {
          const { longitude, latitude } = point.coordinates;
          const markerColor = colorMap.get(point.id) ?? defaultMarkerColor;

          const wrapper = document.createElement('div');
          wrapper.style.cssText = 'cursor: pointer; line-height: 0; transition: opacity 200ms ease;';
          // Tag the wrapper with the point id so the focus-dim effect
          // can find this marker without rebuilding the marker map.
          wrapper.dataset.pointId = point.id;

          const inner = document.createElement('div');
          inner.style.cssText = [
            'transition: transform 120ms ease, filter 120ms ease',
            'filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
            'transform-origin: 50% 100%', // scale around the apex (bottom)
          ].join(';');
          inner.innerHTML = `
            <svg width="12" height="14" viewBox="0 0 12 14" xmlns="http://www.w3.org/2000/svg">
              <polygon points="1,1 11,1 6,13"
                fill="${markerColor}"
                stroke="${ringColor}"
                stroke-width="1.5"
                stroke-linejoin="round" />
            </svg>
          `;
          wrapper.appendChild(inner);

          wrapper.addEventListener('mouseenter', () => {
            inner.style.transform = 'scale(1.25)';
            inner.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))';
          });
          wrapper.addEventListener('mouseleave', () => {
            inner.style.transform = 'scale(1)';
            inner.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))';
          });
          wrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            handlePointClick(point);
          });

          const marker = new mapboxgl.Marker({ element: wrapper, anchor: 'bottom' })
            .setLngLat([longitude, latitude])
            .addTo(map);
          markersRef.current.push(marker);
        });

        // Fit map to bounds. Symmetric padding → content at canvas
        // center. The overlays (locations panel, preview card) are
        // floating absolute elements, not canvas-resizing chrome, so
        // they cover whatever they cover; we don't try to shift the
        // camera to compensate.
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 50, maxZoom: 15 });
        }
      } catch (error) {
        console.warn('Error adding map markers:', error);
      }
    };

    // Check if style is loaded before adding markers
    if (map.isStyleLoaded()) {
      addMarkers();
    } else {
      // Wait for style to load, then add markers
      map.once('style.load', addMarkers);
    }

    // Cleanup function to remove existing markers
    return () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
    };
  }, [visiblePoints, markerPoints, mapLoaded, handlePointClick, colorMap, mapTheme]);

  // Label generation. Two distinct streams so the map can render them with
  // different anchors:
  //   - ``nameFeatures``: the main location string. For polygons, anchored
  //     above the NW corner of the *largest* polygon part so the label
  //     hovers over mainland France instead of mid-Atlantic when France
  //     pulls in overseas territories. For pins, this carries the combined
  //     name + data labels at centroid (the existing single-label feel).
  //   - ``dataFeatures``: only the stacked annotation-derived labels, only
  //     for polygon-rendered points, anchored at the south edge midpoint
  //     of the largest polygon part. Empty for pins (those carry their data
  //     in the combined ``nameFeatures`` label).
  //
  // Field-value gathering itself is unchanged: ``extractLabelValuesForMarker``
  // walks shared array prefixes so a Canada marker doesn't show "Koblenz".
  const labelData = useMemo(() => {
    if (visiblePoints.length === 0) {
      return null;
    }

    const schemeLookup = new Map(schemas.map((s) => [s.id, s]));
    const STACK_CAP = 4;
    const PER_VALUE_CAP = 30;

    // Single feature stream. Each feature carries both ``nameText`` and
    // (optional) ``dataText`` so the layer paint can render them as one
    // unit via a ``format`` expression with per-segment colors. This
    // keeps the name + data labels visibility-consistent — Mapbox's
    // collision detector evaluates them as a single bounding box, so
    // they show or hide together. (Two separate layers were getting
    // independently culled, dropping the name while keeping the smaller
    // data label.)
    const labelFeatures: LabelGeoJsonFeature[] = [];

    for (const point of visiblePoints) {
      const isPolygon = polygonRenderedIds.has(point.id);
      // Pin markers without docs are noise — drop their labels. Polygons
      // always get a label so the box is identifiable on its own (the
      // box is visible regardless of whether annotations matched it).
      if (!isPolygon && !point.documentIds.length) continue;

      // Gather field-driven label text — multi-field aware. Each picked
      // label field contributes one (or a few) lines. When more than one
      // field is in play, each line gets a ``Field: `` prefix so the
      // marker reads as ``Population: 5.4M / GDP: 0.3T`` instead of two
      // bare numbers; with a single field, the prefix is omitted to keep
      // the marker compact.
      let dataText = '';
      if (locationField && labelConfigs.length > 0 && resultsForMap.length > 0) {
        const showFieldNames = labelConfigs.length > 1;
        const lines: string[] = [];
        const markerKey = _normalizeMatch(point.canonicalName ?? point.locationString);
        for (const cfg of labelConfigs) {
          if (!schemas.some((s) => s.id === cfg.schemaId)) continue;
          const schema = schemeLookup.get(cfg.schemaId);
          if (!schema) continue;
          const locationResults = resultsForMap.filter((r) =>
            point.documentIds.includes(r.asset_id) && r.schema_id === cfg.schemaId,
          );
          if (locationResults.length === 0) continue;

          // ``includeArrayItemFields`` so paths like ``document.orte[*].type``
          // resolve to a real field instead of falling through as ``unknown``.
          const targetKeys = getTargetKeysForScheme(cfg.schemaId, schemas, { includeArrayItemFields: true });
          const fieldInfo = targetKeys.find((tk) => tk.key === cfg.fieldKey);
          const isNumericField = !!fieldInfo && (fieldInfo.type === 'integer' || fieldInfo.type === 'number');
          const fieldLabel = fieldInfo?.name
            ?? formatFieldNameForDisplay(cfg.fieldKey).displayName
            ?? cfg.fieldKey;

          const collected: any[] = [];
          for (const r of locationResults) {
            const matches = extractLabelValuesForMarker(
              r.value,
              markerKey,
              locationField,
              cfg.fieldKey,
            );
            for (const v of matches) collected.push(v);
          }
          if (collected.length === 0) continue;

          if (isNumericField) {
            const nums = collected.map(Number).filter((n) => Number.isFinite(n));
            if (nums.length === 0) continue;
            const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
            const formatted = Number.isInteger(avg) ? String(avg) : avg.toFixed(2);
            const suffix = nums.length > 1 ? ` (${nums.length})` : '';
            const valueText = `${formatted}${suffix}`;
            lines.push(showFieldNames ? `${fieldLabel}: ${valueText}` : valueText);
          } else {
            const seen = new Set<string>();
            const unique: string[] = [];
            for (const v of collected) {
              if (v == null) continue;
              const s = String(v).trim();
              if (!s) continue;
              const k = s.toLowerCase();
              if (seen.has(k)) continue;
              seen.add(k);
              unique.push(s);
            }
            if (unique.length === 0) continue;
            // Per-field cap: with multiple fields, keep each entry to a
            // single line (first 2 values + "…") so the stacked label
            // doesn't grow unboundedly tall. With one field, preserve
            // the existing multi-line stacking up to STACK_CAP.
            if (showFieldNames) {
              const shown = unique.slice(0, 2).map((s) =>
                s.length > PER_VALUE_CAP ? `${s.slice(0, PER_VALUE_CAP)}…` : s,
              );
              const more = unique.length - shown.length;
              const tail = more > 0 ? `, +${more}` : '';
              lines.push(`${fieldLabel}: ${shown.join(', ')}${tail}`);
            } else {
              const shown = unique.slice(0, STACK_CAP).map((s) =>
                s.length > PER_VALUE_CAP ? `${s.slice(0, PER_VALUE_CAP)}…` : s,
              );
              const more = unique.length - shown.length;
              lines.push(`${shown.join('\n')}${more > 0 ? `\n+${more} more` : ''}`);
            }
          }
        }
        dataText = lines.join('\n');
      }

      let coords: [number, number];
      if (isPolygon) {
        // Anchor at the centroid of the largest polygon part — for a
        // MultiPolygon this is mainland (e.g. France's mainland centroid,
        // not somewhere mid-Atlantic). Bbox center is a good-enough proxy
        // for most admin shapes.
        const partBbox = _largestPartBbox(point.geometry ?? null);
        const fallbackBbox = (point.bbox && point.bbox.length === 4)
          ? point.bbox.map((v) => Number(v)) as [number, number, number, number]
          : null;
        const useBbox = partBbox && partBbox.every((v) => Number.isFinite(v))
          ? partBbox
          : (fallbackBbox && fallbackBbox.every((v) => Number.isFinite(v)) ? fallbackBbox : null);
        if (!useBbox) continue;
        const [south, north, west, east] = useBbox;
        coords = [(west + east) / 2, (south + north) / 2];
      } else {
        coords = [point.coordinates.longitude, point.coordinates.latitude];
      }

      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: {
          pointId: point.id,
          nameText: point.locationString,
          // Empty string (not undefined) so the ``format`` expression
          // can safely reach ``has 'dataText'`` without throwing on
          // missing props. Mapbox treats empty-string segments as
          // zero-width — no extra blank line.
          dataText: dataText || '',
          isPolygon,
        },
      } as LabelGeoJsonFeature);
    }

    return labelFeatures;
  }, [labelConfigs, locationField, visiblePoints, polygonRenderedIds, resultsForMap, schemas, mapTheme]);

  // Calculate and display labels if configured - STABLE with memoized data
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const sourceId = 'label-source';
    const layerId = 'label-layer';

    // Two-tier color (primary name / muted data) and theme-aware halo.
    const nameColor = mapTheme === 'dark' ? '#FFFFFF' : '#0F172A';
    const dataColor = mapTheme === 'dark' ? '#A3B0BF' : '#64748B';
    const haloColor = mapTheme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)';

    const addLabels = () => {
      if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;

      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        if (!labelData || labelData.length === 0) return;

        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: labelData },
        });

        // Single layer renders both text segments via ``format`` so the
        // collision detector treats them as one bbox — they show or hide
        // together. Per-segment ``text-color`` keeps the visual two-tier
        // hierarchy (semibold name on top, muted data below).
        map.addLayer({
          id: layerId,
          type: 'symbol',
          source: sourceId,
          layout: {
            'text-field': [
              'case',
              ['all', ['has', 'dataText'], ['!=', ['get', 'dataText'], '']],
              [
                'format',
                ['get', 'nameText'], { 'text-color': nameColor, 'font-scale': 1.0 },
                '\n', {},
                ['get', 'dataText'], { 'text-color': dataColor, 'font-scale': 0.9 },
              ],
              ['format', ['get', 'nameText'], { 'text-color': nameColor }],
            ],
            'text-size': 12,
            // Polygons → centered (centroid). Pins → anchored 'top' with
            // icon clearance so the label sits below the triangle marker.
            'text-anchor': [
              'case',
              ['get', 'isPolygon'], 'center',
              'top',
            ],
            'text-offset': [
              'case',
              ['get', 'isPolygon'], ['literal', [0, 0]],
              ['literal', [0, 1.2]],
            ],
            'text-line-height': 1.2,
            'text-justify': 'center',
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          },
          paint: {
            'text-halo-color': haloColor,
            'text-halo-width': 1.5,
          },
        });
      } catch (error) {
        console.warn('Error adding map labels:', error);
      }
    };

    let pendingStyleLoad: (() => void) | null = null;
    if (map.isStyleLoaded()) {
      addLabels();
    } else {
      pendingStyleLoad = addLabels;
      map.once('style.load', addLabels);
    }

    return () => {
      const stillAlive = mapRef.current === map;
      if (!stillAlive) return;
      try {
        if (pendingStyleLoad) {
          map.off('style.load', pendingStyleLoad);
          pendingStyleLoad = null;
        }
        if (map.isStyleLoaded()) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      } catch (error) {
        console.warn('Error cleaning up map labels:', error);
      }
    };
    // ``styleVersion`` bumps on every ``style.load`` (theme toggle wipes the
    // style's sources/layers, so we need to re-add them).
  }, [mapLoaded, labelData, styleVersion]);

  // Focus dim — when a point is selected (preview card open), fade
  // everything else so the selected location reads as the focal point.
  // We mutate paint properties on the already-rendered layers (no
  // teardown / re-render) and walk the marker DOM by ``data-point-id``
  // for HTML markers. ``selectedId === null`` restores full opacity.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const selectedId = selectedPoint?.id ?? null;
    const FOCUS_DIM = 0.25; // unselected things drop to 25% opacity

    // Markers — walk the DOM. Each wrapper carries ``data-point-id``.
    for (const m of markersRef.current) {
      const el = m.getElement() as HTMLElement | null;
      if (!el) continue;
      const pid = el.dataset.pointId ?? null;
      el.style.opacity = !selectedId || pid === selectedId ? '1' : String(FOCUS_DIM);
    }

    // Layer paint — wrap the existing opacity expressions in a ``case``
    // that checks pointId. When no selection, restore the originals.
    const trySet = (layerId: string, prop: string, value: any) => {
      try {
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, prop as any, value);
      } catch {
        // setPaintProperty can throw on style transitions; safe to ignore.
      }
    };

    // Polygon fill — base opacity is the nestLevel interpolation.
    const baseFill: any = [
      'interpolate', ['linear'], ['coalesce', ['get', 'nestLevel'], 0],
      0, 0.18, 1, 0.30, 2, 0.42, 3, 0.52,
    ];
    trySet(
      'location-areas-layer',
      'fill-opacity',
      selectedId
        ? ['case', ['==', ['get', 'pointId'], selectedId], baseFill, FOCUS_DIM * 0.6]
        : baseFill,
    );

    // Polygon border — base opacity is constant 0.9.
    trySet(
      'location-areas-border-layer',
      'line-opacity',
      selectedId
        ? ['case', ['==', ['get', 'pointId'], selectedId], 0.9, FOCUS_DIM]
        : 0.9,
    );

    // Labels — match by pointId (carried as a feature property).
    trySet(
      'label-layer',
      'text-opacity',
      selectedId
        ? ['case', ['==', ['get', 'pointId'], selectedId], 1.0, FOCUS_DIM]
        : 1.0,
    );
  }, [mapLoaded, selectedPoint, styleVersion]);

  // Add location area polygons when showAreas is enabled
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // Top-of-effect ping — proves whether the effect is even running.
      // If we never see this, deps aren't changing (likely a memoization
      // break in the visible-points pipeline).
      // eslint-disable-next-line no-console
      console.debug('[map.areas] effect tick', {
        mapLoaded,
        hasMapRef: !!mapRef.current,
        showAreas,
        pointsWithMeaningfulAreas: pointsWithMeaningfulAreas.length,
        visible: visiblePoints.length,
        accumulated: accumulatedPoints.length,
        styleVersion,
      });
    }
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const areaSourceId = 'location-areas';
    const areaLayerId = 'location-areas-layer';
    const areaBorderLayerId = 'location-areas-border-layer';

    const addAreas = () => {
      if (!mapRef.current) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.debug('[map.areas] addAreas bail — no map ref');
        }
        return;
      }

      try {
        // Remove existing layers and source
        if (map.getLayer(areaBorderLayerId)) {
          map.removeLayer(areaBorderLayerId);
        }
        if (map.getLayer(areaLayerId)) {
          map.removeLayer(areaLayerId);
        }
        if (map.getSource(areaSourceId)) {
          map.removeSource(areaSourceId);
        }

        // Only add areas if enabled and we have points with meaningful bboxes
        if (!showAreas || pointsWithMeaningfulAreas.length === 0) {
          if (process.env.NODE_ENV !== 'production') {
            // Walk the whole pipeline so we can see exactly where the
            // pipeline drops to zero. ``processed > visible`` means
            // ``hiddenPointIds`` is masking points; ``visible > 0 but
            // withBbox === 0`` means no point carries a usable bbox.
            // ``points/accumulated/merged === 0`` means no data has
            // landed yet (re-run geocoding or check the SSE stream).
            const sampleBbox = visiblePoints.find((p) => p.bbox)?.bbox
              ?? processedPoints.find((p) => p.bbox)?.bbox
              ?? mergedPoints.find((p) => p.bbox)?.bbox
              ?? accumulatedPoints.find((p) => p.bbox)?.bbox;
            // eslint-disable-next-line no-console
            console.debug('[map.areas] skip — no polygon-rendering points', {
              showAreas,
              locationField,
              accumulated: accumulatedPoints.length,
              legacyPoints: (points ?? []).length,
              merged: mergedPoints.length,
              processed: processedPoints.length,
              hiddenIds: hiddenPointIds.size,
              visible: visiblePoints.length,
              withBbox: pointsWithMeaningfulAreas.length,
              sampleBbox,
              sampleBboxType: sampleBbox ? sampleBbox.map((v) => typeof v) : undefined,
            });
          }
          return;
        }

        // Default polygon color when no color role is set (theme-aware blue).
        const defaultFill = mapTheme === 'dark' ? '#3b82f6' : '#2563eb';
        const defaultBorder = mapTheme === 'dark' ? '#60a5fa' : '#3b82f6';

        // Convert points to GeoJSON polygons. Real ``geometry`` from
        // Nominatim is preferred — gives the actual shape (mainland +
        // overseas territories as separate parts of a MultiPolygon) so a
        // bbox-derived rectangle never spans the Atlantic. Fall back to
        // bbox-derived rect for points without geometry (POIs, cities,
        // entries geocoded before geometry persistence). Each feature
        // carries its own ``color`` so the layer paint can do a single
        // ``['get', 'color']`` lookup.
        type FeatureEntry = {
          feature: {
            type: 'Feature';
            geometry: any;
            properties: Record<string, any>;
          };
          /** Largest-part bbox for nesting comparisons. ``null`` means we
           *  couldn't compute one; nesting falls back to an area of 0. */
          anchorBbox: [number, number, number, number] | null;
          /** Bbox area in square degrees — proxy for "how big is this
           *  polygon" used to sort paint order (largest first). */
          area: number;
        };

        const entries = pointsWithMeaningfulAreas
          .map((point): FeatureEntry | null => {
            const polyColor = colorMap.get(point.id) ?? defaultFill;
            const baseProps = {
              locationString: point.locationString,
              documentCount: point.documentIds.length,
              pointId: point.id,
              color: polyColor,
              borderColor: colorMap.has(point.id) ? polyColor : defaultBorder,
            };

            // Anchor bbox: prefer largest-part bbox of real geometry
            // (mainland) so the visual area used for nesting matches the
            // user's perception (France's mainland nests Paris, even if
            // France's full bbox spans to French Guiana).
            const partBbox = _largestPartBbox(point.geometry ?? null);
            const fallbackBbox = (point.bbox && point.bbox.length === 4)
              ? point.bbox.map((v) => Number(v)) as [number, number, number, number]
              : null;
            const anchorBbox: [number, number, number, number] | null =
              partBbox && partBbox.every((v) => Number.isFinite(v))
                ? partBbox
                : (fallbackBbox && fallbackBbox.every((v) => Number.isFinite(v)) ? fallbackBbox : null);
            const area = anchorBbox
              ? Math.abs((anchorBbox[1] - anchorBbox[0]) * (anchorBbox[3] - anchorBbox[2]))
              : 0;

            // Path 1: real OSM geometry. Polygon/MultiPolygon accepted
            // as Mapbox source geometry verbatim.
            const g = point.geometry;
            if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
              return {
                feature: { type: 'Feature' as const, geometry: g, properties: baseProps },
                anchorBbox,
                area,
              };
            }

            // Path 2: bbox-derived rect fallback. Coerce stringified bbox
            // values — legacy entries written before the provider was
            // hardened can carry ``["35.6", "82.0", ...]``.
            const raw = point.bbox;
            if (!raw || raw.length !== 4) return null;
            const nums = raw.map((v) => (typeof v === 'number' ? v : Number(v))) as [number, number, number, number];
            if (!nums.every((v) => Number.isFinite(v))) return null;
            const [south, north, west, east] = nums;
            return {
              feature: {
                type: 'Feature' as const,
                geometry: {
                  type: 'Polygon',
                  coordinates: [[
                    [west, south],
                    [east, south],
                    [east, north],
                    [west, north],
                    [west, south],
                  ]],
                },
                properties: baseProps,
              },
              anchorBbox,
              area,
            };
          })
          .filter((entry): entry is FeatureEntry => entry !== null);

        // Compute nest level: how many other polygons fully contain this
        // one (by anchor-bbox containment). Level 0 = outermost; deeper
        // levels paint with higher opacity and a slightly thicker border
        // so an inner country reads as more prominent than its parent
        // continent. This is the visual rule for distinguishing nested
        // polygons — bigger outline + bolder fill as you go deeper.
        const bboxContains = (
          outer: [number, number, number, number],
          inner: [number, number, number, number],
        ): boolean => {
          // [south, north, west, east]
          return (
            outer[0] <= inner[0]
            && outer[1] >= inner[1]
            && outer[2] <= inner[2]
            && outer[3] >= inner[3]
          );
        };

        for (const entry of entries) {
          let level = 0;
          if (entry.anchorBbox) {
            for (const other of entries) {
              if (other === entry || !other.anchorBbox) continue;
              if (other.area <= entry.area) continue; // strictly bigger
              if (bboxContains(other.anchorBbox, entry.anchorBbox)) level++;
            }
          }
          entry.feature.properties.nestLevel = level;
        }

        // Sort largest-area first so smaller (innermost) polygons paint
        // last and end up visually on top — Mapbox renders fill features
        // in source order. Without this, outer continents would cover
        // their nested countries.
        entries.sort((a, b) => b.area - a.area);

        const features = entries.map((e) => e.feature);

        // Dev-only trace so a quick devtools peek tells us exactly why
        // polygons aren't showing (typical culprits: empty features,
        // bbox NaN, source/layer add throwing). Strip the guard if the
        // bug ever recurs in prod and you need server-side telemetry.
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.debug('[map.areas] addAreas', {
            showAreas,
            visible: visiblePoints.length,
            withBbox: pointsWithMeaningfulAreas.length,
            features: features.length,
            sample: features[0]?.geometry,
            mapTheme,
          });
        }

        // Add source
        map.addSource(areaSourceId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: features as any
          }
        });

        // Add layers at the top of the stack so polygons are guaranteed
        // visible (no ``beforeId`` race during fast theme/viewMode
        // toggles). Mapbox renders ``symbol`` layers above ``fill``/
        // ``line`` siblings by default, so labels still float above
        // even without explicit insertion-before.
        // Opacity scales with nest level so deeper (smaller) polygons
        // read as more prominent than their parents. Steps capped at 4 —
        // beyond that the deepest level just stays bold. Combined with
        // the source-order sort above (largest paints first), nested
        // polygons read crisply: outer continent faint, inner country
        // medium, inner-inner city bold.
        map.addLayer({
          id: areaLayerId,
          type: 'fill',
          source: areaSourceId,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': [
              'interpolate', ['linear'], ['coalesce', ['get', 'nestLevel'], 0],
              0, 0.18,
              1, 0.30,
              2, 0.42,
              3, 0.52,
            ],
          },
        });

        map.addLayer({
          id: areaBorderLayerId,
          type: 'line',
          source: areaSourceId,
          paint: {
            'line-color': ['get', 'borderColor'],
            'line-width': [
              'interpolate', ['linear'], ['coalesce', ['get', 'nestLevel'], 0],
              0, 1.5,
              1, 2.0,
              2, 2.5,
              3, 3.0,
            ],
            'line-opacity': 0.9,
          },
        });

        // Polygons are the only thing on screen for these points in polygon
        // mode (markers are suppressed). Wire fill clicks to the same drill
        // handler markers use so the user can still open the side panel.
        // When polygons overlap (e.g. a country inside a continent), prefer
        // the *smallest* one — that's almost always the user's intent.
        // Area comparison uses the largest-part bbox of real geometry when
        // present (so France's mainland bbox, not a world-spanning one),
        // falling back to the OSM bbox for bbox-only renders.
        const handleAreaClick = (ev: mapboxgl.MapMouseEvent & { features?: any[] }) => {
          const feats = ev.features ?? [];
          if (feats.length === 0) return;
          let bestPoint: MapPoint | undefined;
          let bestArea = Number.POSITIVE_INFINITY;
          for (const feat of feats) {
            const pointId = feat?.properties?.pointId as string | undefined;
            if (!pointId) continue;
            const candidate = pointsWithMeaningfulAreas.find((p) => p.id === pointId);
            if (!candidate) continue;
            const partBbox = _largestPartBbox(candidate.geometry ?? null);
            const fallbackBbox = (candidate.bbox && candidate.bbox.length === 4)
              ? candidate.bbox.map((v) => Number(v)) as [number, number, number, number]
              : null;
            const useBbox = partBbox && partBbox.every((v) => Number.isFinite(v))
              ? partBbox
              : (fallbackBbox && fallbackBbox.every((v) => Number.isFinite(v)) ? fallbackBbox : null);
            if (!useBbox) continue;
            const [south, north, west, east] = useBbox;
            const area = Math.abs((north - south) * (east - west));
            if (area < bestArea) {
              bestArea = area;
              bestPoint = candidate;
            }
          }
          if (bestPoint) handlePointClick(bestPoint);
        };
        const handleAreaEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
        const handleAreaLeave = () => { map.getCanvas().style.cursor = ''; };
        map.on('click', areaLayerId, handleAreaClick);
        map.on('mouseenter', areaLayerId, handleAreaEnter);
        map.on('mouseleave', areaLayerId, handleAreaLeave);
        // Stash so the cleanup branch can detach without rebinding context.
        (map as any).__areaListeners = { handleAreaClick, handleAreaEnter, handleAreaLeave };
      } catch (error) {
        // Bright red in devtools so a regression here is impossible to
        // miss. Past failures here have been silent because the catch
        // swallowed via warn.
        console.error('[map.areas] addAreas threw — polygons will not render:', error);
      }
    };

    // Dispatch via the ``idle`` event, which Mapbox emits whenever the
    // map has finished all current operations and is ready for layer
    // manipulation. This is more reliable than gating on
    // ``isStyleLoaded()`` — that flag has been observed to flip false
    // mid-flow even after a successful load, leaving polygons stuck
    // never rendering. ``idle`` fires almost immediately if the map is
    // already settled, so there's no perceptible delay either way.
    let pendingDispatch: (() => void) | null = addAreas;
    const handleDispatch = () => {
      pendingDispatch = null;
      addAreas();
    };
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[map.areas] dispatch — queuing on idle', {
        styleLoaded: map.isStyleLoaded(),
      });
    }
    map.once('idle', handleDispatch);

    return () => {
      const stillAlive = mapRef.current === map;
      if (!stillAlive) return;
      try {
        if (pendingDispatch) {
          map.off('idle', handleDispatch);
          pendingDispatch = null;
        }
        const listeners = (map as any).__areaListeners as
          | { handleAreaClick: any; handleAreaEnter: any; handleAreaLeave: any }
          | undefined;
        if (listeners) {
          map.off('click', areaLayerId, listeners.handleAreaClick);
          map.off('mouseenter', areaLayerId, listeners.handleAreaEnter);
          map.off('mouseleave', areaLayerId, listeners.handleAreaLeave);
          (map as any).__areaListeners = undefined;
        }
        // Layer/source removal is style-dependent — guard so we don't
        // throw during a setStyle transition.
        if (map.isStyleLoaded()) {
          if (map.getLayer(areaBorderLayerId)) {
            map.removeLayer(areaBorderLayerId);
          }
          if (map.getLayer(areaLayerId)) {
            map.removeLayer(areaLayerId);
          }
          if (map.getSource(areaSourceId)) {
            map.removeSource(areaSourceId);
          }
        }
      } catch (error) {
        console.warn('Error cleaning up map areas:', error);
      }
    };
  }, [mapLoaded, pointsWithMeaningfulAreas, showAreas, mapTheme, styleVersion, handlePointClick, colorMap]);

  // Apply the *map* theme (independent of the page theme). Tracks the
  // last applied URL on a ref so we don't kick a redundant reload when
  // the effect re-fires for some other reason (e.g. mapLoaded flipping
  // true after the map already has the right style).
  const lastAppliedMapStyleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const targetStyleUrl = mapTheme === 'dark'
      ? 'mapbox://styles/mapbox/dark-v11'
      : 'mapbox://styles/mapbox/light-v11';

    // First run after mount: the create-effect already set the right
    // style URL, so just record it and skip the redundant reload.
    if (lastAppliedMapStyleRef.current === null) {
      lastAppliedMapStyleRef.current = targetStyleUrl;
      return;
    }
    if (lastAppliedMapStyleRef.current === targetStyleUrl) return;

    try {
      lastAppliedMapStyleRef.current = targetStyleUrl;
      // setStyle is safe to call whether or not the current style has
      // finished loading — Mapbox queues the swap. ``style.load`` fires
      // when the new style is ready, which bumps ``styleVersion`` via
      // the persistent listener attached in the create-effect, and
      // every layer-owning effect re-runs to re-add its sources.
      map.setStyle(targetStyleUrl);
    } catch (error) {
      console.warn('Error updating map style:', error);
    }
  }, [mapTheme, mapLoaded]);

  // Get label configuration info for display — multi-aware so the
  // bottom-left chip can list every label field the user picked, not
  // just the first.
  // ``includeArrayItemFields`` so paths through array-of-objects (e.g.
  // ``document.orte[*].type``) resolve to a real field instead of falling
  // back to the raw path with ``(unknown)``.
  const labelConfigInfos = useMemo(() => {
    if (labelConfigs.length === 0) return [];
    return labelConfigs.flatMap((cfg) => {
      const schema = schemas.find((s) => s.id === cfg.schemaId);
      if (!schema) return [];
      const targetKeys = getTargetKeysForScheme(cfg.schemaId, schemas, { includeArrayItemFields: true });
      const fieldInfo = targetKeys.find((tk) => tk.key === cfg.fieldKey);
      const prettyName = fieldInfo?.name ?? formatFieldNameForDisplay(cfg.fieldKey).displayName ?? cfg.fieldKey;
      return [{
        schemaName: schema.name,
        fieldName: prettyName,
        fieldType: fieldInfo?.type ?? 'unknown',
        fieldKey: cfg.fieldKey,
        schemaId: cfg.schemaId,
      }];
    });
  }, [labelConfigs, schemas]);

  // Handle location click from list. Opens the preview card and flies
  // to the point. When the locations panel is open it covers the left
  // edge of the canvas, so we offset the camera so the point lands in
  // the visible area (right of the panel) rather than centered behind
  // it. ``flyTo({ offset })`` places the geographic target at
  // ``canvas_center + offset`` — positive X = visually right of center.
  const handleLocationClick = useCallback((point: MapPoint) => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    handlePointClick(point);

    // Two side panels frame the canvas: locations list on the left
    // (when ``locationsPanelOpen``) and the asset HUD on the right
    // (always opens after this click via ``handlePointClick``).
    // ``flyTo({ offset })`` shifts the geographic target from canvas
    // center; positive X = visually right of canvas center.
    //
    // We want the point in the centre of the *visible* area:
    //   - Both panels open ⇒ canvas centre IS the visible centre, offset 0
    //   - Only left open   ⇒ visible centre is right of canvas centre, +half
    //   - Only right open  ⇒ visible centre is left of canvas centre, -half
    const LEFT_HALF = 224 / 2;   // left panel = w-56 ≈ 224
    const RIGHT_HALF = 256 / 2;  // right panel = w-64 ≈ 256
    const leftShift = locationsPanelOpen ? LEFT_HALF : 0;
    const rightShift = RIGHT_HALF; // right panel about to open
    const offsetX = leftShift - rightShift;

    map.flyTo({
      center: [point.coordinates.longitude, point.coordinates.latitude],
      offset: [offsetX, 0],
      zoom: Math.max(map.getZoom(), 4),
      duration: 800,
    });
  }, [handlePointClick, locationsPanelOpen]);

  // Handle external location highlighting (from cross-panel navigation)
  useEffect(() => {
    if (!highlightLocation || !mapLoaded) return;
    
    const { location, fieldKey } = highlightLocation;
    
    // Find matching point by location string (case-insensitive)
    const matchingPoint = processedPoints.find(point => 
      point.locationString.toLowerCase().includes(location.toLowerCase()) ||
      location.toLowerCase().includes(point.locationString.toLowerCase())
    );
    
    if (matchingPoint) {
      handleLocationClick(matchingPoint);
    }
  }, [highlightLocation, processedPoints, mapLoaded, handleLocationClick]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <PanelHeaderSlot>
          <PanelFormulaBinder
            formulaId={(panelConfig as any).formula_id ?? (panelConfig as any).observation_id ?? null}
            onBind={(id) => onUpdatePanel({ formula_id: id, observation_id: undefined } as any)}
          />
          <RolePickerPopover
          schema={PANEL_ROLE_SCHEMAS.map}
          availableSchemas={schemas}
          value={rolePickerValue}
          onChange={handleRolePickerChange}
        />
      </PanelHeaderSlot>
      {!selectedSchemaId || !locationField ? (
        <div className="p-2 flex-shrink-0">
          <EmptyStateCard
            reason={
              !selectedSchemaId
                ? { kind: 'no_schema' }
                : { kind: 'role_unfilled', roleLabel: 'Location' }
            }
          />
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative annotation-map-host">
      {/* Hide the default Mapbox bottom-right control box (attribution +
          logo) within this panel, scoped via an ancestor class so we
          don't impact other Mapbox instances elsewhere on the page. */}
      <style>
        {`.annotation-map-host .mapboxgl-ctrl-bottom-right { display: none; }`}
      </style>
      <div
        ref={mapContainerRef}
        className="h-full w-full"
        style={{
          minHeight: '200px', // Reduced minimum height to respect panel constraints
          maxHeight: '100%' // Ensure it doesn't exceed container height
        }}
      />

      {/* Locations panel — toggled by the locations chip in the toolbar.
          Floats on the left, intentionally lighter than the shadcn popover
          style: no shadow, soft border, translucent backdrop. Reads as a
          quiet sidebar, not a popup. Search filters the list, eye toggles
          per-point visibility on the map. */}
      {locationsPanelOpen && processedPoints.length > 0 && (() => {
        const search = locationsSearch.trim().toLowerCase();
        // Sort locations by document count descending — the busiest
        // places lead the list; ties break alphabetically so the order
        // is stable across renders. ``[].sort`` mutates, so we copy
        // first to keep ``processedPoints`` reference identity intact.
        const sorted = [...processedPoints].sort((a, b) => {
          const da = a.documentIds.length;
          const db = b.documentIds.length;
          if (db !== da) return db - da;
          return (a.canonicalName ?? a.locationString ?? '').localeCompare(
            b.canonicalName ?? b.locationString ?? '',
          );
        });
        const filtered = search
          ? sorted.filter((p) =>
              (p.locationString || '').toLowerCase().includes(search)
              || (p.canonicalName || '').toLowerCase().includes(search))
          : sorted;
        return (
          <div
            className="absolute top-2 left-0 z-30 w-56 max-w-[calc(100%-1rem)] rounded-r-md border-y border-r border-border/50 bg-background/55 backdrop-blur-sm flex flex-col"
            style={{ maxHeight: 'calc(100% - 1rem)' }}
          >
            <div className="flex items-center justify-between gap-1 px-2 pt-1 pb-0.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium">
                Locations
              </span>
              <div className="flex items-center gap-0.5">
                {/* Toggle-all: hides every point if any are visible,
                    otherwise shows everything. Keeps the persisted
                    ``hiddenPointIds`` source of truth in sync. */}
                <button
                  type="button"
                  onClick={() => {
                    const allHidden = hiddenPointIds.size >= processedPoints.length;
                    onUpdatePanel({
                      settings: {
                        ...mapSettingsRef.current,
                        hiddenPointIds: allHidden ? [] : processedPoints.map((p) => p.id),
                      },
                    });
                  }}
                  aria-label={
                    hiddenPointIds.size >= processedPoints.length
                      ? 'Show all locations'
                      : 'Hide all locations'
                  }
                  title={
                    hiddenPointIds.size >= processedPoints.length
                      ? 'Show all'
                      : 'Hide all'
                  }
                  className="h-4 w-4 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:outline-none"
                >
                  {hiddenPointIds.size >= processedPoints.length
                    ? <Eye className="h-3 w-3" />
                    : <EyeOff className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => setLocationsPanelOpen(false)}
                  aria-label="Close locations panel"
                  className="h-4 w-4 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:outline-none"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="px-2 pb-1">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60 pointer-events-none" />
                <input
                  type="search"
                  placeholder="Search…"
                  value={locationsSearch}
                  onChange={(e) => setLocationsSearch(e.target.value)}
                  className="w-full pl-6 pr-1.5 py-0.5 text-[11px] bg-transparent border border-border/40 rounded focus:outline-none focus:border-border/80 placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
            <div className="px-2 pb-0.5 text-[10px] text-muted-foreground/80 tabular-nums">
              {processedPoints.length - hiddenPointIds.size}/{processedPoints.length} visible
              {search && ` · ${filtered.length} match${filtered.length === 1 ? '' : 'es'}`}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-1">
              {filtered.length === 0 ? (
                <div className="px-1 py-1.5 text-[11px] text-muted-foreground italic">
                  No matches.
                </div>
              ) : (
                <ul>
                  {filtered.map((point) => {
                    const isHidden = hiddenPointIds.has(point.id);
                    const docs = point.documentIds.length;
                    const isSelected = selectedPoint?.id === point.id;
                    return (
                      <li
                        key={point.id}
                        className={cn(
                          'group flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 text-[11px] rounded hover:bg-muted/30',
                          isSelected && 'bg-muted/40',
                          isHidden && 'opacity-50',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => handleLocationClick(point)}
                          disabled={isHidden}
                          className="flex-1 min-w-0 flex items-center gap-1.5 text-left disabled:cursor-not-allowed"
                          title={point.locationString}
                        >
                          <span className="truncate">{point.canonicalName ?? point.locationString}</span>
                          {docs > 0 && (
                            <span className="ml-auto pl-1 text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                              {docs}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePointHidden(point.id);
                          }}
                          aria-label={isHidden ? 'Show on map' : 'Hide from map'}
                          title={isHidden ? 'Show on map' : 'Hide from map'}
                          className="flex-shrink-0 h-4 w-4 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );
      })()}

      {/* Map control overlay — geocode + locations + view-mode + projection
          + theme, consolidated into a single ButtonGroup so the panel
          stays free of toolbars. CircleDotDashed + GitBranchPlus =
          geocode action ("resolve names → branch out coords"); MapPin =
          locations list (carries the count badge). */}
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 flex flex-col items-end gap-1">
        <ButtonGroup className="bg-background/80 backdrop-blur-sm border shadow-lg rounded-md">
          {/* Geocode action — dual-icon static layout (no swap, no
              greying since neither icon is "inactive"): dashed circle
              top-left = "input name", GitBranchPlus bottom-right =
              "resolved + branched into coords". */}
          <Button
            onClick={handleKickGeocode}
            variant="secondary"
            size="icon"
            className="relative bg-transparent hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9 overflow-hidden"
            disabled={!locationField || isGeocoding || isGeocodingActive}
            title={
              !locationField
                ? 'Pick a location field first'
                : isGeocodingActive
                  ? 'Geocoding…'
                  : `Geocode values of ${locationField}`
            }
          >
            {(isGeocoding || isGeocodingActive) ? (
              <Loader2 className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
            ) : (
              <>
                <CircleDotDashed className="absolute top-1 left-1 h-3 w-3 text-foreground" />
                <GitBranchPlus className="absolute bottom-1 right-1 h-3.5 w-3.5 text-foreground" />
              </>
            )}
          </Button>
          {processedPoints.length > 0 && (
            // Locations chip — toggles the left-side locations panel.
            // Dual-icon static layout (MapPin + List). Count footnote
            // bottom-left, no badge background. ``aria-pressed`` makes
            // the toggle state announceable.
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setLocationsPanelOpen((v) => !v)}
              aria-pressed={locationsPanelOpen}
              className={cn(
                'relative bg-transparent hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9 overflow-hidden',
                locationsPanelOpen && 'bg-background/70',
              )}
              title={`${processedPoints.length} location${processedPoints.length === 1 ? '' : 's'}${
                hiddenPointIds.size > 0 ? ` (${hiddenPointIds.size} hidden)` : ''
              }`}
            >
              <MapPin className="absolute top-1 left-1 h-3 w-3 text-foreground" />
              <List className="absolute bottom-1 right-1 h-3.5 w-3.5 text-foreground" />
              <span
                className="absolute bottom-0.5 left-0.5 text-[9px] leading-none font-medium tabular-nums text-muted-foreground"
                aria-hidden
              >
                {processedPoints.length}
              </span>
            </Button>
          )}
          {/* View-mode toggle. Both icons live in the same button; the
              ACTIVE one sits big in the bottom-right, the INACTIVE one
              sits small + greyed in the top-left, and a curved Spline
              in the top-right hints at the swap direction. CSS
              transitions on top/left/bottom/right + h/w give the
              physical swap animation when the user clicks. */}
          <Button
            onClick={() => setViewMode(viewMode === 'pointer' ? 'polygon' : 'pointer')}
            variant="secondary"
            size="icon"
            className="relative bg-transparent hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9 overflow-hidden"
            disabled={!mapLoaded}
            title={viewMode === 'pointer'
              ? 'Active: pin markers — click for polygon view'
              : 'Active: polygon view — click for pin markers'}
          >
            <Pin
              className={cn(
                'absolute transition-all duration-200 ease-in-out',
                viewMode === 'pointer'
                  ? 'bottom-1 right-1 h-4 w-4 text-foreground'
                  : 'top-1 left-1 h-2.5 w-2.5 text-muted-foreground/60',
              )}
            />
            <Hexagon
              className={cn(
                'absolute transition-all duration-200 ease-in-out',
                viewMode === 'polygon'
                  ? 'bottom-1 right-1 h-4 w-4 text-foreground'
                  : 'top-1 left-1 h-2.5 w-2.5 text-muted-foreground/60',
              )}
            />
            {/* Curved arrow pointing from the inactive (top-left) glyph
                toward the active (bottom-right) one. Mirrored on the
                X axis so the curve sweeps top-left → bottom-right. */}
            <Spline
              className="absolute top-1 right-1 h-2.5 w-2.5 text-muted-foreground/40 pointer-events-none -scale-x-100"
              aria-hidden
            />
          </Button>
          <Button
            onClick={toggleProjection}
            variant="secondary"
            size="icon"
            className="bg-transparent hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9"
            disabled={!mapLoaded}
            title={isGlobeView ? 'Switch to flat view' : 'Switch to globe view'}
          >
            {isGlobeView ? (
              <MapIcon className="h-4 w-4" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
          </Button>
          {/* Color legend toggle — only meaningful when ``group_by`` is
              set and produced at least one categorical bucket. The
              button bring back a fully hidden legend; collapsed state
              is owned by the legend itself (chevron). */}
          {colorEntries.length > 0 && !legendVisible && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setLegendVisible(true)}
              className="bg-transparent hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9"
              title="Show color legend"
            >
              <Palette className="h-4 w-4" />
            </Button>
          )}
          <Button
            onClick={toggleTheme}
            variant="secondary"
            size="icon"
            className="bg-transparent hover:bg-background/90 h-8 w-8 sm:h-9 sm:w-9"
            title={`Switch map to ${mapTheme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {mapTheme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </ButtonGroup>
        {/* Polygon mode is on but nothing has a meaningful bbox yet —
            usually means the cached coords were saved before bbox
            persistence landed. Re-running the geocode action backfills
            bboxes via the partial-cache-miss path in the @task. */}
        {viewMode === 'polygon'
          && processedPoints.length > 0
          && pointsWithMeaningfulAreas.length === 0
          && !isGeocoding
          && !isGeocodingActive && (
          <div className="max-w-xs rounded-md border bg-background/80 backdrop-blur-sm shadow-lg px-2 py-1 text-[11px] text-muted-foreground">
            No bounding boxes yet — re-run geocoding to backfill polygons.
          </div>
        )}
        {geocodeError && (
          <div className="max-w-xs rounded-md border border-destructive/40 bg-background/80 backdrop-blur-sm shadow-lg px-2 py-1 text-[11px] text-destructive">
            {geocodeError.message}
          </div>
        )}
      </div>
      
      {/* Label-source indicator. One pill per picked label field — same
          visual weight as the toolbar chips, no card chrome. */}
      {labelConfigInfos.length > 0 && (
        <div className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 flex-wrap">
          {labelConfigInfos.map((info) => (
            <div
              key={`${info.schemaId}:${info.fieldKey}`}
              className="inline-flex items-center gap-1 rounded-md border bg-background/80 backdrop-blur-sm px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <Eye className="h-3 w-3" />
              <span className="truncate max-w-[10rem]" title={`${info.fieldName} (${info.fieldType})`}>
                {info.fieldName}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Color legend — only meaningful for categorical ``group_by``.
          Three states:
            - hidden   : nothing here; toolbar Palette button brings it back
            - collapsed: tiny pill ("Colors · N") that expands on click
            - expanded : horizontal pill with one swatch+label per value,
                         a toggle-all eye, a collapse chevron, and an X
                         to fully hide. Each swatch is a native color
                         input — pick any hex; cleared overrides revert
                         to the deterministic palette colour. Clicking
                         the value text toggles its visibility on the
                         map (line-through + dimmed when hidden).
          Inspired by the graph's ``EntityTypeLegend`` — same chip
          aesthetic, more controls. Numeric mode skips the legend
          entirely (gradient bar UI is a separate question). */}
      {colorEntries.length > 0 && !colorIsNumeric && legendVisible && (() => {
        const allHidden = hiddenColorValues.size >= colorEntries.length;
        if (legendCollapsed) {
          return (
            <button
              type="button"
              onClick={() => setLegendCollapsed(false)}
              title={`Color legend (${colorEntries.length})`}
              className="absolute left-1/2 -translate-x-1/2 bottom-2 z-20 inline-flex items-center gap-1 rounded-full border bg-background/85 backdrop-blur-sm px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-background"
            >
              <Palette className="h-3 w-3" />
              <span className="tabular-nums">{colorEntries.length}</span>
              <ChevronUp className="h-3 w-3" />
            </button>
          );
        }
        return (
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-2 z-20 max-w-[calc(100%-1rem)]"
            style={{ pointerEvents: 'none' }}
          >
            <div
              className="flex items-center gap-1 px-1.5 py-1 rounded-full bg-background/85 backdrop-blur-sm border shadow-sm overflow-x-auto"
              style={{ pointerEvents: 'auto' }}
            >
              {colorEntries.map(({ value, color, count }) => {
                const isHidden = hiddenColorValues.has(value);
                return (
                  <div
                    key={value}
                    className={cn(
                      'flex items-center gap-1 px-1 py-0.5 rounded-full text-[11px] whitespace-nowrap transition-opacity',
                      isHidden && 'opacity-40',
                    )}
                  >
                    {/* Native color input wrapping the swatch — click
                        opens the platform's color picker. ``input`` is
                        invisible but layered over the swatch so the
                        whole circle is the click target. */}
                    <label
                      className="relative w-3 h-3 rounded-full flex-shrink-0 cursor-pointer ring-1 ring-border/40"
                      style={{ backgroundColor: isHidden ? 'var(--muted)' : color }}
                      title={`Pick color for ${value}`}
                    >
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColorOverride(value, e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleColorValueHidden(value)}
                      title={isHidden ? `Show ${value}` : `Hide ${value}`}
                      className={cn(
                        'inline-flex items-center gap-1 hover:text-foreground',
                        isHidden && 'line-through',
                      )}
                    >
                      <span className="truncate max-w-[10rem]">{value}</span>
                      <span className="text-muted-foreground tabular-nums">{count}</span>
                    </button>
                    {colorOverridesForField[value] && (
                      <button
                        type="button"
                        onClick={() => setColorOverride(value, null)}
                        className="text-muted-foreground/60 hover:text-foreground"
                        title="Reset to auto color"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {/* Trailing controls — separator + toggle-all + collapse + close. */}
              <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />
              <button
                type="button"
                onClick={() => setColorValuesHidden(allHidden ? [] : colorEntries.map((e) => e.value))}
                title={allHidden ? 'Show all' : 'Hide all'}
                className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:outline-none"
              >
                {allHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => setLegendCollapsed(true)}
                title="Collapse legend"
                className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:outline-none"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setLegendVisible(false)}
                title="Hide legend (use Palette button to bring it back)"
                className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:outline-none"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })()}
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Selected-location HUD — anchored on the right BELOW the toolbar
          so it never hides the chip buttons. Shows the docs whose
          annotations geocoded to this point: asset title + kind badge,
          and beneath each doc the location field rendered via the same
          ``TypedCell`` pipeline the table uses (so a ``places`` field
          renders as the same tag pills here as it does there). One CTA
          at the bottom opens the EvidenceDrawer for the whole group.
          Aesthetic borrows from the graph NodeDetailHUD: bare list,
          thin border-bottom separators, no card chrome. */}
      {selectedPoint && (() => {
        const point = selectedPoint;
        const docIds = point.documentIds;
        const docCount = docIds.length;

        // Build a single ``FieldDef`` for the location field so each
        // asset row can render its value via TypedCell. We anchor on
        // the *parent* of any ``[*]`` step so the cell receives the
        // whole array (e.g. ``orte: [Berlin, Munich]``) rather than a
        // single fanned-out leaf — matches how the table presents
        // array fields.
        const schema = locationField
          ? schemas.find((s) => s.id === selectedSchemaId)
          : null;
        const fieldParentPath = locationField
          ? locationField.split('[*]')[0]
          : null;
        const fieldDef: FieldDef | null = (() => {
          if (!schema || !fieldParentPath) return null;
          const def = findFieldDefinition(schema, fieldParentPath);
          // ``getTargetKeysForScheme`` knows how to pretty-print the
          // path → label including parent fallback if the leaf itself
          // is unnamed.
          const targets = getTargetKeysForScheme(schema.id, schemas, { includeArrayItemFields: true });
          const target = targets.find((tk) => tk.key === fieldParentPath)
            ?? targets.find((tk) => tk.key === locationField);
          const prettyName = target?.name
            ?? formatFieldNameForDisplay(fieldParentPath).displayName
            ?? fieldParentPath;
          return {
            key: fieldParentPath,
            name: prettyName,
            type: def?.type ?? target?.type ?? 'unknown',
            definition: def,
          };
        })();

        // Per-asset: pick the first matching annotation row for the
        // selected schema. The map only renders one schema at a time
        // (selectedSchemaId), so taking the first row is correct.
        const resultByAsset = new Map<number, FormattedAnnotation>();
        if (selectedSchemaId != null) {
          for (const r of resultsForMap) {
            if (r.schema_id !== selectedSchemaId) continue;
            if (!resultByAsset.has(r.asset_id)) resultByAsset.set(r.asset_id, r);
          }
        }

        return (
          <div
            className={cn(
              'absolute right-0 z-30 w-64 max-w-[calc(100%-1rem)] rounded-l-md border-y border-l border-border/50 bg-background/55 backdrop-blur-sm flex flex-col',
              // ``top-44`` (mobile) / ``top-52`` (sm) clears the toolbar
              // column above (5 buttons × 2-2.25rem). ``bottom-2`` lets
              // the HUD grow vertically and scroll internally.
              'top-44 sm:top-52 bottom-2',
            )}
          >
            <div className="flex items-start justify-between gap-1 px-2 pt-1 pb-0.5">
              <div className="min-w-0 flex-1">
                <div
                  className="text-[11px] font-medium truncate leading-tight"
                  title={point.locationString}
                >
                  {point.canonicalName ?? point.locationString}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground/80 tabular-nums leading-tight">
                  {docCount} doc{docCount === 1 ? '' : 's'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleClosePopup}
                aria-label="Close"
                className="h-4 w-4 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:outline-none"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-1">
              {docCount === 0 ? (
                <div className="py-1.5 text-[11px] text-muted-foreground italic">
                  No documents.
                </div>
              ) : (
                <ul>
                  {docIds.map((aid) => {
                    const asset = assetsMap.get(aid);
                    const title = asset?.title?.trim();
                    const result = resultByAsset.get(aid);
                    const fieldValue = (fieldDef && result)
                      ? getAnnotationFieldValue(result.value, fieldDef.key)
                      : undefined;
                    const showField = fieldDef && schema && fieldValue != null;
                    return (
                      <li
                        key={aid}
                        className="border-b border-border/40 last:border-b-0 py-1"
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => openEvidenceForPoint(point)}
                            className="text-[11px] font-medium truncate text-left flex-1 min-w-0 hover:underline text-foreground"
                            title={title || `Asset ${aid}`}
                          >
                            {title || `Untitled asset`}
                          </button>
                          {asset?.kind && (
                            <AssetKindBadge
                              kind={asset.kind as any}
                              context="card"
                              size="sm"
                              showLabel={false}
                              className="flex-shrink-0 h-4 w-4 p-0"
                            />
                          )}
                        </div>
                        {showField && fieldDef && schema && (
                          <div className="mt-0.5 flex items-baseline gap-1.5 min-w-0">
                            <span
                              className="text-[10px] text-muted-foreground/80 truncate shrink-0 max-w-[40%]"
                              title={fieldDef.name}
                            >
                              {fieldDef.name}:
                            </span>
                            <div className="text-[11px] min-w-0 flex-1">
                              <TypedCell
                                field={fieldDef}
                                value={fieldValue}
                                density="comfortable"
                                schema={schema}
                              />
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={() => openEvidenceForPoint(point)}
              className="border-t border-border/50 px-2 py-1 text-[10px] font-medium text-primary hover:bg-muted/40 focus:outline-none focus:bg-muted/40 transition-colors text-left"
            >
              Open evidence →
            </button>
          </div>
        );
      })()}

      <EvidenceDrawer
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        infospaceId={infospaceId}
        runId={runId}
        scope={evidenceScope}
        baseFilters={panelConfig.local_filters}
        mergeMaps={panelConfig.merge_maps}
        schemas={schemas}
      />
      </div>
    </div>
  );
};

export default AnnotationResultsMap;
