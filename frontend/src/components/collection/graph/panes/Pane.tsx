'use client';

/**
 * Pane — a name, a link toggle, and a surface.
 *
 * The name is the analyst's and it is load-bearing: it resolves against the
 * preset table for a starting binding and is otherwise just a label. Renaming
 * a pane to `Consignments` does not make it a lesser pane than `Evidence`; the
 * only difference is whether a preset happened to match.
 *
 * **Linked vs unlinked** is the whole interaction. A linked pane re-derives
 * from the panel's query on every commit — *the query proposes, configuration
 * disposes*, and derivation only ever turns panes on, never hides one someone
 * is reading. Unlinking gives the pane its own bar and stops the derivation,
 * with a "relink" affordance that puts it back.
 */
import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  ChevronDown, ChevronRight, Link2, Link2Off, SlidersHorizontal, X,
} from 'lucide-react';
import { HUD_INPUT, HUD_SURFACE, HudButton, HudReadout } from '../chrome';
import { QueryBar, type QueryWarning } from './QueryBar';
import { Surface } from './Surface';
import type { PaneSpec, Surface as SurfaceData, SurfaceRow } from './paneTypes';

export interface PaneProps {
  spec: PaneSpec;
  surface: SurfaceData;
  onUpdate: (next: Partial<PaneSpec>) => void;
  onRemove?: () => void;
  /** Opens the Composer for this pane — which datapoints it shows. */
  onCompose?: () => void;
  /** The panel's query — what a linked pane is following. Shown in this
   *  pane's bar so following is visible rather than implied, and used as the
   *  seed when the pane forks. */
  inheritedQ?: string;
  onPick?: (row: SurfaceRow) => void;
  onPin?: (row: SurfaceRow) => void;
  focusIds?: ReadonlySet<string>;
  warnings?: QueryWarning[];
  onAsk?: (prose: string) => Promise<string>;
  /** Rendered instead of the surface when `spec.kind === 'table'` — one
   *  section's rows, which the server projects and the panel supplies. */
  table?: React.ReactNode;
  /** Rendered instead of the surface when `spec.kind === 'docs'` — the same
   *  rows, regrouped by the document that produced them. */
  docs?: React.ReactNode;
  /** Rendered instead of the surface when `spec.kind === 'detail'`. A detail
   *  pane is the one kind that is not a fold — it is a single selected thing,
   *  rendered whole — so it takes a node rather than rows. */
  detail?: React.ReactNode;
  className?: string;
}

export function Pane({
  spec, surface, onUpdate, onRemove, onCompose, inheritedQ, onPick, onPin, focusIds, warnings, onAsk,
  detail, table, docs, className,
}: PaneProps) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(spec.name);

  const commitName = () => {
    const next = nameDraft.trim();
    setRenaming(false);
    if (next && next !== spec.name) onUpdate({ name: next });
    else setNameDraft(spec.name);
  };

  return (
    <section
      className={cn('pointer-events-auto flex min-h-0 flex-col', HUD_SURFACE, className)}
    >
      {/* The header's actions only exist on hover. A pane sitting over the
          canvas is something you READ; four permanently-lit icons on every
          pane is four times the chrome and none of it is the finding. The
          name, the count and the collapse arrow stay — those are state. */}
      <header className="group/hdr flex shrink-0 items-center gap-1 px-1.5 py-1">
        <HudButton
          size="sm"
          icon={spec.collapsed ? ChevronRight : ChevronDown}
          onClick={() => onUpdate({ collapsed: !spec.collapsed })}
          title={spec.collapsed ? 'Expand' : 'Collapse'}
          className="border-transparent hover:border-transparent"
        />

        {renaming ? (
          <Input
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitName(); }
              if (e.key === 'Escape') { setNameDraft(spec.name); setRenaming(false); }
            }}
            className={cn(HUD_INPUT, 'h-6 flex-1 px-1.5 text-[11px] font-medium')}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setRenaming(true)}
            className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-hud-fg"
            title="Double-click to rename — the name picks the starting binding"
          >
            {spec.name}
          </button>
        )}

        <HudReadout>{surface.rows.length}</HudReadout>

        {/* Unlinked is the one state here worth a colour: the pane has stopped
            following the panel, so what it shows and what the query says can
            now disagree. It stays lit when the others fade. */}
        <HudButton
          size="sm"
          icon={spec.linked ? Link2 : Link2Off}
          tone={spec.linked ? 'neutral' : 'warn'}
          onClick={() => onUpdate(spec.linked
            // Forking inherits what you were reading. Unlinking to an EMPTY
            // bar threw the current view away and made the pane jump, so the
            // gesture cost you your place to gain an edit.
            ? { linked: false, q: spec.q ?? inheritedQ ?? '' }
            : { linked: true, q: undefined })}
          title={spec.linked
            ? 'Following the panel query — click to give this pane its own'
            : 'Independent query — click to follow the panel again'}
          className={cn(
            'border-transparent hover:border-transparent',
            spec.linked && 'opacity-0 transition-opacity focus-visible:opacity-100 group-hover/hdr:opacity-100',
          )}
        />

        {onCompose && (
          <HudButton
            size="sm"
            icon={SlidersHorizontal}
            onClick={onCompose}
            title="Choose datapoints"
            className="border-transparent opacity-0 transition-opacity hover:border-transparent
                       focus-visible:opacity-100 group-hover/hdr:opacity-100"
          />
        )}

        {onRemove && (
          <HudButton
            size="sm"
            icon={X}
            onClick={onRemove}
            title="Remove pane"
            className="border-transparent opacity-0 transition-opacity hover:border-transparent
                       focus-visible:opacity-100 group-hover/hdr:opacity-100"
          />
        )}
      </header>

      {!spec.collapsed && (
        <>
          {/* **The bar is always there, and editing it IS the fork.**
              Hiding it while linked meant the only way to narrow a pane was to
              find the chain-link icon first — and wanting to type a query is
              already the decision that you no longer want to follow. So a
              linked pane shows what it is following, greyed, and the first
              keystroke unlinks it seeded with exactly that. Re-link with the
              icon; the pane's own string is dropped and it follows again. */}
          <div className="shrink-0 px-1.5 pb-1">
            <QueryBar
              dense
              value={spec.linked ? (inheritedQ ?? '') : (spec.q ?? '')}
              onChange={q => onUpdate(spec.linked ? { linked: false, q } : { q })}
              placeholder={spec.linked
                ? 'Following the panel — type to give this pane its own'
                : 'Narrow this pane — type:Event BY place'}
              warnings={spec.linked ? undefined : warnings}
              onAsk={onAsk}
              className={spec.linked ? 'opacity-55' : undefined}
            />
          </div>
          {spec.kind === 'docs' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {docs ?? (
                <p className="px-3 py-4 text-[11px] text-hud-dimmer">
                  No documents in scope.
                </p>
              )}
            </div>
          ) : spec.kind === 'table' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {table ?? (
                <p className="px-3 py-4 text-[11px] text-hud-dimmer">
                  No rows for this query.
                </p>
              )}
            </div>
          ) : spec.kind === 'detail' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {detail ?? (
                <p className="px-3 py-4 text-[11px] text-hud-dimmer">
                  Select a node.
                </p>
              )}
            </div>
          ) : (
            <Surface
              surface={surface}
              focusIds={focusIds}
              onPick={onPick}
              onPin={onPin}
              className="min-h-0 flex-1"
            />
          )}
        </>
      )}
    </section>
  );
}
