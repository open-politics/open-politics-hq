'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Shuffle, Sparkles, Baseline, Palette } from 'lucide-react';
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
    <div className="absolute top-2 left-2 bg-background/70 backdrop-blur-sm rounded-full flex flex-row gap-0 z-20 border shadow-sm overflow-hidden">
      {!hideStepButtons && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => stepZoom(1.3)}
            className="h-6 w-6 p-0 rounded-none"
            title="Zoom In"
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => stepZoom(1 / 1.3)}
            className="h-6 w-6 p-0 rounded-none"
            title="Zoom Out"
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handle.current?.zoomToFit?.(400, 50)}
        className="h-6 w-6 p-0 rounded-none"
        title="Fit to Content"
      >
        <Maximize2 className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handle.current?.resetView?.(300)}
        className="h-6 w-6 p-0 rounded-none"
        title="Reset View"
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
      {canShowPresets && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRichToggle}
            className={`h-6 w-auto px-1 flex items-center justify-center gap-0. rounded-none ${richActive ? 'bg-amber-100 dark:bg-amber-900/40' : ''}`}
            title={richActive ? 'Rich detail: ON (click to revert)' : 'Rich detail: all labels, predicate colors, max quality'}
            aria-pressed={richActive}
          >
            <Baseline
              className="h-3 w-3"
              fill={richActive ? '#f59e0b' : 'none'}
              stroke={richActive ? '#d97706' : 'currentColor'}
            />
            <Palette
              className="h-3 w-3"
              fill={richActive ? '#f59e0b' : 'none'}
              stroke={richActive ? '#d97706' : 'currentColor'}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRandomize}
            className="h-6 w-6 p-0 rounded-none"
            title="Randomize layout"
          >
            <Shuffle className="h-3 w-3" />
          </Button>
        </>
      )}
      {groupSelectedCount > 0 && (
        <span className="text-[10px] text-cyan-600 font-medium self-center px-1.5">
          {groupSelectedCount}
        </span>
      )}
    </div>
  );
};
