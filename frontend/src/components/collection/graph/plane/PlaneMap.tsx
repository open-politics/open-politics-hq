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
 * **The loop is closed.** MapLibre keeps its own limits — it will not show past
 * the world's edge, zoom beyond its range, or float a world smaller than the
 * view off-centre — and the plane has none. Following one way, every refused
 * camera left the map somewhere the graph was not, and the two drifted apart.
 * So after each move the map's *actual* camera is read back, and when MapLibre
 * adjusted it the plane is fitted to the map's real viewport instead. Web
 * Mercator and the plane share one uniform scale, so fitting the viewport's
 * corners reproduces the camera exactly: the two always show the same piece of
 * the world.
 */
import { useEffect, useRef } from 'react';
import type { Layer } from '@deck.gl/core';
import { GeoCanvas, type GeoCanvasHandle } from '@/components/collection/geo/GeoCanvas';
import { SPACE_SIZE, usePlane } from './CosmosPlane';
import { toSpace } from './arrange';

/** MapLibre's world is 512 px wide at zoom 0. */
const TILE = 512;
/** How far the map may sit from where the plane asked, in screen pixels,
 *  before the plane is brought to the map. */
const SLACK_PX = 0.75;

export function PlaneMap({ layers = [], contrast = 'normal' }: { layers?: Layer[]; contrast?: 'normal' | 'high' }) {
  const plane = usePlane();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<GeoCanvasHandle>(null);
  const last = useRef('');

  const sync = () => {
    const graph = plane.graph;
    const el = box.current;
    const m = map.current;
    if (!graph || !el || !m) return;
    const w = el.clientWidth, h = el.clientHeight;
    // The world's north-west and south-east corners, on screen.
    const [x0, y0] = graph.spaceToScreenPosition([0, SPACE_SIZE]);
    const [x1] = graph.spaceToScreenPosition([SPACE_SIZE, 0]);
    const world = x1 - x0;
    if (!(world > 0)) return;
    const mx = (w / 2 - x0) / world;
    const my = (h / 2 - y0) / world;
    const lon = mx * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
    const zoom = Math.log2(world / TILE);
    const key = `${lon.toFixed(5)}:${lat.toFixed(5)}:${zoom.toFixed(4)}`;
    if (key === last.current) return;
    last.current = key;
    m.jumpTo(lon, lat, zoom);

    // Did the map go where it was asked? Compare in pixels: where the plane
    // puts the map's actual centre.
    const actual = m.camera();
    if (!actual) return;
    const [ax, ay] = toSpace(actual.lat, actual.lon, SPACE_SIZE);
    const [sx, sy] = graph.spaceToScreenPosition([ax, ay]);
    const off = Math.hypot(sx - w / 2, sy - h / 2);
    const zoomOff = Math.abs(actual.zoom - zoom) * world;
    if (off <= SLACK_PX && zoomOff <= SLACK_PX) return;
    // It did not: the plane follows the map. The map's viewport, in plane
    // space, from its actual centre and zoom — not by unprojecting the corners,
    // which clamp at the world's edge when the view shows more than the world.
    const unit = SPACE_SIZE / (TILE * 2 ** actual.zoom);     // plane units per pixel
    const hx = (w / 2) * unit, hy = (h / 2) * unit;
    last.current = '';
    graph.setZoomTransformByPointPositions(
      new Float32Array([ax - hx, ay - hy, ax + hx, ay + hy]), 0, undefined, 0,
    );
  };

  useEffect(() => plane.subscribe(sync)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  , [plane]);

  return (
    <div ref={box} className="absolute inset-0">
      <GeoCanvas ref={map} passive contrast={contrast} layers={layers}
                 onReady={() => { last.current = ''; sync(); }}
                 className="absolute inset-0" />
    </div>
  );
}
