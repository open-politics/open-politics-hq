/**
 * Light — what the reader keeps lit: a node, a group, a type or a set, with
 * everything it links to directly.
 *
 * A selection highlights one thing at a time and opens its documents. Light
 * is the other gesture: switched on beside a row's gain, for as many things as
 * the reader wants, and it stays — Trump's links and Putin's at once, and the
 * nodes that light up twice are the ones between them. Everything unlit greys
 * out, in whichever view is showing.
 *
 * Light is read through the network underneath, then drawn: a node inside a
 * folded group lights its group, and only the links that carry one of its own.
 */
import type { View } from './collapse';

export type LightKind = 'node' | 'group' | 'type' | 'set';

export interface Light {
  kind: LightKind;
  key: string;
}

export interface Lit {
  /** Drawn units: the lit things themselves. */
  seeds: number[];
  /** Drawn units: the lit things and what they link to. */
  points: number[];
  /** Drawn links: between a lit thing and what it links to. */
  links: number[];
}

/** One lit thing, from its base nodes. */
export function lightOf(view: View, base: Iterable<number>): Lit {
  const { net, base: under, unitOf } = view;
  const seedUnits = new Set<number>();
  const nearUnits = new Set<number>();
  for (const i of base) {
    seedUnits.add(unitOf[i]);
    for (let k = under.adjOffsets[i]; k < under.adjOffsets[i + 1]; k++) nearUnits.add(unitOf[under.adjNodes[k]]);
  }
  const links: number[] = [];
  const points = new Set(seedUnits);
  for (const u of seedUnits) {
    for (let k = net.adjOffsets[u]; k < net.adjOffsets[u + 1]; k++) {
      const v = net.adjNodes[k];
      if (!nearUnits.has(v)) continue;
      links.push(net.adjLinks[k]);
      points.add(v);
    }
  }
  return { seeds: [...seedUnits], points: [...points], links: [...new Set(links)] };
}

/** Several highlights as one. */
export function joinLight(parts: ReadonlyArray<{ points: readonly number[]; links: readonly number[] } | null | undefined>):
  { points: number[]; links: number[] } | null {
  const live = parts.filter((p): p is NonNullable<typeof p> => !!p);
  if (!live.length) return null;
  if (live.length === 1) return { points: [...live[0].points], links: [...live[0].links] };
  const points = new Set<number>(), links = new Set<number>();
  for (const p of live) { p.points.forEach((i) => points.add(i)); p.links.forEach((j) => links.add(j)); }
  return { points: [...points], links: [...links] };
}

/** Switch one thing's light. */
export function toggleLight(lights: readonly Light[], kind: LightKind, key: string): Light[] {
  return lights.some((l) => l.kind === kind && l.key === key)
    ? lights.filter((l) => !(l.kind === kind && l.key === key))
    : [...lights, { kind, key }];
}
