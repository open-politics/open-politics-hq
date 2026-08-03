/**
 * The axis budget — how three spatial axes are spent across four frames.
 *
 * This replaces "which field is the graph source", which is not a question an
 * investigator has. A graph has no axes in the sense a bar chart does; what it
 * has is a choice of **frames**, and there are exactly four things that can
 * give a node a position:
 *
 * ```
 *   time      metric, universal — the four-rung ladder guarantees every node one
 *   geo       metric, and the ONLY frame whose coordinates are not our opinion
 *   interest  semantic; position is arbitrary, so it can be SOLVED FOR
 *   event     discretises time into meaningful bins
 * ```
 *
 * Actors are absent from that list on purpose. Actor space has no intrinsic
 * order, so actors can never hold an axis — they are what the axes position.
 *
 * The default is the block: geo on the plane, time up, interest left free. A
 * free interest is not a demoted one — unpinned, it drifts to the weighted
 * centroid of everything serving it, so its position becomes an answer to
 * *where and when is this motive being pursued*. That is the same argument
 * `anchors.ts` already makes for actors ("the force simulation IS the weighted
 * middleground"), one dimension up.
 *
 * All of this resolves onto the anchor primitive, which already handles three
 * dimensions — `AnchorSpec.axis`, `anchorTarget(…, 'z')` and the `forceZ` in
 * `useForcesEffect` were all present and had no way to be switched on, because
 * the only writer of `config.anchors` never emitted `axis`.
 */
import type { AnchorSpec } from './anchors';

export type Frame = 'time' | 'geo' | 'interest' | 'event';

/** Spatial axes each frame costs. Geo is a plane; the rest are a line. */
export const FRAME_COST: Record<Frame, number> = {
  geo: 2, time: 1, interest: 1, event: 1,
};

export const AXIS_BUDGET = 3;

export interface AxisBudget {
  plane: Frame | null;
  up: Frame | null;
  /** Hard-pin the plane rather than pulling toward it — what "verifiable
   *  coordinate" means. A simulation must not out-vote a latitude. */
  pin: boolean;
}

export const defaultAxisBudget: AxisBudget = { plane: 'geo', up: 'time', pin: true };

export const FRAME_LABEL: Record<Frame, string> = {
  time: 'Time', geo: 'Geography', interest: 'Interest', event: 'Event',
};

export const FRAME_HINT: Record<Frame, string> = {
  time: 'Chronology. Every node has one — a row\'s own date, or the document\'s, or the asset\'s.',
  geo: 'The map. The only frame whose coordinates are not our opinion, which is why it pins.',
  interest: 'What acts are for. Position is arbitrary, so leaving it FREE lets the layout solve for it — an interest drifts to the centre of gravity of what serves it.',
  event: 'Named happenings, ordered by `within` and `follows`. Discretises time into steps.',
};

/** Which coverage key answers for a frame. Geo has two: coordinates place a
 *  node on a map, a place NAME still clusters it, and a control that reported
 *  one number would make a usable cluster look like an impossible map. */
export const FRAME_COVERAGE_KEY: Record<Frame, string> = {
  time: 'time', geo: 'geo', interest: 'interest', event: 'event',
};

export function spent(b: AxisBudget): number {
  return ([b.plane, b.up].filter(Boolean) as Frame[])
    .reduce((n, f) => n + (FRAME_COST[f] ?? 1), 0);
}

export function freeFrames(b: AxisBudget): Frame[] {
  const used = new Set([b.plane, b.up].filter(Boolean));
  return (Object.keys(FRAME_COST) as Frame[]).filter(f => !used.has(f));
}

/** Can this frame be moved into this slot without overspending? */
export function canAfford(b: AxisBudget, slot: 'plane' | 'up', frame: Frame): boolean {
  const next = { ...b, [slot]: frame };
  return next.plane !== next.up && spent(next as AxisBudget) <= AXIS_BUDGET;
}

/**
 * The budget, as anchors.
 *
 * One frame → one `AnchorSpec`, and the axis it claims comes from the slot it
 * sits in. The `time` anchor is the only kind that takes an explicit `axis`,
 * which is why the block was unreachable: toggling geo and time in the settings
 * popover produced `{kind:'time'}` with `axis` defaulting to `'x'`, colliding
 * with geo's pin, and the time anchor was silently discarded for every geocoded
 * node.
 */
export function budgetToAnchors(b: AxisBudget, strength = 0.4): AnchorSpec[] {
  const out: AnchorSpec[] = [];

  if (b.plane === 'geo') {
    out.push({ kind: 'geo', pin: b.pin, strength });
  } else if (b.plane === 'interest') {
    // The field view. An affinity anchor over the interest profile — a
    // `{label: weight}` map, which is exactly the vector shape `affinityOf`
    // wants, so clustering needs no new force code.
    out.push({ kind: 'field', strength });
  } else if (b.plane === 'time') {
    out.push({ kind: 'time', axis: 'x', strength });
  }

  if (b.up === 'time') {
    // `z` in 3D is the block; in 2D the renderer installs no z force, so the
    // spec is harmless rather than needing a mode check here.
    out.push({ kind: 'time', axis: 'z', strength });
  } else if (b.up === 'geo') {
    out.push({ kind: 'geo', pin: b.pin, strength });
  } else if (b.up === 'interest') {
    out.push({ kind: 'field', strength });
  }
  // `event` holds no anchor kind of its own yet — an event frame wants a step
  // ordinal, which needs `within`/`follows` walked into a rank. Declaring it
  // spends the axis and positions nothing, so it is refused by the control
  // rather than silently doing nothing here.

  return out;
}

/** Named camera positions — the 2D views are projections of one arrangement,
 *  not separate visualisations, which is why they cannot disagree. */
export const CAMERAS = [
  { id: 'map', label: 'Map', hint: 'Look down the time axis — geography alone.',
    budget: { plane: 'geo', up: null, pin: true } as AxisBudget, view: '2d' as const },
  { id: 'timeline', label: 'Timeline', hint: 'Look along a geo axis — when, not where.',
    budget: { plane: 'time', up: null, pin: false } as AxisBudget, view: '2d' as const },
  { id: 'field', label: 'Field', hint: 'Position is similarity. Where convergence without contact becomes visible.',
    budget: { plane: 'interest', up: null, pin: false } as AxisBudget, view: '2d' as const },
  { id: 'block', label: 'Block', hint: 'Geography on the floor, time rising. The default.',
    budget: { plane: 'geo', up: 'time', pin: true } as AxisBudget, view: '3d' as const },
] as const;
