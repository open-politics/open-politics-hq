'use client';

import React, { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowUpNarrowWide } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HUD_SURFACE, HudButton, HudMeter, HudReadout } from '@/components/ui/chrome';
import { resolveEntityColor, type ColorOverrides } from '@/lib/annotations/colors';
import { buildDegreeMap, type GraphEdge, type GraphNode } from '../graphTypes';

// =============================================================================
// TopNodesList — the highest-degree nodes, as a toolbar popover.
//
// This used to be a horizontal strip floating at bottom-centre of the canvas,
// stacked above the entity-type legend. Two problems with that, and they were
// the same problem: **the middle of the canvas is where the graph is.** The
// strip had accumulated a dismiss button, a `hidden` prop, a `highlightedNodeId`
// auto-hide and a `compact` popover variant — four mechanisms whose only job
// was to get it out of the way of the thing it was floating on top of. A
// control that spends most of its code hiding belongs somewhere else.
//
// So it lives in the toolbar now, in the one form it always collapsed to
// anyway. All four mechanisms are gone; the component is what remains.
// =============================================================================

interface TopNodesListProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
  /** Maximum number of rows. Default 10. */
  topN?: number;
  /** Entity-type colour overrides — same source the nodes use. */
  colorOverrides?: ColorOverrides;
  className?: string;
}

export const TopNodesList: React.FC<TopNodesListProps> = ({
  nodes, edges, onNodeClick, topN = 10, colorOverrides, className,
}) => {
  const degreeMap = useMemo(() => buildDegreeMap(edges), [edges]);

  const topNodes = useMemo(() => {
    if (nodes.length === 0) return [];
    return [...nodes]
      .map(n => ({ node: n, deg: degreeMap.get(n.id) ?? 0 }))
      .sort((a, b) => b.deg - a.deg)
      .slice(0, topN);
  }, [nodes, degreeMap, topN]);

  if (topNodes.length === 0) return null;

  // Degree relative to the best-connected node in view. The list was already
  // sorted, so the *order* was visible and the *distances* were not — a run
  // of 40, 39, 38 reads the same as 40, 4, 3 in a column of bare numbers.
  const peak = topNodes[0]?.deg || 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <HudButton
          icon={ArrowUpNarrowWide}
          count={topNodes.length}
          className={className}
          title="Best-connected nodes — click one to fly to it"
        >
          Top
        </HudButton>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(HUD_SURFACE, 'w-64 p-1.5')}>
        <div className="flex max-h-72 flex-col gap-px overflow-y-auto">
          {topNodes.map(({ node, deg }) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onNodeClick(node)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px]',
                'text-left text-hud-fg transition-colors hover:bg-hud-sunken',
              )}
              title={`${node.label} · ${node.type} · degree ${deg}`}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: resolveEntityColor(node.type, colorOverrides) }}
              />
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              <HudMeter value={deg / peak} className="shrink-0" />
              <HudReadout className="w-5 text-right">{deg}</HudReadout>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
