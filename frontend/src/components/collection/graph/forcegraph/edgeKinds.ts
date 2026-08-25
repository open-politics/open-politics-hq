/**
 * edgeKinds — four kinds of connection, four treatments.
 *
 * `FAULTS` F2: containment, sequence, cast and relation all painted as one grey
 * line. That is the direct cause of *"no hierarchy, still random nodes
 * everywhere"* — and the numbers say why. On run 15010, of 192 edges:
 *
 * ```
 *   role      136   the CAST of an act — who was in it
 *   contains   35   part_of · within · during
 *   relation   14   owns · works_for · controls · furthers
 *   follows     7   the chain
 * ```
 *
 * Seventy-one percent of the edges were connective tissue drawn at the weight
 * of a finding, and the thirty-five that said *this is inside that* were drawn
 * as adjacency, so nothing could nest. No force-tuning fixes either: they are
 * three different statements rendered as one.
 *
 * What each becomes, and why:
 *
 * ```
 *   contains   enclosure, never an arrow      B is INSIDE A. A line between them
 *                                             asserts they are beside each other,
 *                                             which is the opposite of the claim.
 *                                             Also a LAYOUT pull — nesting that is
 *                                             only painted is not nesting.
 *   follows    a tapered arrow                direction is the whole content
 *   role       thin, receding, no arrowhead   tissue. Present, checkable, quiet.
 *   relation   the primary line               weight, arrow, predicate colour
 * ```
 *
 * The classification is server-side (`sections.EDGE_KINDS`) because it needs
 * the projection that minted the edge. This module decides only how each is
 * drawn, which is layout and belongs here.
 */
import type { GraphEdge } from '../graphTypes';

export type EdgeKind = 'contains' | 'follows' | 'role' | 'relation';

export interface EdgeTreatment {
  /** Multiplier on the configured edge width. */
  width: number;
  /** Multiplier on edge alpha. Below 1 the edge recedes. */
  alpha: number;
  /** Arrowhead length in px. 0 means none. */
  arrow: number;
  /** Dash pattern, or null for solid. */
  dash: number[] | null;
  /** Bow, so parallel edges of different kinds do not overlap into one mark. */
  curvature: number;
  /** Pull toward the far endpoint, for the layout. 0 leaves the link force
   *  alone; 1 means "sit inside it". */
  nest: number;
}

/**
 * The table. Written as data because it is a set of visual decisions that will
 * be argued with, and an argument you can have against a table is cheaper than
 * one you have to have against four branches in a painter.
 */
export const EDGE_TREATMENT: Record<EdgeKind, EdgeTreatment> = {
  // Enclosure. Drawn as a short, wide, very faint band rather than a line —
  // it reads as a membrane, not a connection — and it is the only kind that
  // moves the layout, because containment that is only painted is decoration.
  contains: { width: 3.5, alpha: 0.12, arrow: 0, dash: null, curvature: 0, nest: 0.9 },
  // Direction is the whole content of a sequence, so it gets the biggest
  // arrowhead and a solid stroke, and it never bows — a chain that curves
  // reads as two chains.
  follows: { width: 1.4, alpha: 0.95, arrow: 9, dash: null, curvature: 0, nest: 0 },
  // Tissue. Thin, quiet, no arrowhead: an act's cast is not a claim about
  // direction between two entities, and drawing one there invents a
  // relationship the row never asserted.
  role: { width: 0.5, alpha: 0.28, arrow: 0, dash: null, curvature: 0.06, nest: 0 },
  // The findings. Full weight, arrow, predicate colour.
  relation: { width: 1.6, alpha: 1, arrow: 6, dash: null, curvature: 0.12, nest: 0 },
};

const FALLBACK = EDGE_TREATMENT.relation;

/** How to draw this edge. Unknown or absent kind reads as `relation`, which is
 *  the honest default: it asserts least about how to draw it, and it is what
 *  every edge looked like before this existed. */
export function treatmentFor(edge: Pick<GraphEdge, 'kind'> | null | undefined): EdgeTreatment {
  const k = (edge?.kind ?? '') as EdgeKind;
  return EDGE_TREATMENT[k] ?? FALLBACK;
}

export function isKind(edge: Pick<GraphEdge, 'kind'> | null | undefined, k: EdgeKind): boolean {
  return (edge?.kind ?? 'relation') === k;
}
