/**
 * Layout anchors — one primitive for clustering, geography and time.
 *
 * `clusterByType` used to be a hardcoded circle-of-type-angles. Geography would
 * have been a second special case, time a third, embeddings a fourth. They are
 * all the same thing:
 *
 * > **An anchor resolves a node to a position and a strength.** Nodes with an
 * > anchor are pulled (or pinned) there; nodes without float free.
 *
 * Two shapes cover every case:
 *
 * - **coordinate** — an actual position. Geography (`mercator(lon, lat)`) and
 *   time (`x = timeScale(t0)`) are verifiable, so they can be *hard-pinned*:
 *     fixed in world space, never recomputed. The view then becomes a camera
 *     over a settled layout rather than a coordinate authority, which is what
 *     keeps pan/zoom from reheating the simulation.
 * - **affinity** — a weighted label set (`{climate: 3.2, energy: 1}`). Labels
 *   get positions on a circle; the node's target is the weighted centroid. Node
 *   type, any grouped field, multi-label topics and (later) vector
 *   neighbourhoods are all this one case.
 *
 * Composable by construction: geo on x/y plus time on z is 3D spatiotemporal
 * without a spatiotemporal feature existing anywhere in the code.
 *
 * The honest constraint, from `docs/plans/scenario-ready/graphmap.md`: in most
 * graphs most nodes don't anchor. A geo layout over 15%-geocoded data is a
 * mostly-empty map with a blob over the ocean. So anchors are a **lens** you
 * switch into when the axis is load-bearing — never a default.
 */
import type { GraphNode, NodePlace } from '../graphTypes';
import { POLE_OPPOSES, POLE_SERVES, readPole } from '../hud/convergence';

// ─── Serializable config ────────────────────────────────────────────────────

export type AnchorKind = 'type' | 'field' | 'geo' | 'time' | 'cluster';

/** A rung of the place ladder — where a coordinate claim came from. */
export type PlaceRung = 'row' | 'attribute' | 'doc' | 'asset' | 'canon';

/**
 * How much each rung is trusted.
 *
 * Coordinates are **ranked, never resolved**: several sources may claim a
 * node's position and keeping only the winner throws away the disagreement,
 * which is often the finding. A stated site ("the meeting was in Valletta")
 * hard-pins; a seat ("the company is registered there") pulls softly; a
 * document's own subject ("this filing is about Malta") barely pulls at all.
 *
 * These must never render alike. Presenting a filing address with the visual
 * authority of a whereabouts is how a layout starts asserting things nobody
 * said.
 */
export type RungWeights = Partial<Record<PlaceRung, number>>;

export const DEFAULT_RUNGS: RungWeights = {
  row: 1,
  attribute: 0.3,
  doc: 0.1,
  asset: 0,
  canon: 0.3,
};

/** Named ladders. Presets, not modes — each is just an ordering with weights,
 *  and the user can dial any rung by hand. */
export const RUNG_PRESETS: Record<string, { label: string; hint: string; rungs: RungWeights }> = {
  stated: {
    label: 'As stated',
    hint: 'Anchor on where things happened. Seats pull weakly; the document\'s own subject barely at all.',
    rungs: DEFAULT_RUNGS,
  },
  based: {
    label: 'As based',
    hint: 'Anchor on registered seats. Shows the paper geography rather than the active one.',
    rungs: { attribute: 1, row: 0.2, doc: 0.05, asset: 0, canon: 1 },
  },
  documented: {
    label: 'As documented',
    hint: 'Anchor on what each document is about. Coarse, and the weakest claim available.',
    rungs: { doc: 1, row: 0.3, attribute: 0.2, asset: 0.1, canon: 0.2 },
  },
  strict: {
    label: 'Stated only',
    hint: 'Only places something was said to happen. Everything else floats free.',
    rungs: { row: 1 },
  },
};

/** What gets stored on the panel's render config. Functions are derived from
 *  this at layout time, never persisted. */
export interface AnchorSpec {
  kind: AnchorKind;
  /** 0–1. Ignored for pinned coordinate anchors, which are absolute. */
  strength?: number;
  /** Coordinate anchors only: fix the node instead of pulling it. */
  pin?: boolean;
  /** `time` only: which axis time occupies. `z` gives geo x/y + time depth. */
  axis?: 'x' | 'y' | 'z';
  /** `geo` only: per-rung trust. Omitted = `DEFAULT_RUNGS`. */
  rungs?: RungWeights;
  /** `cluster` only: how much room one node occupies, so a cell can be sized
   *  from its contents rather than from an arbitrary fraction of the layout. */
  nodeRadius?: number;
}

/** Where a node actually sits, and why — the resolved rung, so the UI can say
 *  *which* claim it is drawing rather than just drawing it. */
export interface ResolvedPlace {
  place: NodePlace;
  weight: number;
}

/**
 * Pick the place a node anchors on, at a moment in time.
 *
 * Two filters, in order:
 *
 * 1. **The interval.** A seat held 2009–2015 is not where a company is in
 *    2018. With a cursor set, only entries covering it are eligible — which is
 *    what makes a company *drift across the map* as you scrub, instead of
 *    sitting at whichever address happened to be seen first.
 * 2. **The rung.** Among what is left, the most-trusted source wins.
 *
 * Entries with no coordinate are skipped rather than treated as the origin:
 * a place we could not geocode is unknown, not (0, 0).
 */
export function resolvePlace(
  node: GraphNode,
  rungs: RungWeights,
  cursor?: string | null,
): ResolvedPlace | null {
  const covers = (p: NodePlace) => {
    if (!cursor) return true;
    if (p.from && cursor < p.from) return false;
    // An open `to` means "still current" — an interval that has not ended
    // cannot be excluded by a later cursor.
    if (p.to && cursor > p.to) return false;
    return true;
  };

  let best: ResolvedPlace | null = null;
  for (const p of node.places ?? []) {
    if (p.lat == null || p.lon == null) continue;
    if (p.end === 'to') continue;          // the far end of a leg, not a seat
    if (!covers(p)) continue;
    const weight = rungs[p.source ?? 'row'] ?? 0;
    if (weight <= 0) continue;
    if (!best) { best = { place: p, weight }; continue; }
    if (weight > best.weight) { best = { place: p, weight }; continue; }
    // **Ties break on the later start, not on array order.** Two equally
    // trusted claims can both be true at once — a company holds a 2009 branch
    // and a 2011 head office simultaneously — so something has to choose, and
    // it must be stable and explainable. Annotation order is neither: it would
    // move the node when an unrelated document arrived. The most recently
    // established claim is the better answer to "where is this now".
    if (weight === best.weight && (p.from ?? '') > (best.place.from ?? '')) {
      best = { place: p, weight };
    }
  }
  if (best) return best;

  // Nothing in `places[]` qualified. Fall back to the scalar pair, which is
  // what a graph built before the ladder existed carries.
  if (node.lat != null && node.lon != null) {
    const weight = rungs.row ?? 1;
    return weight > 0
      ? { place: { place: node.place ?? '', lat: node.lat, lon: node.lon, source: 'row' }, weight }
      : null;
  }
  return null;
}

/**
 * A node's second-choice position, when a *different* rung disagrees.
 *
 * A company registered in Valletta whose every act happens in Zurich is a
 * lead, not a layout bug — so rather than resolve the conflict silently, the
 * renderer can ghost the runner-up and draw the gap. Returns null when the
 * rungs agree, which is the common case.
 */
export function placeDivergence(
  node: GraphNode,
  rungs: RungWeights,
  cursor?: string | null,
): { primary: NodePlace; ghost: NodePlace } | null {
  const primary = resolvePlace(node, rungs, cursor);
  if (!primary) return null;

  // A disagreement is a disagreement whether or not the rungs differ. The
  // Malta case is *within* one rung: a company registered in Valletta with its
  // head office in Zurich — both `attribute`, both current, 1,500 km apart, and
  // the gap is the whole point. Restricting this to cross-rung conflicts would
  // have found only the least interesting one.
  let ghost: NodePlace | null = null;
  let ghostScore = -Infinity;
  for (const p of node.places ?? []) {
    if (p.lat == null || p.lon == null || p.end === 'to') continue;
    if (p === primary.place) continue;
    const weight = rungs[p.source ?? 'row'] ?? 0;
    if (weight <= 0) continue;
    if (p.lat === primary.place.lat && p.lon === primary.place.lon) continue;
    if (cursor && p.from && cursor < p.from) continue;
    if (cursor && p.to && cursor > p.to) continue;
    // Rank by trust, then by distance: among equally-trusted alternatives the
    // furthest one is the finding, not the nearest.
    const km = haversineKm(primary.place, p) ?? 0;
    const score = weight * 1000 + Math.min(km, 999);
    if (score > ghostScore) { ghostScore = score; ghost = p; }
  }
  return ghost ? { primary: primary.place, ghost } : null;
}

/**
 * The two ends of a trajectory, when a node has both geocoded.
 *
 * Returned as `[[fromLat, fromLon], [toLat, toLon]]` so a renderer can draw
 * the arc. A movement is not *at* an airport; it spans two, and showing it as
 * a dot on the origin quietly asserts it stayed there.
 */
export function trajectoryEnds(
  node: GraphNode,
  cursor?: string | null,
): [[number, number], [number, number]] | null {
  let a: NodePlace | null = null, b: NodePlace | null = null;
  for (const p of node.places ?? []) {
    if (p.lat == null || p.lon == null) continue;
    if (cursor && p.from && cursor < p.from) continue;
    if (cursor && p.to && cursor > p.to) continue;
    if (p.end === 'from' && !a) a = p;
    if (p.end === 'to' && !b) b = p;
  }
  return a && b ? [[a.lat!, a.lon!], [b.lat!, b.lon!]] : null;
}

/** Midpoint of a trajectory, or null when the node is not one. */
function trajectoryMidpoint(
  node: GraphNode,
  cursor?: string | null,
): [number, number] | null {
  const ends = trajectoryEnds(node, cursor);
  if (!ends) return null;
  const [[aLat, aLon], [bLat, bLon]] = ends;
  return [(aLat + bLat) / 2, (aLon + bLon) / 2];
}

/** Great-circle distance in km — how far apart two claims about one node are.
 *  Sorting a node list by this gives an investigator a worklist. */
export function haversineKm(
  a: { lat?: number | null; lon?: number | null },
  b: { lat?: number | null; lon?: number | null },
): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const R = 6371.0088;
  const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1, dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const ANCHOR_LABEL: Record<AnchorKind, string> = {
  cluster: 'CLUSTER: binding',
  type: 'Entity type',
  field: 'Grouped field',
  geo: 'Geography',
  time: 'Time',
};

export const ANCHOR_HINT: Record<AnchorKind, string> = {
  cluster: 'Written in the bar — `CLUSTER:place`. Each group gets a labelled '
    + 'cell of its own, with the link forces still acting inside it.',
  type: 'Cluster nodes of the same type together.',
  field: 'Cluster by the panel\'s "group nodes by" field.',
  geo: 'Pin geocoded nodes to their real coordinates. Everything else settles around them.',
  time: 'Lay nodes out along a time axis using their earliest timestamp.',
};

// ─── Runtime resolution ─────────────────────────────────────────────────────

export interface ResolvedAnchor {
  /** Target in world space, or null when this node isn't anchored. */
  at: (n: GraphNode) => [number, number, number?] | null;
  strength: number;
  pin: boolean;
  axes: ReadonlyArray<'x' | 'y' | 'z'>;
}

/** How far apart affinity clusters and coordinate projections spread. Scaled
 *  from link distance so anchoring reads consistently at any graph size. */
const SPREAD = 6;

/**
 * The most an anchor may pull, whatever it asks for.
 *
 * A **clamp, not a default**. Callers pass their own strength — a cluster
 * slider is a user control that already reaches geo — and this only stops one
 * anchor from dominating the simulation outright. The distinction matters:
 * replacing a passed strength (which the geo branch used to do) makes every
 * other layout weight unimplementable, because one term is effectively ∞.
 */
export const ANCHOR_STRENGTH_CEILING = 1;

/** Geo's default pull. Coordinates are the one frame that is not our opinion,
 *  so it outranks everything aspatial — but it does NOT pin: see the geo
 *  branch of `resolveAnchors`. */
export const GEO_STRENGTH = 1;

/** Positions for a label set, evenly spaced on a circle.
 *
 * Sorted so a label keeps its position across re-renders — an unstable order
 * would make the layout jump every time the node set changed slightly. */
function labelPositions(labels: string[], radius: number): Map<string, [number, number]> {
  // A profile key carries a pole (`opacity▲` / `opacity▼`). The two are the two
  // ends of ONE axis, so they are placed **opposite each other** rather than
  // sorted into unrelated angles — spreading them alphabetically would put
  // "serving opacity" and "opposing opacity" wherever the alphabet happened to
  // land, and an actor pursuing one and an actor frustrating it would read as
  // neighbours. Positions are laid out per interest; the poles are ±180°.
  const bases = [...new Set(labels.map(l => readPole(l).label))].sort();
  const out = new Map<string, [number, number]>();
  const seen = new Set(labels);
  bases.forEach((base, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, bases.length);
    const put = (key: string, a: number) => {
      if (seen.has(key)) out.set(key, [Math.cos(a) * radius, Math.sin(a) * radius]);
    };
    put(base, angle);                              // no pole — the older form
    put(`${base}${POLE_SERVES}`, angle);
    put(`${base}${POLE_OPPOSES}`, angle + Math.PI);
  });
  return out;
}

/** A cluster cell: where the pile sits, and how much room it gets. */
export interface ClusterCell {
  label: string;
  /** Cell centre, in the same units as every other anchor. */
  at: [number, number];
  /** Half-extent. Members are pulled here and the local forces do the rest, so
   *  this is what the label and the boundary are drawn from. */
  r: number;
  count: number;
}

/**
 * Lay clusters out as a **grid of cells**, not points on a circle.
 *
 * This is the one layout decision the survey settled outright: the universal
 * first move on a dense graph is grouping by an attribute, and every tool that
 * does it well (Gephi's modularity → colour → ForceAtlas2, Cytoscape's
 * group-attribute layouts, Bloom's categories) separates the groups *spatially*
 * rather than only by colour. A colour-only clustering leaves the hairball a
 * hairball with more information in it.
 *
 * A circle of label positions — which is what `type`/`field` anchors use — puts
 * every group the same distance from every other and leaves the middle a
 * contested void that fills with whatever belongs to several groups at once.
 * A grid gives each group an interior, and an interior is what lets the *local*
 * forces read: inside a cell, link distance means adjacency again.
 *
 * Cells are ordered by size, largest first, so the biggest pile lands
 * top-left where reading starts, and sized by `sqrt(count)` so a group ten
 * times larger gets about three times the radius — area, not radius, tracks
 * membership, because area is what the eye compares.
 */
export function clusterCells(
  counts: Map<string, number>,
  radius: number,
  /** Collision radius — how much room one node actually occupies. **A cell has
   *  to be sized from its CONTENTS.** Sizing it as a fraction of an arbitrary
   *  layout radius produced cells narrower than the piles inside them: 33 nodes
   *  at a 60px collision radius need a disc of r ≈ √33 × 60 ≈ 345, and the cell
   *  was 194 — so collision blew every pile out through its own boundary and
   *  into its neighbours, which reads exactly like no clustering at all. */
  nodeRadius = 40,
): Map<string, ClusterCell> {
  const out = new Map<string, ClusterCell>();
  const entries = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  if (!entries.length) return out;

  // Room for `count` discs of `nodeRadius`, packed. √count is the honest
  // scaling — area tracks membership, which is also what the eye compares.
  const need = (count: number) => Math.max(nodeRadius, Math.sqrt(count) * nodeRadius);
  const radii = entries.map(([, c]) => need(c));
  const cols = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.ceil(entries.length / cols);

  // Pitch from the LARGEST cell plus a gutter, so no pile can reach its
  // neighbour's centre. Uniform rather than per-column because a ragged grid
  // puts small piles in the gaps between big ones, and proximity then means
  // "there was space here" instead of "these are alike".
  const pitch = Math.max(2 * Math.max(...radii) * 1.35, radius / 3);
  const w = pitch * cols, h = pitch * rows;

  entries.forEach(([label, count], i) => {
    const cx = (i % cols) + 0.5;
    const cy = Math.floor(i / cols) + 0.5;
    out.set(label, {
      label,
      at: [cx * pitch - w / 2, cy * pitch - h / 2],
      r: need(count),
      count,
    });
  });
  return out;
}

/** Weighted centroid of the labels a node belongs to. */
function centroid(
  weights: Record<string, number>,
  positions: Map<string, [number, number]>,
): [number, number] | null {
  let sx = 0, sy = 0, sw = 0;
  for (const [label, w] of Object.entries(weights)) {
    const p = positions.get(label);
    if (!p || !(w > 0)) continue;
    sx += p[0] * w; sy += p[1] * w; sw += w;
  }
  return sw > 0 ? [sx / sw, sy / sw] : null;
}

/**
 * Membership of a node in an affinity anchor's label space.
 *
 * Returns a weighted set, not a single label — which is the whole reason this
 * is a vector rather than a scalar. An entity in three topics belongs to all
 * three and settles between them; weighting by edge strength or a property
 * makes the strongest association pull hardest.
 */
function affinityOf(kind: 'type' | 'field', n: GraphNode): Record<string, number> {
  if (kind === 'type') {
    const t = (n.type || '').trim().toUpperCase();
    return t ? { [t]: 1 } : {};
  }
  const g = n.groupValue;
  if (Array.isArray(g)) {
    // Multi-label: every value counts, equally unless the backend weighted it.
    const out: Record<string, number> = {};
    for (const v of g) {
      const k = String(v ?? '').trim();
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }
  if (g && typeof g === 'object') {
    // Already a weighted map (presence × edge weight × property).
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
      const w = Number(v);
      if (k && Number.isFinite(w) && w > 0) out[k] = w;
    }
    return out;
  }
  const k = String(g ?? '').trim();
  return k ? { [k]: 1 } : {};
}

/** Spacing between co-located nodes, in world units. Roughly two node radii,
 *  so a cluster reads as distinct marks rather than a blob. */
const CO_LOCATION_STEP = 13;

/**
 * Fan out nodes that resolve to the *same* coordinate.
 *
 * Twelve occurrences in Zurich all pin to one point and stack into a single
 * dot: the count is invisible and eleven of them are unclickable. Hard-pinning
 * alone cannot fix this, because they genuinely are at the same place.
 *
 * The structure is "pin the cluster, lay out locally" — global position stays a
 * fixed skeleton, and members are distributed within their own anchor. A
 * phyllotaxis (sunflower) spiral packs them evenly with no nested simulation:
 * radius grows as √index so density stays constant, and the golden angle keeps
 * successive marks apart.
 *
 * **Deterministic**, keyed on a sorted id list. An unstable order — or real
 * jitter — would make the whole cluster jump every time the node set changed
 * slightly, which on a live run is every few seconds.
 */
function coLocationOffsets(
  nodes: ReadonlyArray<GraphNode>,
  resolved: ReadonlyMap<string, [number, number]>,
): Map<string, [number, number]> {
  const byCoord = new Map<string, string[]>();
  for (const n of nodes) {
    const at = resolved.get(n.id);
    if (!at) continue;
    // Key on the *resolved* position, not the raw lat/lon — two nodes anchored
    // to the same place by different rungs still stack.
    const key = `${at[0].toFixed(2)},${at[1].toFixed(2)}`;
    const list = byCoord.get(key);
    if (list) list.push(n.id);
    else byCoord.set(key, [n.id]);
  }

  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const out = new Map<string, [number, number]>();
  for (const ids of byCoord.values()) {
    if (ids.length < 2) continue;      // a lone node sits exactly on its point
    ids.sort();                         // stable across re-renders
    ids.forEach((id, i) => {
      const r = CO_LOCATION_STEP * Math.sqrt(i);
      const a = i * GOLDEN;
      out.set(id, [Math.cos(a) * r, Math.sin(a) * r]);
    });
  }
  return out;
}

/** World-space radius the geo anchor projects into.
 *
 *  **Exported so the map underlay uses the identical scale.** Outlines and
 *  nodes drifting apart by a scale factor would be worse than no map at all —
 *  a coastline that is subtly wrong is a lie told confidently. */
export function geoRadius(linkDistance: number): number {
  return linkDistance * SPREAD;
}

/** Web-Mercator, normalised to the layout's world scale.
 *
 * y is negated because screen space grows downward while latitude grows north.
 * Clamped near the poles, where the projection diverges. */
export function mercator(lat: number, lon: number, scale: number): [number, number] {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return [(lon / 180) * scale, -(y / Math.PI) * scale];
}

/** Lexicographic ISO comparison is chronological, so no Date parsing needed —
 *  and no risk of a dirty value throwing mid-layout. */
function isoToUnit(t: string, min: string, max: string): number {
  if (min === max) return 0.5;
  const a = Date.parse(t), lo = Date.parse(min), hi = Date.parse(max);
  if (!Number.isFinite(a) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, (a - lo) / (hi - lo)));
}

/**
 * Turn stored specs into runtime anchors for this node set.
 *
 * Label spaces and time extents are computed from the nodes actually present,
 * so a filtered graph anchors within its own range rather than against a
 * remembered one.
 */
export function resolveAnchors(
  specs: ReadonlyArray<AnchorSpec>,
  nodes: ReadonlyArray<GraphNode>,
  linkDistance: number,
  /** Scrubber position. Place entries are interval-scoped, so the same node
   *  anchors somewhere different at different moments — which is the whole
   *  point of a seat history. */
  cursor?: string | null,
): ResolvedAnchor[] {
  if (!specs.length || !nodes.length) return [];
  const radius = linkDistance * SPREAD;
  const out: ResolvedAnchor[] = [];

  for (const spec of specs) {
    const strength = spec.strength ?? 0.4;

    if (spec.kind === 'type' || spec.kind === 'field') {
      const labels: string[] = [];
      for (const n of nodes) labels.push(...Object.keys(affinityOf(spec.kind, n)));
      if (!labels.length) continue;
      const positions = labelPositions(labels, radius);
      out.push({
        at: (n) => centroid(affinityOf(spec.kind as 'type' | 'field', n), positions),
        strength,
        pin: false,
        axes: ['x', 'y'],
      });
      continue;
    }

    if (spec.kind === 'cluster') {
      // `node.cluster` is resolved server-side, because the KEY may name a
      // declaration the client cannot see — a role, a place rung, a section.
      // The geometry is decided here, because the geometry is layout.
      const counts = new Map<string, number>();
      for (const n of nodes) {
        if (n.cluster) counts.set(n.cluster, (counts.get(n.cluster) ?? 0) + 1);
      }
      if (!counts.size) continue;   // don't install a force nothing satisfies
      const cells = clusterCells(counts, radius, spec.nodeRadius);
      out.push({
        // A node with no value for the key returns null and stays where the
        // link forces put it. "Everything else" is not a group, and drawing it
        // as one puts a labelled box around the residue.
        at: (n) => (n.cluster ? cells.get(n.cluster)?.at ?? null : null),
        strength,
        pin: false,
        axes: ['x', 'y'],
      });
      continue;
    }

    if (spec.kind === 'geo') {
      const rungs = spec.rungs ?? DEFAULT_RUNGS;
      const resolved = new Map<string, [number, number]>();
      for (const n of nodes) {
        const leg = trajectoryMidpoint(n, cursor);
        if (leg) {
          // A movement is at neither endpoint; it spans them. The midpoint is
          // the only single position that represents the span, and the arc
          // itself is drawn from the two ends the node still carries.
          resolved.set(n.id, mercator(leg[0], leg[1], radius));
          continue;
        }
        const best = resolvePlace(n, rungs, cursor);
        if (best) resolved.set(n.id, mercator(best.place.lat!, best.place.lon!, radius));
      }
      if (resolved.size === 0) continue;   // don't install a force nothing satisfies
      const spread = coLocationOffsets(nodes, resolved);
      out.push({
        at: (n) => {
          const base = resolved.get(n.id);
          if (!base) return null;
          const off = spread.get(n.id);
          return off ? [base[0] + off[0], base[1] + off[1]] : base;
        },
        // **Authoritative is not the same as immovable.**
        //
        // Geography is verifiable, so it outranks everything aspatial and gets
        // the full default strength — coordinates are law and the chain
        // stretches, not the other way round. But this used to also set
        // `pin: true` and DISCARD the passed strength, which is infinite geo
        // strength by another name: a pinned node has fixed coordinates, so a
        // pinned step cannot bend, cannot lean toward the act before it, and
        // cannot belong to a chain at all. Every layout weight downstream was
        // then unimplementable at any number, because one term in the sum was
        // effectively ∞.
        //
        // So pinning is now what the spec asked for and nothing more, and the
        // ceiling is a CLAMP rather than a replacement — a caller that passes
        // a lower strength (a cluster slider that already reaches geo) gets
        // the number it passed.
        strength: Math.min(spec.strength ?? GEO_STRENGTH, ANCHOR_STRENGTH_CEILING),
        pin: spec.pin === true,
        axes: ['x', 'y'],
      });
      continue;
    }

    if (spec.kind === 'time') {
      let min: string | null = null, max: string | null = null;
      for (const n of nodes) {
        for (const v of [n.t0, n.t1]) {
          if (!v) continue;
          if (min === null || v < min) min = v;
          if (max === null || v > max) max = v;
        }
      }
      if (!min || !max) continue;
      const lo = min, hi = max;
      const axis = spec.axis ?? 'x';
      out.push({
        at: (n) => {
          if (!n.t0) return null;
          const u = isoToUnit(n.t0, lo, hi);
          const pos = (u - 0.5) * 2 * radius;
          // Only the chosen axis is constrained; the others stay free so force
          // still resolves structure within each time slice.
          return axis === 'z' ? [0, 0, pos] : axis === 'y' ? [0, pos] : [pos, 0];
        },
        strength: spec.pin ? 1 : strength,
        pin: !!spec.pin,
        axes: [axis],
      });
    }
  }
  return out;
}

/** Per-axis target + strength for one node, combining every active anchor.
 *
 * A pinned anchor wins outright — that is what "verifiable coordinate" means.
 * Otherwise strengths compose as a weighted average per axis, so geo-soft plus
 * type-cluster settles between them instead of one silently overriding.
 * Unanchored nodes get strength 0, which is how they stay free without needing
 * a separate code path.
 */
export function anchorTarget(
  anchors: ReadonlyArray<ResolvedAnchor>,
  node: GraphNode,
  axis: 'x' | 'y' | 'z',
): { value: number; strength: number; pinned: boolean } {
  let num = 0, den = 0;
  for (const a of anchors) {
    if (!a.axes.includes(axis)) continue;
    const at = a.at(node);
    if (!at) continue;
    const v = axis === 'x' ? at[0] : axis === 'y' ? at[1] : (at[2] ?? 0);
    if (v === undefined) continue;
    if (a.pin) return { value: v, strength: 1, pinned: true };
    num += v * a.strength;
    den += a.strength;
  }
  return den > 0
    ? { value: num / den, strength: Math.min(1, den), pinned: false }
    : { value: 0, strength: 0, pinned: false };
}

/**
 * What actually decides layout.
 *
 * **The query wins.** This is the seam FAULTS F1 named: `CLUSTER:` parsed, was
 * documented, was generated into the MCP description and the ✨ prompt, and
 * reached no renderer — because this function read only `config.anchors`,
 * written by the old axis-budget popover, and had never heard of the query
 * string. Writing `CLUSTER:place` and writing nothing produced identical
 * pictures.
 *
 * Precedence, and it is deliberate: a binding **written in the bar** outranks a
 * stored config, because the bar is the thing the analyst just typed and a
 * layout that ignores it in favour of a popover setting from last week is
 * indistinguishable from a bug. The stored config still applies when the query
 * says nothing, so a panel nobody has re-queried keeps laying out the same way.
 *
 * MVP S7 — *anything reachable by clicking is expressible as a query* — is what
 * makes that safe: the popover has no power the bar lacks.
 */
export function effectiveAnchors(config: {
  anchors?: AnchorSpec[];
  clusterByType?: boolean;
  clusterStrength?: number;
}, query?: string): AnchorSpec[] {
  const fromQuery: AnchorSpec[] = [];
  if (query && /\bCLUSTER:/i.test(query)) {
    // **Stronger than a link.** Link strength reaches 0.9 and its rest length
    // is a fraction of the cell pitch, so at 0.6 any edge crossing two cells
    // simply dragged both endpoints out of them — "whatever has an edge to
    // something takes precedence in being near it". The pull has to win, and
    // the cross-cluster link damping in `useForcesEffect` is the other half.
    fromQuery.push({ kind: 'cluster', strength: config.clusterStrength ?? 0.95 });
  }
  if (fromQuery.length) return fromQuery;
  if (config.anchors?.length) return config.anchors;
  if (config.clusterByType) {
    return [{ kind: 'type', strength: config.clusterStrength ?? 0.3 }];
  }
  return [];
}
