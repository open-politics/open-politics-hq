// frontend/src/components/collection/infospaces/annotation/AnnotationResultsMap.tsx
'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import mapboxgl, { Map as MapboxMap, LngLatLike, Popup, Marker, LngLatBounds } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from 'next-themes';
import { AnnotationSchemaRead, AssetRead } from '@/client';
import { PanelConfig, AnnotationResultRow } from '@/lib/annotations/types';
import type { MapVizConfig } from '@/lib/annotations/types';
import { getAnnotationFieldValue, getAnnotationFieldValuesExploded, getTargetKeysForScheme, formatFieldNameForDisplay } from '@/lib/annotations/utils';
import { inferRangeFromValues, readDeclaredRange } from './cellRenderers/NumberCell';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { createScopeFromSelection } from '@/lib/annotations/scopes';
import type { Scope } from '@/lib/annotations/types';
import { EvidenceDrawer } from './panels/EvidenceDrawer';
import { debounce } from 'lodash';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Badge } from '@/components/ui/badge';
import { Loader2, Globe, Map as MapIcon, MapPin, X, Eye, EyeOff, Sun, Moon, Hexagon, Pin, CircleDotDashed, GitBranchPlus, Spline, List, Search, Palette, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import { EmptyStateCard } from './panels/EmptyStateCard';
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
  splitValue?: string;
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
 * field path so we can pull declared minimum/maximum bounds.
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
 * Pick the bbox of the largest part of a Polygon/MultiPolygon.
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
  onResultSelect?: (result: any) => void;
  highlightLocation?: { location: string; fieldKey: string } | null;
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
  // ── Visual config from panel_config ─────────────────────────────────────
  const cfg = panelConfig.panel_config as MapVizConfig;
  const mapMode: 'markers' | 'areaGeometryMeasures' = (cfg?.mode as 'markers' | 'areaGeometryMeasures' | undefined) ?? 'markers';

  // Location field: cfg.position drives geocoding in both modes.
  const locationField: string | undefined = cfg?.position ?? undefined;

  // Label fields: cfg.label is string[]; derive the same labelConfigs shape
  // as before so all label rendering code below remains unchanged.
  const selectedSchemaId: number | null = cfg?.geocode_source?.schemaId ?? null;
  const labelConfigs = useMemo<{ schemaId: number; fieldKey: string }[]>(() => {
    const sid = selectedSchemaId;
    const paths: string[] = Array.isArray(cfg?.label)
      ? cfg.label.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    if (paths.length > 0 && sid != null) {
      return paths.map((fieldKey) => ({ schemaId: sid, fieldKey }));
    }
    return [];
  }, [cfg?.label, selectedSchemaId]);
  const labelConfig = labelConfigs[0];

  // Color role: cfg.color drives the group_by coloring.
  const colorField: string | undefined = cfg?.color ?? undefined;
  const colorSchemaId = selectedSchemaId;

  // viewMode / showAreas: driven by cfg.show_areas (new) with settings
  // fallback for dashboards saved before the cfg migration.
  const viewMode: 'pointer' | 'polygon' =
    cfg?.show_areas
      ? 'polygon'
      : ((panelConfig.settings?.viewMode as 'pointer' | 'polygon' | undefined)
          ?? (panelConfig.settings?.showAreas ? 'polygon' : 'pointer'));
  const showAreas = viewMode === 'polygon';

  const setViewMode = useCallback((next: 'pointer' | 'polygon') => {
    onUpdatePanel({
      panel_config: {
        ...cfg,
        show_areas: next === 'polygon',
      } as any,
      settings: {
        ...(panelConfig.settings ?? {}),
        viewMode: next,
        showAreas: next === 'polygon',
      },
    });
  }, [onUpdatePanel, cfg, panelConfig.settings]);

  // Mode toggle: markers ↔ areaGeometryMeasures — stays on the renderer toolbar.
  const setMapMode = useCallback((next: 'markers' | 'areaGeometryMeasures') => {
    onUpdatePanel({
      panel_config: { ...cfg, mode: next } as any,
    });
  }, [onUpdatePanel, cfg]);

  const panelConfigRef = useRef(panelConfig);
  panelConfigRef.current = panelConfig;

  const mapSettingsRef = useRef(panelConfig.settings);
  mapSettingsRef.current = panelConfig.settings;

  const onSettingsChange = useCallback((settings: any) => {
    onUpdatePanel({ settings: { ...mapSettingsRef.current, ...settings } });
  }, [onUpdatePanel]);

  // ── Data fetching ─────────────────────────────────────────────────────────
  // markers mode: rows phase — each row becomes a marker.
  // areaGeometryMeasures mode: aggregate phase — each row.keys[position] → region,
  //                  row.measures[color or 'count'] → color intensity.
  const { data: viewData } = useAnnotationView({
    infospaceId,
    runId,
    panel: panelConfig,
    schemas,
    fields: mapMode === 'markers' ? panelConfig.fields : undefined,
    incoming_scopes: panelConfig.scopes_in,
    merge_maps: panelConfig.merge_maps,
    ...(mapMode === 'markers'
      ? { rows: { cursor: null as any, limit: 500 }, enabled: !!runId && !!infospaceId && !!locationField }
      : { aggregate: {}, enabled: !!runId && !!infospaceId }),
  });

  // Map rows-phase response to the FormattedAnnotation shape the rest of the
  // component uses so none of the marker-building / label / color code below
  // needs to change.
  const results = useMemo<any[]>(() => {
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

  // areaGeometryMeasures aggregate: build a locationValue → numeric-measure map so
  // the polygon color layer can drive fill intensity from it.
  const areaGeometryMeasures = useMemo<Map<string, number>>(() => {
    if (mapMode !== 'areaGeometryMeasures' || !viewData?.aggregate) return new Map();
    const measureKey = colorField ?? 'count';
    const out = new Map<string, number>();
    for (const row of viewData.aggregate.rows) {
      const region = locationField ? row.keys[locationField] : undefined;
      if (!region) continue;
      const val = row.measures[measureKey];
      const n = typeof val === 'number' ? val : Number(val);
      if (Number.isFinite(n)) out.set(region.toLowerCase(), n);
    }
    return out;
  }, [mapMode, viewData?.aggregate, colorField, locationField]);

  // ── Geocode action + marker accumulator ──────────────────────────────────
  const { watchUrl, isPending: isGeocoding, error: geocodeError, kick: kickGeocode, reset: resetGeocode } = useGeocodeAction();
  const [accumulatedPoints, setAccumulatedPoints] = useState<MapPoint[]>([]);
  const [isGeocodingActive, setIsGeocodingActive] = useState(false);

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
            const existing = prev[idx];
            const next: MapPoint = {
              ...existing,
              locationString: existing.locationString || (r.display_name ?? r.name ?? String(r.entity_id)),
              canonicalName: existing.canonicalName ?? r.name,
              bbox: existing.bbox ?? incomingBbox,
              geometry: existing.geometry ?? incomingGeometry,
            };
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
        void refetchSeedRef.current?.();
      } else if (event.type === 'error' || event.type === 'failed') {
        setIsGeocodingActive(false);
      }
    },
    onDone: () => {
      setIsGeocodingActive(false);
      void refetchSeedRef.current?.();
    },
  });

  // Reset accumulator when the location field changes.
  const prevLocationFieldRef = useRef<string | undefined>(locationField);
  useEffect(() => {
    const prev = prevLocationFieldRef.current;
    prevLocationFieldRef.current = locationField;
    if (prev === locationField) return;
    if (prev === undefined) return;
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[map.reset] locationField changed', { from: prev, to: locationField });
    }
    setAccumulatedPoints([]);
    resetGeocode();
  }, [locationField, resetGeocode]);

  // Seed already-resolved coords on mount / when the field changes.
  const { entities: seededEntities, refetch: refetchSeed } = useGeocodedEntities({
    infospaceId,
    runId,
    fieldPath: locationField ?? null,
    enabled: !!infospaceId && !!runId && !!locationField,
  });
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
    const refetch = () => refetchSeedRef.current?.();
    setTimeout(() => { void refetch(); }, 800);
    setTimeout(() => { void refetch(); }, 3000);
    setTimeout(() => { void refetch(); }, 8000);
  }, [locationField, infospaceId, runId, kickGeocode]);

  // ── Misc state ───────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceScope, setEvidenceScope] = useState<Scope | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [isGlobeView, setIsGlobeView] = useState(false);
  const [locationsPanelOpen, setLocationsPanelOpen] = useState(false);
  const [locationsSearch, setLocationsSearch] = useState('');
  const { theme: pageTheme } = useTheme();

  const mapTheme: 'light' | 'dark' = (() => {
    const stored = panelConfig.settings?.mapTheme as 'light' | 'dark' | undefined;
    if (stored === 'light' || stored === 'dark') return stored;
    return pageTheme === 'dark' ? 'dark' : 'light';
  })();
  const themeRef = useRef(mapTheme);
  themeRef.current = mapTheme;

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiamltdnciLCJhIjoiY20xd2U3Z2pqMGprdDJqczV2OXJtMTBoayJ9.hlSx0Nc19j_Z1NRgyX7HHg';

  const assetsMap = useMemo(() => new Map((assets || []).map(asset => [asset.id, asset])), [assets]);

  // Merge legacy seed points with the SSE accumulator.
  const mergedPoints = useMemo<MapPoint[]>(() => {
    const seed = points ?? [];
    if (accumulatedPoints.length === 0) return seed;
    const byId = new Map<string, MapPoint>();
    seed.forEach((p) => byId.set(p.id, p));
    accumulatedPoints.forEach((p) => byId.set(p.id, p));
    return Array.from(byId.values());
  }, [points, accumulatedPoints]);

  // Enrich markers with the annotations whose location value matches the
  // marker's canonical name.
  const markersWithDocuments = useMemo<MapPoint[]>(() => {
    if (!locationField || results.length === 0) return mergedPoints;

    const parsePath = (p: string): string[] => p.split('.');
    const parts = parsePath(locationField);
    const unwrapped = parts[0] === 'document' ? parts.slice(1) : null;

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
      const key = (p.canonicalName ?? p.locationString ?? '').trim().toLowerCase();
      const ids = byLocation.get(key);
      if (!ids || ids.size === 0) return p;
      return { ...p, documentIds: Array.from(ids) };
    });
  }, [mergedPoints, results, locationField]);

  const processedPoints = markersWithDocuments;
  const resultsForMap = results;

  // ── Per-value color override map ─────────────────────────────────────────
  const colorOverridesForField = useMemo<Record<string, string>>(() => {
    const all = (panelConfig.settings?.colorOverrides ?? {}) as Record<string, Record<string, string>>;
    if (!colorField) return {};
    return all[colorField] ?? {};
  }, [panelConfig.settings?.colorOverrides, colorField]);

  const hiddenColorValues = useMemo<Set<string>>(() => {
    const all = (panelConfig.settings?.hiddenColorValues ?? {}) as Record<string, string[]>;
    if (!colorField) return new Set();
    return new Set(all[colorField] ?? []);
  }, [panelConfig.settings?.hiddenColorValues, colorField]);

  const pointToColorValue = useMemo<Map<string, string>>(() => {
    const out = new Map<string, string>();
    if (!colorField || !colorSchemaId || processedPoints.length === 0) return out;
    const targetKeys = getTargetKeysForScheme(colorSchemaId, schemas, { includeArrayItemFields: true });
    const fieldInfo = targetKeys.find((tk) => tk.key === colorField);
    const isNumeric = !!fieldInfo && (fieldInfo.type === 'integer' || fieldInfo.type === 'number');
    if (isNumeric) return out;
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

  // Per-point visibility.
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

  const pointsWithMeaningfulAreas = useMemo(() => {
    const AREA_THRESHOLD = 0.001;
    return visiblePoints.filter((point) => {
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

  const markerPoints = useMemo<MapPoint[]>(() => {
    if (viewMode === 'pointer') return visiblePoints;
    const polygonIds = new Set(pointsWithMeaningfulAreas.map((p) => p.id));
    return visiblePoints.filter((p) => !polygonIds.has(p.id));
  }, [visiblePoints, viewMode, pointsWithMeaningfulAreas]);

  const polygonRenderedIds = useMemo<Set<string>>(() => {
    if (!showAreas) return new Set();
    return new Set(pointsWithMeaningfulAreas.map((p) => p.id));
  }, [showAreas, pointsWithMeaningfulAreas]);

  const colorBundle = useMemo<{
    colorMap: Map<string, string>;
    entries: { value: string; color: string; count: number }[];
    isNumeric: boolean;
  }>(() => {
    const colorMap = new Map<string, string>();
    const entries: { value: string; color: string; count: number }[] = [];

    // areaGeometryMeasures mode: color intensity from aggregate measures
    if (mapMode === 'areaGeometryMeasures' && areaGeometryMeasures.size > 0) {
      const vals = Array.from(areaGeometryMeasures.values());
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      if (max > min) {
        for (const p of processedPoints) {
          const key = _normalizeMatch(p.canonicalName ?? p.locationString);
          const v = areaGeometryMeasures.get(key);
          if (v == null) continue;
          const f = (v - min) / (max - min);
          colorMap.set(p.id, numericGradientColor(f));
        }
      }
      return { colorMap, entries, isNumeric: true };
    }

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

    // Categorical
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
  }, [
    mapMode, areaGeometryMeasures,
    colorField, colorSchemaId, processedPoints, resultsForMap, schemas, locationField,
    colorOverridesForField, pointToColorValue,
  ]);

  const colorMap = colorBundle.colorMap;
  const colorEntries = colorBundle.entries;
  const colorIsNumeric = colorBundle.isNumeric;

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

  // Legend visibility + collapsed state.
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

  // ── Map lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: themeRef.current === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [13.4050, 52.5200],
      zoom: 3,
      projection: 'mercator' as any
    });

    map.on('load', () => {
      setMapLoaded(true);
    });
    map.on('style.load', () => {
      setStyleVersion((v) => v + 1);
    });

    mapRef.current = map;

    if (mapContainerRef.current && 'ResizeObserver' in window) {
      resizeObserverRef.current = new ResizeObserver(
        debounce(() => {
          if (mapRef.current) {
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
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      map.remove();
    };
  }, [MAPBOX_TOKEN]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;

    const addMarkers = () => {
      if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
        return;
      }

      try {
        markersRef.current.forEach(marker => marker.remove());
        markersRef.current = [];

        const bounds = new mapboxgl.LngLatBounds();

        visiblePoints.forEach((p) => {
          bounds.extend([p.coordinates.longitude, p.coordinates.latitude]);
        });

        const ringColor = mapTheme === 'dark' ? '#0f172a' : '#ffffff';
        const defaultMarkerColor = mapTheme === 'dark' ? '#60a5fa' : '#2563eb';

        markerPoints.forEach((point) => {
          const { longitude, latitude } = point.coordinates;
          const markerColor = colorMap.get(point.id) ?? defaultMarkerColor;

          const wrapper = document.createElement('div');
          wrapper.style.cssText = 'cursor: pointer; line-height: 0; transition: opacity 200ms ease;';
          wrapper.dataset.pointId = point.id;

          const inner = document.createElement('div');
          inner.style.cssText = [
            'transition: transform 120ms ease, filter 120ms ease',
            'filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
            'transform-origin: 50% 100%',
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

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 50, maxZoom: 15 });
        }
      } catch (error) {
        console.warn('Error adding map markers:', error);
      }
    };

    if (map.isStyleLoaded()) {
      addMarkers();
    } else {
      map.once('style.load', addMarkers);
    }

    return () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
    };
  }, [visiblePoints, markerPoints, mapLoaded, handlePointClick, colorMap, mapTheme]);

  // Label generation.
  const labelData = useMemo(() => {
    if (visiblePoints.length === 0 || cfg?.show_labels === false) {
      return null;
    }

    const schemeLookup = new Map(schemas.map((s) => [s.id, s]));
    const STACK_CAP = 4;
    const PER_VALUE_CAP = 30;

    const labelFeatures: LabelGeoJsonFeature[] = [];

    for (const point of visiblePoints) {
      const isPolygon = polygonRenderedIds.has(point.id);
      if (!isPolygon && !point.documentIds.length) continue;

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
          dataText: dataText || '',
          isPolygon,
        },
      } as LabelGeoJsonFeature);
    }

    return labelFeatures;
  }, [cfg?.show_labels, labelConfigs, locationField, visiblePoints, polygonRenderedIds, resultsForMap, schemas, mapTheme]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const sourceId = 'label-source';
    const layerId = 'label-layer';

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
  }, [mapLoaded, labelData, styleVersion]);

  // Focus dim effect.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const selectedId = selectedPoint?.id ?? null;
    const FOCUS_DIM = 0.25;

    for (const m of markersRef.current) {
      const el = m.getElement() as HTMLElement | null;
      if (!el) continue;
      const pid = el.dataset.pointId ?? null;
      el.style.opacity = !selectedId || pid === selectedId ? '1' : String(FOCUS_DIM);
    }

    const trySet = (layerId: string, prop: string, value: any) => {
      try {
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, prop as any, value);
      } catch {
        // safe to ignore
      }
    };

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

    trySet(
      'location-areas-border-layer',
      'line-opacity',
      selectedId
        ? ['case', ['==', ['get', 'pointId'], selectedId], 0.9, FOCUS_DIM]
        : 0.9,
    );

    trySet(
      'label-layer',
      'text-opacity',
      selectedId
        ? ['case', ['==', ['get', 'pointId'], selectedId], 1.0, FOCUS_DIM]
        : 1.0,
    );
  }, [mapLoaded, selectedPoint, styleVersion]);

  // Area polygon layer effect.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
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
        if (map.getLayer(areaBorderLayerId)) {
          map.removeLayer(areaBorderLayerId);
        }
        if (map.getLayer(areaLayerId)) {
          map.removeLayer(areaLayerId);
        }
        if (map.getSource(areaSourceId)) {
          map.removeSource(areaSourceId);
        }

        if (!showAreas || pointsWithMeaningfulAreas.length === 0) {
          if (process.env.NODE_ENV !== 'production') {
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

        const defaultFill = mapTheme === 'dark' ? '#3b82f6' : '#2563eb';
        const defaultBorder = mapTheme === 'dark' ? '#60a5fa' : '#3b82f6';

        type FeatureEntry = {
          feature: {
            type: 'Feature';
            geometry: any;
            properties: Record<string, any>;
          };
          anchorBbox: [number, number, number, number] | null;
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

            const g = point.geometry;
            if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
              return {
                feature: { type: 'Feature' as const, geometry: g, properties: baseProps },
                anchorBbox,
                area,
              };
            }

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

        const bboxContains = (
          outer: [number, number, number, number],
          inner: [number, number, number, number],
        ): boolean => {
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
              if (other.area <= entry.area) continue;
              if (bboxContains(other.anchorBbox, entry.anchorBbox)) level++;
            }
          }
          entry.feature.properties.nestLevel = level;
        }

        entries.sort((a, b) => b.area - a.area);

        const features = entries.map((e) => e.feature);

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

        map.addSource(areaSourceId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: features as any
          }
        });

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
        (map as any).__areaListeners = { handleAreaClick, handleAreaEnter, handleAreaLeave };
      } catch (error) {
        console.error('[map.areas] addAreas threw — polygons will not render:', error);
      }
    };

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

  // Map theme effect.
  const lastAppliedMapStyleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const targetStyleUrl = mapTheme === 'dark'
      ? 'mapbox://styles/mapbox/dark-v11'
      : 'mapbox://styles/mapbox/light-v11';

    if (lastAppliedMapStyleRef.current === null) {
      lastAppliedMapStyleRef.current = targetStyleUrl;
      return;
    }
    if (lastAppliedMapStyleRef.current === targetStyleUrl) return;

    try {
      lastAppliedMapStyleRef.current = targetStyleUrl;
      map.setStyle(targetStyleUrl);
    } catch (error) {
      console.warn('Error updating map style:', error);
    }
  }, [mapTheme, mapLoaded]);

  // Label config info for display chips.
  const labelConfigInfos = useMemo(() => {
    if (labelConfigs.length === 0) return [];
    return labelConfigs.flatMap((cfgItem) => {
      const schema = schemas.find((s) => s.id === cfgItem.schemaId);
      if (!schema) return [];
      const targetKeys = getTargetKeysForScheme(cfgItem.schemaId, schemas, { includeArrayItemFields: true });
      const fieldInfo = targetKeys.find((tk) => tk.key === cfgItem.fieldKey);
      const prettyName = fieldInfo?.name ?? formatFieldNameForDisplay(cfgItem.fieldKey).displayName ?? cfgItem.fieldKey;
      return [{
        schemaName: schema.name,
        fieldName: prettyName,
        fieldType: fieldInfo?.type ?? 'unknown',
        fieldKey: cfgItem.fieldKey,
        schemaId: cfgItem.schemaId,
      }];
    });
  }, [labelConfigs, schemas]);

  const handleLocationClick = useCallback((point: MapPoint) => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    handlePointClick(point);

    const LEFT_HALF = 224 / 2;
    const RIGHT_HALF = 256 / 2;
    const leftShift = locationsPanelOpen ? LEFT_HALF : 0;
    const rightShift = RIGHT_HALF;
    const offsetX = leftShift - rightShift;

    map.flyTo({
      center: [point.coordinates.longitude, point.coordinates.latitude],
      offset: [offsetX, 0],
      zoom: Math.max(map.getZoom(), 4),
      duration: 800,
    });
  }, [handlePointClick, locationsPanelOpen]);

  // Handle external location highlighting.
  useEffect(() => {
    if (!highlightLocation || !mapLoaded) return;
    const { location, fieldKey } = highlightLocation;
    const matchingPoint = processedPoints.find(point =>
      point.locationString.toLowerCase().includes(location.toLowerCase()) ||
      location.toLowerCase().includes(point.locationString.toLowerCase())
    );
    if (matchingPoint) {
      handleLocationClick(matchingPoint);
    }
  }, [highlightLocation, processedPoints, mapLoaded, handleLocationClick]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Header slot empty — Markers/areaGeometryMeasures toggle moved to the
          map's own canvas overlay (top-right), alongside the pointer/
          polygon button. The panel header carries only the universal
          config popover. */}
      <PanelHeaderSlot>{null}</PanelHeaderSlot>

      {!locationField ? (
        <div className="p-2 flex-shrink-0">
          <EmptyStateCard
            reason={{ kind: 'role_unfilled', roleLabel: 'Position (location field)' }}
          />
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative annotation-map-host">
      <style>
        {`.annotation-map-host .mapboxgl-ctrl-bottom-right { display: none; }`}
      </style>
      <div
        ref={mapContainerRef}
        className="h-full w-full"
        style={{
          minHeight: '200px',
          maxHeight: '100%'
        }}
      />

      {/* Locations panel */}
      {locationsPanelOpen && processedPoints.length > 0 && (() => {
        const search = locationsSearch.trim().toLowerCase();
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

      {/* Map control overlay */}
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 flex flex-col items-end gap-1">
        <ButtonGroup className="bg-background/80 backdrop-blur-sm border shadow-lg rounded-md">
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
          {/* Markers ↔ areaGeometryMeasures — display knob. Lives on the canvas
              (not in the panel header) alongside the pointer/polygon
              button. The config popover handles roles + filter only. */}
          {/* <Button
            onClick={() => setMapMode(mapMode === 'markers' ? 'areaGeometryMeasures' : 'markers')}
            variant="secondary"
            size="sm"
            className="h-8 sm:h-9 px-2 bg-transparent hover:bg-background/90 text-[11px]"
            title={mapMode === 'markers' ? 'Active: per-row markers — click for Area' : 'Active: Area Geometry aggregate — click for markers'}
          >
            {mapMode === 'markers' ? (
              <><MapPin className="h-3.5 w-3.5 mr-1" />Markers</>
            ) : (
              <><Hexagon className="h-3.5 w-3.5 mr-1" />Area</>
            )}
          </Button> */}
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

      {/* Label-source indicator chips */}
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

      {/* Color legend */}
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

      {/* Selected-location HUD */}
      {selectedPoint && (() => {
        const point = selectedPoint;
        const docIds = point.documentIds;
        const docCount = docIds.length;

        const schema = locationField
          ? schemas.find((s) => s.id === selectedSchemaId)
          : null;
        const fieldParentPath = locationField
          ? locationField.split('[*]')[0]
          : null;
        const fieldDef: FieldDef | null = (() => {
          if (!schema || !fieldParentPath) return null;
          const def = findFieldDefinition(schema, fieldParentPath);
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

        const resultByAsset = new Map<number, any>();
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
        baseFilters={panelConfig.formula?.filter as any}
        mergeMaps={panelConfig.merge_maps}
        schemas={schemas}
      />
      </div>
    </div>
  );
};

export default AnnotationResultsMap;
