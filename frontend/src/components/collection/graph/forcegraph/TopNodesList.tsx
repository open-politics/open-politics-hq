'use client';

import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowUpNarrowWide } from 'lucide-react';
import { cn } from '@/lib/utils';
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-6 gap-1 px-1.5 text-[11px]', className)}
          title="Best-connected nodes — click one to fly to it"
        >
          <ArrowUpNarrowWide className="h-3 w-3" />
          Top
          <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
            {topNodes.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {topNodes.map(({ node, deg }) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onNodeClick(node)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px]',
                'text-left transition-colors hover:bg-muted',
              )}
              title={`${node.label} · ${node.type} · degree ${deg}`}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: resolveEntityColor(node.type, colorOverrides) }}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{deg}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
