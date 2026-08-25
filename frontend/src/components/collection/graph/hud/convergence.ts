/**
 * Convergence — who is pursuing the same thing, and are they connected?
 *
 * This is the one measure in the model that cannot be asked any other way, and
 * it is the reason interests exist as a named set rather than as a label.
 *
 * Two actors sharing an interest is unremarkable when they act together: their
 * profiles overlap *by construction*, because the same occurrences produced
 * both. The question worth asking is whether they converge **disproportionately
 * to their connection** — alignment that graph distance does not explain.
 *
 * **Two numbers, not one.**
 *
 *     similarity = cosine(profile A, profile B)     how aligned      [-1, 1]
 *     hops       = actor-steps between them          how connected    null = no path
 *
 * These used to be multiplied into a single `residual`, with a penalty pinned
 * to 0 at one hop and rising toward 1 with distance. The intent was right and
 * the arithmetic was not: sharing an interest puts two actors at *exactly two
 * hops* through the interest node, where the penalty is 0.5 — so the residual
 * could never exceed 0.5, and `converge>0.6` was empty by construction. It had
 * been the canonical worked example in three documents.
 *
 * The penalty was never a weight. It was a **set difference written as a
 * multiplication**, and you cannot multiply your way to a set operation. So
 * callers filter on both, separately: high similarity AND high hops is the
 * finding; high similarity AND low hops is a description of people already
 * working together. In the query language that reads
 * `converge>0.6 contact>2`.
 *
 * **What it is not.** A high similarity is not evidence of coordination. It is
 * evidence of alignment without contact, which has at least two explanations:
 * people acting together off the record, and people responding independently
 * to the same incentive. Distinguishing those two is the analytical work, and
 * this only says where to look.
 */
import type { GraphEdge, GraphNode } from '../graphTypes';

export interface ConvergencePair {
  a: GraphNode;
  b: GraphNode;
  /** Raw profile overlap, `[-1, 1]`. Positive is alignment (including two
   *  parties united in opposing the same thing); negative is opposition. */
  similarity: number;
  /** Actor hops between them; `null` when no path exists — the strongest form
   *  of "converging without contact", not a missing value. */
  hops: number | null;
  /** The interests they share, strongest first — the "on what" of the finding. */
  shared: string[];
}

/** Cap on actors considered. Pairwise is O(N²); the graph is capped upstream
 *  anyway, and beyond a couple of hundred profiles the ranking is noise. */
const MAX_ACTORS = 200;

/** Pole markers `stream._profile_key` writes into a profile key. */
export const POLE_SERVES = '▲';    // ▲
export const POLE_OPPOSES = '▼';   // ▼

export interface Pole {
  /** The interest itself, with the marker removed — what a person reads. */
  label: string;
  /** `null` for a key written before poles existed (the signed single-key
   *  form), where the direction was in the value's sign instead. */
  direction: 'serves' | 'opposes' | null;
}

/**
 * Split a profile key back into interest and direction.
 *
 * Every surface that shows a profile entry goes through this, so the marker
 * never reaches a label. Rendering `port privatisation▼` to an analyst would
 * be leaking an encoding, and worse, it reads as part of the interest's name.
 */
export function readPole(key: string): Pole {
  if (key.endsWith(POLE_SERVES)) return { label: key.slice(0, -1), direction: 'serves' };
  if (key.endsWith(POLE_OPPOSES)) return { label: key.slice(0, -1), direction: 'opposes' };
  return { label: key, direction: null };
}

/**
 * A node's interest vector, when it has one.
 *
 * Values are magnitudes; the direction lives in the **key** — `stream._profile_key`
 * appends a pole marker, so `opacity▲` and `opacity▼` are two dimensions. That
 * is what stops an actor who both serves and opposes one interest from netting
 * to zero and disappearing.
 *
 * **Negatives are still accepted**, never filtered: a profile written by an
 * older run carries the signed single-key form, and dropping half of it would
 * silently overstate similarity — the exact drift the parity fixture exists to
 * catch.
 *
 * Zero is dropped. Under the two-sided key that can only mean an entry nobody
 * contributed to.
 *
 * Reads `profile`, never `groupValue`. That slot holds whatever the panel
 * asked to group by, and this function will cosine any dict it is handed —
 * under `node_group_by: "roles"` it holds a role histogram, and two
 * intermediaries then score a perfect 1.0 for both being intermediaries a lot.
 *
 * Mirrors `gql._profile_of`. `convergence.parity.test.ts` asserts that on
 * shared literals, because a docstring claiming two implementations agree is
 * how they came to disagree.
 */
export function profileOf(n: GraphNode): Record<string, number> | null {
  const g = n.profile;
  if (g && typeof g === 'object' && !Array.isArray(g)) {
    const entries = Object.entries(g).filter(([, w]) => Number.isFinite(w) && w !== 0);
    return entries.length ? Object.fromEntries(entries) : null;
  }
  return null;
}

export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of Object.entries(a)) { na += v * v; if (k in b) dot += v * b[k]; }
  for (const v of Object.values(b)) nb += v * v;
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Actor-hop distances from every profiled actor, occurrences contracted.
 *
 * Contracting matters here for the same reason it matters in traversal: an
 * actor and their co-participant are two edges apart but **one hop**, and
 * counting the occurrence would halve every distance and make everything look
 * far apart — inflating exactly the signal we are trying to measure.
 */
function hopDistances(
  seeds: GraphNode[], nodes: ReadonlyArray<GraphNode>, edges: ReadonlyArray<GraphEdge>,
  maxHops: number,
): Map<string, Map<string, number>> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map<string, Set<string>>();
  const members = new Map<string, string[]>();
  for (const e of edges) {
    const s = byId.get(e.sourceId), t = byId.get(e.targetId);
    if (!s || !t) continue;
    if (s.kind === 'occurrence' && t.kind !== 'occurrence') {
      (members.get(e.sourceId) ?? members.set(e.sourceId, []).get(e.sourceId)!).push(e.targetId);
    } else if (s.kind !== 'occurrence' && t.kind !== 'occurrence') {
      (adj.get(e.sourceId) ?? adj.set(e.sourceId, new Set()).get(e.sourceId)!).add(e.targetId);
      (adj.get(e.targetId) ?? adj.set(e.targetId, new Set()).get(e.targetId)!).add(e.sourceId);
    }
  }
  for (const list of members.values()) {
    for (const m of list) {
      const set = adj.get(m) ?? adj.set(m, new Set()).get(m)!;
      for (const o of list) if (o !== m) set.add(o);
    }
  }

  const out = new Map<string, Map<string, number>>();
  for (const seed of seeds) {
    const dist = new Map<string, number>([[seed.id, 0]]);
    let frontier = [seed.id];
    for (let d = 1; d <= maxHops && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const peer of adj.get(id) ?? []) {
          if (!dist.has(peer)) { dist.set(peer, d); next.push(peer); }
        }
      }
      frontier = next;
    }
    out.set(seed.id, dist);
  }
  return out;
}

/**
 * Rank pairs by alignment, optionally excluding the ones a short path explains.
 *
 * `minContact` is the set difference the old `distancePenalty` was trying to
 * express by multiplication: pairs closer than this are dropped outright rather
 * than scaled toward zero, so a real threshold on `minSimilarity` stays
 * reachable. Unconnected pairs have `hops == null` and always pass — no path at
 * all is the strongest form of the signal, not a missing one.
 */
export function convergencePairs(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  { minSimilarity = 0.2, minContact = 0, maxHops = 6, limit = 25 } = {},
): ConvergencePair[] {
  const actors = nodes
    .filter(n => n.kind !== 'occurrence' && profileOf(n))
    .slice(0, MAX_ACTORS);
  if (actors.length < 2) return [];

  const profiles = new Map(actors.map(n => [n.id, profileOf(n)!]));
  const dists = hopDistances(actors, nodes, edges, maxHops);

  const out: ConvergencePair[] = [];
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const a = actors[i], b = actors[j];
      const pa = profiles.get(a.id)!, pb = profiles.get(b.id)!;
      const similarity = cosine(pa, pb);
      if (similarity < minSimilarity) continue;
      const hops = dists.get(a.id)?.get(b.id) ?? null;
      // `null` = no path = maximally uncontacted, so it passes every floor.
      if (hops != null && hops < minContact) continue;
      // Shared means they take the SAME side, so the signs must agree — an
      // interest one serves and the other opposes is what they disagree
      // about, and listing it under "shared" inverts the finding. Ranked by
      // the weaker of the two magnitudes: how much they BOTH put behind it.
      const shared = Object.keys(pa)
        .filter(k => k in pb && Math.sign(pa[k]) === Math.sign(pb[k]))
        .sort((x, y) => Math.min(Math.abs(pb[y]), Math.abs(pa[y]))
                      - Math.min(Math.abs(pb[x]), Math.abs(pa[x])));
      out.push({ a, b, similarity, hops, shared });
    }
  }
  // Ranked by alignment, then by distance — of two equally aligned pairs the
  // one nothing connects is the more interesting finding. `null` sorts last
  // in the comparator's terms by standing in as the largest distance.
  const far = (h: number | null) => (h == null ? Number.MAX_SAFE_INTEGER : h);
  return out
    .sort((x, y) => (y.similarity - x.similarity) || (far(y.hops) - far(x.hops)))
    .slice(0, limit);
}

/** Total activity attributable to an interest, for the dossier. */
export interface InterestImpact {
  interest: string;
  occurrences: number;
  actors: number;
  magnitude: number;
  from: string | null;
  to: string | null;
  places: number;
}

/** Aggregate over the filtered occurrence set — the "how big is this" half of
 *  the question, computed from what is on screen so it always matches it. */
export function interestImpact(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
): InterestImpact[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const acc = new Map<string, InterestImpact & { actorIds: Set<string>; placeNames: Set<string> }>();

  // occurrence -> the interests it serves, and its participants
  const serves = new Map<string, string[]>();
  const parts = new Map<string, string[]>();
  for (const e of edges) {
    const s = byId.get(e.sourceId), t = byId.get(e.targetId);
    if (!s || !t || s.kind !== 'occurrence') continue;
    const bucket = (t.type || '').toLowerCase() === 'interest' ? serves : parts;
    (bucket.get(e.sourceId) ?? bucket.set(e.sourceId, []).get(e.sourceId)!).push(t.label);
  }

  for (const [occId, interests] of serves) {
    const occ = byId.get(occId)!;
    for (const name of interests) {
      let row = acc.get(name);
      if (!row) {
        row = {
          interest: name, occurrences: 0, actors: 0, magnitude: 0,
          from: null, to: null, places: 0,
          actorIds: new Set(), placeNames: new Set(),
        };
        acc.set(name, row);
      }
      row.occurrences += 1;
      row.magnitude += occ.magnitude ?? 0;
      if (occ.t0 && (!row.from || occ.t0 < row.from)) row.from = occ.t0;
      for (const v of [occ.t1, occ.t0]) if (v && (!row.to || v > row.to)) row.to = v;
      if (occ.place) row.placeNames.add(occ.place);
      for (const p of parts.get(occId) ?? []) row.actorIds.add(p);
    }
  }

  return [...acc.values()]
    .map(r => ({ ...r, actors: r.actorIds.size, places: r.placeNames.size }))
    .sort((a, b) => b.occurrences - a.occurrences);
}
