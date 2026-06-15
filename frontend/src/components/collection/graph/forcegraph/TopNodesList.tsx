'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveEntityColor, type ColorOverrides } from '@/lib/annotations/colors';
import type { GraphNode } from '../graphTypes';

// =============================================================================
// TopNodesList — small horizontal strip of the highest-degree nodes, anchored
// just above the entity-type legend at bottom-center. Acts as a "graph
// minimap" for unfocused exploration: click a chip to fly to that node.
// Disappears whenever a node is focused (the HUD takes over) and can be
// dismissed for the session via the × button.
//
// On narrow panels (``compact``) the inline strip would collide with the
// zoom toolbar and the entity-type legend, so it collapses into a single
// "Top N" popover button — same data, one chip wide. The width signal comes
// from the renderer's ResizeObserver, so the strip adapts to the *panel*
// size, not the viewport.
// =============================================================================

interface TopNodesListProps {
  nodes: GraphNode[];
  degreeMap: Map<string, number>;
  /** When set, the list hides — focused-node HUD takes priority. */
  highlightedNodeId: string | null;
  onNodeClick: (node: GraphNode) => void;
  /** Maximum number of chips to render. Default 10. */
  topN?: number;
  /** Entity-type colour overrides — same source the legend / nodes use. */
  colorOverrides?: ColorOverrides;
  /** External hide signal (e.g. subnet HUD is up). Same semantic as
   *  ``EntityTypeLegend``'s ``hidden`` prop. */
  hidden?: boolean;
  /** Narrow-panel mode — collapse the inline strip into a popover button so
   *  it doesn't compete for the top edge with the zoom toolbar / legend. */
  compact?: boolean;
}

export const TopNodesList: React.FC<TopNodesListProps> = ({
  nodes, degreeMap, highlightedNodeId, onNodeClick, topN = 10, colorOverrides,
  hidden: externallyHidden = false, compact = false,
}) => {
  const [sessionHidden, setSessionHidden] = useState(false);

  const topNodes = useMemo(() => {
    if (nodes.length === 0) return [];
    return [...nodes]
      .map(n => ({ node: n, deg: degreeMap.get(n.id) ?? 0 }))
      .sort((a, b) => b.deg - a.deg)
      .slice(0, topN);
  }, [nodes, degreeMap, topN]);

  if (highlightedNodeId !== null) return null;
  if (externallyHidden) return null;
  if (sessionHidden) return null;
  if (topNodes.length === 0) return null;

  // Shared chip — used inline (horizontal) and inside the compact popover
  // (full-width rows). ``block`` lets the same markup flow either way.
  const chip = (node: GraphNode, deg: number) => {
    const color = resolveEntityColor(node.type, colorOverrides);
    return (
      <button
        key={node.id}
        type="button"
        onClick={() => onNodeClick(node)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]',
          'bg-muted/50 border-transparent hover:bg-muted text-foreground',
          'shrink-0 transition-colors',
          compact && 'w-full',
        )}
        title={`${node.label} · ${node.type} · degree ${deg}`}
      >
        <span
          aria-hidden
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className={cn('font-medium truncate', compact ? 'flex-1 text-left' : 'max-w-[110px]')}>
          {node.label}
        </span>
        <span className="text-muted-foreground tabular-nums">{deg}</span>
      </button>
    );
  };

  if (compact) {
    return (
      <div
        className="absolute top-12 left-1/2 -translate-x-1/2 z-10"
        style={{ pointerEvents: 'auto' }}
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 bg-background/85 backdrop-blur-sm shadow-sm"
            >
              Top {topNodes.length}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="center" side="bottom" className="w-56 p-1">
            <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto scrollbar-hide">
              {topNodes.map(({ node, deg }) => chip(node, deg))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div
      className="absolute top-12 left-1/2 -translate-x-1/2 z-10 max-w-[calc(100%-1rem)] flex items-center gap-1 bg-background/85 backdrop-blur-sm border rounded-md shadow-sm px-2 py-1"
      style={{ pointerEvents: 'auto' }}
    >
      <span className="text-[10px] font-medium text-muted-foreground shrink-0">
        Top {topNodes.length}
      </span>
      <div className="w-px h-3 bg-border shrink-0" />
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
        {topNodes.map(({ node, deg }) => chip(node, deg))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => setSessionHidden(true)}
        title="Hide top nodes"
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
};
