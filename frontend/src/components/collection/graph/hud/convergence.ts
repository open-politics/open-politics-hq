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
 *     residual = cosine(profile A, profile B) × distancePenalty(hops)
 *
 * One actor-hop apart scores **zero**: you share an act, of course you share
 * its interest. The penalty relaxes as distance grows, so six hops apart and
 * still converging keeps almost the full cosine — and *no path at all* keeps
 * all of it, which is the strongest form of the signal.
 *
 * **What it is not.** A high residual is not evidence of coordination. It is
 * evidence of alignment without contact, which has at least two explanations:
 * people acting together off the record, and people responding independently
 * to the same incentive. Distinguishing those two is the analytical work, and
 * this only says where to look.
 */
import type { GraphEdge, GraphNode } from '../graphTypes';

export interface ConvergencePair {
  a: GraphNode;
  b: GraphNode;
  /** Raw profile overlap, 0–1. */
  similarity: number;
  /** Actor hops between them; `null` when no path exists. */
  hops: number | null;
  /** Similarity discounted by how much their connection already explains. */
  residual: number;
  /** The interests they share, strongest first — the "on what" of the finding. */
  shared: string[];
}

/** Cap on actors considered. Pairwise is O(N²); the graph is capped upstream
 *  anyway, and beyond a couple of hundred profiles the ranking is noise. */
const MAX_ACTORS = 200;

/**
 * A node's interest vector, when it has one.
 *
 * **Negatives are kept.** The profile is signed — an act that OPPOSES an
 * interest subtracts (`stream.OPPOSING_ROLES`) — and filtering to positives
 * broke this pane in two directions at once. Two parties who both oppose X
 * had their profiles emptied and dropped out of the pane entirely, though
 * they agree and score +1 in the bar; and a mixed profile lost its negative
 * half, overstating similarity against anyone sharing only the positive one.
 *
 * Zero is still dropped: it means the entry cancelled out, which is no
 * information rather than a weak signal.
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

/** Zero at one hop, rising toward 1 with distance. Unconnected pairs get the
 *  full weight: alignment with no path at all is the strongest form. */
export function distancePenalty(hops: number | null): number {
  if (hops == null) return 1;
  if (hops <= 1) return 0;
  return 1 - 1 / hops;
}

export function convergencePairs(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  { minResidual = 0.2, maxHops = 6, limit = 25 } = {},
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
      if (similarity <= 0) continue;
      const hops = dists.get(a.id)?.get(b.id) ?? null;
      const residual = similarity * distancePenalty(hops);
      if (residual < minResidual) continue;
      // Shared means they take the SAME side, so the signs must agree — an
      // interest one serves and the other opposes is what they disagree
      // about, and listing it under "shared" inverts the finding. Ranked by
      // the weaker of the two magnitudes: how much they BOTH put behind it.
      const shared = Object.keys(pa)
        .filter(k => k in pb && Math.sign(pa[k]) === Math.sign(pb[k]))
        .sort((x, y) => Math.min(Math.abs(pb[y]), Math.abs(pa[y]))
                      - Math.min(Math.abs(pb[x]), Math.abs(pa[x])));
      out.push({ a, b, similarity, hops, residual, shared });
    }
  }
  return out.sort((x, y) => y.residual - x.residual).slice(0, limit);
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
