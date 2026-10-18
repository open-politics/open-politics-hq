/**
 * Gain — turning parts of the network up or down.
 *
 * A reader looking for something in a run's graph wants what they are
 * following to be louder than what the run happens to mention most. Gain says
 * that per *thing*: a type, an entity, a group (a stream, in deep time), a
 * set the reader made (`sets.ts`). Each
 * is a value from −1 (attenuate) through 0 (as is) to +1 (exaggerate), and
 * they compose — in stops, like exposure:
 *
 *   type     every node of the type
 *   group    every node of the top-level group
 *   node     the entity, and its sub-network at a little less: turning up
 *            "Donald Trump" turns up what he is linked to, so with Interest
 *            turned up too, *his* interests come out loudest
 *   set      every member of the set
 *
 * What it does to the picture (`applyGain`): a node turned up grows and keeps
 * its strength; a node turned down shrinks and fades. And once anything is
 * turned up, everything that is not *flattens* — sizes squeeze toward the
 * smallest, colour recedes — so the run's prevalent hubs stop shouting over
 * what the reader asked for. Pure: buffers in, buffers out.
 */
import type { Network } from './network';
import type { View } from './collapse';

export type GainKind = 'type' | 'node' | 'group' | 'set';

export interface Gain {
  kind: GainKind;
  /** A type's name, a node's id, a group's key, a set's id. */
  key: string;
  /** −1 … +1. */
  value: number;
}

/** Stops at full gain: ×4 at +1, ×¼ at −1. */
export const GAIN_STOPS = 2;
/** How much of an entity's gain its neighbours share. */
const SUBNETWORK = 0.6;
/** Once anything is up, how far the rest flatten (0 = not at all). */
const FLATTEN = 0.6;
/** The smallest node the channels draw — what flattening squeezes toward. */
const FLOOR_SIZE = 3;

export const gainKey = (kind: GainKind, key: string) => `${kind}:${key}`;

/** Gains → stops per base node. */
export function gainStops(
  base: Network,
  gains: readonly Gain[],
  groupOf: (i: number) => string | null,
  setMembers?: (id: string) => readonly number[] | undefined,
): Float32Array {
  const out = new Float32Array(base.size);
  const live = gains.filter((g) => g.value !== 0);
  if (!live.length) return out;
  const byType = new Map<string, number>(), byGroup = new Map<string, number>();
  for (const g of live) {
    if (g.kind === 'type') byType.set(g.key, (byType.get(g.key) ?? 0) + g.value * GAIN_STOPS);
    else if (g.kind === 'group') byGroup.set(g.key, (byGroup.get(g.key) ?? 0) + g.value * GAIN_STOPS);
  }
  if (byType.size || byGroup.size) {
    const typeStops = base.types.map((t) => byType.get(t || 'unknown') ?? 0);
    for (let i = 0; i < base.size; i++) {
      out[i] += typeStops[base.type[i]];
      if (byGroup.size) {
        const key = groupOf(i);
        if (key != null) out[i] += byGroup.get(key) ?? 0;
      }
    }
  }
  for (const g of live) {
    if (g.kind === 'set') {
      for (const i of setMembers?.(g.key) ?? []) out[i] += g.value * GAIN_STOPS;
      continue;
    }
    if (g.kind !== 'node') continue;
    const i = base.index.get(g.key);
    if (i === undefined) continue;
    const stops = g.value * GAIN_STOPS;
    out[i] += stops;
    const seen = new Set<number>([i]);
    for (let k = base.adjOffsets[i]; k < base.adjOffsets[i + 1]; k++) {
      const j = base.adjNodes[k];
      if (seen.has(j)) continue;
      seen.add(j);
      out[j] += stops * SUBNETWORK;
    }
  }
  return out;
}

/** Base stops → per drawn unit: a group is as loud as its loudest member. */
export function unitStops(view: View, stops: Float32Array): Float32Array {
  const n = view.net.size;
  const out = new Float32Array(n);
  for (let u = 0; u < n; u++) {
    let best = 0;
    for (let k = view.memberOffsets[u]; k < view.memberOffsets[u + 1]; k++) {
      const v = stops[view.memberIds[k]];
      if (Math.abs(v) > Math.abs(best) || (v > 0 && v === -best)) best = v;
    }
    out[u] = best;
  }
  return out;
}

/** Whether anything is turned up — when the rest flattens. */
export function anyUp(stops: Float32Array): boolean {
  for (let i = 0; i < stops.length; i++) if (stops[i] > 0) return true;
  return false;
}

/** Sizes, node colours and link colours with the gain applied, in place. */
export function applyGain(
  net: Network,
  stops: Float32Array,
  buffers: { sizes: Float32Array; colors: Float32Array; linkColors: Float32Array },
): void {
  const up = anyUp(stops);
  const fade = new Float32Array(net.size);
  for (let i = 0; i < net.size; i++) {
    const g = stops[i];
    let size = buffers.sizes[i];
    if (up && g <= 0) size = FLOOR_SIZE + (size - FLOOR_SIZE) * (1 - FLATTEN);
    buffers.sizes[i] = size * 2 ** (0.5 * g);
    let a = 1;
    if (g < 0) a *= 2 ** (0.9 * g);
    if (up && g <= 0) a *= 0.4;
    fade[i] = a;
    buffers.colors[4 * i + 3] *= a;
  }
  for (let j = 0; j < net.links; j++) {
    buffers.linkColors[4 * j + 3] *= Math.min(fade[net.source[j]], fade[net.target[j]]);
  }
}

/** The loudest units, for names — what the reader turned up is what gets read. */
export function loudest(net: Network, stops: Float32Array, limit = 24): number[] {
  const out: number[] = [];
  for (let i = 0; i < net.size; i++) if (stops[i] > 0) out.push(i);
  return out
    .sort((a, b) => stops[b] - stops[a] || net.frequency[b] - net.frequency[a])
    .slice(0, limit);
}

/** Set one gain, dropping it at 0. */
export function setGain(gains: readonly Gain[], kind: GainKind, key: string, value: number): Gain[] {
  const rest = gains.filter((g) => !(g.kind === kind && g.key === key));
  return Math.abs(value) < 0.02 ? rest : [...rest, { kind, key, value: Math.max(-1, Math.min(1, value)) }];
}
