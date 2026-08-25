/**
 * The rows behind the picture — the wire shape.
 *
 * Mirrors `backend/app/api/modules/graph/rows.py::SectionRows`. One section's
 * actual records, projected, arriving alongside `nodes`/`edges` from the same
 * query. The canvas is for layout; this is for reading.
 *
 * The property that makes it worth its own payload: **entity cells carry the
 * node id the assembler minted**, so a click in either surface selects in both
 * and neither has to know the other's shape. Without it, a table beside a graph
 * is two views of one dataset that cannot refer to each other — which is what
 * every folded-node pane in this panel has been.
 *
 * See `docs/plans/observation-model/MVP.md` §4.
 */
import type { AxisKind } from './Value';

/** An entity reference inside a cell — the foreign key, resolved. */
export interface RowRef {
  name: string;
  type?: string;
  /** The assembler's id for this entity. Present whenever the name resolved,
   *  absent when the row named something the graph did not mint. */
  nodeId?: string;
}

export interface RowColumn {
  key: string;
  label: string;
  /** The declared axis kind, so the renderer never guesses. */
  kind: AxisKind;
  /** `"entity"` when this column's cells hold `RowRef`s. */
  ref?: 'entity';
  unit?: string;
  /** The entity type this column's values are, when the role declared one. A
   *  bare string in an entity slot needs it to mint a node id. */
  entityType?: string;
  /** `declared` came from the contract; `shape` was found in the data. Shown
   *  differently, because a column the engine guessed and a column the schema
   *  stated must not look equally authoritative. */
  source: 'declared' | 'shape';
  /** How many rows of the SECTION fill this column — counted server-side over
   *  the whole section, against `SectionRows.total`, not the loaded page. The
   *  fields worth warning someone about are the rare ones, and a page-scoped
   *  count reports exactly those as empty. Absent when no census ran; `0` is a
   *  finding ("declared, never filled"), absence is a shrug. */
  filled?: number;
  /** A few real values, from anywhere in the section. What lets the exemplar
   *  row show a field the loaded page happens not to fill. */
  examples?: string[];
}

export interface RowItem {
  /** `"<annotationId>:<section>:<ord>"` — stable across refetches. */
  id: string;
  annotationId: number;
  assetId?: number | null;
  cells: Record<string, unknown>;
  /** The node this row MINTED, when it minted one — the act itself.
   *
   *  Without it a row could only be reached through its cast, so selecting a
   *  payment on the canvas matched no row and the table emptied with "Nothing
   *  in the selection touches these rows". The row IS the act; not linking it
   *  to its own node was the one link the two-surface design turns on. */
  nodeId?: string | null;
  /** The row's grounds. Belongs to the ROW, which is the whole reason this
   *  payload exists: hanging justification on nodes is what produced an
   *  evidence pane that ranked node labels by a value of 1. */
  justification?: { reasoning?: string | null; quote?: string | null } | null;
}

export interface SectionRows {
  section: string;
  path: string;
  columns: RowColumn[];
  items: RowItem[];
  /** Counted under the same predicate and **independent of the node cap** — a
   *  table that inherited the canvas's truncation would report "8 payments" for
   *  a run holding two hundred, and be believed. */
  total: number;
  cursorNext?: string | null;
  /** Anything the reader must know to trust the numbers. Rendered, always. */
  notes: string[];
}

/** The column key a roster row's own entity sits under. */
export const SELF_COLUMN = '@self';

/** Entity references in a cell, however many. A cell is never exploded into
 *  rows — a payment with two payers is one payment — so this is the one place
 *  that flattens for display. */
export function refsOf(v: unknown): RowRef[] {
  if (Array.isArray(v)) return v.flatMap(refsOf);
  if (v && typeof v === 'object' && 'name' in (v as any)) return [v as RowRef];
  return [];
}

/** Every node id a row touches — its participants **and its own node**.
 *
 *  The row's own id was the missing one. A row IS an act, so selecting that act
 *  on the canvas has to reach it; without `item.nodeId` a row could only be
 *  found through its cast, and clicking a payment emptied the table with
 *  "Nothing in the selection touches these rows". */
export function nodeIdsOf(item: RowItem): string[] {
  const out = Object.values(item.cells)
    .flatMap(refsOf)
    .map(r => r.nodeId)
    .filter((id): id is string => !!id);
  return item.nodeId ? [item.nodeId, ...out] : out;
}

/** Scalars in a cell that are not entity references — keywords, tags, codes.
 *  Rendered as chips, because `["a","b"]` on screen is the JSON leaking. */
export function scalarsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(scalarsOf);
  if (v == null || v === '') return [];
  if (typeof v === 'object') return [];
  return [String(v)];
}
