'use client';

/**
 * RegionPane — place clusters, as a filter.
 *
 * Clicking a place writes `near:"X"<Nkm` into the query. That matters more
 * than it sounds: a spatial gesture becomes **the same kind of thing** as
 * typing a filter, so it scopes the canvas, the item pane and the evidence
 * pane together, survives reload, travels with a shared dashboard, and the
 * companion can produce it. A separate map viewport with its own private
 * state would do none of that.
 *
 * It is a list rather than a second map because the canvas already *is* the
 * map when the underlay is on. What the list adds is a ranking — which places
 * carry the most activity — which a map cannot show without labels nobody can
 * read at overview zoom.
 */
import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { MapPin } from 'lucide-react';
import { placeClusters } from '../forcegraph/useGeoPaint';
import type { RungWeights } from '../forcegraph/anchors';
import type { GraphNode } from '../graphTypes';

interface Props {
  nodes: ReadonlyArray<GraphNode>;
  rungs?: RungWeights;
  timeCursor?: string | null;
  /** The place currently scoped, parsed out of the query so the pane reflects
   *  the filter rather than holding its own idea of what is selected. */
  activePlace?: string | null;
  onScopeToPlace?: (place: string, radiusKm: number) => void;
  maxRows?: number;
}

/** Radii offered. Coarse on purpose — the useful question is "this city" or
 *  "this region", and a slider would imply a precision the geocoding does not
 *  have. */
const RADII = [25, 200, 1000];

export function RegionPane({
  nodes, rungs, timeCursor, activePlace, onScopeToPlace, maxRows = 12,
}: Props) {
  const [radiusKm, setRadiusKm] = useState(200);
  const clusters = useMemo(
    () => placeClusters(nodes, rungs, timeCursor).slice(0, maxRows),
    [nodes, rungs, timeCursor, maxRows],
  );

  if (clusters.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        Nothing geocoded in view. Places resolve from the enricher's cache or
        curated entries — the model is never asked for coordinates.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border/40 px-2 py-1">
        <span className="text-[10px] text-muted-foreground">within</span>
        {RADII.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setRadiusKm(r)}
            className={cn(
              'rounded px-1 text-[10px] tabular-nums',
              r === radiusKm
                ? 'bg-primary/15 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {r}km
          </button>
        ))}
      </div>
      <ul className="divide-y divide-border/40">
        {clusters.map(c => {
          const active = activePlace?.toLowerCase() === c.place.toLowerCase();
          return (
            <li key={c.place}>
              <button
                type="button"
                onClick={() => onScopeToPlace?.(c.place, radiusKm)}
                className={cn(
                  'flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-xs',
                  'hover:bg-muted/60',
                  active && 'bg-muted',
                )}
              >
                <MapPin className={cn('h-3 w-3 shrink-0',
                  active ? 'text-primary' : 'text-muted-foreground')} />
                <span className="truncate">{c.place}</span>
                <span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted-foreground">
                  {c.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
