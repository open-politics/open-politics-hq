/**
 * Merge — the resolver's decisions, folded into the network.
 *
 * Every merge in effect (`graph/decisions.py`, status `merged`) says two
 * labels are one entity, which label it carries and what type it is. Applied
 * here, in the browser, as decisions arrive: rebuilding the run's graph for each
 * one would cost the better part of a minute, and folding two nodes into one is
 * a few array passes. A fresh load gets the same decisions alongside the graph
 * and folds them the same way.
 *
 * Union-find over the pairs, so chains compose — "US" ↔ "United States" and
 * "United States" ↔ "USA" leave one node. Each merged node keeps the id of the
 * node it is named after, so it stays where that node was on the plane, and
 * carries everything its members carried: mentions, documents, places, links.
 *
 * The result is a `View` (`collapse.ts`) — what grouping, layout and the drill
 * column already read — so nothing downstream knows merges exist.
 */
import { identity, type View } from './collapse';
import { assemble, type Network } from './network';

export interface MergeDecision {
  id: number;
  a: { name: string; type: string };
  b: { name: string; type: string };
  keep?: string | null;          // "a" | "b"
  type?: string | null;
}

/** A node's identity as the graph engine mints it: name and type, trimmed and
 *  lowercased (`stream._node_id`). */
export const nodeKey = (name: string, type: string) => `${name.trim().toLowerCase()}|${type.trim().toLowerCase()}`;

/** Every node of `net` by `nodeKey`. */
export function keyIndex(net: Network): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < net.size; i++) out.set(nodeKey(net.name[i], net.types[net.type[i]] ?? ''), i);
  return out;
}

export function merge(base: Network, decisions: readonly MergeDecision[]): View {
  if (!decisions.length) return identity(base);
  const n = base.size;
  const at = keyIndex(base);
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  // What each decision says about the group it touches, latest last.
  const named = new Map<number, number>();      // a member → the node the group is named after
  const typed = new Map<number, string>();      // a member → the group's type
  let any = false;
  for (const d of decisions) {
    const a = at.get(nodeKey(d.a.name, d.a.type));
    const b = at.get(nodeKey(d.b.name, d.b.type));
    if (a === undefined || b === undefined || a === b) continue;
    any = true;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
    named.set(a, d.keep === 'b' ? b : a);
    if (d.type) typed.set(a, d.type);
  }
  if (!any) return identity(base);

  // Groups, in base order; each named and typed by the latest decision about it.
  const unitOf = new Uint32Array(n);
  const members: number[][] = [];
  const unitByRoot = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let u = unitByRoot.get(r);
    if (u === undefined) { u = members.length; unitByRoot.set(r, u); members.push([]); }
    members[u].push(i);
    unitOf[i] = u;
  }
  const head = new Map<number, number>();
  const type = new Map<number, string>();
  named.forEach((h, member) => head.set(unitOf[member], h));
  typed.forEach((t, member) => type.set(unitOf[member], t));

  const types = [...base.types];
  const typeIndex = (t: string) => {
    let k = types.findIndex((x) => x.trim().toLowerCase() === t.trim().toLowerCase());
    if (k < 0) { k = types.length; types.push(t); }
    return k;
  };

  const U = members.length;
  const id: string[] = [], name: string[] = [];
  const typeOut = new Uint16Array(U), kind = new Uint8Array(U);
  const frequency = new Float32Array(U), sizeHint = new Float32Array(U), count = new Uint32Array(U);
  const t0: (string | null)[] = [], t1: (string | null)[] = [];
  const annOffsets = new Uint32Array(U + 1), annIds: number[] = [];
  const placeOffsets = new Uint32Array(U + 1);
  const placeCoord: number[] = [], placeRung: number[] = [], placeEnd: number[] = [];
  const placeFrom: (string | null)[] = [], placeTo: (string | null)[] = [];
  const memberOffsets = new Uint32Array(U + 1), memberIds: number[] = [];

  for (let u = 0; u < U; u++) {
    const list = members[u];
    const h = head.get(u) ?? list[0];
    memberIds.push(...list);
    memberOffsets[u + 1] = memberIds.length;
    id.push(base.id[h]);
    name.push(base.name[h]);
    const t = type.get(u);
    typeOut[u] = t ? typeIndex(t) : base.type[h];
    kind[u] = base.kind[h];
    sizeHint[u] = list.length === 1 ? base.sizeHint[h] : NaN;
    let freq = 0;
    let lo: string | null = null, hi: string | null = null;
    const anns = new Set<number>();
    for (const i of list) {
      freq += base.frequency[i];
      const a = base.t0[i], b = base.t1[i] ?? a;
      if (a && (lo == null || a < lo)) lo = a;
      if (b && (hi == null || b > hi)) hi = b;
      for (let k = base.annOffsets[i]; k < base.annOffsets[i + 1]; k++) anns.add(base.annIds[k]);
      for (let k = base.placeOffsets[i]; k < base.placeOffsets[i + 1]; k++) {
        placeCoord.push(base.placeCoord[k]); placeRung.push(base.placeRung[k]);
        placeFrom.push(base.placeFrom[k]); placeTo.push(base.placeTo[k]); placeEnd.push(base.placeEnd[k]);
      }
    }
    frequency[u] = freq;
    // One entity, however many labels it had: not a group.
    count[u] = 1;
    t0.push(list.length === 1 ? base.t0[h] : lo);
    t1.push(list.length === 1 ? base.t1[h] : hi);
    annIds.push(...anns);
    annOffsets[u + 1] = annIds.length;
    placeOffsets[u + 1] = placeCoord.length;
  }

  // Links: remapped onto the merged nodes; a link inside a merge is gone, and
  // two that now say the same thing between the same nodes are one.
  const source: number[] = [], target: number[] = [], linkKind: number[] = [];
  const predicate: number[] = [], weight: number[] = [];
  const seen = new Map<string, number>();
  for (let j = 0; j < base.links; j++) {
    const a = unitOf[base.source[j]], b = unitOf[base.target[j]];
    if (a === b) continue;
    const key = `${a}:${b}:${base.linkKind[j]}:${base.predicate[j]}`;
    const at2 = seen.get(key);
    if (at2 !== undefined) { weight[at2] += base.weight[j]; continue; }
    seen.set(key, source.length);
    source.push(a); target.push(b); linkKind.push(base.linkKind[j]);
    predicate.push(base.predicate[j]); weight.push(base.weight[j]);
  }

  const net = assemble({
    ...base,
    id, name, type: typeOut, types, kind, frequency, sizeHint, members: count, t0, t1,
    source: Uint32Array.from(source), target: Uint32Array.from(target),
    linkKind: Uint8Array.from(linkKind), predicate: Uint16Array.from(predicate),
    weight: Float32Array.from(weight),
    annOffsets, annIds: Int32Array.from(annIds),
    placeOffsets, placeCoord: Uint32Array.from(placeCoord), placeRung: Uint8Array.from(placeRung),
    placeFrom, placeTo, placeEnd: Uint8Array.from(placeEnd),
  });
  return {
    net, base, memberOffsets, memberIds: Uint32Array.from(memberIds),
    group: new Array(U).fill(null), heads: new Map(), unitOf,
  };
}
