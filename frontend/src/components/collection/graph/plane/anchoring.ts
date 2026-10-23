/**
 * Anchors — sets the reader puts on the canvas, to gather what they hold.
 *
 * "Ukraine" dropped at the left, "energy prices" at the right: the set's
 * members, and what they link to, gravitate to their anchor, and the space
 * between the two fills with what connects them. A set (`sets.ts`) is placed
 * per space, and means what that space means:
 *
 *   free   groups and deep time — a point; members gather around it, and in
 *          deep time a stream gathers there through every slice
 *   time   the flat timeline — a lane: members keep their column (their
 *          time) and move to the anchor's height, so a topic reads left to
 *          right across the period
 *   geo    the map — a point on the world: members gather there, those with
 *          no place of their own too
 *
 * Members are pulled firmly, their neighbours more lightly — the related, not
 * only the named.
 *
 * A set with a degree (`fields.ts`) can be placed **along** an axis instead
 * of at a point: each member goes to the height its weight gives — a 9 high,
 * a 2 low — so the plane sorts itself by the scale. On the flat timeline that
 * is a lane per value band in each time column. Deep time does it when it
 * draws (`surface.towardField`), where the layout's height is free to give;
 * the forces have no pull along one axis only, so in the groups view a field
 * places as a point until a second field gives the other axis.
 *
 * Same primitive as every view (`arrange.ts`): an anchor is a cluster with a
 * position, and its members' cluster and strength. `withAnchors` hands back
 * the arrangement with those added — same key, so nothing jumps; the forces
 * carry the nodes over.
 */
import type { Arrangement } from './arrange';
import type { View } from './collapse';
import type { Field } from './fields';

export type AnchorSpace = 'free' | 'time' | 'geo';

/** One placed set, as the forces read it. */
export interface Pull {
  space: AnchorSpace;
  /** Plane space. In `time`, only `y` is the anchor's own. */
  x: number;
  y: number;
  /** −1 … +1: how hard it pulls. */
  gain: number;
  /** Base nodes pulled firmly — the members. */
  direct: readonly number[];
  /** Base nodes pulled lightly — what links to them. */
  related: readonly number[];
  /** Placed along an axis by a field instead of at the point: each node's
   *  position on `axis` comes from its weight — `unit` maps 0…1 onto
   *  `lo…hi`, `signed` maps −1…1 (a versus, `a − b`). Nodes without a basis
   *  are not pulled. */
  along?: { field: Field; axis: 'x' | 'y'; range: 'unit' | 'signed'; lo: number; hi: number };
}

/** Value bands a field-placed lane is cut into — fine enough to read as a
 *  slope, few enough to stay a handful of clusters per column. */
const BANDS = 24;

/** How far along a field-placed pull a weight lies, 0…1. */
export function alongShare(along: NonNullable<Pull['along']>, w: number): number {
  const t = along.range === 'signed' ? (w + 1) / 2 : w;
  return Math.min(1, Math.max(0, t));
}

/** Every node some anchor pulls — drawn as itself, out of its group. */
export function anchored(pulls: readonly Pull[]): Set<number> {
  const out = new Set<number>();
  for (const p of pulls) { p.direct.forEach((i) => out.add(i)); p.related.forEach((i) => out.add(i)); }
  return out;
}

/** The cluster force an anchored view runs at, at least — a reader's anchor
 *  should visibly pull, whatever the view's own force. */
const ANCHOR_CLUSTER = 0.4;

/**
 * The arrangement with the anchors' pulls added, in base nodes; `view` maps
 * them onto what is drawn. An earlier anchor wins a node both would pull at
 * the same strength.
 */
export function withAnchors(arr: Arrangement, view: View, pulls: readonly Pull[]): Arrangement {
  if (!pulls.some((p) => p.direct.length || p.related.length)) return arr;
  const n = view.net.size;
  const clusters = arr.clusters.length === n ? arr.clusters.slice() : new Array<number | undefined>(n).fill(undefined);
  const strength = arr.strength.length === n ? Float32Array.from(arr.strength) : new Float32Array(n);
  const include = arr.include ? Uint8Array.from(arr.include) : undefined;

  // Raise the cluster force for the anchors; scale the view's own pulls down
  // by as much, so they pull exactly as hard as they did.
  const own = arr.forces.simulationCluster ?? 0.1;
  const force = Math.max(own, ANCHOR_CLUSTER);
  const keep = own / force;
  for (let u = 0; u < n; u++) strength[u] *= keep;

  let next = 0;
  for (const c of clusters) if (c !== undefined && c + 1 > next) next = c + 1;
  next = Math.max(next, Math.ceil(arr.clusterPositions.length / 2));
  const positions: (number | undefined)[] = Array.from({ length: 2 * next }, (_, k) => arr.clusterPositions[k]);
  const add = (x: number, y: number) => { positions.push(x, y); return next++; };

  const taken = new Float32Array(n);
  const lanes = new Map<string, number>();
  pulls.forEach((a, k) => {
    const g = 2 ** a.gain;
    // Along a field, only the timeline's lanes pull here (see the header).
    if (a.along && a.space !== 'time') return;
    const point = a.space === 'time' ? -1 : add(a.x, a.y);
    const pull = (i: number, s: number) => {
      const u = view.unitOf[i];
      if (s <= taken[u]) return;
      let c = point;
      if (a.along) {
        // A lane per value band in the node's own time column.
        const w = a.along.field[i];
        if (Number.isNaN(w)) return;
        const cell = arr.clusters[u];
        if (cell === undefined) return;
        const band = Math.round(alongShare(a.along, w) * BANDS);
        const key = `${k}:${cell}:${band}`;
        c = lanes.get(key) ?? -1;
        if (c < 0) {
          const at = a.along.lo + (band / BANDS) * (a.along.hi - a.along.lo);
          const cx = arr.clusterPositions[2 * cell] ?? a.x;
          const cy = arr.clusterPositions[2 * cell + 1] ?? a.y;
          c = a.along.axis === 'y' ? add(cx, at) : add(at, cy);
          lanes.set(key, c);
        }
      } else if (a.space === 'time') {
        // A lane: the node's own time column, at the anchor's height.
        const cell = arr.clusters[u];
        if (cell === undefined) return;
        const key = `${k}:${cell}`;
        c = lanes.get(key) ?? -1;
        if (c < 0) { c = add(arr.clusterPositions[2 * cell] ?? a.x, a.y); lanes.set(key, c); }
      }
      taken[u] = s;
      clusters[u] = c;
      strength[u] = s;
      if (include) include[u] = 1;
    };
    a.direct.forEach((i) => pull(i, Math.min(1, 0.85 * g)));
    a.related.forEach((i) => pull(i, Math.min(1, 0.35 * g)));
  });

  return {
    ...arr, clusters, clusterPositions: positions, strength, include,
    forces: { ...arr.forces, simulationCluster: force },
    heat: Math.max(arr.heat, 0.4),
  };
}

/** The anchors a view shows: deep time reads the groups' free space. */
export function spaceOf(core: 'groups' | 'time' | 'geo', deep: boolean): AnchorSpace {
  return core === 'geo' ? 'geo' : core === 'time' && !deep ? 'time' : 'free';
}
