/**
 * Channels — what each node and link looks like, as the buffers the GPU reads.
 *
 * Every function here is `Network → Float32Array`, pure, one value (or one
 * RGBA quad) per node or link, in index order. A *layer* is nothing more than
 * a function of this shape: colour by type today; by topic, by time, by
 * community tomorrow — each one more function, composed by the panel, read by
 * whichever renderer is mounted. Nothing here knows about cosmos.
 *
 * The visual decisions are the knowledge-graph panel's, read from the same
 * places so the two panels agree: entity colours from `lib/annotations/colors`,
 * the four kinds of connection from `forcegraph/edgeKinds`.
 */
import { resolveEntityColor, resolvePredicateColor, type ColorOverrides } from '@/lib/annotations/colors';
import { EDGE_TREATMENT, type EdgeKind } from '../forcegraph/edgeKinds';
import type { Network } from './network';

export type Rgba = [number, number, number, number];

/** `#rgb`, `#rrggbb`, `#rrggbbaa` → RGBA in 0..1. Anything else reads as grey,
 *  which is visible and wrong rather than invisible and wrong. */
export function hexToRgba(hex: string, alpha = 1): Rgba {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return [0.6, 0.6, 0.6, alpha];
  const v = (k: number) => parseInt(h.slice(k, k + 2), 16) / 255;
  return [v(0), v(2), v(4), (h.length === 8 ? v(6) : 1) * alpha];
}

/** What the page's theme and the schema's style contribute. */
export interface Palette {
  overrides?: ColorOverrides;
  /** The colour links recede into — the theme's edge stroke. */
  edge: Rgba;
  /** Occurrences: the connective tissue, drawn in the theme's quiet tone. */
  occurrence: Rgba;
}

const OCCURRENCE = 1;

// ─── Points ─────────────────────────────────────────────────────────────────

export function pointColors(net: Network, palette: Palette): Float32Array {
  const out = new Float32Array(net.size * 4);
  const byType = net.types.map((t) => hexToRgba(resolveEntityColor(t || 'unknown', palette.overrides)));
  for (let i = 0; i < net.size; i++) {
    out.set(net.kind[i] === OCCURRENCE ? palette.occurrence : byType[net.type[i]], i * 4);
  }
  return out;
}

/** Twelve hues for groups, in rank order — distinct from each other, and
 *  muted enough that the entity palette's type colours still read as types
 *  when a view switches back. */
export const GROUP_HUES = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948',
  '#b07aa1', '#ff9da7', '#9c755f', '#86bcb6', '#d37295', '#a0cbe8',
];

/** Colour by group: each node in its top-level group's hue, by rank; nodes in
 *  no group in the tissue tone. Ranks past the palette cycle — beyond twelve,
 *  colour stops telling groups apart and the labels do the work. */
export function groupColors(net: Network, rankOf: (i: number) => number, palette: Palette): Float32Array {
  const out = new Float32Array(net.size * 4);
  const hues = GROUP_HUES.map((h) => hexToRgba(h));
  for (let i = 0; i < net.size; i++) {
    const r = rankOf(i);
    out.set(r >= 0 ? hues[r % hues.length] : palette.occurrence, i * 4);
  }
  return out;
}

/** Radius in screen pixels at zoom 1. Logarithmic in frequency — a node
 *  mentioned a thousand times is not a thousand times as important to *see* —
 *  and occurrences stay small whatever their count: they are tissue, and the
 *  eye should land on the nouns. The engine's own size channel, where it
 *  decided one, scales the result. */
export function pointSizes(net: Network): Float32Array {
  const out = new Float32Array(net.size);
  for (let i = 0; i < net.size; i++) {
    if (net.members[i] > 1) {
      // A collapsed group: sized by how many it holds, not how often.
      out[i] = Math.min(8 + 4 * Math.log2(net.members[i]), 48);
      continue;
    }
    const f = Math.log2(1 + net.frequency[i]);
    const base = net.kind[i] === OCCURRENCE ? Math.min(1.5 + 0.6 * f, 5) : Math.min(3 + 1.6 * f, 22);
    const hint = net.sizeHint[i];
    out[i] = Number.isNaN(hint) ? base : base * Math.max(0.5, Math.min(2, hint));
  }
  return out;
}

// ─── Links ──────────────────────────────────────────────────────────────────

const treatment = (net: Network, j: number) =>
  EDGE_TREATMENT[net.linkKinds[net.linkKind[j]] as EdgeKind] ?? EDGE_TREATMENT.relation;

/** Relations carry their predicate's colour; containment, sequence and cast
 *  recede into the theme's edge stroke at their kind's alpha. */
export function linkColors(net: Network, palette: Palette): Float32Array {
  const out = new Float32Array(net.links * 4);
  const byPredicate = net.predicates.map((p) => hexToRgba(resolvePredicateColor(p || 'related', palette.overrides)));
  for (let j = 0; j < net.links; j++) {
    const t = treatment(net, j);
    const isRelation = net.linkKinds[net.linkKind[j]] === 'relation';
    const [r, g, b, a] = isRelation ? byPredicate[net.predicate[j]] : palette.edge;
    out.set([r, g, b, a * t.alpha], j * 4);
  }
  return out;
}

export function linkWidths(net: Network): Float32Array {
  const out = new Float32Array(net.links);
  for (let j = 0; j < net.links; j++) {
    out[j] = treatment(net, j).width * (1 + 0.35 * Math.log2(1 + Math.max(0, net.weight[j] - 1)));
  }
  return out;
}

/** Direction is content only where the kind says so. */
export function linkArrows(net: Network): boolean[] {
  const out = new Array<boolean>(net.links);
  for (let j = 0; j < net.links; j++) out[j] = treatment(net, j).arrow > 0;
  return out;
}

/** Containment pulls its member in — nesting that is only painted is not
 *  nesting. Everything else keeps the simulation's default spring. */
export function linkStrength(net: Network): Float32Array {
  const out = new Float32Array(net.links);
  for (let j = 0; j < net.links; j++) out[j] = 1 + 2 * treatment(net, j).nest;
  return out;
}

// ─── Positions ──────────────────────────────────────────────────────────────

/** A stable pseudo-random in [0, 1) from a string — the same node starts in
 *  the same place on every load, so a reopened graph does not reshuffle. */
function unit(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

/** Where each node starts.
 *
 *  A node the screen has seen before starts where it was (`previous`, keyed by
 *  id): a live run replacing its graph, or a reopened panel, keeps its shape
 *  and only the new nodes settle in. A node standing in for others starts
 *  where they were (`inherit` — see `collapse.inheritFrom`). Anything else
 *  starts beside its first already-placed neighbour; a node with none, on a
 *  disc whose area grows with the graph, at a position derived from its id. */
export function seedPositions(
  net: Network,
  spaceSize: number,
  previous?: ReadonlyMap<string, [number, number]>,
  inherit?: (i: number) => string[][],
): Float32Array {
  const out = new Float32Array(net.size * 2).fill(NaN);
  const c = spaceSize / 2;
  const radius = Math.min(spaceSize * 0.45, 40 * Math.sqrt(net.size + 1));
  const placed = new Uint8Array(net.size);

  if (previous) {
    for (let i = 0; i < net.size; i++) {
      const p = previous.get(net.id[i]);
      if (p) { out[2 * i] = p[0]; out[2 * i + 1] = p[1]; placed[i] = 1; }
    }
  }
  // A node that stands in for others — a group just collapsed, members of a
  // group just opened — starts where they were.
  if (previous && inherit) {
    for (let i = 0; i < net.size; i++) {
      if (placed[i]) continue;
      for (const tier of inherit(i)) {
        let x = 0, y = 0, k = 0;
        for (const id of tier) {
          const p = previous.get(id);
          if (p) { x += p[0]; y += p[1]; k++; }
        }
        if (!k) continue;
        const a = 2 * Math.PI * unit(net.id[i], 4);
        const d = k === 1 ? 4 + 10 * unit(net.id[i], 5) : 0;
        out[2 * i] = x / k + d * Math.cos(a);
        out[2 * i + 1] = y / k + d * Math.sin(a);
        placed[i] = 1;
        break;
      }
    }
  }
  for (let i = 0; i < net.size; i++) {
    if (placed[i]) continue;
    let anchor = -1;
    for (let k = net.adjOffsets[i]; k < net.adjOffsets[i + 1] && anchor < 0; k++) {
      if (placed[net.adjNodes[k]]) anchor = net.adjNodes[k];
    }
    const a = 2 * Math.PI * unit(net.id[i], 1);
    if (anchor >= 0) {
      const d = 8 + 12 * unit(net.id[i], 2);
      out[2 * i] = out[2 * anchor] + d * Math.cos(a);
      out[2 * i + 1] = out[2 * anchor + 1] + d * Math.sin(a);
    } else {
      const r = radius * Math.sqrt(unit(net.id[i], 3));
      out[2 * i] = c + r * Math.cos(a);
      out[2 * i + 1] = c + r * Math.sin(a);
    }
    placed[i] = 1;
  }
  return out;
}

/** Current positions by node id — what `seedPositions` reads back. */
export function positionsById(net: Network, positions: ArrayLike<number>): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (let i = 0; i < net.size; i++) {
    const x = positions[2 * i], y = positions[2 * i + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) out.set(net.id[i], [x, y]);
  }
  return out;
}

// ─── Visibility ─────────────────────────────────────────────────────────────

/** 1 where a node is shown. Hidden types are *absent* — out of the layout and
 *  the picture — not greyed: the legend says "not this", and a ghost that
 *  still pushes its neighbours around is still this. */
export function visibility(net: Network, hiddenTypes: ReadonlySet<string>): Uint8Array {
  const out = new Uint8Array(net.size).fill(1);
  if (!hiddenTypes.size) return out;
  const hidden = net.types.map((t) => hiddenTypes.has(t));
  for (let i = 0; i < net.size; i++) if (hidden[net.type[i]]) out[i] = 0;
  return out;
}
