/**
 * Anchors — points a reader puts on the canvas, each with a few words, that
 * gather what the words are about.
 *
 * "Ukraine" dropped at the left, "energy prices" at the right: the entities
 * named that way, and what they link to, gravitate to their anchor, and the
 * space between the two fills with what connects them. Anchors are new groups
 * the reader makes, beside the ones the links make. They live in a view's
 * space and mean what that space means:
 *
 *   free   groups and deep time — a point; matches gather around it, and in
 *          deep time a stream gathers there through every slice
 *   time   the flat timeline — a lane: matches keep their column (their
 *          time) and move to the anchor's height, so a topic reads left to
 *          right across the period
 *   geo    the map — a point on the world: matches gather there, those with
 *          no place of their own too
 *
 * The words: `type:Person` keeps a type; the rest is matched in names,
 * ignoring case and accents. What matches is pulled firmly, its neighbours
 * more lightly — the related, not only the named. Filters compose: a hidden
 * type is never pulled, because it is not drawn.
 *
 * Same primitive as every view (`arrange.ts`): an anchor is a cluster with a
 * position, and its matches' cluster and strength. `withAnchors` hands back
 * the arrangement with those added — same key, so nothing jumps; the forces
 * carry the nodes over.
 */
import type { Arrangement } from './arrange';
import type { View } from './collapse';
import type { Network } from './network';

export type AnchorSpace = 'free' | 'time' | 'geo';

export interface Anchor {
  id: string;
  /** What it gathers — words, `type:Person`. */
  q: string;
  space: AnchorSpace;
  /** Plane space. In `time`, only `y` is the anchor's own. */
  x: number;
  y: number;
  /** −1 … +1: how hard it pulls, and how far. */
  gain?: number;
}

export interface AnchorMatch {
  /** Named by the words, most frequent first. */
  direct: number[];
  /** Linked to what is named. */
  related: number[];
}

const DIRECT_LIMIT = 400;
const RELATED_LIMIT = 1600;

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const folded = new WeakMap<Network, string[]>();
function namesOf(net: Network): string[] {
  let out = folded.get(net);
  if (!out) folded.set(net, (out = net.name.map(fold)));
  return out;
}

export function parseAnchor(q: string): { text: string; types: string[] } {
  const types: string[] = [];
  const text = q.replace(/\btype:(?:"([^"]+)"|(\S+))/gi, (_, quoted, bare) => {
    types.push(fold(quoted ?? bare));
    return ' ';
  });
  return { text: fold(text.replace(/\s+/g, ' ').trim()), types };
}

/** What an anchor's words gather in `net` (the network underneath), among
 *  the nodes `visible` keeps. */
export function anchorMatches(net: Network, q: string, visible?: (i: number) => boolean): AnchorMatch {
  const { text, types } = parseAnchor(q);
  if (!text && !types.length) return { direct: [], related: [] };
  const names = namesOf(net);
  const typeOk = types.length ? net.types.map((t) => types.includes(fold(t || 'unknown'))) : null;
  const direct: number[] = [];
  for (let i = 0; i < net.size; i++) {
    if (typeOk && !typeOk[net.type[i]]) continue;
    if (text && !names[i].includes(text)) continue;
    if (visible && !visible(i)) continue;
    direct.push(i);
  }
  direct.sort((a, b) => net.frequency[b] - net.frequency[a]);
  direct.length = Math.min(direct.length, DIRECT_LIMIT);
  const named = new Set(direct);
  const near = new Set<number>();
  for (const i of direct) {
    for (let k = net.adjOffsets[i]; k < net.adjOffsets[i + 1]; k++) {
      const j = net.adjNodes[k];
      if (!named.has(j) && (!visible || visible(j))) near.add(j);
    }
  }
  const related = [...near].sort((a, b) => net.frequency[b] - net.frequency[a]).slice(0, RELATED_LIMIT);
  return { direct, related };
}

/** Every node some anchor pulls — drawn as itself, out of its group. */
export function anchored(matches: readonly AnchorMatch[]): Set<number> {
  const out = new Set<number>();
  for (const m of matches) { m.direct.forEach((i) => out.add(i)); m.related.forEach((i) => out.add(i)); }
  return out;
}

/** The cluster force an anchored view runs at, at least — a reader's anchor
 *  should visibly pull, whatever the view's own force. */
const ANCHOR_CLUSTER = 0.4;

/**
 * The arrangement with the anchors' pulls added. `matches[k]` is anchor k's,
 * in base nodes; `view` maps them onto what is drawn. An earlier anchor wins
 * a node both would pull at the same strength.
 */
export function withAnchors(
  arr: Arrangement, view: View, anchors: readonly Anchor[], matches: readonly AnchorMatch[],
): Arrangement {
  if (!anchors.some((_, k) => matches[k] && (matches[k].direct.length || matches[k].related.length))) return arr;
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
  anchors.forEach((a, k) => {
    const m = matches[k];
    if (!m) return;
    const g = 2 ** (a.gain ?? 0);
    const point = a.space === 'time' ? -1 : add(a.x, a.y);
    const pull = (i: number, s: number) => {
      const u = view.unitOf[i];
      if (s <= taken[u]) return;
      let c = point;
      if (a.space === 'time') {
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
    m.direct.forEach((i) => pull(i, Math.min(1, 0.85 * g)));
    m.related.forEach((i) => pull(i, Math.min(1, 0.35 * g)));
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
