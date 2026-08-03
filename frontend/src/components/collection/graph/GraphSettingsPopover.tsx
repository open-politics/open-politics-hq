'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings2, RotateCcw, Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { GraphViewConfig } from './graphTypes';
import {
  ANCHOR_HINT, ANCHOR_LABEL, effectiveAnchors,
  type AnchorKind, type AnchorSpec,
} from './forcegraph/anchors';

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
}

export function GraphSettingsPopover({
  config,
  onConfigChange,
  defaultConfig,
  availableEdgeFields = [],
  edgeFieldDataRange = null,
  onReheatSimulation,
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
        <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5">
          <Settings2 className="h-3 w-3 mr-1" />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto p-3" align="end">
        <TooltipProvider>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-xs">Graph Settings</h4>
            <div className="flex items-center gap-1">
              {onReheatSimulation && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onReheatSimulation}
                  className="h-6 text-[10px] px-2"
                  title="Re-run force layout"
                >
                  <Zap className="h-2.5 w-2.5 mr-1" />
                  Re-run
                </Button>
              )}
              {defaultConfig && (
                <Button variant="ghost" size="sm" onClick={handleReset} className="h-6 text-[10px] px-2">
                  <RotateCcw className="h-2.5 w-2.5 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>

          {config.viewMode === '3d' && (
            <div className="text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-1.5 leading-relaxed">
              <span className="font-medium">3D mode:</span> drag to orbit, scroll to dolly, right-drag to pan. Marquee select (Alt+drag) is 2D-only — use shift+click to multi-select.
            </div>
          )}

          {/* Interaction */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Interaction</div>

            <div className="flex items-center justify-between">
              <Label htmlFor="zoom-on-click" className="text-xs">Zoom on Click</Label>
              <Switch
                id="zoom-on-click"
                checked={config.zoomOnNodeClick}
                onCheckedChange={(checked) => updateConfig({ zoomOnNodeClick: checked })}
              />
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Zoom Scale</Label>
                <span className="text-[10px] text-muted-foreground">{config.clickZoomScale.toFixed(1)}x</span>
              </div>
              <Slider
                min={1.0} max={3.0} step={0.1}
                value={[config.clickZoomScale]}
                onValueChange={([v]) => updateConfig({ clickZoomScale: v })}
                disabled={!config.zoomOnNodeClick}
              />
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Transition</Label>
                <span className="text-[10px] text-muted-foreground">{config.zoomTransitionMs}ms</span>
              </div>
              <Slider
                min={0} max={1000} step={50}
                value={[config.zoomTransitionMs]}
                onValueChange={([v]) => updateConfig({ zoomTransitionMs: v })}
              />
            </div>
          </div>

          {/* Layout */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Layout</div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Charge</Label>
                <span className="text-[10px] text-muted-foreground">{config.chargeStrength}</span>
              </div>
              <Slider
                min={-1000} max={0} step={50}
                value={[config.chargeStrength]}
                onValueChange={([v]) => updateConfig({ chargeStrength: v })}
              />
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Link Distance</Label>
                <span className="text-[10px] text-muted-foreground">{config.linkDistance}</span>
              </div>
              <Slider
                min={50} max={400} step={10}
                value={[config.linkDistance]}
                onValueChange={([v]) => updateConfig({ linkDistance: v })}
              />
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Warmup</Label>
                <span className="text-[10px] text-muted-foreground">{config.warmupTicks}</span>
              </div>
              <Slider
                min={0} max={300} step={10}
                value={[config.warmupTicks]}
                onValueChange={([v]) => updateConfig({ warmupTicks: v })}
              />
            </div>

            {/* Layout anchors. Clustering, geography and time are one
                primitive (see forcegraph/anchors.ts) — so they are one control
                rather than three unrelated toggles. Anchors compose: geo pins
                the verifiable positions while type still clusters the rest. */}
            <div className="space-y-1">
              <Label className="text-xs">Anchor layout on</Label>
              <div className="flex flex-wrap gap-1">
                {(['type', 'field', 'geo', 'time'] as AnchorKind[]).map((kind) => {
                  const active = anchors.some(a => a.kind === kind);
                  return (
                    <Tooltip key={kind}>
                      <TooltipTrigger asChild>
                        <Button
                          variant={active ? 'secondary' : 'outline'}
                          size="sm"
                          className="h-6 px-2 text-[10px]"
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
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[16rem] text-xs">
                        {ANCHOR_HINT[kind]}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              {anchors.length === 0 && (
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Pure force layout. Anchors are a lens — switch one on when that
                  axis is load-bearing in the data.
                </p>
              )}
              {anchors.some(a => a.kind !== 'geo') && (
                <div className="space-y-0.5 pt-0.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Anchor strength</Label>
                    <span className="text-[10px] text-muted-foreground">
                      {anchorStrength.toFixed(1)}
                    </span>
                  </div>
                  <Slider
                    min={0.1} max={1.0} step={0.1}
                    value={[anchorStrength]}
                    onValueChange={([v]) => updateConfig({
                      anchors: anchors.map(a =>
                        a.kind === 'geo' ? a : { ...a, strength: v }),
                      clusterStrength: v,
                    })}
                  />
                </div>
              )}
              {anchors.some(a => a.kind === 'geo') && (
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Geocoded nodes are pinned to real coordinates; everything else
                  settles around them.
                </p>
              )}
            </div>
          </div>

          {/* Nodes */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Nodes</div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-node-labels" className="text-xs">Labels</Label>
              <Switch
                id="show-node-labels"
                checked={config.showNodeLabels}
                onCheckedChange={(checked) => updateConfig({ showNodeLabels: checked })}
              />
            </div>

            <div className="flex items-center justify-between pl-2">
              <Label htmlFor="show-all-labels" className="text-[11px] text-muted-foreground">
                Show all (not just top 10)
              </Label>
              <Switch
                id="show-all-labels"
                checked={config.showAllLabels}
                disabled={!config.showNodeLabels}
                onCheckedChange={(checked) => updateConfig({ showAllLabels: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-node-icons" className="text-xs">Icons</Label>
              <Switch
                id="show-node-icons"
                checked={config.showNodeIcons}
                onCheckedChange={(checked) => updateConfig({ showNodeIcons: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-node-props" className="text-xs">Field Values</Label>
              <Switch
                id="show-node-props"
                checked={config.showNodeProperties}
                onCheckedChange={(checked) => updateConfig({ showNodeProperties: checked })}
              />
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Label Size</Label>
                <span className="text-[10px] text-muted-foreground">{config.labelFontSize}px</span>
              </div>
              <Slider
                min={8} max={20} step={1}
                value={[config.labelFontSize]}
                onValueChange={([v]) => updateConfig({ labelFontSize: v })}
              />
            </div>
          </div>

          {/* Edges */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Edges</div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-edge-labels" className="text-xs">Labels</Label>
              <Switch
                id="show-edge-labels"
                checked={config.showEdgeLabels}
                onCheckedChange={(checked) => updateConfig({ showEdgeLabels: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-edge-arrows" className="text-xs">Arrows</Label>
              <Switch
                id="show-edge-arrows"
                checked={config.showEdgeArrows}
                onCheckedChange={(checked) => updateConfig({ showEdgeArrows: checked })}
              />
            </div>

            <div className="space-y-0.5">
              <Label className="text-xs">Width Field</Label>
              <Select
                value={config.edgeWidthField}
                onValueChange={(v) => updateConfig({ edgeWidthField: v })}
              >
                <SelectTrigger className="h-7 text-xs">
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
            </div>

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
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Scale Lower</Label>
                    <span className="text-[10px] text-muted-foreground">
                      {curLower === dMin ? `${dMin} (auto)` : curLower}
                    </span>
                  </div>
                  <Slider
                    min={sliderMin} max={sliderMax} step={step}
                    value={[curLower]}
                    onValueChange={([v]) => updateConfig({ edgeScaleLower: v <= dMin ? null : v })}
                  />
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Scale Upper</Label>
                    <span className="text-[10px] text-muted-foreground">
                      {curUpper === dMax ? `${dMax} (auto)` : curUpper}
                    </span>
                  </div>
                  <Slider
                    min={sliderMin} max={sliderMax} step={step}
                    value={[curUpper]}
                    onValueChange={([v]) => updateConfig({ edgeScaleUpper: v >= dMax ? null : v })}
                  />
                </div>
              </>);
            })()}

            <div className="space-y-0.5">
              <Label className="text-xs">Color</Label>
              <Select
                value={config.edgeColorMode}
                onValueChange={(v) => updateConfig({ edgeColorMode: v as GraphViewConfig['edgeColorMode'] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="uniform">Uniform</SelectItem>
                  <SelectItem value="predicate">By Predicate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Performance — affects render perf at scale, not visible appearance */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Performance</div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Cooldown Ticks</Label>
                <span className="text-[10px] text-muted-foreground">{config.cooldownTicks}</span>
              </div>
              <Slider
                min={30} max={300} step={10}
                value={[config.cooldownTicks]}
                onValueChange={([v]) => updateConfig({ cooldownTicks: v })}
              />
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Label Min Zoom</Label>
                <span className="text-[10px] text-muted-foreground">{config.labelMinScale.toFixed(1)}x</span>
              </div>
              <Slider
                min={0.1} max={1.0} step={0.1}
                value={[config.labelMinScale]}
                onValueChange={([v]) => updateConfig({ labelMinScale: v })}
              />
              <div className="text-[10px] text-muted-foreground">Hides labels below this zoom level (selected stay visible).</div>
            </div>

            <div className="space-y-0.5">
              <Label className="text-xs">Force Engine</Label>
              <Select
                value={config.forceEngine}
                onValueChange={(v) => updateConfig({ forceEngine: v as GraphViewConfig['forceEngine'] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="d3">d3-force (default)</SelectItem>
                  <SelectItem value="ngraph">ngraph (faster at scale)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3D — only visible in 3D mode */}
          {config.viewMode === '3d' && (
            <div className="space-y-2">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">3D</div>

              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Sphere Quality</Label>
                  <span className="text-[10px] text-muted-foreground">{config.sphereWidthSegments}</span>
                </div>
                <Slider
                  min={6} max={32} step={2}
                  value={[config.sphereWidthSegments]}
                  onValueChange={([v]) => updateConfig({ sphereWidthSegments: v })}
                />
              </div>

              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Node Opacity</Label>
                  <span className="text-[10px] text-muted-foreground">{config.nodeOpacity3D.toFixed(2)}</span>
                </div>
                <Slider
                  min={0.1} max={1.0} step={0.05}
                  value={[config.nodeOpacity3D]}
                  onValueChange={([v]) => updateConfig({ nodeOpacity3D: v })}
                />
              </div>

              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Link Opacity</Label>
                  <span className="text-[10px] text-muted-foreground">{config.linkOpacity3D.toFixed(2)}</span>
                </div>
                <Slider
                  min={0.1} max={1.0} step={0.05}
                  value={[config.linkOpacity3D]}
                  onValueChange={([v]) => updateConfig({ linkOpacity3D: v })}
                />
              </div>
            </div>
          )}

          {/* General */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">General</div>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-fit" className="text-xs">Auto Fit on Load</Label>
              <Switch
                id="auto-fit"
                checked={config.autoFitOnLoad}
                onCheckedChange={(checked) => updateConfig({ autoFitOnLoad: checked })}
              />
            </div>
          </div>
        </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
