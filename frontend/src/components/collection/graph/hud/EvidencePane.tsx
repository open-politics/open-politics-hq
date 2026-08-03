'use client';

/**
 * EvidencePane — the document's own words for what is on screen.
 *
 * Paired with the items pane this answers the two-part question the whole HUD
 * exists for: **what**, and **on what grounds**. Items without evidence is
 * assertion; evidence without items is a pile of quotes.
 *
 * `serves[]` without `justification` is schema-invalid, so for a claimed motive
 * this pane can never legitimately be empty — an empty row here is a bug, not
 * a gap. That is the property that keeps interest analysis on the analysis side
 * of the line rather than the speculation side.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { epistemicStance, type EdgeStance } from '../graphTypes';
import type { HudEvidence } from './hudChannels';

interface Props {
  evidence: HudEvidence[];
  onSelectAbout?: (nodeId: string) => void;
}

/** Stance changes how a quote reads, for the same reason it changes how an
 *  edge paints: a contradiction and a confirmation are different objects, and
 *  rendering them alike asserts something nobody said. */
// Keyed on the SAME vocabulary the canvas paints edges with, so a quote and
// the edge it grounds can never disagree about how the claim was made.
// `unresolved` is the one worth naming: a witness who declines to answer or
// does not recall has made no claim at all, and rendering that like a denial
// invents a position nobody took.
const STANCE_STYLE: Record<EdgeStance, string> = {
  asserted: 'border-l-emerald-500',
  negated: 'border-l-rose-500',
  corrective: 'border-l-amber-500',
  unresolved: 'border-l-muted-foreground/40',
};

export function EvidencePane({ evidence, onSelectAbout }: Props) {
  if (evidence.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        Nothing selected, or nothing in view carries a quote. Select an
        occurrence to read what it rests on.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/40">
      {evidence.map(ev => (
        <li key={ev.id} className="px-2.5 py-2 text-xs">
          <button
            type="button"
            onClick={() => onSelectAbout?.(ev.aboutId)}
            className="mb-1 block max-w-full truncate text-left text-[11px] text-muted-foreground hover:text-foreground"
          >
            {ev.aboutLabel}
          </button>

          {ev.quote && (
            <blockquote
              className={cn(
                'border-l-2 pl-2 italic text-foreground/90',
                ev.stance ? STANCE_STYLE[epistemicStance(ev.stance)] : 'border-l-border',
              )}
            >
              “{ev.quote}”
            </blockquote>
          )}

          {/* Reasoning is the model's account of why, and is shown *under* the
              quote and unquoted — it is not something the document said. */}
          {ev.reasoning && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {ev.reasoning.length > 220
                ? `${ev.reasoning.slice(0, 220)}…`
                : ev.reasoning}
            </p>
          )}

          {(ev.source || ev.locator || ev.stance) && (
            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              {ev.stance && (
                <span className="uppercase tracking-wide">{ev.stance}</span>
              )}
              {ev.source && <span className="truncate">{ev.source}</span>}
              {ev.locator && <span className="tabular-nums">{ev.locator}</span>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
