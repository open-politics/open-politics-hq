/**
 * Network — a run's graph as typed arrays, indexed by position.
 *
 * The wire (`backend graph/network.py`) ships columns: one list per channel,
 * small integers where a string repeats. This decodes them once into the shape
 * the GPU and every layer above it read — a node IS its index, so colours,
 * sizes, positions, clusters and selections are all parallel arrays and no
 * layer ever walks objects.
 *
 *   node i     id[i] · name[i] · type[i] → types · kind[i] · frequency[i] …
 *   link j     source[j] → target[j] · linkKind[j] · predicate[j] · weight[j]
 *   adjacency  CSR: the links touching node i, and the node at their far end
 *   provenance CSR: the annotations that produced node i, and their assets
 *   places     CSR: node i's geocoded place claims — coordinate, rung, interval
 *
 * Pure and framework-free, so it is tested on its own and any renderer —
 * cosmos today, deck.gl beside it — reads the same thing.
 */

export interface NetworkWire {
  nodes: {
    id: string[];
    name: string[];
    type: number[];
    kind: number[];
    frequency: number[];
    size: (number | null)[];
    t0: (string | null)[];
    t1: (string | null)[];
    ann: { offsets: number[]; ids: number[] };
    places: {
      offsets: number[];
      coord: number[];
      rung: number[];
      from: (string | null)[];
      to: (string | null)[];
      end: number[];
    };
  };
  edges: {
    source: number[];
    target: number[];
    kind: number[];
    predicate: number[];
    weight: number[];
  };
  vocab: {
    type: string[];
    edge_kind: string[];
    predicate: string[];
    node_kind: string[];
    rung: string[];
    /** `[lat, lon, name]` — the coordinates place claims index into. */
    coord: [number, number, string][];
  };
  /** Each annotation's asset, and that asset's own timestamp (epoch s). */
  assets: { annotation: number[]; asset: number[]; time: (number | null)[] };
  dropped_edges: number;
  meta: { ms: number; capped: boolean };
}

export type NodeKind = 'entity' | 'occurrence';
export type PlaceRung = 'row' | 'attribute' | 'doc' | 'asset' | 'canon';
const ENDS = [null, 'from', 'to'] as const;

export interface Network {
  /** Node count. */
  readonly size: number;
  /** Link count. */
  readonly links: number;

  readonly id: string[];
  readonly name: string[];
  readonly index: ReadonlyMap<string, number>;
  readonly type: Uint16Array;
  readonly types: string[];
  readonly kind: Uint8Array;
  readonly kinds: NodeKind[];
  readonly frequency: Float32Array;
  /** The engine's size channel, NaN where it decided none. */
  readonly sizeHint: Float32Array;
  /** How many nodes each node stands for: 1, or a collapsed group's size
   *  (`collapse.ts`). */
  readonly members: Uint32Array;
  readonly t0: (string | null)[];
  readonly t1: (string | null)[];

  readonly source: Uint32Array;
  readonly target: Uint32Array;
  readonly linkKind: Uint8Array;
  readonly linkKinds: string[];
  readonly predicate: Uint16Array;
  readonly predicates: string[];
  readonly weight: Float32Array;

  /** CSR adjacency: links of node i are `adjLinks[adjOffsets[i] .. adjOffsets[i+1])`,
   *  and `adjNodes` holds the node at each link's far end. */
  readonly adjOffsets: Uint32Array;
  readonly adjLinks: Uint32Array;
  readonly adjNodes: Uint32Array;

  /** CSR provenance: annotations of node i are `annIds[annOffsets[i] .. annOffsets[i+1])`. */
  readonly annOffsets: Uint32Array;
  readonly annIds: Int32Array;
  /** annotation id → asset id. */
  readonly assetOf: ReadonlyMap<number, number>;
  /** asset id → its own timestamp (ms), where it has one. */
  readonly assetTime: ReadonlyMap<number, number>;

  /** CSR places: claims of node i are `placeOffsets[i] .. placeOffsets[i+1]`;
   *  each indexes `coords` (`[lat, lon]` pairs) and `coordNames`. */
  readonly placeOffsets: Uint32Array;
  readonly placeCoord: Uint32Array;
  readonly placeRung: Uint8Array;
  readonly placeFrom: (string | null)[];
  readonly placeTo: (string | null)[];
  readonly placeEnd: Uint8Array;
  readonly rungs: PlaceRung[];
  readonly coords: Float32Array;
  readonly coordNames: string[];

  readonly droppedEdges: number;
  readonly capped: boolean;
  readonly buildMs: number;
}

const nan = (v: number | null | undefined) => (v == null ? NaN : v);

/** Everything a Network is given; the rest — size, id index, adjacency — is
 *  derived by `assemble`. */
export type NetworkParts = Omit<Network, 'size' | 'links' | 'index' | 'adjOffsets' | 'adjLinks' | 'adjNodes'>;

/** Parts → Network: the id index and the CSR adjacency, each link listed
 *  under both of its ends. Shared by the decoder and by derived views. */
export function assemble(parts: NetworkParts): Network {
  const n = parts.id.length;
  const m = parts.source.length;
  const { source, target } = parts;
  const index = new Map<string, number>();
  parts.id.forEach((id, i) => index.set(id, i));

  const adjOffsets = new Uint32Array(n + 1);
  for (let j = 0; j < m; j++) {
    adjOffsets[source[j] + 1]++;
    adjOffsets[target[j] + 1]++;
  }
  for (let i = 0; i < n; i++) adjOffsets[i + 1] += adjOffsets[i];
  const fill = adjOffsets.slice(0, n);
  const adjLinks = new Uint32Array(2 * m);
  const adjNodes = new Uint32Array(2 * m);
  for (let j = 0; j < m; j++) {
    const s = source[j], t = target[j];
    adjLinks[fill[s]] = j; adjNodes[fill[s]++] = t;
    adjLinks[fill[t]] = j; adjNodes[fill[t]++] = s;
  }
  return { ...parts, size: n, links: m, index, adjOffsets, adjLinks, adjNodes };
}

export function decodeNetwork(w: NetworkWire): Network {
  const n = w.nodes.id.length;

  const assetOf = new Map<number, number>();
  const assetTime = new Map<number, number>();
  w.assets.annotation.forEach((a, k) => {
    const asset = w.assets.asset[k];
    assetOf.set(a, asset);
    const t = w.assets.time[k];
    if (t != null) assetTime.set(asset, t * 1000);
  });
  const coords = new Float32Array(w.vocab.coord.length * 2);
  w.vocab.coord.forEach(([lat, lon], c) => { coords[2 * c] = lat; coords[2 * c + 1] = lon; });

  return assemble({
    id: w.nodes.id,
    name: w.nodes.name,
    type: Uint16Array.from(w.nodes.type),
    types: w.vocab.type,
    kind: Uint8Array.from(w.nodes.kind),
    kinds: w.vocab.node_kind as NodeKind[],
    frequency: Float32Array.from(w.nodes.frequency),
    sizeHint: Float32Array.from(w.nodes.size, nan),
    members: new Uint32Array(n).fill(1),
    t0: w.nodes.t0,
    t1: w.nodes.t1,
    source: Uint32Array.from(w.edges.source),
    target: Uint32Array.from(w.edges.target),
    linkKind: Uint8Array.from(w.edges.kind),
    linkKinds: w.vocab.edge_kind,
    predicate: Uint16Array.from(w.edges.predicate),
    predicates: w.vocab.predicate,
    weight: Float32Array.from(w.edges.weight),
    annOffsets: Uint32Array.from(w.nodes.ann.offsets),
    annIds: Int32Array.from(w.nodes.ann.ids),
    assetOf,
    assetTime,
    placeOffsets: Uint32Array.from(w.nodes.places.offsets),
    placeCoord: Uint32Array.from(w.nodes.places.coord),
    placeRung: Uint8Array.from(w.nodes.places.rung),
    placeFrom: w.nodes.places.from,
    placeTo: w.nodes.places.to,
    placeEnd: Uint8Array.from(w.nodes.places.end),
    rungs: w.vocab.rung as PlaceRung[],
    coords,
    coordNames: w.vocab.coord.map((c) => c[2]),
    droppedEdges: w.dropped_edges,
    capped: w.meta.capped,
    buildMs: w.meta.ms,
  });
}

// ─── Reading a network ───────────────────────────────────────────────────────

export function degree(net: Network, i: number): number {
  return net.adjOffsets[i + 1] - net.adjOffsets[i];
}

/** Distinct neighbours of node i. */
export function neighbours(net: Network, i: number): number[] {
  const out = new Set<number>();
  for (let k = net.adjOffsets[i]; k < net.adjOffsets[i + 1]; k++) out.add(net.adjNodes[k]);
  out.delete(i);
  return [...out];
}

/** Links touching any of the given nodes. */
export function linksOf(net: Network, nodes: Iterable<number>): number[] {
  const out = new Set<number>();
  for (const i of nodes) {
    for (let k = net.adjOffsets[i]; k < net.adjOffsets[i + 1]; k++) out.add(net.adjLinks[k]);
  }
  return [...out];
}

/** The annotations behind a set of nodes, deduplicated. */
export function annotationsOf(net: Network, nodes: Iterable<number>): number[] {
  const out = new Set<number>();
  for (const i of nodes) {
    for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) out.add(net.annIds[k]);
  }
  return [...out];
}

/** Node i's place claims, in the shape the place ladder reads
 *  (`forcegraph/anchors.pickPlace`). `coord` is the index into `net.coords`,
 *  so claims about the same spot can be grouped without comparing floats. */
export function placesOf(net: Network, i: number) {
  const out: Array<{
    place: string; lat: number; lon: number; coord: number;
    source: PlaceRung; from: string | null; to: string | null; end: 'from' | 'to' | null;
  }> = [];
  for (let k = net.placeOffsets[i]; k < net.placeOffsets[i + 1]; k++) {
    const c = net.placeCoord[k];
    out.push({
      place: net.coordNames[c], lat: net.coords[2 * c], lon: net.coords[2 * c + 1], coord: c,
      source: net.rungs[net.placeRung[k]], from: net.placeFrom[k], to: net.placeTo[k],
      end: ENDS[net.placeEnd[k]] ?? null,
    });
  }
  return out;
}

/** The earliest own timestamp among the assets behind node i, in ms — when
 *  the node was first *published*, as opposed to when it was said to happen. */
export function publishedAt(net: Network, i: number): number {
  let best = NaN;
  for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) {
    const asset = net.assetOf.get(net.annIds[k]);
    const t = asset == null ? undefined : net.assetTime.get(asset);
    if (t != null && !(t >= best)) best = t;
  }
  return best;
}

/** How many distinct assets each node's annotations come from. */
export function assetCount(net: Network, i: number): number {
  const seen = new Set<number>();
  for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) {
    const a = net.assetOf.get(net.annIds[k]);
    if (a != null) seen.add(a);
  }
  return seen.size;
}

/** Node count per type index, for legends. */
export function typeCounts(net: Network): Uint32Array {
  const out = new Uint32Array(net.types.length);
  for (let i = 0; i < net.size; i++) out[net.type[i]]++;
  return out;
}

/** Case-insensitive name search, entities before occurrences, then by
 *  frequency — what a search box offers first. */
export function findNodes(net: Network, term: string, limit = 8): number[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const hits: number[] = [];
  for (let i = 0; i < net.size; i++) {
    if (net.name[i].toLowerCase().includes(q)) hits.push(i);
  }
  const starts = (i: number) => (net.name[i].toLowerCase().startsWith(q) ? 0 : 1);
  hits.sort((a, b) =>
    starts(a) - starts(b) || net.kind[a] - net.kind[b] || net.frequency[b] - net.frequency[a]);
  return hits.slice(0, limit);
}
