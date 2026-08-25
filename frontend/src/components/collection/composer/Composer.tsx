'use client';

/**
 * Composer — a visual query writer.
 *
 * It answers "which datapoints am I looking at here?", and the answer it
 * produces is **a query**. That is the whole design: everything the composer
 * can do is expressible in the bar, and the bar is shown at the bottom while
 * you work, so the surface teaches the language instead of hiding it. Anything
 * reachable by clicking stays expressible as a query (`MVP` S7) by
 * construction rather than by discipline.
 *
 * The picker is **one exemplar row**, drawn by the surface's own renderer — see
 * `ExemplarRow`. A field list asks you to imagine the result; a row shows it.
 *
 * **The grain is not chosen here.** The surface you opened it from decides:
 * the observations pane composes observations, a schema's column header
 * composes that schema. An earlier version let you switch section from inside,
 * which rewrote the panel's `SECTION:` and blanked every other pane — the same
 * conflation of *what is in scope* with *what am I looking at* that this whole
 * separation exists to remove. Adding a pane is how you look at something else.
 *
 * **Storage-agnostic on purpose.** It takes a `ComposerModel` and hands one
 * back; the caller adapts to `SHOW:`/`SECTION:` or to `panel_config.columns`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Search, X } from 'lucide-react';
import { ExemplarRow } from './ExemplarRow';
import {
  fieldsOfGrain, reorder, toggleField,
  type ComposerField, type ComposerModel,
} from './composerModel';

export interface ComposerProps {
  open: boolean;
  onClose: () => void;
  model: ComposerModel;
  onChange: (next: ComposerModel) => void;
  /** Shown top-left — which surface this is configuring. */
  title?: string;
  /** Floor on the selection. Set to 1 where the surface's storage cannot
   *  express "show none" — the table's `columns: []` means *show all*, so an
   *  empty list there silently turns everything back on. */
  minSelected?: number;
  /** The query a selection amounts to, rendered at the foot and recomputed as
   *  you edit. A function rather than a string because it must follow the
   *  DRAFT — a frozen preview of the committed state would be showing you the
   *  query you already had. The caller supplies it: only it knows its dialect. */
  queryPreview?: (model: ComposerModel) => string;
  /** How one value draws. The surface passes its OWN cell renderer, which is
   *  what makes the exemplar row a preview rather than an approximation. */
  renderCell: (field: ComposerField, value: unknown) => React.ReactNode;
  /** The surface's own whole-row rendering, given the current selection and a
   *  toggle. Use where the surface does NOT lay a row out as one column per
   *  field — the table groups a schema into a single three-section cell.
   *
   *  `toggle` is handed down rather than reached for, because it must act on
   *  the composer's DRAFT: a surface calling the committed `onChange` would
   *  write through and move the view behind the overlay. */
  renderExemplar?: (
    selected: string[],
    toggle: (id: string) => void,
  ) => React.ReactNode;
}

export function Composer({
  open, onClose, model, onChange, title,
  minSelected = 0, queryPreview, renderCell, renderExemplar,
}: ComposerProps) {
  const [search, setSearch] = useState('');

  // **Edits are buffered until Done.** Writing straight through re-rendered and
  // re-fetched the surface underneath on every toggle — work you cannot see,
  // because the overlay is covering it, and a save per click besides. The
  // exemplar row is the preview; the thing behind the blur is not.
  const [draft, setDraft] = useState(model);
  useEffect(() => { if (open) setDraft(model); }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => { onChange(draft); onClose(); };

  useEffect(() => {
    if (!open) return;
    // Escape ABANDONS — the draft is dropped and the surface never moved.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const all = useMemo(() => fieldsOfGrain(draft), [draft]);
  const atFloor = draft.selected.length <= minSelected;

  // One gate for both directions, so the floor cannot be enforced in the row
  // and forgotten in the hidden-chips rail.
  const toggle = (id: string) => {
    if (atFloor && draft.selected.includes(id)) return;
    setDraft(d => toggleField(d, id));
  };

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () => (q
      ? all.filter(f => f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
      : all),
    [all, q],
  );

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-background/60 backdrop-blur-md"
      onMouseDown={e => { if (e.target === e.currentTarget) commit(); }}
    >
      <div className="flex max-h-[80vh] w-[min(1100px,92vw)] flex-col overflow-hidden rounded-xl border bg-background/95 shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-medium">{title ?? 'Datapoints'}</span>
          <span className="text-xs text-muted-foreground">
            {draft.selected.length} of {all.length}
          </span>
          <div className="relative ml-auto w-52">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a field…"
              className="h-7 pl-7 text-xs"
            />
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            One row, filled from across the loaded data — <em>not</em> a single
            record. It shows what a result looks like with these datapoints.
          </p>
          <ExemplarRow
            fields={shown}
            selected={draft.selected.filter(id => shown.some(f => f.id === id))}
            onToggle={toggle}
            onReorder={(from, to) => setDraft(d => reorder(d, from, to))}
            renderCell={renderCell}
            atFloor={atFloor}
            preview={renderExemplar?.(draft.selected, toggle)}
          />
        </div>

        {/* ── What this amounts to. The composer writes a query; showing it is
               what keeps the bar and this surface the same instrument. ── */}
        <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
          {queryPreview && (
            <>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                Query
              </span>
              <code className={cn(
                'min-w-0 flex-1 truncate rounded bg-background/70 px-2 py-1 font-mono text-[11px]',
                !queryPreview(draft) && 'italic text-muted-foreground',
              )}>
                {queryPreview(draft) || '(everything — no clause needed)'}
              </code>
            </>
          )}
          <Button size="sm" className="ml-auto h-7 shrink-0 text-xs" onClick={commit}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
