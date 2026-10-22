/**
 * Declutter — which names fit, and what is under the pointer.
 *
 * Every surface that names nodes — the plane, the map under it, the deck deep
 * in time — has the same problem where the graph is dense: names drawn over
 * names, and nodes drawn over nodes. Two pure answers, in screen space:
 *
 *   declutter   names in order of say — what must show, then what is pinned,
 *               then the loudest — each kept only where it overlaps no name
 *               already kept. Zooming in makes room, so more appear exactly
 *               where there is space for them.
 *   stackAt     every node whose disc is under the pointer, loudest first — a
 *               click on a pile asks which one instead of guessing.
 */

export interface LabelCandidate {
  /** The node. */
  i: number;
  /** Its centre on screen, px. */
  x: number;
  y: number;
  /** Its radius on screen, px — the name starts just right of the dot. */
  r: number;
  /** The name's box, px. */
  w: number;
  h: number;
}

/** A name's width at a font size, px — Inter's average advance, near enough
 *  to keep names from touching without measuring each one. */
export function labelWidth(text: string | undefined, fontPx: number): number {
  return (text?.length ?? 0) * fontPx * 0.56 + 2;
}

/** The candidates whose names fit, in the order given (the order is the say:
 *  earlier wins). `must` are kept wherever they fall and claim their room
 *  first. */
export function declutter(
  candidates: readonly LabelCandidate[], { must, gap = 3, pad = 2 }: { must?: ReadonlySet<number>; gap?: number; pad?: number } = {},
): number[] {
  const CELL = 48;
  const grid = new Map<number, Array<[number, number, number, number]>>();
  const key = (cx: number, cy: number) => cx * 73856093 ^ cy * 19349663;
  const boxOf = (c: LabelCandidate): [number, number, number, number] => {
    const x0 = c.x + c.r + gap;
    return [x0 - pad, c.y - c.h / 2 - pad, x0 + c.w + pad, c.y + c.h / 2 + pad];
  };
  const cells = (b: [number, number, number, number], fn: (k: number) => boolean | void) => {
    for (let cx = Math.floor(b[0] / CELL); cx <= Math.floor(b[2] / CELL); cx++) {
      for (let cy = Math.floor(b[1] / CELL); cy <= Math.floor(b[3] / CELL); cy++) {
        if (fn(key(cx, cy)) === true) return true;
      }
    }
    return false;
  };
  const hits = (b: [number, number, number, number]) => cells(b, (k) =>
    grid.get(k)?.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]));
  const claim = (b: [number, number, number, number]) => cells(b, (k) => {
    const list = grid.get(k);
    if (list) list.push(b); else grid.set(k, [b]);
  });

  const kept: number[] = [];
  const seen = new Set<number>();
  const ordered = must?.size
    ? [...candidates.filter((c) => must.has(c.i)), ...candidates.filter((c) => !must.has(c.i))]
    : candidates;
  for (const c of ordered) {
    if (seen.has(c.i) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    seen.add(c.i);
    const b = boxOf(c);
    if (!must?.has(c.i) && hits(b)) continue;
    claim(b);
    kept.push(c.i);
  }
  return kept;
}

/** The nodes whose discs are under the point (within `slop` px of their
 *  edge), nearest first among equals of say: `rank` orders them (lower
 *  first), ties by distance. */
export function stackAt(
  at: [number, number],
  nodes: ArrayLike<number>,
  screen: (i: number) => [number, number, number] | null,
  rank: (i: number) => number,
  slop = 4,
): number[] {
  const out: Array<{ i: number; d: number; k: number }> = [];
  for (let q = 0; q < nodes.length; q++) {
    const i = nodes[q];
    const p = screen(i);
    if (!p) continue;
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d <= Math.max(p[2], 2) + slop) out.push({ i, d, k: rank(i) });
  }
  return out.sort((a, b) => a.k - b.k || a.d - b.d).map((x) => x.i);
}
