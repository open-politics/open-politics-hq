import * as d3 from 'd3';
import type { AnchorSpec } from './forcegraph/anchors';

// =============================================================================
// Public graph data types — shared by run-scoped, curated, and inline-preview
// graph surfaces. Naming intentionally generic ("Graph", not "Triplet") so the
// upcoming edges-as-first-class-entities work doesn't need a rename pass.
// =============================================================================

/** One place a node is, over one interval, from one rung of the place ladder.
 *  Mirrors backend `NodePlace`. A node's location is a list because a company
 *  holds a registered office, a head office and a tax residence at once, in
 *  three countries — and the gap between two of them is often the finding. */
export interface NodePlace {
  place: string;
  lat?: number | null;
  lon?: number | null;
  /** Interval this place holds over; open `to` means "still current". */
  from?: string | null;
  to?: string | null;
  /** `registered_office`, `head_office`, … Null for a plain site. */
  kind?: string | null;
  /** Which end of a trajectory. Null for a point. */
  end?: 'from' | 'to' | null;
  /** Which rung. `row` is a stated site and outranks everything; `attribute`
   *  is a seat; `doc`/`asset` are weaker still. **These must never render
   *  alike** — "this filing is about Malta" carries nothing like the authority
   *  of "the meeting was in Valletta". */
  source?: 'row' | 'attribute' | 'doc' | 'asset' | 'canon';
}

/** An inline justification riding a node or edge — the structured-output
 *  `JustificationSubModel` shape. `text_spans` carry the document's own words,
 *  which is the part that matters: `reasoning` is the model's account of why,
 *  and must never be presented as something the document said. */
export interface GraphEvidence {
  reasoning?: string | null;
  text_spans?: Array<{ text_snippet?: string | null; text?: string | null }>;
  [key: string]: any;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  /** `entity` comes from a named set — it persists and recurs. `occurrence` is
   *  minted from a statement row that is about itself: it *happened*.
   *  The two get **opposite** visual treatment: entities are the labelled
   *  nouns you recognise, occurrences are numerous connective tissue that
   *  recedes until you zoom or open the item pane. */
  kind?: 'entity' | 'occurrence';
  /** Occurrences only: the declared kind of act — `Payment`, `Meeting`. */
  nodeType?: string | null;
  /** What the document said this act was worth. Separate from `frequency`
   *  (how often we saw it) on purpose — conflating them makes "mentioned
   *  often" look like "large". Not a calibrated measurement. */
  magnitude?: number | null;
  /** The resolved `WEIGHT:` binding, `[0, 1]`. Undefined when nothing bound
   *  it, in which case the renderer keeps its own degree-based default —
   *  `nodeRadius` is the fallback, never an override. */
  size?: number | null;
  /** The resolved `CLUSTER:` binding — **which pile**, not where the pile goes.
   *
   *  Resolved server-side because the key may name a declaration the client
   *  cannot see (a role, a place rung, a section); the geometry is decided in
   *  `anchors.ts::clusterCells`, because geometry is layout. `null`/undefined
   *  means this node has no value for the key and stays where the link forces
   *  put it — "everything else" is not a group.
   *
   *  Deliberately not `groupValue`: that slot is whatever `node_group_by` asked
   *  for and is then overwritten by the convergence profile, so a clustering
   *  stored there would vanish the moment anyone asked a `converge:` question. */
  cluster?: string | null;
  frequency?: number;
  sourceAssetCount?: number;
  sourceAssetIds?: number[];
  /** Raw annotation ids this node was extracted from. Derived fields like
   * ``sourceAssetIds`` can be built from these via the rows fetch. */
  annotationIds?: number[];
  aliases?: string[];
  properties?: Record<string, any>;

  // ─── Time (backend: annotation/panel_config Projection.time) ───
  /** Existence interval, unioned across every atom that named this node.
   *  ISO strings. ``t1 === null`` with ``t0`` set means OPEN-ENDED — the node
   *  exists from ``t0`` onward, which is what a bare timestamp declares. The
   *  time slider filters on these client-side; there is no refetch. */
  t0?: string | null;
  t1?: string | null;
  /** Activity interval — the histogram source when a projection binds
   *  ``activity`` separately from ``time``. Falls back to t0/t1 when unbound. */
  a0?: string | null;
  a1?: string | null;

  // ─── Space ───
  /** Raw location string — the `at`, or a trajectory's origin. */
  place?: string | null;
  /** A trajectory's far end. A movement is at neither endpoint; it spans them,
   *  and both are needed to draw the arc. */
  placeTo?: string | null;
  /** Every place this node is. `place`/`lat`/`lon` mirror the first entry. */
  places?: NodePlace[];
  /** Geo anchor. Resolved server-side from the asset-facet geocoding cache or
   *  from curated canon coords — a canon is an enhancement, not a requirement.
   *  Null for anything that never geocoded, which is most nodes in most
   *  graphs: treat the geo layout as a lens, not a default. */
  lat?: number | null;
  lon?: number | null;

  // ─── Provenance ───
  /** Which projections produced this node. A node in more than one is the
   *  linking payoff — the same entity named by a roster and by a triplet. */
  sourcePaths?: string[];
  /** Role labels this node appeared under ("speaker", "subject", …). */
  roles?: string[];
  /** Inline justifications from every atom that named this node. */
  evidence?: GraphEvidence[];
  /** The panel's `node_group_by` value. A scalar today; an array or a weighted
   *  map when a grouping is multi-valued — which is why the `field` anchor
   *  treats membership as a vector rather than a single label. */
  groupValue?: string | string[] | Record<string, number> | null;
  /** Signed affinity vector — `{opacity: 8.2, oversight: -3.0}` — aggregated
   *  over `node → occurrence → Interest`, weighted by each act's magnitude and
   *  negative where the act opposed. Convergence reads this and nothing else;
   *  `groupValue` is whatever the panel grouped by and cosining it is how a
   *  role histogram came to be scored as alignment. */
  profile?: Record<string, number> | null;
  // d3-force / react-force-graph mutates these during simulation — declared
  // here so consumers reading positions after a render see the right shape.
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  predicate: string;
  /** The role the target plays in its source occurrence — `payer`, `via`,
   *  `on_board`. A property of the **edge**, never of the node: the same bank
   *  is `via` in 340 payments and `employer` in 12 employments while staying
   *  one node. "Facilitator" is a measured view, never a declared type. */
  role?: string | null;
  frequency?: number;
  weight?: number;
  confidence?: number;
  sourceAssetCount?: number;
  date?: string;
  context?: string;
  properties?: Record<string, any>;

  /** Existence interval — what pops this edge in and out on the time slider.
   *  ``t1 === null`` with ``t0`` set is open-ended (a bare timestamp). */
  t0?: string | null;
  t1?: string | null;
  /** Activity interval — separate histogram source when a projection binds
   *  ``activity`` distinctly from ``time``. */
  a0?: string | null;
  a1?: string | null;
  /** Which projections contributed to this edge. */
  sourcePaths?: string[];
  /** Which annotations produced this edge. The provenance nodes already had;
   *  edge → document traceability reads this and nothing else. */
  annotationIds?: number[];
  /** Inline justifications from each contributing atom. */
  evidence?: GraphEvidence[];
  /** The `edge_group_by` bucket. Where binding `modality` or `stance` puts the
   *  value, which is what `edgeEpistemics` paints from. */
  /** What this edge DOES to the picture — `contains` · `follows` · `role` ·
   *  `relation`. Four kinds, closed (`sections.EDGE_KINDS`), resolved
   *  server-side because it needs the projection that minted the edge.
   *
   *  They used to paint identically, which is the direct cause of "no
   *  hierarchy, still random nodes everywhere": 35 containment edges drawn as
   *  adjacency so nothing nested, and 136 role edges — an act's cast — drawn at
   *  the weight of a finding. `FAULTS` F2. */
  kind?: 'contains' | 'follows' | 'role' | 'relation' | null;
  groupValue?: string | null;
}

// =============================================================================
// Collapse — bipartite ⇄ direct, over ONE data model.
//
// An occurrence-centric graph answers "what happened, when, where, on whose
// word". A collapsed one answers "who is connected to whom". Both readings are
// wanted, often minutes apart, so neither is a separate fetch: collapsing is a
// pure fold over the assembled graph and expanding is dropping the fold.
//
// Ownership work wants collapsed by default (chains over time are the finding);
// co-presence work wants bipartite (the meeting IS the finding). The default is
// inferred from the shape of the occurrences and remembered once overridden.
// =============================================================================

export interface CollapsedEdge extends GraphEdge {
  /** The occurrences this edge stands for. Authoritative for dates, evidence
   *  and drill-down — the fold is a view, it does not discard anything. */
  occurrences: GraphNode[];
  occurrenceCount: number;
  /** Roles at each end, when every contributing occurrence agreed on them. */
  sourceRole?: string | null;
  targetRole?: string | null;
}

/** Fold occurrence nodes into direct participant-to-participant edges.
 *
 *  Pure. Returns entity nodes only, plus one edge per participant pair per
 *  distinct occurrence type.
 *
 *  **The collapsed edge's interval is a union, and that is a claim to handle
 *  carefully.** Two payments in 2019 and 2023 fold into one edge spanning
 *  2019–2023, which read naively says "an ongoing funding relationship" —
 *  precisely the failure occurrences exist to prevent. So `occurrenceCount`
 *  rides along and the renderer must surface it ("3 payments"), never present
 *  a fold as one continuous thing. Expanding always recovers the truth.
 */
export function collapseOccurrences(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: GraphNode[]; edges: CollapsedEdge[] } {
  const occById = new Map<string, GraphNode>();
  for (const n of nodes) if (n.kind === 'occurrence') occById.set(n.id, n);
  if (occById.size === 0) return { nodes, edges: edges as CollapsedEdge[] };

  // Participants per occurrence, in role order — the order roles were declared,
  // which is what makes payer→payee point the right way.
  const members = new Map<string, Array<{ id: string; role?: string | null }>>();
  const passthrough: GraphEdge[] = [];
  for (const e of edges) {
    if (occById.has(e.sourceId)) {
      const list = members.get(e.sourceId) ?? [];
      list.push({ id: e.targetId, role: e.role });
      members.set(e.sourceId, list);
    } else if (!occById.has(e.targetId)) {
      passthrough.push(e);   // a plain connection; nothing to fold
    }
  }

  const folded = new Map<string, CollapsedEdge>();
  for (const [occId, parts] of members) {
    const occ = occById.get(occId)!;
    const label = occ.nodeType || occ.type || 'related';
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        if (a.id === b.id) continue;
        const key = `${a.id}|${b.id}|${label}`;
        const existing = folded.get(key);
        if (existing) {
          existing.occurrences.push(occ);
          existing.occurrenceCount += 1;
          existing.weight = (existing.weight ?? 0) + (occ.magnitude ?? 1);
          if (occ.t0 && (!existing.t0 || occ.t0 < existing.t0)) existing.t0 = occ.t0;
          if (occ.t1 && (!existing.t1 || occ.t1 > existing.t1)) existing.t1 = occ.t1;
          if (existing.sourceRole !== a.role) existing.sourceRole = null;
          if (existing.targetRole !== b.role) existing.targetRole = null;
        } else {
          folded.set(key, {
            id: `collapsed:${key}`,
            sourceId: a.id,
            targetId: b.id,
            predicate: label,
            role: null,
            sourceRole: a.role ?? null,
            targetRole: b.role ?? null,
            weight: occ.magnitude ?? 1,
            frequency: 1,
            t0: occ.t0 ?? null,
            t1: occ.t1 ?? null,
            occurrences: [occ],
            occurrenceCount: 1,
          });
        }
      }
    }
  }

  return {
    nodes: nodes.filter(n => n.kind !== 'occurrence'),
    edges: [...(passthrough as CollapsedEdge[]), ...folded.values()],
  };
}

/** Should this graph open collapsed or bipartite?
 *
 *  Two participants and a magnitude is a stake or a transfer: the chain is the
 *  finding, so fold it. More than two participants is co-presence: who was in
 *  the room together IS the finding, and folding destroys it — five passengers
 *  become ten pair-edges with no way back to the flight.
 */
export function inferOccurrenceView(nodes: GraphNode[], edges: GraphEdge[]):
  'bipartite' | 'collapsed' {
  const counts = new Map<string, number>();
  let withMagnitude = 0, total = 0;
  for (const n of nodes) {
    if (n.kind !== 'occurrence') continue;
    total += 1;
    if (n.magnitude != null) withMagnitude += 1;
    counts.set(n.id, 0);
  }
  if (total === 0) return 'bipartite';
  for (const e of edges) {
    if (counts.has(e.sourceId)) counts.set(e.sourceId, counts.get(e.sourceId)! + 1);
  }
  const pairwise = [...counts.values()].filter(c => c === 2).length;
  return pairwise / total > 0.7 && withMagnitude / total > 0.5
    ? 'collapsed'
    : 'bipartite';
}

// =============================================================================
// Epistemic painting — what KIND of claim an edge is.
//
// A denial, an inference, a retraction and a recorded filing are different
// epistemic objects. If they render alike the graph asserts things nobody
// said, which in a court corpus is the difference between analysis and
// defamation. So this is a correctness rule, not a style choice, and it lives
// in one pure function so no surface can quietly disagree with another.
//
// The vocabulary comes from the schema (`modality` on a statement, `stance` on
// evidence). Anything unrecognised reads as plainly asserted — the schema
// author's own taxonomy is authoritative and we do not guess at words we were
// not taught.
// =============================================================================

export type EdgeStance = 'asserted' | 'negated' | 'unresolved' | 'corrective';

export interface EdgeEpistemics {
  stance: EdgeStance;
  /** Canvas dash pattern, or null for a solid stroke. */
  dash: number[] | null;
  /** Opacity multiplier — an unresolved claim reads fainter than a made one. */
  alpha: number;
}

const STANCE_BY_TERM: Record<string, EdgeStance> = {
  // made, and standing
  asserts: 'asserted', asserted: 'asserted', recalls: 'asserted',
  supports: 'asserted', confirms: 'asserted',
  // made, and opposite — a denial is a strong claim, not a weak one
  denies: 'negated', denied: 'negated', contradicts: 'negated',
  refutes: 'negated', disputes: 'negated',
  // asked and not answered — the absence of a claim, not a claim of absence
  does_not_recall: 'unresolved', declines: 'unresolved',
  speculates: 'unresolved', qualifies: 'unresolved', alleges: 'unresolved',
  // the record changing under you
  corrects: 'corrective', retracts: 'corrective', supersedes: 'corrective',

  // ── Adjectival forms, which is how a `modality` enum reads ───────────────
  //
  // This list was written in the verb voice a transcript uses ("the witness
  // alleges"), and a schema states the same fact as a state ("modality:
  // alleged"). Three of the court-records vocabulary's own terms therefore
  // fell through to the default — including `alleged`, which defaulted to
  // ASSERTED. An allegation painting as an assertion is the exact failure that
  // schema exists to prevent, and it would have happened silently.
  //
  // Listed rather than stemmed: this vocabulary is deliberate and closed, and
  // a stemmer would quietly admit words nobody chose.
  recorded: 'asserted',      // a log or manifest — the document IS the record
  testified: 'asserted',     // sworn
  corroborated: 'asserted',  // a second independent source
  adjudicated: 'asserted',   // a court found it
  // Secondhand is still a claim, and `source_kind` is where its weight lives —
  // a different axis from how the claim was made.
  reported: 'asserted',
  alleged: 'unresolved',     // asserted in a pleading, untested
  declined: 'unresolved',    // refused to answer: neither denial nor admission
  disputed: 'negated',       // contested on the record
};

const EPISTEMICS: Record<EdgeStance, EdgeEpistemics> = {
  asserted:   { stance: 'asserted',   dash: null,      alpha: 1 },
  negated:    { stance: 'negated',    dash: [6, 4],    alpha: 1 },
  unresolved: { stance: 'unresolved', dash: [1, 3],    alpha: 0.55 },
  corrective: { stance: 'corrective', dash: [8, 3, 2, 3], alpha: 0.85 },
};

/** One vocabulary for "how was this claim made", shared by the canvas and the
 *  evidence pane.
 *
 *  Exported because the pane needs the same answer: a quote grounding a denial
 *  and a quote grounding an assertion must not render alike, and if the two
 *  surfaces kept separate term lists they would eventually disagree about what
 *  `declines` means — which is the difference between reporting a refusal to
 *  answer and reporting an answer. */
export function epistemicStance(term: string | null | undefined): EdgeStance {
  if (typeof term !== 'string') return 'asserted';
  return STANCE_BY_TERM[term.trim().toLowerCase()] ?? 'asserted';
}

/** How this edge should read. Looks at `modality`/`stance` among the forwarded
 *  properties, then at the edge's grouping value (which is where
 *  `edge_group_by: modality` puts it). */
export function edgeEpistemics(edge: GraphEdge): EdgeEpistemics {
  const p = edge.properties ?? {};
  const raw = p.modality ?? p.stance ?? p.epistemic ?? edge.groupValue ?? null;
  return EPISTEMICS[epistemicStance(raw)];
}

// =============================================================================
// Time helpers — one place that knows what an open-ended interval means.
//
// A bare timestamp binding yields t1 = null, meaning "exists from t0 onward".
// Treating null as "unknown end" and treating it as "no end" give opposite
// answers on the slider, so the rule lives here rather than in each caller.
// =============================================================================

/** Which clock an interval is read on. `time` is when it happened or was
 *  recorded; `activity` is the period it is *about*. Where they differ — a
 *  deposition describing events fifteen years earlier — the difference is the
 *  finding. */
export type Clock = 'time' | 'activity';

/** An item's interval on the named clock.
 *
 * **One function, because the alternative already went wrong.** The scrubber
 * histogrammed `a0`/`a1` whenever an item had them and `filterByCursor` read
 * `t0`/`t1` unconditionally, so the bars counted the period items were about
 * while the cursor filtered on when they happened — and the scrubber's own
 * docstring promised the two could not disagree. Whoever reads an interval
 * reads it from here, and says which clock they meant.
 *
 * `activity` falls back to the existence interval, because most corpora bind
 * a second clock on some sections and not others; dropping the rest would make
 * the toggle look like it broke the panel.
 */
export function clockOf<T extends {
  t0?: string | null; t1?: string | null; a0?: string | null; a1?: string | null;
}>(it: T, clock: Clock): { t0: string | null | undefined; t1: string | null | undefined } {
  return clock === 'activity' && (it.a0 || it.a1)
    ? { t0: it.a0, t1: it.a1 }
    : { t0: it.t0, t1: it.t1 };
}

/** How many items carry a second clock — so a control can say whether choosing
 *  it would show anything, before it is chosen rather than after. Same
 *  argument as `frame_coverage` makes for the axis budget. */
export function activityCoverage(
  items: ReadonlyArray<{ a0?: string | null; a1?: string | null }>,
): number {
  return items.reduce((n, it) => n + (it.a0 || it.a1 ? 1 : 0), 0);
}

/** Filter a graph to one instant. Pure, so the panel can memoize on the cursor.
 *
 * Takes the clock explicitly and reads it through the same `clockOf` the bars
 * use. It used to read `t0`/`t1` unconditionally while the scrubber preferred
 * `a0`/`a1` per item, so with a second clock bound the histogram and the canvas
 * were answering different questions.
 */
export function filterByCursor<N extends GraphNode, E extends GraphEdge>(
  nodes: N[], edges: E[], cursor: string | null, clock: Clock = 'time',
): { nodes: N[]; edges: E[] } {
  if (!cursor) return { nodes, edges };
  const covers = (it: GraphNode | GraphEdge) => {
    const { t0, t1 } = clockOf(it, clock);
    return intervalCovers(t0, t1, cursor);
  };
  const keptNodes = nodes.filter(covers);
  const kept = new Set(keptNodes.map(n => n.id));
  return {
    nodes: keptNodes,
    edges: edges.filter(e =>
      kept.has(e.sourceId) && kept.has(e.targetId) && covers(e),
    ),
  };
}

/** Does this interval exist at `cursor`? Untimed items are always present —
 *  the slider narrows what *has* time, it doesn't hide what doesn't. */
export function intervalCovers(
  t0: string | null | undefined,
  t1: string | null | undefined,
  cursor: string,
): boolean {
  if (!t0 && !t1) return true;            // untimed — never filtered out
  if (t0 && cursor < t0) return false;    // not yet in existence
  if (t1 && cursor > t1) return false;    // already ended
  return true;                            // t1 null ⇒ open-ended, still alive
}

/** Min/max across a set of intervals, for the slider's extent and the bars'
 *  domain. Ignores nulls; returns null when nothing is timed at all. */
export function timeExtent(
  items: ReadonlyArray<{ t0?: string | null; t1?: string | null }>,
): { min: string; max: string } | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const it of items) {
    if (it.t0 && (min === null || it.t0 < min)) min = it.t0;
    for (const v of [it.t1, it.t0]) {
      if (v && (max === null || v > max)) max = v;
    }
  }
  return min && max ? { min, max } : null;
}

// =============================================================================
// Edge bundling — collapse every connection between a node pair into ONE
// rendered link, regardless of predicate. A dense graph where A and B are
// joined by five different relationships reads as one weighted connection
// instead of five fanned arcs; the per-predicate breakdown lives in the edge
// inspector (click), not on the canvas.
//
// A ``BundledEdge`` IS a ``GraphEdge`` (so the renderer's painters / width /
// highlight machinery work unchanged) plus the aggregate it stands for:
//   - ``members``         the individual edges it collapses (authoritative
//                         for evidence / source-doc / curate lookups)
//   - ``predicateCounts`` per-predicate {count, weight}, sorted strongest-first
//   - ``totalWeight``     Σ member weight — drives the rendered line width
//   - ``directionMix``    whether members run one way, the other, or both
//
// Grouping is by UNORDERED pair (``pairKey``); the bundle's id is canonical so
// any member edge can be mapped back to its bundle by recomputing the key.
// Orientation (``sourceId``/``targetId``) follows the dominant member so the
// forward arrow points along the strongest relationship.
// =============================================================================

export interface BundledEdgePredicate {
  predicate: string;
  count: number;
  weight: number;
}

export interface BundledEdge extends GraphEdge {
  members: GraphEdge[];
  predicateCounts: BundledEdgePredicate[];
  totalWeight: number;
  memberCount: number;
  directionMix: 'forward' | 'backward' | 'both';
}

/** Canonical (order-independent) key for a node pair. Matches the separator
 *  convention used by the renderer's parallel-edge curvature grouping. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Bundle id for a node pair — deterministic so a member edge maps back to
 *  its bundle via ``bundleIdForEdge`` without a side table. */
export function bundleIdForPair(a: string, b: string): string {
  return `bundle:${pairKey(a, b)}`;
}

/** The bundle id an individual edge belongs to. */
export function bundleIdForEdge(e: GraphEdge): string {
  return bundleIdForPair(e.sourceId, e.targetId);
}

/** Collapse a flat edge list into one ``BundledEdge`` per unordered node
 *  pair. Pure — safe to memoize on the edges array. */
export function bundleEdges(edges: GraphEdge[]): BundledEdge[] {
  const groups = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const key = pairKey(e.sourceId, e.targetId);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const out: BundledEdge[] = [];
  for (const [key, members] of groups) {
    const predMap = new Map<string, { count: number; weight: number }>();
    for (const m of members) {
      const w = m.weight ?? m.frequency ?? 1;
      const cur = predMap.get(m.predicate);
      if (cur) { cur.count += 1; cur.weight += w; }
      else predMap.set(m.predicate, { count: 1, weight: w });
    }
    const predicateCounts: BundledEdgePredicate[] = Array.from(predMap.entries())
      .map(([predicate, v]) => ({ predicate, count: v.count, weight: v.weight }))
      .sort((a, b) => b.weight - a.weight || b.count - a.count || a.predicate.localeCompare(b.predicate));

    const totalWeight = predicateCounts.reduce((s, p) => s + p.weight, 0);
    const dominantPredicate = predicateCounts[0]?.predicate ?? members[0].predicate;
    // Orient the bundle along the dominant relationship so the forward arrow
    // reads correctly for the strongest member.
    const dominant = members.find(m => m.predicate === dominantPredicate) ?? members[0];

    // Direction mix relative to the canonical (sorted) endpoints.
    const canonicalSource = key.slice(0, key.indexOf('|'));
    let anyForward = false, anyBackward = false;
    for (const m of members) {
      if (m.sourceId === canonicalSource) anyForward = true;
      else anyBackward = true;
    }
    const directionMix: BundledEdge['directionMix'] =
      anyForward && anyBackward ? 'both' : anyBackward ? 'backward' : 'forward';

    out.push({
      id: `bundle:${key}`,
      sourceId: dominant.sourceId,
      targetId: dominant.targetId,
      predicate: dominantPredicate,
      weight: totalWeight,
      frequency: totalWeight,
      members,
      predicateCounts,
      totalWeight,
      memberCount: members.length,
      directionMix,
    });
  }
  return out;
}

/** Label lines for an edge, shared by the 2D painter and the 3D sprite so
 *  both render the connection identically. A bundle shows its top-3
 *  predicates sized by rank (strongest largest) with a "…" row when more
 *  exist; a plain edge shows its single predicate. ``scale`` is relative to
 *  the base label font size. */
export function edgeLabelLines(edge: GraphEdge): Array<{ text: string; scale: number }> {
  const pc = (edge as Partial<BundledEdge>).predicateCounts;
  if (Array.isArray(pc) && pc.length > 1) {
    const RANK = [1, 0.82, 0.68];
    const lines = pc.slice(0, 3).map((p, i) => ({ text: p.predicate, scale: RANK[i] }));
    if (pc.length > 3) lines.push({ text: '…', scale: 0.6 });
    return lines;
  }
  return [{ text: edge.predicate, scale: 1 }];
}

// =============================================================================
// ActiveSubNetwork — single primitive for every "this region of the graph is
// in focus" lens. Each lens (node selection, asset highlight, keyboard-nav,
// pin board, future search/time-window/schema-filter) projects to the same
// shape:
//   - ``nodeIds`` membership (used by node painter for halos / pinning)
//   - ``edgeIds`` to highlight (driven by linkColor, linkWidth, label opacity,
//     painter halo, 3D label scale boost)
//   - a colour token (visual identity — blue ⇒ contextual node-focus,
//     amber ⇒ explicit lens like asset / pin / keyboard-nav)
//
// The graph reads from a list of active sub-networks rather than ad-hoc
// ``highlightedEdgeId`` / ``highlightedEdgeIds`` / per-edge incidence
// checks. List shape (vs. single) is intentional: we keep "one active at a
// time" today (last interaction wins, set by the parent), but the rendering
// cascade already iterates correctly so future composition (multi-lens,
// pin-board view + asset-lens, etc.) is a parent-side change only.
//
// Iteration order is the priority order — first match wins for color +
// thickness + halo. Asset/edge-nav lenses come first (amber), node-focus
// last (blue), so an edge that's both incident-to-focused-node AND in an
// active asset lens paints amber.
// =============================================================================

export type SubNetworkColor = 'blue' | 'amber';

export type SubNetworkSource =
  | 'node-focus'      // single node + its incident edges
  | 'asset-lens'      // edges spawned by a single asset's triplets
  | 'edge-nav'        // single edge — keyboard navigation / evidence-card hover
  | 'pin-set'         // pin board page — direct edges between pinned nodes
  | 'cooccurs-focus'; // relationship-as-a-lens — entities + edges between them

export interface ActiveSubNetwork {
  source: SubNetworkSource;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  color: SubNetworkColor;
  /** Optional label for future UI badges (e.g. "Asset 12", "Pins: cluster A"). */
  label?: string;
}

// =============================================================================
// View configuration — controls layout, display, and renderer behavior. Stored
// per-panel in ``panelConfig.settings.graphViewConfig`` (run-scoped) or via the
// caller's ``onGraphConfigChange`` callback (curated view). Inline preview
// hardcodes its own overrides.
//
// New fields in this rev:
//  - ``viewMode`` — '2d' (Canvas) | '3d' (Three.js, dynamic-imported)
//  - ``cooldownTicks`` — auto-stop simulation after N ticks
//  - ``labelMinScale`` — hide node labels below this zoom level (perf at scale)
//  - ``forceEngine`` — 'd3' (default) | 'ngraph' (faster settle for >10k nodes)
//  - 3D-only: ``cameraType``, ``sphereWidthSegments``, ``nodeOpacity3D``,
//    ``linkOpacity3D``
//
// Backward-compat: stored configs from older versions lack these fields and
// fall through ``{ ...defaultGraphViewConfig, ...stored }`` — no migration.
// =============================================================================

export interface GraphViewConfig {
  // Interaction
  zoomOnNodeClick: boolean;
  clickZoomScale: number;
  zoomTransitionMs: number;

  // Layout / forces
  chargeStrength: number;
  linkDistance: number;
  warmupTicks: number;
  cooldownTicks: number;
  forceEngine: 'd3' | 'ngraph';

  // Display
  showNodeLabels: boolean;
  /** When true, render labels for *all* nodes (sized by degree, faded by
   *  zoom/camera-distance for far-away ones). When false, only the top-N
   *  anchor nodes (highest degree) plus selection/hover state get labels.
   *  Default false — large graphs read better with anchor labels only. */
  showAllLabels: boolean;
  showEdgeLabels: boolean;
  labelFontSize: number;
  showEdgeArrows: boolean;
  showNodeIcons: boolean;
  /** Hide node labels when canvas zoom drops below this fraction. Selected,
   * connected, and hovered nodes always render their label. */
  labelMinScale: number;
  /** Hide edge labels when canvas zoom drops below this fraction. Hovered
   * edges and edges incident to the selected node always render. */
  edgeLabelMinScale: number;

  // Clustering
  /** @deprecated superseded by `anchors` (kind: 'type'). Still read by
   *  `effectiveAnchors` so stored configs lay out unchanged. */
  clusterByType: boolean;
  clusterStrength: number;

  /** Occurrence rendering. `bipartite` shows each occurrence as its own node
   *  with role-labelled edges to its participants; `collapsed` folds it into
   *  direct participant-to-participant edges. Same data, two readings —
   *  "what happened" vs "who is connected to whom".
   *
   *  `auto` picks from the shape of the data (see `inferOccurrenceView`):
   *  two-participant rows carrying a magnitude are stakes and transfers, where
   *  the chain is the finding; anything wider is co-presence, where folding
   *  would destroy the very thing you are looking at. */
  occurrenceView: 'auto' | 'bipartite' | 'collapsed';

  /** World map behind the graph.
   *
   *  `underlay` paints country outlines into the same canvas, projected with
   *  the same mercator the geo anchor uses — so the map and the nodes cannot
   *  drift apart. `region` adds a place-cluster pane that scopes the query
   *  spatially. `off` is the default, because most graphs have well under 20%
   *  geocodable nodes and a mostly-empty map is a worse frame than none. */
  mapMode: 'off' | 'underlay' | 'region';
  /** Layout anchors — clustering, geography and time as one primitive.
   *  Empty = pure force. See `forcegraph/anchors.ts`. */
  anchors?: AnchorSpec[];

  // Edge display
  edgeColorMode: 'uniform' | 'predicate';
  edgeWidthField: 'auto' | 'none' | string;
  edgeScaleLower: number | null;
  edgeScaleUpper: number | null;

  // Node extras
  showNodeProperties: boolean;

  // Fit
  autoFitOnLoad: boolean;

  // View mode (2D / 3D toggle)
  viewMode: '2d' | '3d';

  // 3D-only
  cameraType: 'perspective' | 'orthographic';
  sphereWidthSegments: number;
  nodeOpacity3D: number;
  linkOpacity3D: number;
}

export const defaultGraphViewConfig: GraphViewConfig = {
  zoomOnNodeClick: true,
  // 1.1 — a gentle bump-on-click that draws the eye without overshooting.
  // 1.2 felt a touch close on busy graphs. The user can still zoom
  // further manually.
  clickZoomScale: 1.1,
  zoomTransitionMs: 300,
  // Stronger default repulsion + longer settle than the legacy SVG renderer.
  // Canvas labels need more whitespace to stay legible vs SVG ``<text>`` which
  // could overflow without anti-aliasing artifacts. Live tuning still happens
  // in the popover.
  chargeStrength: -500,
  linkDistance: 180,
  warmupTicks: 100,
  cooldownTicks: 200,
  forceEngine: 'd3',
  showNodeLabels: true,
  // Anchor labels only by default — top-N highest-degree nodes plus the
  // current selection state. Large graphs read as a clean web with a
  // handful of orientation labels. Toggle ``showAllLabels`` (popover) to
  // render every node's label, sized by degree and faded by zoom in 2D
  // / camera distance in 3D so the dense interior stays legible.
  showAllLabels: false,
  // Edge labels on by default but zoom-gated (see ``edgeLabelMinScale``) so
  // dense regions stay readable while the connections themselves are
  // labelled when you zoom in. Hovered edges and edges incident to the
  // selected node always paint regardless of zoom.
  showEdgeLabels: true,
  labelFontSize: 12,
  showEdgeArrows: true,
  // Icons inside node circles read as "comicy" at the default zoom for
  // densely-connected clusters. Keep the option but make it opt-in — the
  // entity-type color (legend) carries the type signal cleanly enough.
  showNodeIcons: false,
  labelMinScale: 0.4,
  edgeLabelMinScale: 0.8,
  clusterByType: false,
  clusterStrength: 0.3,
  occurrenceView: 'auto',
  mapMode: 'off',
  anchors: [],
  edgeColorMode: 'uniform',
  edgeWidthField: 'auto',
  edgeScaleLower: null,
  edgeScaleUpper: null,
  showNodeProperties: false,
  autoFitOnLoad: true,
  viewMode: '2d',
  cameraType: 'perspective',
  sphereWidthSegments: 12,
  nodeOpacity3D: 0.9,
  // 3D edge opacity. With our ``MeshBasicMaterial`` override (see
  // ForceGraph.tsx) edges paint at full RGB regardless of scene lighting,
  // so this multiplier alone controls how prominent they read. 0.6 keeps
  // them clearly visible against the dark canvas without flattening node
  // labels or edge labels behind them.
  linkOpacity3D: 0.6,
};

// =============================================================================
// Public helpers — used by the popover (edge-field availability detection) and
// by the painter hooks. Kept in this file so the public barrel only re-exports
// stable surface area.
// =============================================================================

const EDGE_PX_MIN = 1;
const EDGE_PX_MAX = 5;

export function detectEdgeFields(edges: GraphEdge[]): string[] {
  if (edges.length === 0) return [];
  const out = new Set<string>();
  for (const edge of edges) {
    if (edge.properties) {
      for (const key of Object.keys(edge.properties)) {
        if (['computed_weight', 'weight', 'confidence', 'date', 'context'].includes(key)) {
          out.add(key);
        }
      }
    }
    if (edge.weight !== undefined) out.add('weight');
    if (edge.confidence !== undefined) out.add('confidence');
    if (edge.date !== undefined) out.add('date');
    if (edge.context !== undefined) out.add('context');
  }
  return Array.from(out);
}

export function getEdgeFieldValue(e: GraphEdge, f: string): number {
  const direct = (e as any)[f];
  if (direct != null && typeof direct === 'number') return direct;
  const fromProps = e.properties?.[f];
  if (fromProps != null && typeof fromProps === 'number') return fromProps;
  return 1;
}

/** Compute { min, max } of a numeric field across edges. */
export function edgeFieldRange(edges: GraphEdge[], field: string): { min: number; max: number } | null {
  if (field === 'none' || edges.length === 0) return null;
  const resolved = field === 'auto'
    ? (detectEdgeFields(edges).includes('weight') ? 'weight'
      : edges.some(e => e.frequency !== undefined) ? 'frequency' : null)
    : field;
  if (!resolved) return null;
  const vals = edges.map(e => getEdgeFieldValue(e, resolved));
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

export function buildEdgeWidthFn(
  edges: GraphEdge[],
  field: GraphViewConfig['edgeWidthField'],
  scaleLower: number | null,
  scaleUpper: number | null,
): (edge: GraphEdge) => number {
  const uniform = (EDGE_PX_MIN + EDGE_PX_MAX) / 2;
  if (field === 'none') return () => uniform;

  if (field === 'auto') {
    const available = detectEdgeFields(edges);
    if (available.includes('computed_weight')) return buildEdgeWidthFn(edges, 'computed_weight', scaleLower, scaleUpper);
    if (available.includes('weight')) return buildEdgeWidthFn(edges, 'weight', scaleLower, scaleUpper);
    if (edges.some(e => e.frequency !== undefined)) return buildEdgeWidthFn(edges, 'frequency', scaleLower, scaleUpper);
    return () => uniform;
  }

  const range = edgeFieldRange(edges, field);
  if (!range || range.min === range.max) return () => uniform;

  const lo = scaleLower ?? range.min;
  const hi = scaleUpper ?? range.max;
  if (lo >= hi) return () => uniform;

  const scale = d3.scaleSqrt().domain([lo, hi]).range([EDGE_PX_MIN, EDGE_PX_MAX]).clamp(true);
  return (edge: GraphEdge) => scale(getEdgeFieldValue(edge, field));
}

export function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of edges) {
    map.set(e.sourceId, (map.get(e.sourceId) ?? 0) + 1);
    map.set(e.targetId, (map.get(e.targetId) ?? 0) + 1);
  }
  return map;
}

/** Node rendered radius based on connection count. Selected nodes render
 * larger (base 20 vs 12) so they're visually salient regardless of degree. */
export function nodeRadius(degree: number, isHighlighted: boolean = false): number {
  const base = isHighlighted ? 20 : 12;
  return Math.max(base, Math.min(30, base + degree * 1.5));
}

/**
 * Radius for a node, from the resolved `WEIGHT:` binding when there is one.
 *
 * **Size is a measure, not a degree count.** Degree is why a hearing with forty
 * participants swallows the scene while the thin shell company on a five-step
 * chain — the entire finding in a concealment case — renders as a speck. It is
 * available and it is deliberately not the default.
 *
 * `size` arrives already normalised to `[0, 1]` with its denominator and scale
 * applied server-side, because those need the whole population: a median or a
 * rank computed over the client's capped top-N is a different number from the
 * same query. Here it only becomes pixels.
 *
 * Mapped through `sqrt` so that **area**, not radius, is proportional to the
 * measure — a circle twice the radius reads as four times the quantity, and
 * every linear-radius chart overstates its largest value by exactly that much.
 */
export function nodeRadiusFor(
  node: GraphNode, degree: number, isHighlighted: boolean = false,
): number {
  if (node.size == null) return nodeRadius(degree, isHighlighted);
  const min = isHighlighted ? 8 : 5;
  const max = isHighlighted ? 34 : 26;
  return min + Math.sqrt(Math.max(0, Math.min(1, node.size))) * (max - min);
}
