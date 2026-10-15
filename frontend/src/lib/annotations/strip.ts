/**
 * The dashboard strip — panels flowing into columns read left to right,
 * niri-style.
 *
 * Each panel declares two things: its width (`grid_position.w`, a share of
 * the page in grid columns) and its height (`height`, a share of a column,
 * 0–1, unset meaning the whole column). The columns follow from those and the
 * panels' order: a panel joins the column before it when it still fits in the
 * height left, otherwise it starts the next column. A column is as wide as its
 * widest panel. Nothing about the arrangement is stored except the order, so
 * there is nothing to keep consistent.
 *
 * What the user declares is what they get. If the declared heights leave room
 * at the bottom of a column, the room stays — `packStrip` (the Compact action)
 * reorders panels so columns fill, and only when asked. It never changes a
 * width or a height.
 *
 * Order is `grid_position.y`, then `.x`: the field every writer of panels
 * already sets, and that the backend appends by ("below the last panel"), so
 * panels it creates arrive at the end of the strip. `writeOrder` rewrites it
 * canonically after any reordering.
 */

type GridPos = { x: number; y: number; w: number; h: number };
type StripPanel = { id: string; height?: number | null; grid_position: GridPos };

/** The heights offered, as a share of a column. */
export const HEIGHTS = [
  { value: 1, label: 'Full' },
  { value: 3 / 4, label: '¾' },
  { value: 2 / 3, label: '⅔' },
  { value: 1 / 2, label: '½' },
  { value: 1 / 3, label: '⅓' },
  { value: 1 / 4, label: '¼' },
] as const;

/** Rounding slack, so three thirds fill a column rather than overflow it. */
const EPSILON = 1e-3;

/** A panel's share of its column's height. */
export const heightOf = (panel: StripPanel): number =>
  Math.max(0.1, Math.min(1, panel.height ?? 1));

/** Panels in strip order. */
export function stripOrder<P extends StripPanel>(panels: P[]): P[] {
  return [...panels].sort(
    (a, b) => (a.grid_position.y - b.grid_position.y) || (a.grid_position.x - b.grid_position.x),
  );
}

/** The strip's columns in order, each with its panels top to bottom. */
export function stripColumns<P extends StripPanel>(panels: P[]): P[][] {
  const columns: P[][] = [];
  let used = 0;
  for (const panel of stripOrder(panels)) {
    const current = columns[columns.length - 1];
    const h = heightOf(panel);
    if (current && used + h <= 1 + EPSILON) {
      current.push(panel);
      used += h;
    } else {
      columns.push([panel]);
      used = h;
    }
  }
  return columns;
}

/** Write an order back onto the panels: one after another down a single grid
 *  column, so "below the last panel" stays "at the end of the strip". */
export function writeOrder<P extends StripPanel>(ordered: P[]): void {
  let y = 0;
  for (const panel of ordered) {
    const h = Math.max(1, panel.grid_position.h || 1);
    panel.grid_position = { ...panel.grid_position, x: 0, y };
    y += h;
  }
}

/** Move a panel one place earlier (-1) or later (+1) in the strip. */
export function shiftPanel<P extends StripPanel>(ordered: P[], panelId: string, delta: -1 | 1): P[] {
  const i = ordered.findIndex((p) => p.id === panelId);
  const to = i + delta;
  if (i < 0 || to < 0 || to >= ordered.length) return ordered;
  const next = [...ordered];
  [next[i], next[to]] = [next[to], next[i]];
  return next;
}

/** Where a dragged panel goes relative to the one it is dropped on. */
export type StripPlacement = 'before' | 'after' | 'swap';

export function placeInOrder<P extends StripPanel>(
  ordered: P[],
  panelId: string,
  targetId: string,
  where: StripPlacement,
): P[] {
  const from = ordered.findIndex((p) => p.id === panelId);
  const at = ordered.findIndex((p) => p.id === targetId);
  if (from < 0 || at < 0 || from === at) return ordered;
  const next = [...ordered];
  if (where === 'swap') {
    [next[from], next[at]] = [next[at], next[from]];
    return next;
  }
  const [moving] = next.splice(from, 1);
  const target = next.findIndex((p) => p.id === targetId);
  next.splice(where === 'after' ? target + 1 : target, 0, moving);
  return next;
}

/** A column's width: its widest panel's, in grid columns. */
export const columnWidth = (members: StripPanel[]): number =>
  Math.max(...members.map((p) => p.grid_position.w || 1));

/**
 * Reorder so columns fill: Compact. First-fit, taking panels in their current
 * order, so a column is completed by the nearest later panel that fits rather
 * than by whatever packs tightest. Columns then keep the order of their first
 * panel. Widths and heights are the user's and are never touched.
 */
export function packStrip<P extends StripPanel>(panels: P[]): P[] {
  const columns: { panels: P[]; used: number }[] = [];
  for (const panel of stripOrder(panels)) {
    const h = heightOf(panel);
    const open = columns.find((c) => c.used + h <= 1 + EPSILON);
    if (open) {
      open.panels.push(panel);
      open.used += h;
    } else {
      columns.push({ panels: [panel], used: h });
    }
  }
  return columns.flatMap((c) => c.panels);
}
