/**
 * The overview stream's wire shapes — mirrors `annotation/overview.py` and
 * `routes/overview.py`. Hand-written rather than generated: the stream is SSE,
 * and its events carry packed tuples the OpenAPI generator cannot describe.
 */

export type BindingSource = 'picked' | 'declared' | 'structural' | 'discovered' | 'none';

export interface Binding {
  path: string | null;
  source: BindingSource;
}

export interface SectionPlan {
  /** `<schema_id>:<path>` or `<schema_id>:@document` — what picks are keyed by. */
  key: string;
  schema_id: number;
  path: string | null;
  label: string;
  kind: 'section' | 'document';
  frame: string | null;
  time: Binding;
  place: Binding;
  time_candidates: string[];
  place_candidates: string[];
}

export interface SchemaPlanWire {
  id: number;
  name: string;
  /** No sections: the document is the only row there is. */
  flat: boolean;
  sections: SectionPlan[];
  /** path → [hits, sampled] — why a field was or was not taken as a place. */
  discovery: Record<string, [number, number]>;
}

export interface OverviewFrame {
  run: { id: number; status: string; live: boolean; progress: [number, number] };
  totals: { annotations: number; failed: number; assets: number };
  watermark: number;
  basis: string;
}

export interface OverviewPlan {
  schemas: SchemaPlanWire[];
}

/** 0 = the row's own place, 1 = only its document's. Never drawn alike. */
export type Rung = 0 | 1;

/** Every placed-but-not-located bucket points here instead of a place index. */
export const UNLOCATED = -2;

export interface OverviewBuckets {
  grain: 'day' | 'week' | 'month' | 'quarter' | 'year';
  extent: [string | null, string | null];
  placed_assets: number;
  sections: Array<{ key: string; rows: number; placed: number; dated: number }>;
  /** Time cells, ISO; buckets index into this. -1 = undated. */
  cells: string[];
  /** Located places, columnar — the shape a GPU layer wants. */
  places: {
    id: string[]; name: string[]; lat: number[]; lon: number[];
    entry: Array<number | null>; geo: boolean[]; rows: number[]; assets: number[];
  };
  /** place index → the spellings that folded into it (only where > 1). */
  spellings: Record<string, string[]>;
  unlocated: {
    total: number;
    items: Array<{ id: string; name: string; entry: number | null; geo: boolean; rows: number; assets: number }>;
  };
  /** [section, rung, place, cell, rows] */
  rows: Array<[number, Rung, number, number, number]>;
  rows_truncated: number;
  /** [section, cell, rows] — every row, placed or not. */
  hist: Array<[number, number, number]>;
  /** [rung, place, asset cell, assets] */
  assets: Array<[Rung, number, number, number]>;
  /** [asset cell, assets] */
  asset_time: Array<[number, number]>;
}

export interface OverviewEntity {
  id: string;
  name: string;
  type: string | null;
  entry_id: number | null;
  mentions: number;
  assets: number;
  spellings?: string[];
}

export interface OverviewEntities {
  items: OverviewEntity[];
  total: number;
}

/** A reader's override for one section; a key that is present wins. */
export interface BindingPick {
  time?: string | null;
  place?: string | null;
}

export type OverviewMode = 'assets' | 'rows' | 'sections';
