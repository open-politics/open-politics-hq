// Dashboard grid geometry — the single source of truth for the panel canvas's
// coordinate system.
//
// The geometry lives on ``DashboardConfig.layout``: ``columns`` (horizontal
// subdivisions) and ``rowHeight`` (px per vertical unit). Panel positions
// (``grid_position.{x,y,w,h}``) are expressed in these units.
//
// Older saved dashboards predate the finer grid: they carry ``columns: 12`` and
// no ``rowHeight``. They render at the LEGACY geometry (12 × 150px) so their
// stored layouts don't reflow. New dashboards default to DEFAULT_* — a 2×-finer
// grid (24 × 75px) that gives twice the placement precision on each axis at the
// same visual scale. ``setGridDensity`` rescales a dashboard between the two.
//
// Quick-size and per-type default footprints are expressed as a width FRACTION
// of the grid plus a PIXEL height, so "Medium" or a default chart occupies the
// same on-screen area regardless of the active geometry — the unit counts just
// scale with it.

export const LEGACY_GRID_COLUMNS = 12;
export const LEGACY_ROW_HEIGHT = 150;

export const DEFAULT_GRID_COLUMNS = 24;
export const DEFAULT_ROW_HEIGHT = 75;

export interface GridGeometry {
  columns: number;
  rowHeight: number;
}

/** Resolve the effective geometry from a (possibly legacy/partial) layout. */
export const resolveGridGeometry = (
  layout?: { columns?: number; rowHeight?: number } | null,
): GridGeometry => ({
  columns: layout?.columns && layout.columns > 0 ? layout.columns : LEGACY_GRID_COLUMNS,
  // rowHeight is the newer field; its absence marks a pre-fine-grid dashboard.
  rowHeight: layout?.rowHeight && layout.rowHeight > 0 ? layout.rowHeight : LEGACY_ROW_HEIGHT,
});

export const widthUnits = (frac: number, columns: number): number =>
  Math.max(1, Math.min(columns, Math.round(frac * columns)));

export const heightUnits = (px: number, rowHeight: number): number =>
  Math.max(1, Math.round(px / rowHeight));

// --- Quick sizes (the Panel Layout popover) ---
// Calibrated so they reproduce the historical 4×3 / 6×4 / 8×5 / 12×6 presets
// exactly at the legacy 12 × 150px geometry, and scale cleanly past it.
const SIZE_PRESETS = {
  small: { wFrac: 1 / 3, px: 450 },
  medium: { wFrac: 1 / 2, px: 600 },
  large: { wFrac: 2 / 3, px: 750 },
  full: { wFrac: 1, px: 900 },
} as const;
export type QuickSize = keyof typeof SIZE_PRESETS;

export const quickSize = (size: QuickSize, geo: GridGeometry): { w: number; h: number } => {
  const p = SIZE_PRESETS[size];
  return { w: widthUnits(p.wFrac, geo.columns), h: heightUnits(p.px, geo.rowHeight) };
};

/** Label for a quick-size button, e.g. "Small (8×6)" at the active geometry. */
export const quickSizeLabel = (size: QuickSize, geo: GridGeometry): string => {
  const { w, h } = quickSize(size, geo);
  return `${size[0].toUpperCase()}${size.slice(1)} (${w}×${h})`;
};

// --- Per-type default footprint (addPanel) ---
// Matches the old absolute defaults at the legacy geometry, fraction/px-based
// so a finer grid yields proportionally larger unit counts (same visual size).
const TYPE_DEFAULTS: Record<string, { wFrac: number; px: number }> = {
  table: { wFrac: 1, px: 900 }, // 12×6 legacy
  chart: { wFrac: 2 / 3, px: 750 }, // 8×5
  pie: { wFrac: 1 / 2, px: 600 }, // 6×4
  map: { wFrac: 2 / 3, px: 900 }, // 8×6
  graph: { wFrac: 5 / 6, px: 900 }, // 10×6
};

export const defaultPanelSize = (type: string, geo: GridGeometry): { w: number; h: number } => {
  const d = TYPE_DEFAULTS[type] ?? { wFrac: 1 / 2, px: 600 };
  return { w: widthUnits(d.wFrac, geo.columns), h: heightUnits(d.px, geo.rowHeight) };
};

// --- Automatic legacy → fine-grid upgrade ---
// Mutates a dashboard config in place: if it's still on a coarser geometry than
// the current default, rescale every panel's grid_position to preserve its
// on-screen footprint and stamp the new geometry. Idempotent — a config already
// at (or finer than) the default is left untouched. Runs at load/migration time
// so old dashboards transparently gain the finer grid with no user action.
export const upgradeLayoutGeometry = (config: { layout?: any; panels?: any[] } | null | undefined): void => {
  if (!config) return;
  const from = resolveGridGeometry(config.layout);
  // Already at the default or finer (more columns AND shorter rows) → nothing to do.
  if (from.columns >= DEFAULT_GRID_COLUMNS && from.rowHeight <= DEFAULT_ROW_HEIGHT) return;
  const sx = DEFAULT_GRID_COLUMNS / from.columns;
  const sy = from.rowHeight / DEFAULT_ROW_HEIGHT;
  (config.panels ?? []).forEach((p: any) => {
    const gp = p?.grid_position;
    if (!gp) return;
    gp.x = Math.max(0, Math.min(DEFAULT_GRID_COLUMNS - 1, Math.round((gp.x || 0) * sx)));
    gp.w = Math.max(1, Math.min(DEFAULT_GRID_COLUMNS, Math.round((gp.w || 1) * sx)));
    gp.y = Math.max(0, Math.round((gp.y || 0) * sy));
    gp.h = Math.max(1, Math.round((gp.h || 1) * sy));
  });
  config.layout = { type: 'grid', columns: DEFAULT_GRID_COLUMNS, rowHeight: DEFAULT_ROW_HEIGHT };
};

// --- First-fit packing ---
// Places each {w,h} in array order at the topmost-leftmost free slot. Shared by
// the randomizer and any caller that needs to lay out a fresh set of sizes.
export const packByOrder = (
  items: { w: number; h: number }[],
  columns: number,
): { x: number; y: number }[] => {
  const grid: boolean[][] = [];
  const fits = (x: number, y: number, w: number, h: number): boolean => {
    for (let r = y; r < y + h; r++) {
      if (!grid[r]) grid[r] = new Array(columns).fill(false);
      for (let c = x; c < x + w; c++) {
        if (c >= columns || grid[r][c]) return false;
      }
    }
    return true;
  };
  const mark = (x: number, y: number, w: number, h: number): void => {
    for (let r = y; r < y + h; r++) {
      if (!grid[r]) grid[r] = new Array(columns).fill(false);
      for (let c = x; c < x + w; c++) {
        if (c < columns) grid[r][c] = true;
      }
    }
  };
  return items.map(({ w, h }) => {
    const ww = Math.max(1, Math.min(columns, w));
    const hh = Math.max(1, h);
    for (let y = 0; y < 1000; y++) {
      for (let x = 0; x <= columns - ww; x++) {
        if (fits(x, y, ww, hh)) {
          mark(x, y, ww, hh);
          return { x, y };
        }
      }
    }
    return { x: 0, y: grid.length };
  });
};
