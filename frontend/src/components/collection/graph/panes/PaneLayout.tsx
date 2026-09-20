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
import { HUD_SURFACE, HudButton, HudChip, HudReadout } from '@/components/ui/chrome';
import { useContainerWidth } from '@/hooks/useContainerWidth';
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

/**
 * The narrow presentation: one strip, every pane, region ignored.
 *
 * `REGION_DEFAULT` is 240px of left rail and 300px of right — 540px of chrome
 * absolutely positioned over a canvas that, on a phone, is 390px wide. The
 * bounds in `paneTypes` exist so "a drag cannot make a region unusable or hide
 * the canvas", but they are absolute pixels, so at that width the *defaults*
 * already did both: two rails overlapping each other on top of the graph they
 * were describing.
 *
 * Nothing about a pane changes here. `region` stays what it always was — a
 * property of the pane — and this layout simply has no use for it at a width
 * where there is one place a pane can go. Panes become named chips over the
 * canvas, and opening one gives it the lower half. That is also the honest
 * reading order on a small screen: see the graph, ask one question of it, put
 * the answer away.
 */
function NarrowPanes(props: PaneLayoutProps) {
  const {
    panes, surfaces, onUpdatePane, onRemovePane, onComposePane, inheritedQ,
    onAddPane, onPick, onPin, focusIds, warnings, onAsk, detail, tableFor, docs,
  } = props;

  const [openId, setOpenId] = React.useState<string | null>(null);
  const open = panes.find(p => p.id === openId) ?? null;

  // A pane removed while open would otherwise leave the strip pointing at
  // nothing and the drawer stuck holding a stale spec.
  React.useEffect(() => {
    if (openId && !panes.some(p => p.id === openId)) setOpenId(null);
  }, [panes, openId]);

  if (panes.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-1.5 p-2">
      {open && (
        <div className={cn('pointer-events-auto flex max-h-[45%] min-h-0 flex-col', HUD_SURFACE)}>
          <Pane
            key={open.id}
            spec={open}
            surface={surfaces[open.id] ?? { kind: 'list', rows: [], keyNames: [] }}
            onUpdate={next => onUpdatePane(open.id, next)}
            onRemove={() => onRemovePane(open.id)}
            onCompose={onComposePane ? () => onComposePane(open.id) : undefined}
            inheritedQ={inheritedQ}
            onPick={onPick}
            onPin={onPin}
            focusIds={focusIds}
            warnings={warnings}
            onAsk={onAsk}
            detail={detail}
            table={tableFor?.(open.name)}
            docs={docs}
            className="min-h-0 flex-1 border-0 bg-transparent backdrop-blur-none"
          />
        </div>
      )}

      {/* The strip. Every pane is one chip wide, so the set stays readable at a
          glance and the canvas keeps everything above it. */}
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-1 overflow-x-auto px-1.5 py-1',
          HUD_SURFACE,
        )}
      >
        {panes.map(spec => (
          <HudChip
            key={spec.id}
            active={spec.id === openId}
            onClick={() => setOpenId(id => (id === spec.id ? null : spec.id))}
            title={spec.name}
          >
            <span className="max-w-[8rem] truncate">{spec.name}</span>
            <HudReadout className={spec.id === openId ? 'opacity-70' : undefined}>
              {surfaces[spec.id]?.rows.length ?? 0}
            </HudReadout>
          </HudChip>
        ))}
        <HudButton
          size="sm"
          icon={Plus}
          onClick={() => onAddPane('bottom')}
          title="Add a pane"
          className="ml-auto border-transparent hover:border-transparent"
        />
      </div>
    </div>
  );
}

export function PaneLayout(props: PaneLayoutProps) {
  // Measured on the canvas, not the window: this same panel is embedded in the
  // annotation dashboard, where it can be two grid columns wide on a desktop —
  // which is the narrow case for the same reason a phone is.
  const { ref, width } = useContainerWidth<HTMLDivElement>();

  // Below this, two side rails plus a canvas cannot coexist: `REGION_MIN` alone
  // is 180 + 220, leaving under 250px of graph on a phone.
  const narrow = width !== null && width < 640;

  return (
    // Spans the canvas exactly, so it measures the space the regions are
    // positioned against. `pointer-events-none` keeps the gaps between panes
    // click-through, the same way each region already did.
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {narrow ? (
        <NarrowPanes {...props} />
      ) : (
        <>
          <Region {...props} region="left" />
          <Region {...props} region="right" />
          <Region {...props} region="bottom" />
        </>
      )}
    </div>
  );
}
