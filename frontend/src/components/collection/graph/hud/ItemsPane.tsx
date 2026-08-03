'use client';

/**
 * ItemsPane — occurrences as readable rows.
 *
 * The canvas answers *where* and *connected to what*; it physically cannot
 * show an act's amount, date, place, participants and quote at once. This is
 * the other half of the same object: an occurrence is a node **and** a row.
 *
 * It is also what makes occurrence volume tolerable. Four hundred payments are
 * unreadable as labelled circles and perfectly readable as four hundred sorted
 * rows — so the canvas collapses them and the list enumerates them.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Quote } from 'lucide-react';
import type { HudItem } from './hudChannels';

interface Props {
  items: HudItem[];
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
  /** Clicking a participant jumps the graph to it — the list driving the
   *  canvas, which is the reverse of the usual direction and the reason to fix
   *  a pane in the first place. */
  onSelectParticipant?: (nodeId: string) => void;
}

/** `2019-03-04` → `2019-03-04`; `2019-03-04T09:00:00Z` → `2019-03-04`. */
function day(iso?: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function interval(t0?: string | null, t1?: string | null): string | null {
  const a = day(t0), b = day(t1);
  if (!a && !b) return null;
  if (a && !b) return a;              // open-ended: an instant, or "from here"
  if (a === b) return a;
  return `${a ?? '?'} → ${b ?? 'now'}`;
}

export function ItemsPane({ items, selectedId, onSelect, onSelectParticipant }: Props) {
  if (items.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        No occurrences in view. Widen the query, or point this pane at a
        different projection.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/40">
      {items.map(({ node, participants, evidenceCount }) => {
        const when = interval(node.t0, node.t1);
        return (
          <li
            key={node.id}
            onClick={() => onSelect?.(node.id)}
            className={cn(
              'cursor-pointer px-2.5 py-1.5 text-xs transition-colors',
              'hover:bg-muted/60',
              selectedId === node.id && 'bg-muted',
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="truncate font-medium text-foreground">{node.label}</span>
              {node.nodeType && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {node.nodeType}
                </span>
              )}
              {node.magnitude != null && (
                // Magnitude is what the document said this was worth. It is not
                // a calibrated measurement, so it never appears without the
                // evidence marker beside it.
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {node.magnitude.toLocaleString()}
                </span>
              )}
              {evidenceCount > 0 && (
                <Quote className="h-3 w-3 shrink-0 text-emerald-600" />
              )}
            </div>

            {(when || node.place) && (
              <div className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                {when && <span className="tabular-nums">{when}</span>}
                {node.place && (
                  <span className="truncate">
                    {node.place}
                    {node.placeTo && ` → ${node.placeTo}`}
                  </span>
                )}
              </div>
            )}

            {participants.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {participants.map(p => (
                  <button
                    key={`${node.id}:${p.id}:${p.role ?? ''}`}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSelectParticipant?.(p.id); }}
                    className="rounded border border-border/60 px-1 py-px text-[10px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  >
                    {p.role && <span className="opacity-60">{p.role}: </span>}
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
