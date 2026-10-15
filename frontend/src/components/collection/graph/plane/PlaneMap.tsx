'use client';

/**
 * PlaneMap — the map under the plane, one camera with it.
 *
 * The geo arrangement (`arrange.byPlace`) puts every place at its Web-Mercator
 * position in plane space, the world spanning `[0, SPACE_SIZE]` with north up.
 * So the map only has to show the same square of the world where the plane
 * shows it. The plane takes the input — pan, zoom, drag a node — and the map, a
 * passive `GeoCanvas` (the overview's basemap, with room for deck.gl layers),
 * follows.
 *
 * **The plane is never held back.** MapLibre keeps its own limits — it will
 * not zoom out past its range, show past the poles, or float a world smaller
 * than the view off-centre — and the plane has none. So the map goes as near as
 * it can, its *actual* camera is read back, and whatever is left over is made
 * up by moving and scaling the map's layer: Web Mercator and the plane share
 * one uniform scale, so a translate and a scale close the gap exactly. Zoomed
 * out past the map's range the world simply shrinks on screen, as it should;
 * panned past a pole the map's edge shows, as it should. The graph and the map
 * always show the same piece of the world, and the reader's gesture always
 * goes where they pushed it.
 */
import { useEffect, useRef } from 'react';
import type { Layer } from '@deck.gl/core';
import { GeoCanvas, type GeoCanvasHandle } from '@/components/collection/geo/GeoCanvas';
import { SPACE_SIZE, usePlane } from './CosmosPlane';

/** MapLibre's world is 512 px wide at zoom 0. */
const TILE = 512;
/** Residuals smaller than this (px, or relative scale) are left alone. */
const SLACK = 0.25;

export function PlaneMap({ layers = [], contrast = 'normal' }: { layers?: Layer[]; contrast?: 'normal' | 'high' }) {
  const plane = usePlane();
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const map = useRef<GeoCanvasHandle>(null);
  const last = useRef('');

  const sync = () => {
    const graph = plane.graph;
    const el = box.current;
    const m = map.current;
    if (!graph || !el || !m || !layer.current) return;
    const w = el.clientWidth, h = el.clientHeight;
    // The world's north-west corner and width, on screen, as the plane has it.
    const [x0, y0] = graph.spaceToScreenPosition([0, SPACE_SIZE]);
    const [x1] = graph.spaceToScreenPosition([SPACE_SIZE, 0]);
    const world = x1 - x0;
    if (!(world > 0)) return;
    const key = `${x0.toFixed(2)}:${y0.toFixed(2)}:${world.toFixed(3)}:${w}:${h}`;
    if (key === last.current) return;
    last.current = key;

    const mx = (w / 2 - x0) / world;
    const my = (h / 2 - y0) / world;
    const lon = mx * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
    m.jumpTo(lon, lat, Math.log2(world / TILE));

    // Where the map really went: its world's corner and width on its canvas.
    const actual = m.camera();
    if (!actual) return;
    const mapWorld = TILE * 2 ** actual.zoom;
    const amx = (actual.lon + 180) / 360;
    const phi = (Math.max(-85.0511, Math.min(85.0511, actual.lat)) * Math.PI) / 180;
    const amy = (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
    const mapX0 = w / 2 - amx * mapWorld;
    const mapY0 = h / 2 - amy * mapWorld;
    // The rest, as one transform of the map's layer: map pixel p lands at s·p + t.
    const s = world / mapWorld;
    const tx = x0 - s * mapX0, ty = y0 - s * mapY0;
    const style = layer.current.style;
    if (Math.abs(s - 1) * Math.max(w, h) < SLACK && Math.abs(tx) < SLACK && Math.abs(ty) < SLACK) {
      style.transform = '';
    } else {
      style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    }
  };

  useEffect(() => plane.subscribe(sync)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  , [plane]);

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden">
      <div ref={layer} className="absolute inset-0 origin-top-left will-change-transform">
        <GeoCanvas ref={map} passive contrast={contrast} layers={layers}
                   onReady={() => { last.current = ''; sync(); }}
                   className="absolute inset-0" />
      </div>
    </div>
  );
}
