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
    lat: (number | null)[];
    lon: (number | null)[];
    t0: (string | null)[];
    t1: (string | null)[];
    ann: { offsets: number[]; ids: number[] };
  };
  edges: {
    source: number[];
    target: number[];
    kind: number[];
    predicate: number[];
    weight: number[];
  };
  vocab: { type: string[]; edge_kind: string[]; predicate: string[]; node_kind: string[] };
  assets: { annotation: number[]; asset: number[] };
  dropped_edges: number;
  meta: { ms: number; capped: boolean };
}

export type NodeKind = 'entity' | 'occurrence';

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
  /** Coordinates, NaN where the node never geocoded. */
  readonly lat: Float32Array;
  readonly lon: Float32Array;
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

  readonly droppedEdges: number;
  readonly capped: boolean;
  readonly buildMs: number;
}

const nan = (v: number | null | undefined) => (v == null ? NaN : v);

export function decodeNetwork(w: NetworkWire): Network {
  const n = w.nodes.id.length;
  const m = w.edges.source.length;

  const index = new Map<string, number>();
  w.nodes.id.forEach((id, i) => index.set(id, i));

  const source = Uint32Array.from(w.edges.source);
  const target = Uint32Array.from(w.edges.target);

  // Adjacency: count degrees, prefix-sum, fill. Each link appears under both
  // of its ends.
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

  const assetOf = new Map<number, number>();
  w.assets.annotation.forEach((a, k) => assetOf.set(a, w.assets.asset[k]));

  return {
    size: n,
    links: m,
    id: w.nodes.id,
    name: w.nodes.name,
    index,
    type: Uint16Array.from(w.nodes.type),
    types: w.vocab.type,
    kind: Uint8Array.from(w.nodes.kind),
    kinds: w.vocab.node_kind as NodeKind[],
    frequency: Float32Array.from(w.nodes.frequency),
    sizeHint: Float32Array.from(w.nodes.size, nan),
    lat: Float32Array.from(w.nodes.lat, nan),
    lon: Float32Array.from(w.nodes.lon, nan),
    t0: w.nodes.t0,
    t1: w.nodes.t1,
    source,
    target,
    linkKind: Uint8Array.from(w.edges.kind),
    linkKinds: w.vocab.edge_kind,
    predicate: Uint16Array.from(w.edges.predicate),
    predicates: w.vocab.predicate,
    weight: Float32Array.from(w.edges.weight),
    adjOffsets,
    adjLinks,
    adjNodes,
    annOffsets: Uint32Array.from(w.nodes.ann.offsets),
    annIds: Int32Array.from(w.nodes.ann.ids),
    assetOf,
    droppedEdges: w.dropped_edges,
    capped: w.meta.capped,
    buildMs: w.meta.ms,
  };
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
