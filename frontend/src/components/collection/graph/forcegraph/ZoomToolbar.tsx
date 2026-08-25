'use client';

import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Shuffle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudButton, HudGroup, HudReadout } from '../chrome';
import { defaultGraphViewConfig, type GraphViewConfig } from '../graphTypes';

// =============================================================================
// ZoomToolbar — bottom-left floating toolbar for canvas zoom controls. Wired
// to the ForceGraph imperative handle so 2D and 3D both work; in 3D, zoomIn /
// zoomOut are no-ops (camera-distance-based zoom is non-trivial via the same
// interface) but Fit and Reset still work.
//
// Also hosts the two view-mutating preset buttons that need to live above the
// canvas (always visible, not buried in the settings popover):
//   - Rich detail: flip on every label, color edges by predicate, bump 3D
//     quality dials. Toggling once turns it on; toggling again reverts the
//     same fields back to their defaults — so it behaves like a stateful
//     toggle, not a one-shot apply. Rendered as a ``Sparkles`` icon (filled
//     amber when active) — the "make it nice / enhanced" affordance reads
//     more legibly at 12 px than the multi-color rainbow we tried first.
//   - Randomize: re-roll the four layout-affecting forces (charge, link
//     distance, clusterByType, clusterStrength) and immediately reheat the
//     simulation so the graph re-settles into a different topology.
// =============================================================================

export interface ZoomHandle {
  setZoom?: (scale: number, durationMs?: number) => void;
  zoomToFit?: (durationMs?: number, padding?: number) => void;
  resetView?: (durationMs?: number) => void;
  getZoom?: () => number;
}

interface ZoomToolbarProps {
  handle: { current: ZoomHandle | null };
  groupSelectedCount?: number;
  /** When true, hides the in/out zoom step buttons (3D mode). */
  hideStepButtons?: boolean;
  /** Current resolved config — required to render the preset buttons. */
  config?: GraphViewConfig;
  /** Persist-config callback — required to render the preset buttons. */
  onConfigChange?: (config: GraphViewConfig) => void;
  /** Called by Randomize after writing new force values so the simulation
   *  picks them up without waiting for an unrelated reheat trigger. */
  onReheatSimulation?: () => void;
  /** Where the strip lives.
   *
   *  `floating` pins it over the top-left of the canvas — the original, and
   *  still right for a bare `ForceGraph` with no chrome around it.
   *  `inline` drops the positioning so a panel can seat it in its own top bar.
   *  The graph's top-left is the most valuable corner it has (node info, docs,
   *  pins all want it), and view controls are the least contextual thing
   *  competing for it — they belong with the query, not over the data. */
  placement?: 'floating' | 'inline';
}

// Fields the rich-detail toggle owns. When the toggle is on, every field
// here equals the rich value; when off, every field reverts to its default.
// Listed once so the activation predicate and the apply/revert mutators
// stay in sync — adding a field means updating one place.
const RICH_DETAIL_FIELDS: Partial<GraphViewConfig> = {
  showNodeLabels: true,
  showAllLabels: true,
  showEdgeLabels: true,
  labelMinScale: 0,
  edgeLabelMinScale: 0,
  edgeColorMode: 'predicate',
  sphereWidthSegments: 24,
  nodeOpacity3D: 1.0,
  linkOpacity3D: 0.9,
};

function isRichDetailActive(config: GraphViewConfig): boolean {
  for (const [key, value] of Object.entries(RICH_DETAIL_FIELDS)) {
    if ((config as any)[key] !== value) return false;
  }
  return true;
}


export const ZoomToolbar: React.FC<ZoomToolbarProps> = ({
  handle,
  groupSelectedCount = 0,
  hideStepButtons = false,
  config,
  onConfigChange,
  onReheatSimulation,
  placement = 'floating',
}) => {
  const stepZoom = (factor: number) => {
    const h = handle.current;
    if (!h) return;
    const cur = h.getZoom?.() ?? 1;
    h.setZoom?.(cur * factor, 200);
  };

  const canShowPresets = !!(config && onConfigChange);
  const richActive = config ? isRichDetailActive(config) : false;

  // Toggle: if every rich field already matches its rich value, revert each
  // of those fields to its default. Otherwise apply the rich values. Any
  // unrelated field the user has tuned manually is preserved across both
  // directions.
  const handleRichToggle = () => {
    if (!config || !onConfigChange) return;
    if (richActive) {
      const reverted: Partial<GraphViewConfig> = {};
      for (const key of Object.keys(RICH_DETAIL_FIELDS)) {
        (reverted as any)[key] = (defaultGraphViewConfig as any)[key];
      }
      onConfigChange({ ...config, ...reverted });
    } else {
      onConfigChange({ ...config, ...RICH_DETAIL_FIELDS });
    }
  };

  // Snap rolled values to the same step the manual sliders use so the
  // settings popover reads as clean numbers (-450, not -437.218…).
  const handleRandomize = () => {
    if (!config || !onConfigChange) return;
    const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    onConfigChange({
      ...config,
      chargeStrength: Math.round(rand(-900, -150) / 50) * 50,
      linkDistance: Math.round(rand(80, 350) / 10) * 10,
      clusterByType: Math.random() < 0.5,
      clusterStrength: Math.round(rand(0.2, 1.0) * 10) / 10,
    });
    // Defer reheat so the new config has committed to state before the
    // simulation re-reads forces. RAF beats the next paint, which is enough.
    requestAnimationFrame(() => onReheatSimulation?.());
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1.5',
        placement === 'floating' && 'absolute left-2 top-2 z-20',
        placement === 'inline' && 'shrink-0',
      )}
    >
      <HudGroup>
        {!hideStepButtons && (
          <HudButton icon={ZoomIn} onClick={() => stepZoom(1.3)} title="Zoom in" />
        )}
        {!hideStepButtons && (
          <HudButton icon={ZoomOut} onClick={() => stepZoom(1 / 1.3)} title="Zoom out" />
        )}
        <HudButton
          icon={Maximize2}
          onClick={() => handle.current?.zoomToFit?.(400, 50)}
          title="Fit to content"
        />
        <HudButton
          icon={RotateCcw}
          onClick={() => handle.current?.resetView?.(300)}
          title="Reset view"
        />
        {canShowPresets && (
          // Rich detail is a *state*, so it takes the one state channel the
          // chrome has — filled means on. It used to paint its two glyphs
          // amber and sit on an amber wash, which spent a meaningful colour
          // on a preference and made it look like a warning.
          <HudButton
            icon={Sparkles}
            active={richActive}
            onClick={handleRichToggle}
            aria-pressed={richActive}
            title={richActive
              ? 'Rich detail: on — click to revert'
              : 'Rich detail: all labels, predicate colours, max quality'}
          />
        )}
        {canShowPresets && (
          <HudButton icon={Shuffle} onClick={handleRandomize} title="Randomise layout" />
        )}
      </HudGroup>
      {groupSelectedCount > 0 && (
        <HudReadout className="text-hud-fg">{groupSelectedCount} sel</HudReadout>
      )}
    </div>
  );
};
