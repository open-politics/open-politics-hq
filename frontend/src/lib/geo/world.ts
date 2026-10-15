/**
 * The world, offline — Natural Earth 110m country outlines via `world-atlas`
 * (ISC; the data itself is public domain). No tile server, no token, no
 * network: the basemap HQ draws when nothing else is configured, so a map
 * works the same on an air-gapped laptop as on a cloud deployment.
 *
 * Imported lazily and once per session; every map and the graph's geo lens
 * share the one copy.
 *
 * **Flat, not spherical.** `world-atlas` is cut for d3-geo, which draws on the
 * sphere: Russia, Fiji and Antarctica jump from +180° to −180° mid-ring and
 * trust the renderer to go the short way round. Every consumer here is planar
 * (MapLibre, the graph's Mercator lens), where that jump is a straight edge
 * across the whole world — bands over the northern hemisphere, wedges over
 * the south. So rings are made continuous once, on load (`planar`).
 */
import type { FeatureCollection, Geometry } from 'geojson';

let countries: FeatureCollection<Geometry> | null = null;
let pending: Promise<FeatureCollection<Geometry>> | null = null;

const EMPTY: FeatureCollection<Geometry> = { type: 'FeatureCollection', features: [] };

export function loadCountries(): Promise<FeatureCollection<Geometry>> {
  if (countries) return Promise.resolve(countries);
  if (!pending) {
    pending = Promise.all([
      import('world-atlas/countries-110m.json'),
      import('topojson-client'),
    ])
      .then(([topoMod, { feature }]) => {
        const topo: any = (topoMod as any).default ?? topoMod;
        countries = planar(feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>);
        return countries;
      })
      // A missing outline must never take a map down with it.
      .catch(() => (countries = EMPTY));
  }
  return pending;
}

/** Web Mercator's edge — the furthest a planar map can draw toward a pole. */
const MERCATOR_LAT = 85.0511;

type Position = number[];

/**
 * One ring, continuous in longitude. Each jump of more than 180° is undone by
 * shifting what follows a whole turn, so the ring may run past ±180 — MapLibre
 * draws that into the neighbouring world copy, which is where it belongs.
 *
 * A ring that still ends a whole turn from where it began goes *around* a pole
 * (Antarctica) rather than across the seam. It is closed the long way, down
 * the map's edge, so it fills the pole instead of a slab across the globe.
 */
function continuous(ring: Position[]): Position[] {
  if (ring.length < 2) return ring;
  const out: Position[] = [[...ring[0]]];
  let shift = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) shift -= 360;
    else if (d < -180) shift += 360;
    out.push([ring[i][0] + shift, ring[i][1]]);
  }
  if (shift !== 0) {
    const first = out[0];
    const last = out[out.length - 1];
    const meanLat = out.reduce((s, p) => s + p[1], 0) / out.length;
    const edge = meanLat < 0 ? -MERCATOR_LAT : MERCATOR_LAT;
    out.push([last[0], edge], [first[0], edge], [...first]);
  }
  return out;
}

function planar(fc: FeatureCollection<Geometry>): FeatureCollection<Geometry> {
  for (const f of fc.features) {
    const g = f.geometry;
    if (g?.type === 'Polygon') g.coordinates = g.coordinates.map(continuous);
    else if (g?.type === 'MultiPolygon') g.coordinates = g.coordinates.map((p) => p.map(continuous));
  }
  return fc;
}
