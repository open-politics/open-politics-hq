'use client';

/**
 * GeoCanvas — the one map surface: MapLibre underneath, deck.gl layers
 * interleaved on top.
 *
 * **Sovereign by default.** With nothing configured the basemap is generated
 * here from the offline Natural Earth outlines (`lib/geo/world`): a background,
 * land, and hairline borders, themed from the HUD tokens. No tiles, no token,
 * no request leaves the machine. A deployment that wants detail sets
 * `NEXT_PUBLIC_BASEMAP_STYLE_URL` to any MapLibre style — a self-hosted
 * PMTiles style works the same as a remote one.
 *
 * **A camera, not an authority.** Callers pass layers and, optionally, bounds
 * to frame once per `fitKey`. Data arriving later never moves the camera; the
 * reader does.
 *
 * MapLibre and deck.gl are imported on mount, so a dashboard without a map
 * never downloads either.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import type { Layer } from '@deck.gl/core';
import { cn } from '@/lib/utils';
import { loadCountries } from '@/lib/geo/world';
import { resolveVarToRgba, rgbaCss, useThemeVersion } from '@/lib/theme/cssColor';

export type Bounds = [[number, number], [number, number]];

export interface GeoCanvasHandle {
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  fit: (bounds: Bounds) => void;
  zoomBy: (delta: number) => void;
}

export interface GeoCanvasProps {
  layers: Layer[];
  /** Framed once per distinct `fitKey`, never again on its own. */
  fitBounds?: Bounds | null;
  fitKey?: string | null;
  /** Room the HUD occupies, so framing keeps data out from under it. */
  padding?: { top: number; right: number; bottom: number; left: number };
  className?: string;
  children?: React.ReactNode;
}

const STYLE_URL = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL || null;
const MAX_FIT_ZOOM = 6;

function themeColors() {
  return {
    water: rgbaCss(resolveVarToRgba('--background', [250, 250, 250, 255])),
    land: rgbaCss(resolveVarToRgba('--hud-sunken', [0, 0, 0, 10])),
    border: rgbaCss(resolveVarToRgba('--hud-line', [0, 0, 0, 28])),
  };
}

async function offlineStyle(): Promise<any> {
  const countries = await loadCountries();
  const c = themeColors();
  return {
    version: 8,
    sources: { countries: { type: 'geojson', data: countries } },
    layers: [
      { id: 'hq-water', type: 'background', paint: { 'background-color': c.water } },
      { id: 'hq-land', type: 'fill', source: 'countries', paint: { 'fill-color': c.land } },
      {
        id: 'hq-borders', type: 'line', source: 'countries',
        paint: { 'line-color': c.border, 'line-width': 0.6 },
      },
    ],
  };
}

export const GeoCanvas = forwardRef<GeoCanvasHandle, GeoCanvasProps>(function GeoCanvas(
  { layers, fitBounds, fitKey, padding, className, children },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const overlay = useRef<any>(null);
  const fitted = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const themeVersion = useThemeVersion();

  const latest = useRef({ layers, padding });
  latest.current = { layers, padding };

  // ── Mount ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      const [maplibreModule, { MapboxOverlay }, style] = await Promise.all([
        import('maplibre-gl'),
        import('@deck.gl/mapbox'),
        STYLE_URL ? Promise.resolve(STYLE_URL) : offlineStyle(),
      ]);
      // maplibre-gl ships a UMD build only, so what `import()` hands back
      // depends on the bundler: the library itself, or a wrapper around it.
      const maplibregl: any = (maplibreModule as any).Map
        ? maplibreModule : (maplibreModule as any).default;
      if (disposed || !host.current) return;
      const m = new maplibregl.Map({
        container: host.current,
        style,
        center: [12, 28],
        zoom: 1.15,
        minZoom: 0.6,
        maxZoom: 14,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: true,
      });
      m.touchZoomRotate.disableRotation();
      const o = new MapboxOverlay({ interleaved: true, layers: latest.current.layers });
      m.addControl(o);
      map.current = m;
      overlay.current = o;
      observer = new ResizeObserver(() => m.resize());
      observer.observe(host.current);
      m.once('load', () => !disposed && setReady(true));
      m.on('error', (e: any) => console.error('[GeoCanvas] map error', e?.error ?? e));
    })().catch((err) => {
      // A map that cannot start says so — on the canvas and in the console —
      // rather than leaving a blank rectangle that looks like "no data".
      console.error('[GeoCanvas] failed to start', err);
      if (!disposed) setFailure(err instanceof Error ? err.message : String(err));
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      overlay.current?.finalize?.();
      map.current?.remove();
      map.current = null;
      overlay.current = null;
    };
  }, []);

  // ── Layers ─────────────────────────────────────────────────────────────
  useEffect(() => {
    overlay.current?.setProps({ layers });
  }, [layers, ready]);

  // ── Theme — repaint the generated basemap in place, no style reload ─────
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || STYLE_URL) return;
    const c = themeColors();
    m.setPaintProperty('hq-water', 'background-color', c.water);
    m.setPaintProperty('hq-land', 'fill-color', c.land);
    m.setPaintProperty('hq-borders', 'line-color', c.border);
  }, [themeVersion, ready]);

  // ── Framing — once per key ─────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !fitBounds || !fitKey || fitted.current === fitKey) return;
    fitted.current = fitKey;
    const [[w, s], [e, n]] = fitBounds;
    // One place must not zoom to street level, and a world-spanning run must
    // not be cropped to a sliver: pad the box before framing it.
    const pad = 0.5;
    m.fitBounds([[w - pad, s - pad], [e + pad, n + pad]], {
      padding: latest.current.padding ?? 40,
      maxZoom: MAX_FIT_ZOOM,
      duration: 700,
    });
  }, [fitBounds, fitKey, ready]);

  useImperativeHandle(ref, () => ({
    flyTo: (lon, lat, zoom) => map.current?.flyTo({
      center: [lon, lat], zoom: zoom ?? Math.max(map.current.getZoom(), 4),
      padding: latest.current.padding, duration: 650,
    }),
    fit: (bounds) => map.current?.fitBounds(bounds, {
      padding: latest.current.padding ?? 40, maxZoom: MAX_FIT_ZOOM, duration: 650,
    }),
    zoomBy: (delta) => map.current?.easeTo({ zoom: map.current.getZoom() + delta, duration: 250 }),
  }), []);

  return (
    <div className={cn('relative h-full w-full', className)}>
      {/* Sized by its box, never by position: MapLibre stamps
          `.maplibregl-map { position: relative }` on the element it mounts
          into, which would collapse an `absolute inset-0` host to 0px. */}
      <div className="absolute inset-0">
        <div ref={host} className="h-full w-full" />
      </div>
      {failure && (
        <div className="absolute inset-x-0 bottom-1/2 text-center text-[11px] text-hud-dimmer">
          Map unavailable: {failure}
        </div>
      )}
      {children}
    </div>
  );
});
