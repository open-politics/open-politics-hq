'use client';

/**
 * PaneLayout — the panes, wherever they are, as data.
 *
 * `GraphHUD` had three hardcoded regions with three hardcoded occupants: an
 * Interests/Observations/Evidence column on the right, a Places rail on the
 * left, a Lanes band at the bottom. Which region a finding went in was decided
 * in the component that rendered it, so a new finding needed a new region or a
 * new tab inside an old one.
 *
 * Here a pane says where it lives and the layout puts it there. Adding one is
 * adding a row to a list; the layout has no opinion about what is in it.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Pane } from './Pane';
import { ResizeHandle } from './ResizeHandle';
import type { QueryWarning } from './QueryBar';
import {
  REGION_DEFAULT,
  type PaneRegion, type PaneSpec, type RegionSize,
  type Surface as SurfaceData, type SurfaceRow,
} from './paneTypes';

export interface PaneLayoutProps {
  panes: PaneSpec[];
  /** Folded surface per pane id. Computed by the panel, which owns the data. */
  surfaces: Record<string, SurfaceData>;
  onUpdatePane: (id: string, next: Partial<PaneSpec>) => void;
  onRemovePane: (id: string) => void;
  /** Opens the Composer for a pane — which datapoints it shows. */
  onComposePane?: (id: string) => void;
  /** The panel's query. A linked pane shows it and forks from it. */
  inheritedQ?: string;
  onAddPane: (region: PaneRegion) => void;
  onPick?: (row: SurfaceRow) => void;
  onPin?: (row: SurfaceRow) => void;
  focusIds?: ReadonlySet<string>;
  warnings?: QueryWarning[];
  onAsk?: (prose: string) => Promise<string>;
  /** Body for `detail` panes — the selected node, rendered whole. */
  detail?: React.ReactNode;
  /** Per-region width (height for `bottom`), in px. Absent ⇒ the defaults.
   *  A width is a reading preference, not a design constant: 300px holds a name
   *  and a count, and the table now wants eight columns. */
  regionSize?: RegionSize;
  /** Live, during a drag — the layout follows the hand, nothing is persisted. */
  onResizeRegion?: (region: PaneRegion, px: number) => void;
  /** On release. A drag is one decision, not sixty writes a second. */
  onCommitRegion?: (region: PaneRegion, px: number) => void;
  /** Body for a `table` pane, by the pane's NAME — which is its section.
   *  A function rather than a node because there may be several tables open at
   *  once and each pane must get its own; a single slot would render the same
   *  section under two headings. */
  tableFor?: (name: string) => React.ReactNode;
  /** Body for a `docs` pane — every table regrouped by document. */
  docs?: React.ReactNode;
}

// Position and direction only. The SIZE is a prop, because it is the reader's.
const REGION_CLASS: Record<PaneRegion, string> = {
  right: 'absolute right-2 top-2 bottom-2 z-10 flex flex-col gap-1.5',
  // `bottom` is set from the bottom strip's actual height — a fixed reserve
  // would be overlapped the moment someone dragged that strip taller.
  left: 'absolute left-2 top-2 z-10 flex flex-col gap-1.5',
  bottom: 'absolute bottom-2 left-2 right-2 z-10 flex flex-row gap-1.5',
};

function Region({
  region, panes, surfaces, onUpdatePane, onRemovePane, onComposePane, inheritedQ, onAddPane,
  onPick, onPin, focusIds, warnings, onAsk, detail, tableFor, docs,
  regionSize, onResizeRegion, onCommitRegion,
}: PaneLayoutProps & { region: PaneRegion }) {
  const mine = panes.filter(p => p.region === region);
  if (mine.length === 0) return null;

  const px = regionSize?.[region] ?? REGION_DEFAULT[region];
  // The left column stops above the bottom strip, when there is one. Reading
  // the strip's real height rather than reserving a constant is what keeps the
  // two from overlapping after a drag.
  const floor = panes.some(p => p.region === 'bottom')
    ? (regionSize?.bottom ?? REGION_DEFAULT.bottom) + 16
    : 8;

  return (
    // `pointer-events-none` on the container, re-enabled per pane, so the gaps
    // between panes stay click-through to the canvas underneath.
    <div
      className={cn(REGION_CLASS[region], 'pointer-events-none')}
      style={region === 'bottom'
        ? { maxHeight: px }
        : { width: px, ...(region === 'left' ? { bottom: floor } : {}) }}
    >
      {onResizeRegion && (
        <ResizeHandle
          region={region}
          size={px}
          onResize={next => onResizeRegion(region, next)}
          onCommit={next => (onCommitRegion ?? onResizeRegion)(region, next)}
        />
      )}
      {mine.map(spec => (
        <Pane
          key={spec.id}
          spec={spec}
          surface={surfaces[spec.id] ?? { kind: 'list', rows: [], keyNames: [] }}
          onUpdate={next => onUpdatePane(spec.id, next)}
          onRemove={() => onRemovePane(spec.id)}
          onCompose={onComposePane ? () => onComposePane(spec.id) : undefined}
          inheritedQ={inheritedQ}
          onPick={onPick}
          onPin={onPin}
          focusIds={focusIds}
          warnings={warnings}
          onAsk={onAsk}
          detail={detail}
          table={tableFor?.(spec.name)}
          docs={docs}
          className={cn(
            region === 'bottom' ? 'min-w-[14rem] flex-1' : 'min-h-0',
            // A collapsed pane is a header, and shrinking it lets the ones
            // still open take the space.
            spec.collapsed ? 'flex-none' : 'flex-1',
          )}
        />
      ))}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onAddPane(region)}
        className="pointer-events-auto h-5 w-5 shrink-0 self-end text-muted-foreground"
        title="Add a pane — name it whatever the question is"
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function PaneLayout(props: PaneLayoutProps) {
  return (
    <>
      <Region {...props} region="left" />
      <Region {...props} region="right" />
      <Region {...props} region="bottom" />
    </>
  );
}
