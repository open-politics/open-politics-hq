'use client';

/**
 * DocsTable — one row per document, and what it actually said.
 *
 * The direction the panel never had. Every other surface goes *graph → source*:
 * you find a node and ask where it came from. This goes **source → graph**: you
 * read a document, see the sections and fields it filled, and light up the part
 * of the canvas it produced.
 *
 * It is a **fold of the row payload**, not a fetch. Every row already carries
 * its `annotationId`, its `assetId` and the node ids it touches, so a document
 * is a `groupBy` and its subgraph is the union of those ids. That also makes it
 * obey `MVP` S3 by construction: the documents listed are the documents behind
 * the rows the current query returned, and it cannot show a document the canvas
 * does not.
 *
 * The consequence, stated because it is a real limit rather than an oversight:
 * **it shows the sections the query asked for.** With `SECTION:observations` a
 * document lists its observations and nothing else. Widen the query to widen
 * the view — which is the same rule every other pane follows, and better than a
 * second fetch whose answer could disagree with the canvas.
 */
import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, Network, Pin } from 'lucide-react';
import { RowTable } from './RowTable';
import { nodeIdsOf, type SectionRows } from './rowTypes';

export interface DocsTableProps {
  /** Every table on the wire. A document spans all of them. */
  tables: ReadonlyArray<SectionRows>;
  /** Asset id → title, so a document reads as itself rather than as a number. */
  titleOf?: (assetId: number) => string | undefined;
  /** Light up everything this document produced. Reuses the asset lens the
   *  canvas already has — the same amber highlight a node badge triggers. */
  onHighlight?: (assetId: number | null) => void;
  /** Which document is lit right now, so the row can show it. */
  highlightedAssetId?: number | null;
  /** Pin the DOCUMENT — one pin, whose subgraph is what its term resolves to.
   *
   *  Deliberately not `(nodeIds, label)`: handing up the ids made the caller
   *  mint a pin per node, so pinning one filing produced eight pins named
   *  after its exhibits. The document is the thing being pinned; the ids are
   *  a highlight hint and nothing more. */
  onPinDoc?: (assetId: number, title: string | undefined, nodeIds: string[]) => void;
  onOpenAsset?: (assetId: number) => void;
  /** Select a node from an entity cell. Threaded so a document's rows behave
   *  like the section tables they are — clicking a payer in a doc and clicking
   *  the same payer in the observations pane must do the same thing. */
  onSelectNode?: (nodeId: string) => void;
  className?: string;
}

interface DocGroup {
  annotationId: number;
  assetId: number | null;
  /** Section name → its rows in this document. */
  bySection: Map<string, { columns: SectionRows['columns']; items: SectionRows['items'] }>;
  nodeIds: Set<string>;
  rowCount: number;
}

/** Rows regrouped by the document that produced them. */
function groupByDocument(tables: ReadonlyArray<SectionRows>): DocGroup[] {
  const byDoc = new Map<number, DocGroup>();
  for (const t of tables) {
    for (const it of t.items) {
      let g = byDoc.get(it.annotationId);
      if (!g) {
        g = {
          annotationId: it.annotationId,
          assetId: it.assetId ?? null,
          bySection: new Map(),
          nodeIds: new Set(),
          rowCount: 0,
        };
        byDoc.set(it.annotationId, g);
      }
      let sec = g.bySection.get(t.section);
      if (!sec) {
        sec = { columns: t.columns, items: [] };
        g.bySection.set(t.section, sec);
      }
      sec.items.push(it);
      g.rowCount += 1;
      for (const id of nodeIdsOf(it)) g.nodeIds.add(id);
    }
  }
  // Most-filled first: a document that said ten things is a better place to
  // start than one that said one, and "first in the corpus" is not an ordering
  // anyone asked for.
  return [...byDoc.values()].sort(
    (a, b) => b.rowCount - a.rowCount || a.annotationId - b.annotationId,
  );
}

export function DocsTable({
  tables, titleOf, onHighlight, highlightedAssetId, onPinDoc, onOpenAsset,
  onSelectNode,
  className,
}: DocsTableProps) {
  const docs = useMemo(() => groupByDocument(tables), [tables]);
  const [open, setOpen] = useState<number | null>(null);

  if (!docs.length) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        No documents in scope. The query is doing what it says.
      </p>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-baseline gap-2 border-b px-2 py-1 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground">documents</span>
        <span className="tabular-nums">
          {docs.length} · {docs.reduce((n, d) => n + d.rowCount, 0)} rows
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {docs.map(d => {
          const lit = d.assetId != null && d.assetId === highlightedAssetId;
          const title = d.assetId != null ? titleOf?.(d.assetId) : undefined;
          const isOpen = open === d.annotationId;
          return (
            <div key={d.annotationId} className={cn('border-b', lit && 'bg-amber-50/50 dark:bg-amber-950/20')}>
              <div className="flex items-center gap-1 px-1 py-1">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : d.annotationId)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  <ChevronRight className={cn(
                    'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                    isOpen && 'rotate-90',
                  )} />
                  <span className="truncate text-[11px]">
                    {title ?? `annotation ${d.annotationId}`}
                  </span>
                </button>
                {/* The counter that used to read 0 on every observation-model
                    run, because the old path re-matched edges by label against
                    `document.triplets`. It counts NODES now — what this
                    document put on the canvas. */}
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {d.nodeIds.size}
                </span>
                <button
                  type="button"
                  title={lit ? 'Clear the highlight' : 'Highlight what this document produced'}
                  onClick={() => onHighlight?.(lit ? null : d.assetId)}
                  disabled={d.assetId == null}
                  className={cn('shrink-0 rounded p-0.5',
                    lit ? 'text-amber-600' : 'text-muted-foreground hover:text-foreground',
                    d.assetId == null && 'opacity-30')}
                >
                  <Network className="h-3 w-3" />
                </button>
                {onPinDoc && d.assetId != null && (
                  <button
                    type="button"
                    title="Pin this document — its subgraph follows"
                    onClick={() => onPinDoc(d.assetId!, title, [...d.nodeIds])}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <Pin className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Collapsed: which sections it filled, and how much. Open: the
                  fields themselves. A document's shape is the first question
                  ("did it say anything about money?") and its content is the
                  second. */}
              <div className="px-2 pb-1 pl-5 text-[10px] leading-relaxed text-muted-foreground">
                {[...d.bySection].map(([name, sec], i) => (
                  <span key={name}>
                    {i > 0 && <span className="opacity-40"> · </span>}
                    {name}
                    <span className="ml-0.5 tabular-nums opacity-60">{sec.items.length}</span>
                  </span>
                ))}
              </div>

              {isOpen && (
                <div className="space-y-2 px-2 pb-2 pl-5">
                  {/* **The section's own table, not a flattened restatement.**
                      This used to render one label/value line per column per
                      row, with every value pushed through a to-text preview —
                      which dropped the entity badges, the node ids behind them
                      and the array chips, so a document's rows read as a wall
                      of strings while the identical rows one pane over read as
                      a table. Same rows, same renderer: `RowTable` is what a
                      section IS, and a document is a grouping of sections. */}
                  {[...d.bySection].map(([name, sec]) => (
                    // `RowTable` renders its own section name and its own
                    // "n of total" — repeating either here would be two
                    // headers disagreeing the moment one of them changes.
                    <div key={name} className="min-w-0 rounded border">
                      <RowTable
                        rows={{
                          section: name,
                          path: '',
                          columns: sec.columns,
                          items: sec.items,
                          total: sec.items.length,
                          notes: [],
                        }}
                        onSelectNode={onSelectNode}
                      />
                    </div>
                  ))}
                  {d.assetId != null && onOpenAsset && (
                    <button
                      type="button"
                      onClick={() => onOpenAsset(d.assetId!)}
                      className="text-[10px] text-muted-foreground underline hover:text-foreground"
                    >
                      open the document
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DocsTable;
