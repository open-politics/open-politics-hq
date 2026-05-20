'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
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
}

export const TopNodesList: React.FC<TopNodesListProps> = ({
  nodes, degreeMap, highlightedNodeId, onNodeClick, topN = 10, colorOverrides,
  hidden: externallyHidden = false,
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
        {topNodes.map(({ node, deg }) => {
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
              )}
              title={`${node.label} · ${node.type} · degree ${deg}`}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium max-w-[110px] truncate">{node.label}</span>
              <span className="text-muted-foreground tabular-nums">{deg}</span>
            </button>
          );
        })}
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
