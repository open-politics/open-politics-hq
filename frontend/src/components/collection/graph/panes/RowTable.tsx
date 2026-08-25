'use client';

/**
 * RowTable — one section's rows, as columns.
 *
 * The surface the panel never had. Every pane before this one folded *nodes*
 * and produced a ranked list, which is a layout problem wearing a table's
 * clothes: `payment ×8` tells you neither who paid whom nor how much nor on
 * whose say-so, because assembly had already shattered the row that said all
 * three. This renders the row.
 *
 * Two rules it exists to hold:
 *
 * * **A multi-valued cell stays one cell.** A payment with two payers is one
 *   payment. Exploding it would multiply the table and make `total` a lie.
 * * **Justification belongs to the row**, so it rides the row and not a
 *   separate rail — which is what retires the evidence pane rather than
 *   fixing it.
 *
 * Selection is shared with the canvas through `nodeId` on every entity cell, so
 * hovering a row lights its participants and clicking a node filters here. No
 * reconciliation code exists because there is nothing to reconcile: one query
 * produced both surfaces.
 */
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { Value } from './Value';
import {
  SELF_COLUMN, refsOf, nodeIdsOf, scalarsOf,
  type RowColumn, type RowItem, type SectionRows,
} from './rowTypes';

export interface RowTableProps {
  rows: SectionRows;
  /** Nodes currently selected on the canvas. A row survives when it touches
   *  one — the table narrows to the selection rather than reordering under it,
   *  because a reader who clicked a node is asking "what did this do", not
   *  "where is this in the list". */
  selectedIds?: ReadonlySet<string>;
  onHoverNodes?: (ids: string[]) => void;
  onSelectNode?: (id: string) => void;
  className?: string;
}

/** One cell. Entity refs become chips that address the canvas; everything else
 *  goes through `<Value>` so the declared axis kind decides the drawing and a
 *  justification is always one gesture away. */
/** Exported so the Composer's exemplar row draws cells with the SAME
 *  renderer the table uses — a preview that differs from the thing it
 *  previews is worse than no preview. */
export function Cell({
  col, raw, item, onSelectNode,
}: {
  col: RowColumn;
  raw: unknown;
  item: RowItem;
  onSelectNode?: (id: string) => void;
}) {
  if (raw == null || raw === '') {
    // An absent value renders as absent, not as "0" or "—". A dash in a metric
    // column reads as a measured zero.
    return <span className="text-muted-foreground/40">·</span>;
  }

  if (col.ref === 'entity') {
    const refs = refsOf(raw);
    if (!refs.length) return <span>{String(raw)}</span>;
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        {refs.map((r, i) => (
          <button
            key={`${r.nodeId ?? r.name}-${i}`}
            type="button"
            disabled={!r.nodeId}
            onClick={() => r.nodeId && onSelectNode?.(r.nodeId)}
            title={r.type ? `${r.name} · ${r.type}` : r.name}
            className={cn(
              'max-w-[16ch] truncate rounded px-1 text-[11px]',
              r.nodeId
                ? 'bg-muted/60 hover:bg-muted cursor-pointer'
                : 'text-muted-foreground/70 cursor-default',
            )}
          >
            {r.name}
          </button>
        ))}
      </span>
    );
  }

  // **An array of scalars is a list, not JSON.** A cell reading
  // `["HBRK Associates Inc.","Unnamed foundation"]` is the wire format leaking
  // onto the screen: the brackets and quotes are noise, and the two values —
  // which are the content — are the hardest part to read.
  if (Array.isArray(raw)) {
    const vals = scalarsOf(raw);
    if (!vals.length) return <span className="text-muted-foreground/40">·</span>;
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        {vals.map((v, i) => (
          <span key={`${v}-${i}`}
                className="max-w-[20ch] truncate rounded bg-muted/50 px-1 text-[11px]">
            {v}
          </span>
        ))}
      </span>
    );
  }

  const j = item.justification;
  return (
    <Value
      value={typeof raw === 'object' ? JSON.stringify(raw) : String(raw)}
      axisKind={col.kind}
      unit={col.unit ?? null}
      provenance={j ? { quote: j.quote, reasoning: j.reasoning } : null}
    />
  );
}

export function RowTable({
  rows, selectedIds, onHoverNodes, onSelectNode, className,
}: RowTableProps) {
  const items = useMemo(() => {
    if (!selectedIds?.size) return rows.items;
    return rows.items.filter(it => nodeIdsOf(it).some(id => selectedIds.has(id)));
  }, [rows.items, selectedIds]);

  if (!rows.columns.length) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        No columns resolved for <code>{rows.section}</code>.
      </p>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {/* S4 — a number states its denominator. "8" alone is not an answer to
          how much of the corpus is on screen. */}
      <div className="flex items-baseline gap-2 border-b px-2 py-1 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground">{rows.section}</span>
        <span className="tabular-nums">
          {items.length === rows.items.length
            ? `${rows.items.length} of ${rows.total}`
            : `${items.length} selected · ${rows.items.length} of ${rows.total}`}
        </span>
      </div>

      {rows.notes.length > 0 && (
        <ul className="space-y-0.5 border-b bg-amber-50/60 px-2 py-1 dark:bg-amber-950/20">
          {rows.notes.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[10px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              {rows.columns.map(c => (
                <th
                  key={c.key}
                  className="border-b px-2 py-1 text-left font-medium"
                  // A column the engine found in the data is marked as such,
                  // because it did not come with the schema's authority.
                  title={c.source === 'shape'
                    ? `${c.label} — found in the data, not declared`
                    : c.label}
                >
                  <span className={cn(c.source === 'shape' && 'text-muted-foreground')}>
                    {c.key === SELF_COLUMN ? c.label : c.label}
                    {c.source === 'shape' && <span className="ml-0.5 opacity-60">?</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr
                key={it.id}
                onMouseEnter={() => onHoverNodes?.(nodeIdsOf(it))}
                onMouseLeave={() => onHoverNodes?.([])}
                className="hover:bg-muted/40"
              >
                {rows.columns.map(c => (
                  <td key={c.key} className="border-b px-2 py-1 align-top">
                    <Cell
                      col={c}
                      raw={it.cells[c.key]}
                      item={it}
                      onSelectNode={onSelectNode}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {items.length === 0 && (
          <p className="p-3 text-[11px] text-muted-foreground">
            {rows.items.length === 0
              ? 'No rows match. The query is doing what it says.'
              : 'Nothing in the selection touches these rows.'}
          </p>
        )}
      </div>
    </div>
  );
}

export default RowTable;
