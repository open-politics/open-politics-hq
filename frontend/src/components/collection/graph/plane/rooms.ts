/**
 * Rooms — a set placed with an extent: a box drawn over whatever shows the
 * network, to see what is in it.
 *
 * A room reads or holds, never both:
 *
 *   reads   the set has a `region` term (`⬚ inside`): its members are what
 *           is drawn inside the box, and follow the layout as nodes flow in
 *           and out. With other terms it narrows — *type = Person × inside*
 *           is the people in the room. It never pulls: it would gather its
 *           own reading.
 *   holds   the members come from its other terms, and the room gathers them
 *           at its centre, as an anchor does.
 *
 * Pin is the term rewrite between the two: `holdRoom` swaps the region for
 * `≈ like` the members it read — a snapshot of nodes, so a new model reads
 * it again — and `readRoom` swaps it back.
 *
 * What a room is about is read from its documents: those mostly about what
 * is inside (`roomDocuments`), as a meaning apart from the rest of the run,
 * in words by the backend (`network.describe`).
 */
import type { Place } from './anchoring';
import type { View } from './collapse';
import type { Network } from './network';
import { reachRange, type NodeSet, type Term } from './sets';

export type Room = [number, number, number, number];

export const isRoom = (p: Place | undefined): p is Room => p?.length === 4;

/** The room's corners, lowest first. */
export function corners([x, y, w, h]: Room): [number, number, number, number] {
  return [x - Math.abs(w) / 2, y - Math.abs(h) / 2, x + Math.abs(w) / 2, y + Math.abs(h) / 2];
}

/** A room spanning two corners, in any order. */
export const roomBetween = (a: readonly [number, number], b: readonly [number, number]): Room =>
  [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];

const region = (t: Term) => t.kind === 'region';
const snapshot = (t: Term) => t.kind === 'about' && !!t.like?.length;

/** The set reads what is inside its room. */
export const readsInside = (set: Pick<NodeSet, 'terms'>) => set.terms.some(region);
/** The set holds a snapshot it read. */
export const holdsSnapshot = (set: Pick<NodeSet, 'terms'>) => set.terms.some(snapshot);

/**
 * What is drawn inside a room, over the network underneath: every base node
 * a drawn unit inside stands for — a folded group whole. `positions` are the
 * drawn units', x y interleaved; `shown`, when given, the units drawn now
 * (types switched off, deep time's present) — the rest are not in the room.
 */
export function insideOf(view: View, positions: ArrayLike<number>, room: Room, shown?: Uint8Array | null): Uint8Array {
  const [x0, y0, x1, y1] = corners(room);
  const out = new Uint8Array(view.base.size);
  const units = Math.min(view.net.size, positions.length / 2);
  for (let u = 0; u < units; u++) {
    if (shown && !shown[u]) continue;
    const x = positions[2 * u], y = positions[2 * u + 1];
    if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
    for (let k = view.memberOffsets[u]; k < view.memberOffsets[u + 1]; k++) out[view.memberIds[k]] = 1;
  }
  return out;
}

/** How many nodes each document produced — kept per network. */
const produced = new WeakMap<Network, Map<number, number>>();
function nodesPerDocument(net: Network): Map<number, number> {
  let out = produced.get(net);
  if (out) return out;
  out = new Map();
  const seen = new Set<number>();
  for (let i = 0; i < net.size; i++) {
    seen.clear();
    for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) {
      const d = net.assetOf.get(net.annIds[k]);
      if (d === undefined || seen.has(d)) continue;
      seen.add(d);
      out.set(d, (out.get(d) ?? 0) + 1);
    }
  }
  produced.set(net, out);
  return out;
}

/** A document is a room's when at least this share of what it produced is
 *  inside. */
const MOSTLY = 0.5;
/** With none past it: the documents most inside, this many. */
const FALLBACK = 20;
/** The most a room reads as one meaning. */
export const ROOM_DOCUMENTS = 20_000;

/**
 * The documents a group of nodes is about: those most of whose nodes are
 * among them, most inside first — with none past half, the few most inside.
 * Every document behind every node would let a hub's thousands of documents
 * read as the room.
 */
export function roomDocuments(net: Network, mask: Uint8Array): number[] {
  const total = nodesPerDocument(net);
  const inside = new Map<number, number>();
  const seen = new Set<number>();
  for (let i = 0; i < net.size; i++) {
    if (!mask[i]) continue;
    seen.clear();
    for (let k = net.annOffsets[i]; k < net.annOffsets[i + 1]; k++) {
      const d = net.assetOf.get(net.annIds[k]);
      if (d === undefined || seen.has(d)) continue;
      seen.add(d);
      inside.set(d, (inside.get(d) ?? 0) + 1);
    }
  }
  const share = [...inside].map(([d, n]) => [d, n / (total.get(d) ?? n)] as const)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const mostly = share.filter(([, s]) => s >= MOSTLY);
  return (mostly.length ? mostly : share.slice(0, FALLBACK)).slice(0, ROOM_DOCUMENTS).map(([d]) => d);
}

/** The nodes a snapshot keeps, most frequent first. */
export const SNAPSHOT = 2000;

/**
 * Hold what the room reads: the region becomes `≈ like` its members (node
 * ids, most frequent first), reaching about as many as were inside — `share`
 * of the network. The room then gathers them.
 */
export function holdRoom(set: NodeSet, members: readonly string[], share: number): NodeSet {
  if (!members.length) return set;
  const like: Term = {
    kind: 'about', op: '=', values: [], like: members.slice(0, SNAPSHOT),
    range: reachRange(Math.min(0.5, Math.max(0.01, share))),
  };
  return { ...set, terms: [...set.terms.filter((t) => !region(t)), like] };
}

/** Read what is inside again: a snapshot becomes the region it was taken
 *  from — and a room that only held starts to read. */
export function readRoom(set: NodeSet): NodeSet {
  const terms = set.terms.flatMap((t): Term[] => {
    if (!snapshot(t)) return [t];
    return t.values.length ? [{ ...t, like: undefined }] : [];
  });
  return terms.some(region) ? { ...set, terms } : { ...set, terms: [...terms, { kind: 'region', op: '=', values: [] }] };
}
