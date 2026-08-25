'use client';

import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings2, RotateCcw, Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  HUD_PROSE, HUD_SURFACE, HudButton, HudChip, HudField, HudOverline,
  type HudSize,
} from './chrome';
import type { GraphViewConfig } from './graphTypes';
import {
  ANCHOR_HINT, ANCHOR_LABEL, effectiveAnchors,
  type AnchorKind, type AnchorSpec,
} from './forcegraph/anchors';

/** A `Select` wearing the chrome: hairline, no fill, no shadow. Radix ships
 *  `border-input bg-transparent shadow-xs`, and the shadow is the part that
 *  makes it read as a raised control rather than a slot. */
const SELECT =
  'h-7 w-full rounded-lg border-hud-line bg-transparent px-2.5 text-[11px] ' +
  'shadow-none data-[placeholder]:text-hud-dimmer hover:border-hud-line-strong ' +
  'focus:ring-0 focus-visible:ring-0';

/** A switched setting: name on the left, control on the right, optional line
 *  of prose underneath. The popover had four spellings of this — some with
 *  `Label`, some indented with `pl-2`, one with the hint above the switch and
 *  one with it below. */
function Row({
  label, hint, children,
}: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[11px] text-hud-fg">{label}</span>
        {hint && (
          <span className={cn('mt-0.5 block text-hud-dimmer', HUD_PROSE, 'text-[10px]')}>
            {hint}
          </span>
        )}
      </span>
      <span className="shrink-0 pt-0.5">{children}</span>
    </div>
  );
}

interface GraphSettingsPopoverProps {
  config: GraphViewConfig;
  onConfigChange: (config: GraphViewConfig) => void;
  defaultConfig?: GraphViewConfig;
  /** Detected numeric field names on edges (for width field selector) */
  availableEdgeFields?: string[];
  /** Detected min/max of the active edge width field's data values */
  edgeFieldDataRange?: { min: number; max: number } | null;
  /** When provided, surfaces a "Re-run layout" button at the top of the
   * popover. Wires to ``ForceGraphHandle.reheatSimulation()``. */
  onReheatSimulation?: () => void;
  /** Set by `HudGroup` when this trigger is one position in a run. */
  inGroup?: boolean;
  size?: HudSize;
}

export function GraphSettingsPopover({
  config,
  onConfigChange,
  defaultConfig,
  availableEdgeFields = [],
  edgeFieldDataRange = null,
  onReheatSimulation,
  inGroup,
  size,
}: GraphSettingsPopoverProps) {
  // `effectiveAnchors` folds the legacy `clusterByType` boolean in, so a
  // stored config lights up the right button without a migration step.
  const anchors: AnchorSpec[] = effectiveAnchors(config);
  const anchorStrength =
    anchors.find(a => a.kind !== 'geo')?.strength ?? config.clusterStrength ?? 0.3;

  const handleReset = () => {
    if (defaultConfig) {
      onConfigChange(defaultConfig);
    }
  };

  const updateConfig = (updates: Partial<GraphViewConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <HudButton icon={Settings2} inGroup={inGroup} size={size} title="Graph settings" />
      </PopoverTrigger>
      <PopoverContent
        className={cn(HUD_SURFACE, 'w-72 max-h-[70vh] overflow-y-auto p-0')}
        align="end"
      >
        <TooltipProvider>
        <div className="flex items-center gap-1 border-b border-hud-line px-3 py-2">
          <span className="mr-auto text-[11px] font-medium text-hud-fg">Settings</span>
          {onReheatSimulation && (
            <HudButton size="sm" icon={Zap} onClick={onReheatSimulation}
                       title="Re-run force layout">
              Re-run
            </HudButton>
          )}
          {defaultConfig && (
            <HudButton size="sm" icon={RotateCcw} onClick={handleReset} title="Reset to defaults" />
          )}
        </div>

        <div className="space-y-4 p-3">
          {config.viewMode === '3d' && (
            <p className={cn(HUD_PROSE, 'rounded-lg border border-hud-line px-2.5 py-1.5 text-hud-dim')}>
              <span className="text-hud-fg">3D:</span> drag to orbit, scroll to dolly,
              right-drag to pan. Marquee select (Alt+drag) is 2D-only — use shift+click
              to multi-select.
            </p>
          )}

          {/* Interaction */}
          <section className="space-y-2">
            <HudOverline>Interaction</HudOverline>
            <Row label="Zoom on click">
              <Switch
                checked={config.zoomOnNodeClick}
                onCheckedChange={(checked) => updateConfig({ zoomOnNodeClick: checked })}
              />
            </Row>
            <HudField label="Zoom scale" value={`${config.clickZoomScale.toFixed(1)}×`}>
              <Slider
                min={1.0} max={3.0} step={0.1}
                value={[config.clickZoomScale]}
                onValueChange={([v]) => updateConfig({ clickZoomScale: v })}
                disabled={!config.zoomOnNodeClick}
              />
            </HudField>
            <HudField label="Transition" value={`${config.zoomTransitionMs}ms`}>
              <Slider
                min={0} max={1000} step={50}
                value={[config.zoomTransitionMs]}
                onValueChange={([v]) => updateConfig({ zoomTransitionMs: v })}
              />
            </HudField>
          </section>

          {/* Layout */}
          <section className="space-y-2">
            <HudOverline>Layout</HudOverline>
            <HudField label="Charge" value={config.chargeStrength}>
              <Slider
                min={-1000} max={0} step={50}
                value={[config.chargeStrength]}
                onValueChange={([v]) => updateConfig({ chargeStrength: v })}
              />
            </HudField>
            <HudField label="Link distance" value={config.linkDistance}>
              <Slider
                min={50} max={400} step={10}
                value={[config.linkDistance]}
                onValueChange={([v]) => updateConfig({ linkDistance: v })}
              />
            </HudField>
            <HudField label="Warmup" value={config.warmupTicks}>
              <Slider
                min={0} max={300} step={10}
                value={[config.warmupTicks]}
                onValueChange={([v]) => updateConfig({ warmupTicks: v })}
              />
            </HudField>

            {/* Layout anchors. Clustering, geography and time are one
                primitive (see forcegraph/anchors.ts) — so they are one control
                rather than three unrelated toggles. Anchors compose: geo pins
                the verifiable positions while type still clusters the rest. */}
            <HudField label="Anchor on">
              <div className="flex flex-wrap gap-1">
                {(['type', 'field', 'geo', 'time'] as AnchorKind[]).map((kind) => {
                  const active = anchors.some(a => a.kind === kind);
                  return (
                    <Tooltip key={kind}>
                      <TooltipTrigger asChild>
                        <HudChip
                          active={active}
                          onClick={() => updateConfig({
                            anchors: active
                              ? anchors.filter(a => a.kind !== kind)
                              : [...anchors, kind === 'geo'
                                  ? { kind, pin: true }
                                  : { kind, strength: anchorStrength }],
                            // Retire the legacy flag once the new control is
                            // touched, so the two can't disagree.
                            clusterByType: false,
                          })}
                        >
                          {ANCHOR_LABEL[kind]}
                        </HudChip>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[16rem] text-xs">
                        {ANCHOR_HINT[kind]}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </HudField>
            {anchors.length === 0 && (
              <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
                Pure force layout. Anchors are a lens — switch one on when that
                axis is load-bearing in the data.
              </p>
            )}
            {anchors.some(a => a.kind !== 'geo') && (
              <HudField label="Anchor strength" value={anchorStrength.toFixed(1)}>
                <Slider
                  min={0.1} max={1.0} step={0.1}
                  value={[anchorStrength]}
                  onValueChange={([v]) => updateConfig({
                    anchors: anchors.map(a =>
                      a.kind === 'geo' ? a : { ...a, strength: v }),
                    clusterStrength: v,
                  })}
                />
              </HudField>
            )}
            {anchors.some(a => a.kind === 'geo') && (
              <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
                Geocoded nodes are pinned to real coordinates; everything else
                settles around them.
              </p>
            )}
          </section>

          {/* Nodes */}
          <section className="space-y-2">
            <HudOverline>Nodes</HudOverline>
            <Row label="Labels">
              <Switch
                checked={config.showNodeLabels}
                onCheckedChange={(checked) => updateConfig({ showNodeLabels: checked })}
              />
            </Row>
            <Row label="Show all" hint="Not just the top 10.">
              <Switch
                checked={config.showAllLabels}
                disabled={!config.showNodeLabels}
                onCheckedChange={(checked) => updateConfig({ showAllLabels: checked })}
              />
            </Row>
            {/* Only the DEFAULTS. An icon the schema declares always paints —
                it is part of what the schema says a type is, not a view
                preference this switch gets to overrule. */}
            <Row label="Default icons"
                 hint="Glyphs for types the schema didn't style. Declared ones always show.">
              <Switch
                checked={config.showNodeIcons}
                onCheckedChange={(checked) => updateConfig({ showNodeIcons: checked })}
              />
            </Row>
            <Row label="Field values">
              <Switch
                checked={config.showNodeProperties}
                onCheckedChange={(checked) => updateConfig({ showNodeProperties: checked })}
              />
            </Row>
            <HudField label="Label size" value={`${config.labelFontSize}px`}>
              <Slider
                min={8} max={20} step={1}
                value={[config.labelFontSize]}
                onValueChange={([v]) => updateConfig({ labelFontSize: v })}
              />
            </HudField>
          </section>

          {/* Edges */}
          <section className="space-y-2">
            <HudOverline>Edges</HudOverline>
            <Row label="Labels">
              <Switch
                checked={config.showEdgeLabels}
                onCheckedChange={(checked) => updateConfig({ showEdgeLabels: checked })}
              />
            </Row>
            <Row label="Arrows">
              <Switch
                checked={config.showEdgeArrows}
                onCheckedChange={(checked) => updateConfig({ showEdgeArrows: checked })}
              />
            </Row>
            <HudField label="Width field">
              <Select
                value={config.edgeWidthField}
                onValueChange={(v) => updateConfig({ edgeWidthField: v })}
              >
                <SelectTrigger className={SELECT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="none">Uniform</SelectItem>
                  <SelectItem value="weight">weight</SelectItem>
                  <SelectItem value="confidence">confidence</SelectItem>
                  <SelectItem value="frequency">frequency</SelectItem>
                  {availableEdgeFields
                    .filter(f => !['weight', 'confidence', 'frequency', 'date', 'context'].includes(f))
                    .map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </HudField>

            {edgeFieldDataRange && config.edgeWidthField !== 'none' && (() => {
              const { min: dMin, max: dMax } = edgeFieldDataRange;
              // Pick a sensible slider range & step based on the data
              const span = dMax - dMin;
              const step = span <= 1 ? 0.01 : span <= 10 ? 0.5 : span <= 100 ? 1 : Math.round(span / 100);
              const sliderMin = Math.floor(dMin);
              const sliderMax = Math.ceil(dMax);
              const curLower = config.edgeScaleLower ?? dMin;
              const curUpper = config.edgeScaleUpper ?? dMax;
              return (<>
                <HudField
                  label="Scale lower"
                  value={curLower === dMin ? `${dMin} auto` : curLower}
                >
                  <Slider
                    min={sliderMin} max={sliderMax} step={step}
                    value={[curLower]}
                    onValueChange={([v]) => updateConfig({ edgeScaleLower: v <= dMin ? null : v })}
                  />
                </HudField>
                <HudField
                  label="Scale upper"
                  value={curUpper === dMax ? `${dMax} auto` : curUpper}
                >
                  <Slider
                    min={sliderMin} max={sliderMax} step={step}
                    value={[curUpper]}
                    onValueChange={([v]) => updateConfig({ edgeScaleUpper: v >= dMax ? null : v })}
                  />
                </HudField>
              </>);
            })()}

            <HudField label="Colour">
              <Select
                value={config.edgeColorMode}
                onValueChange={(v) => updateConfig({ edgeColorMode: v as GraphViewConfig['edgeColorMode'] })}
              >
                <SelectTrigger className={SELECT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="uniform">Uniform</SelectItem>
                  <SelectItem value="predicate">By predicate</SelectItem>
                </SelectContent>
              </Select>
            </HudField>
          </section>

          {/* Performance — affects render perf at scale, not visible appearance */}
          <section className="space-y-2">
            <HudOverline>Performance</HudOverline>
            <HudField label="Cooldown ticks" value={config.cooldownTicks}>
              <Slider
                min={30} max={300} step={10}
                value={[config.cooldownTicks]}
                onValueChange={([v]) => updateConfig({ cooldownTicks: v })}
              />
            </HudField>
            <HudField label="Label min zoom" value={`${config.labelMinScale.toFixed(1)}×`}>
              <Slider
                min={0.1} max={1.0} step={0.1}
                value={[config.labelMinScale]}
                onValueChange={([v]) => updateConfig({ labelMinScale: v })}
              />
            </HudField>
            <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
              Hides labels below this zoom level. The selected node keeps its own.
            </p>
            <HudField label="Force engine">
              <Select
                value={config.forceEngine}
                onValueChange={(v) => updateConfig({ forceEngine: v as GraphViewConfig['forceEngine'] })}
              >
                <SelectTrigger className={SELECT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="d3">d3-force (default)</SelectItem>
                  <SelectItem value="ngraph">ngraph (faster at scale)</SelectItem>
                </SelectContent>
              </Select>
            </HudField>
          </section>

          {/* 3D — only visible in 3D mode */}
          {config.viewMode === '3d' && (
            <section className="space-y-2">
              <HudOverline>3D</HudOverline>
              <HudField label="Sphere quality" value={config.sphereWidthSegments}>
                <Slider
                  min={6} max={32} step={2}
                  value={[config.sphereWidthSegments]}
                  onValueChange={([v]) => updateConfig({ sphereWidthSegments: v })}
                />
              </HudField>
              <HudField label="Node opacity" value={config.nodeOpacity3D.toFixed(2)}>
                <Slider
                  min={0.1} max={1.0} step={0.05}
                  value={[config.nodeOpacity3D]}
                  onValueChange={([v]) => updateConfig({ nodeOpacity3D: v })}
                />
              </HudField>
              <HudField label="Link opacity" value={config.linkOpacity3D.toFixed(2)}>
                <Slider
                  min={0.1} max={1.0} step={0.05}
                  value={[config.linkOpacity3D]}
                  onValueChange={([v]) => updateConfig({ linkOpacity3D: v })}
                />
              </HudField>
            </section>
          )}

          {/* General */}
          <section className="space-y-2">
            <HudOverline>General</HudOverline>
            <Row label="Auto fit on load">
              <Switch
                checked={config.autoFitOnLoad}
                onCheckedChange={(checked) => updateConfig({ autoFitOnLoad: checked })}
              />
            </Row>
          </section>
        </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
