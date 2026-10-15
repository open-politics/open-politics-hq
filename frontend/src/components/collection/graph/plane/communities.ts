/**
 * Communities — who belongs with whom, from the links alone.
 *
 * The plane's default arrangement when the run says nothing about time or
 * place, and until topics exist: groups of nodes more connected to each other
 * than to the rest. Louvain (Blondel et al. 2008): move each node to the
 * neighbouring community that most raises modularity until nothing moves, fold
 * every community into one node, repeat. Each fold is a level, so the result
 * is a **hierarchy** — and the hierarchy is what expanding a group walks down:
 * a top-level group opens into its sub-groups, those into nodes.
 *
 * Over typed arrays, deterministic (nodes visited in index order), no
 * dependency. Linear-ish per pass: run 433's 80k nodes / 75k links take a few
 * hundred milliseconds.
 *
 * A node with no links is its own community at every level — and the graph of
 * a news run has many (24k of 80k on run 433): mentioned, never related. They
 * are not groups and are never drawn as one.
 */
import type { Network } from './network';

export interface Communities {
  /** `levels[l][i]` — node i's community at level l. Level 0 is the finest;
   *  the last is the coarsest Louvain reached. Ids are dense from 0. */
  levels: Int32Array[];
  /** `sizes[l][c]` — how many nodes community c of level l holds. */
  sizes: Uint32Array[];
}

/** Louvain over `net`'s links, weighted by how often each was seen. */
export function louvain(net: Network, { resolution = 1, maxLevels = 6, maxPasses = 12 } = {}): Communities {
  const n = net.size;
  // Level-0 graph: CSR over undirected weighted links, self-loops dropped.
  let graph = csr(n, net.source, net.target, net.weight);
  // Weighted degree of each (super)node, carried explicitly: after a fold a
  // community's internal weight is its own, and it moves with it.
  let degree = new Float64Array(n);
  for (let j = 0; j < net.links; j++) {
    if (net.source[j] === net.target[j]) continue;
    degree[net.source[j]] += net.weight[j];
    degree[net.target[j]] += net.weight[j];
  }
  let total2m = 0;
  for (let i = 0; i < n; i++) total2m += degree[i];

  const levels: Int32Array[] = [];
  const sizes: Uint32Array[] = [];
  /** Original node → current super-node. */
  let owner = new Int32Array(n);
  for (let i = 0; i < n; i++) owner[i] = i;
  let count = n;

  for (let level = 0; level < maxLevels; level++) {
    const comm = moveNodes(graph, degree, total2m, resolution, maxPasses);
    const { dense, size: k } = renumber(comm);
    if (level > 0 && k === count) break;           // nothing merged: done

    const levelOf = new Int32Array(n);
    const levelSizes = new Uint32Array(k);
    for (let i = 0; i < n; i++) {
      const c = dense[owner[i]];
      levelOf[i] = c;
      levelSizes[c]++;
    }
    levels.push(levelOf);
    sizes.push(levelSizes);
    if (k === count || k === 1) break;

    // Fold: communities become nodes; links between them sum.
    const folded = fold(graph, dense, k);
    const foldedDegree = new Float64Array(k);
    for (let i = 0; i < count; i++) foldedDegree[dense[i]] += degree[i];
    graph = folded;
    degree = foldedDegree;
    owner = levelOf;
    count = k;
  }
  if (levels.length === 0) {
    const levelOf = new Int32Array(n);
    for (let i = 0; i < n; i++) levelOf[i] = i;
    levels.push(levelOf);
    sizes.push(new Uint32Array(n).fill(1));
  }
  return { levels, sizes };
}

interface Csr {
  n: number;
  offsets: Uint32Array;
  targets: Uint32Array;
  weights: Float64Array;
}

function csr(n: number, source: ArrayLike<number>, target: ArrayLike<number>, weight: ArrayLike<number>): Csr {
  const offsets = new Uint32Array(n + 1);
  const m = source.length;
  for (let j = 0; j < m; j++) {
    if (source[j] === target[j]) continue;
    offsets[source[j] + 1]++;
    offsets[target[j] + 1]++;
  }
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, n);
  const targets = new Uint32Array(offsets[n]);
  const weights = new Float64Array(offsets[n]);
  for (let j = 0; j < m; j++) {
    const s = source[j], t = target[j];
    if (s === t) continue;
    const w = weight[j] || 1;
    targets[fill[s]] = t; weights[fill[s]++] = w;
    targets[fill[t]] = s; weights[fill[t]++] = w;
  }
  return { n, offsets, targets, weights };
}

/** The local-moving phase: each node to the neighbouring community with the
 *  best modularity gain, passes until a pass moves nothing. */
function moveNodes(g: Csr, degree: Float64Array, m2: number, gamma: number, maxPasses: number): Int32Array {
  const { n, offsets, targets, weights } = g;
  const comm = new Int32Array(n);
  const tot = new Float64Array(n);
  for (let i = 0; i < n; i++) { comm[i] = i; tot[i] = degree[i]; }
  if (m2 === 0) return comm;

  const toComm = new Float64Array(n);       // weight from the node to each community
  const touched = new Int32Array(n);
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (offsets[i] === offsets[i + 1]) continue;
      const own = comm[i];
      const ki = degree[i];
      let t = 0;
      for (let e = offsets[i]; e < offsets[i + 1]; e++) {
        const c = comm[targets[e]];
        if (toComm[c] === 0) touched[t++] = c;
        toComm[c] += weights[e];
      }
      tot[own] -= ki;                        // take i out of its community
      let best = own;
      let bestGain = toComm[own] - (gamma * tot[own] * ki) / m2;
      for (let x = 0; x < t; x++) {
        const c = touched[x];
        const gain = toComm[c] - (gamma * tot[c] * ki) / m2;
        if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
      }
      tot[best] += ki;
      if (best !== own) { comm[i] = best; moved++; }
      for (let x = 0; x < t; x++) toComm[touched[x]] = 0;
      toComm[own] = 0;
    }
    if (moved === 0) break;
  }
  return comm;
}

function renumber(comm: Int32Array): { dense: Int32Array; size: number } {
  const map = new Int32Array(comm.length).fill(-1);
  const dense = new Int32Array(comm.length);
  let k = 0;
  for (let i = 0; i < comm.length; i++) {
    const c = comm[i];
    if (map[c] < 0) map[c] = k++;
    dense[i] = map[c];
  }
  return { dense, size: k };
}

function fold(g: Csr, dense: Int32Array, k: number): Csr {
  // Sum weights per (community, community) pair; internal weight is dropped
  // from the adjacency — it lives in the carried degree.
  const pairs = new Map<number, number>();
  for (let i = 0; i < g.n; i++) {
    const a = dense[i];
    for (let e = g.offsets[i]; e < g.offsets[i + 1]; e++) {
      const b = dense[g.targets[e]];
      if (a >= b) continue;                 // each undirected pair once
      const key = a * k + b;
      pairs.set(key, (pairs.get(key) ?? 0) + g.weights[e]);
    }
  }
  const src: number[] = [], tgt: number[] = [], w: number[] = [];
  pairs.forEach((weight, key) => {
    src.push(Math.floor(key / k));
    tgt.push(key % k);
    w.push(weight);
  });
  return csr(k, src, tgt, w);
}

// ─── Reading the hierarchy ──────────────────────────────────────────────────

export interface Group {
  /** Stable within one Communities: `"<level>:<community>"`. */
  key: string;
  level: number;
  community: number;
  size: number;
  /** Member node indices, most frequent first. */
  members: number[];
  /** The group's most frequent entities — what it is *about*, in its own
   *  vocabulary. Basic tags, until topics give it a name. */
  label: string;
  tags: number[];
}

export const groupKey = (level: number, community: number) => `${level}:${community}`;

/**
 * The key of the group node i belongs to at `level`, named by the *lowest*
 * level with exactly the same members. Louvain often carries a community
 * unchanged through several folds; one membership is one group, so it has one
 * key — the one `collapse` uses and `expanded` sets store.
 */
export function canonicalKey(c: Communities, level: number, i: number): string {
  let l = level;
  const size = c.sizes[level][c.levels[level][i]];
  while (l > 0 && c.sizes[l - 1][c.levels[l - 1][i]] === size) l--;
  return groupKey(l, c.levels[l][i]);
}

/**
 * Node i's groups, outermost first, as canonical keys — each at least
 * `minGroup` strong and each strictly smaller than the one before. The path
 * expanding walks down.
 */
export function groupPath(c: Communities, i: number, minGroup: number): string[] {
  const out: string[] = [];
  let last = Infinity;
  for (let l = c.levels.length - 1; l >= 0; l--) {
    const size = c.sizes[l][c.levels[l][i]];
    if (size < minGroup) break;
    if (size === last) continue;
    last = size;
    out.push(canonicalKey(c, l, i));
  }
  return out;
}

/** Each node's top-level group as a rank by size (0 = largest), or -1 for a
 *  node in no group — what colouring by group reads. */
export function topRanks(net: Network, c: Communities, minGroup: number): Int32Array {
  const top = c.levels.length - 1;
  const of = c.levels[top];
  const size = c.sizes[top];
  const order = [...size.keys()].filter((g) => size[g] >= minGroup).sort((a, b) => size[b] - size[a]);
  const rank = new Int32Array(size.length).fill(-1);
  order.forEach((g, r) => { rank[g] = r; });
  const out = new Int32Array(net.size);
  for (let i = 0; i < net.size; i++) out[i] = rank[of[i]];
  return out;
}

/** The groups at one level, at least `minSize` strong, largest first. */
export function groupsAt(net: Network, c: Communities, level: number, minSize = 3, tagCount = 3): Group[] {
  const of = c.levels[level];
  const size = c.sizes[level];
  const members = new Map<number, number[]>();
  for (let i = 0; i < net.size; i++) {
    if (size[of[i]] < minSize) continue;
    let list = members.get(of[i]);
    if (!list) members.set(of[i], (list = []));
    list.push(i);
  }
  const out: Group[] = [];
  members.forEach((list, community) => {
    list.sort((a, b) => net.frequency[b] - net.frequency[a]);
    const tags = tagsOf(net, list, tagCount);
    out.push({
      key: canonicalKey(c, level, list[0]), level, community, size: list.length, members: list,
      tags, label: tags.map((i) => net.name[i]).join(' · ') || `${list.length} nodes`,
    });
  });
  return out.sort((a, b) => b.size - a.size);
}

/** The coarsest level, where a group is a top-level group. */
export const topLevel = (c: Communities) => c.levels.length - 1;

/** A group's tags: its most frequent entities, one per name — the same name
 *  under two types is one tag. `members` must be sorted most frequent first. */
export function tagsOf(net: Network, members: number[], count: number): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const i of members) {
    if (net.kind[i] !== 0) continue;
    const key = net.name[i].trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
    if (out.length === count) break;
  }
  return out;
}
