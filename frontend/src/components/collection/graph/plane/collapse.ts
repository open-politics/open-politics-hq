/**
 * Collapse — the network as groups, opened one at a time.
 *
 * A run's whole graph at once is a field of dots. Collapsed, each community
 * (`communities.ts`) is one node — named by its most frequent entities, sized
 * by how many it holds — and the links between communities are one link each,
 * weighted by how many they stand for. Expanding a group replaces it with what
 * it contains one level down: sub-groups, then nodes.
 *
 * The result is a plain `Network`, so every channel, layer and the plane
 * itself read it unchanged; `View` adds the way back to the nodes underneath.
 *
 * **Ids outlive the partition.** A live run re-clusters on every refresh and
 * Louvain's community numbers mean nothing from one run of it to the next. So
 * a group's id is its *head* — its most frequent member: `group:<head id>`.
 * The same group found again keeps its id, and its place on screen; a group
 * and the sub-group holding its head share one, so opening a group leaves that
 * part of it where it was. What is expanded is remembered the same way
 * (`Expansion`: head + depth on the head's path), not by community number.
 */
import { groupPath, tagsOf, type Communities } from './communities';
import { assemble, type Network } from './network';

export interface View {
  /** What the plane draws. */
  net: Network;
  /** The network underneath. */
  base: Network;
  /** View node → the base nodes it stands for (CSR). */
  memberOffsets: Uint32Array;
  memberIds: Uint32Array;
  /** View node → its group key (`communities.canonicalKey`), or null for a
   *  plain node. */
  group: (string | null)[];
  /** Every group key on any node's path → its head's node id. */
  heads: ReadonlyMap<string, string>;
  /** Base node → the view node that shows it. */
  unitOf: Uint32Array;
}

/** A group's view id, from its head's node id. */
export const groupId = (headId: string) => `group:${headId}`;

/** What is expanded, in terms that survive re-clustering: the group whose
 *  head is `head`, `depth` groups down that head's path. */
export interface Expansion {
  head: string;
  depth: number;
}

/** Expansions → the current partition's group keys. One whose head left the
 *  network, or whose path is now shorter, simply opens nothing. */
export function expandedKeys(base: Network, c: Communities, list: readonly Expansion[], minGroup = 3): Set<string> {
  const out = new Set<string>();
  for (const { head, depth } of list) {
    const i = base.index.get(head);
    if (i === undefined) continue;
    const key = groupPath(c, i, minGroup)[depth];
    if (key) out.add(key);
  }
  return out;
}

/** The expansion that opens group `key`, from a member on its path. */
export function expansionOf(view: View, c: Communities, key: string, minGroup = 3): Expansion | null {
  const head = view.heads.get(key);
  const i = head === undefined ? undefined : view.base.index.get(head);
  if (i === undefined) return null;
  const depth = groupPath(c, i, minGroup).indexOf(key);
  return depth < 0 ? null : { head: head!, depth };
}

/** Every group key on any node's path → its head's node id: the most frequent
 *  member, ties to the lower index. One pass over the network. */
export function headsOf(base: Network, c: Communities, minGroup = 3): Map<string, string> {
  const best = new Map<string, number>();
  for (let i = 0; i < base.size; i++) {
    for (const key of groupPath(c, i, minGroup)) {
      const b = best.get(key);
      if (b === undefined || base.frequency[i] > base.frequency[b] || (base.frequency[i] === base.frequency[b] && i < b)) {
        best.set(key, i);
      }
    }
  }
  const out = new Map<string, string>();
  best.forEach((i, key) => out.set(key, base.id[i]));
  return out;
}

/** The base network as itself — no groups. */
export function identity(base: Network): View {
  const n = base.size;
  const ids = new Uint32Array(n);
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) { ids[i] = i; offsets[i + 1] = i + 1; }
  return {
    net: base, base, memberOffsets: offsets, memberIds: ids, group: new Array(n).fill(null),
    heads: new Map(), unitOf: ids,
  };
}

/** The unit a base node shows as: the outermost group on its path that is not
 *  expanded, or itself when every group above it is. */
function unitKey(c: Communities, i: number, expanded: ReadonlySet<string>, minGroup: number): string | null {
  for (const key of groupPath(c, i, minGroup)) if (!expanded.has(key)) return key;
  return null;
}

export function collapse(
  base: Network,
  c: Communities,
  expanded: ReadonlySet<string>,
  { minGroup = 3, tagCount = 3, heads: given }: { minGroup?: number; tagCount?: number; heads?: Map<string, string> } = {},
): View {
  const n = base.size;
  const unitOf = new Uint32Array(n);
  const keyOf: (string | null)[] = [];
  const members: number[][] = [];
  const byKey = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = unitKey(c, i, expanded, minGroup);
    let u = key == null ? undefined : byKey.get(key);
    if (u === undefined) {
      u = members.length;
      members.push([]);
      keyOf.push(key);
      if (key != null) byKey.set(key, u);
    }
    members[u].push(i);
    unitOf[i] = u;
  }
  if (byKey.size === 0) return identity(base);
  const heads = given ?? headsOf(base, c, minGroup);

  const U = members.length;
  const id: string[] = [], name: string[] = [];
  const type = new Uint16Array(U), kind = new Uint8Array(U);
  const frequency = new Float32Array(U), sizeHint = new Float32Array(U), count = new Uint32Array(U);
  const t0: (string | null)[] = [], t1: (string | null)[] = [];
  const annOffsets = new Uint32Array(U + 1), annIds: number[] = [];
  const placeOffsets = new Uint32Array(U + 1);
  const placeCoord: number[] = [], placeRung: number[] = [], placeEnd: number[] = [];
  const placeFrom: (string | null)[] = [], placeTo: (string | null)[] = [];
  const memberOffsets = new Uint32Array(U + 1), memberIds: number[] = [];

  for (let u = 0; u < U; u++) {
    const list = members[u];
    memberIds.push(...list);
    memberOffsets[u + 1] = memberIds.length;
    const key = keyOf[u];
    if (key == null) {
      // A plain node: itself, places and all.
      const i = list[0];
      id.push(base.id[i]); name.push(base.name[i]);
      type[u] = base.type[i]; kind[u] = base.kind[i];
      frequency[u] = base.frequency[i]; sizeHint[u] = base.sizeHint[i]; count[u] = 1;
      t0.push(base.t0[i]); t1.push(base.t1[i]);
      for (let k = base.annOffsets[i]; k < base.annOffsets[i + 1]; k++) annIds.push(base.annIds[k]);
      for (let k = base.placeOffsets[i]; k < base.placeOffsets[i + 1]; k++) {
        placeCoord.push(base.placeCoord[k]); placeRung.push(base.placeRung[k]);
        placeFrom.push(base.placeFrom[k]); placeTo.push(base.placeTo[k]); placeEnd.push(base.placeEnd[k]);
      }
    } else {
      // A group: named by its most frequent entities, the type most of them
      // share, the span of their times, the union of their documents.
      const sorted = [...list].sort((a, b) => base.frequency[b] - base.frequency[a]);
      const tags = tagsOf(base, sorted, tagCount);
      id.push(groupId(heads.get(key)!));
      name.push(tags.map((i) => base.name[i]).join(' · ') || `${list.length} nodes`);
      const votes = new Map<number, number>();
      let freq = 0;
      let lo: string | null = null, hi: string | null = null;
      const anns = new Set<number>();
      for (const i of list) {
        if (base.kind[i] === 0) votes.set(base.type[i], (votes.get(base.type[i]) ?? 0) + 1);
        freq += base.frequency[i];
        const a = base.t0[i], b = base.t1[i] ?? a;
        if (a && (lo == null || a < lo)) lo = a;
        if (b && (hi == null || b > hi)) hi = b;
        for (let k = base.annOffsets[i]; k < base.annOffsets[i + 1]; k++) anns.add(base.annIds[k]);
      }
      let best = base.type[sorted[0]], bestVotes = -1;
      votes.forEach((v, t) => { if (v > bestVotes) { bestVotes = v; best = t; } });
      type[u] = best; kind[u] = 0;
      frequency[u] = freq; sizeHint[u] = NaN; count[u] = list.length;
      t0.push(lo); t1.push(hi);
      annIds.push(...anns);
    }
    annOffsets[u + 1] = annIds.length;
    placeOffsets[u + 1] = placeCoord.length;
  }

  // Links: between plain nodes, kept as they are — kind, predicate and all.
  // Touching a group, folded into one link per pair of view nodes, weighted
  // by how many it stands for, and a relation if any of them was one.
  const source: number[] = [], target: number[] = [], linkKind: number[] = [];
  const predicate: number[] = [], weight: number[] = [];
  const folded = new Map<number, number>();
  const relation = base.linkKinds.indexOf('relation');
  for (let j = 0; j < base.links; j++) {
    const a = unitOf[base.source[j]], b = unitOf[base.target[j]];
    if (a === b) continue;
    if (keyOf[a] == null && keyOf[b] == null) {
      source.push(a); target.push(b); linkKind.push(base.linkKind[j]);
      predicate.push(base.predicate[j]); weight.push(base.weight[j]);
      continue;
    }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const pair = lo * U + hi;
    const at = folded.get(pair);
    if (at === undefined) {
      folded.set(pair, source.length);
      source.push(lo); target.push(hi); linkKind.push(base.linkKind[j]);
      predicate.push(base.predicate[j]); weight.push(base.weight[j]);
    } else {
      weight[at] += base.weight[j];
      if (base.linkKind[j] === relation) { linkKind[at] = relation; predicate[at] = base.predicate[j]; }
    }
  }

  const net = assemble({
    ...base,
    id, name, type, kind, frequency, sizeHint, members: count, t0, t1,
    source: Uint32Array.from(source), target: Uint32Array.from(target),
    linkKind: Uint8Array.from(linkKind), predicate: Uint16Array.from(predicate),
    weight: Float32Array.from(weight),
    annOffsets, annIds: Int32Array.from(annIds),
    placeOffsets, placeCoord: Uint32Array.from(placeCoord), placeRung: Uint8Array.from(placeRung),
    placeFrom, placeTo, placeEnd: Uint8Array.from(placeEnd),
  });
  return {
    net, base, memberOffsets, memberIds: Uint32Array.from(memberIds), group: keyOf, heads, unitOf,
  };
}

/** The base nodes view node u stands for. */
export function membersOf(view: View, u: number): number[] {
  return Array.from(view.memberIds.subarray(view.memberOffsets[u], view.memberOffsets[u + 1]));
}

/**
 * Where a view node that is new to the plane should start, as tiers of ids
 * whose last positions it may take — the first tier with any known position
 * wins, at the centroid of those it knows (read by `seedPositions` through the
 * plane's `inherit`).
 *
 * A group collapsed from its members starts at their centroid; a group or node
 * revealed — by expanding, or by leaving the groups view altogether — starts
 * where its innermost enclosing group was. `heads` (`headsOf`) names every
 * group, drawn or not, so this works for any view, collapsed or whole.
 */
export function inheritFrom(view: View, c: Communities, heads: ReadonlyMap<string, string>, minGroup = 3) {
  return (u: number): string[][] => {
    const key = view.group[u];
    const list = membersOf(view, u);
    const path = groupPath(c, list[0], minGroup);         // outermost first
    const enclosing = key == null ? path : path.slice(0, path.indexOf(key));
    const tiers = enclosing.reverse().flatMap((k) => {
      const head = heads.get(k);
      return head ? [[groupId(head)]] : [];
    });
    return key == null ? tiers : [list.map((i) => view.base.id[i]), ...tiers];
  };
}
