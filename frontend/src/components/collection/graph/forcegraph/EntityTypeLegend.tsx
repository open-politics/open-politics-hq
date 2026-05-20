'use client';

import React from 'react';

// =============================================================================
// EntityTypeLegend — minimal horizontal bar at the canvas bottom listing entity
// types present in the graph as colour-dot pills. Clicking a pill toggles
// visibility (writes through to ``hiddenEntityTypes`` Set).
//
// Hidden when a node detail HUD is active — the HUD's connection rows occupy
// the same bottom strip and the legend would otherwise overlap them.
// =============================================================================

export interface EntityTypeLegendEntry {
  type: string;
  color: string;
  count: number;
}

interface EntityTypeLegendProps {
  entries: EntityTypeLegendEntry[];
  hiddenTypes: Set<string>;
  onToggle?: (type: string) => void;
  /** When the node detail HUD is showing, the legend hides to avoid colliding
   *  with the bottom connections strip. Caller passes the same flag it uses
   *  to render the HUD. */
  hidden?: boolean;
}

export const EntityTypeLegend: React.FC<EntityTypeLegendProps> = ({
  entries, hiddenTypes, onToggle, hidden = false,
}) => {
  if (entries.length === 0 || hidden) return null;

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 top-2 z-10 max-w-[calc(100%-1rem)]"
      style={{ pointerEvents: 'none' }}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-background/85 backdrop-blur-sm border shadow-sm overflow-x-auto"
        style={{ pointerEvents: 'auto' }}
      >
        {entries.map(({ type, color, count }) => {
          const isHidden = hiddenTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap transition-opacity hover:bg-accent/40 ${isHidden ? 'opacity-40' : ''}`}
              onClick={() => onToggle?.(type)}
              title={isHidden ? `Show ${type}` : `Hide ${type}`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: isHidden ? 'var(--graph-edge-stroke)' : color }}
              />
              <span className={isHidden ? 'line-through' : ''}>{type}</span>
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
