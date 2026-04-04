'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings2, RotateCcw } from 'lucide-react';
import type { GraphViewConfig, defaultGraphViewConfig } from './D3ForceGraph';

interface GraphSettingsPopoverProps {
  config: GraphViewConfig;
  onConfigChange: (config: GraphViewConfig) => void;
  defaultConfig?: GraphViewConfig;
  /** Detected numeric field names on edges (for width field selector) */
  availableEdgeFields?: string[];
}

export function GraphSettingsPopover({
  config,
  onConfigChange,
  defaultConfig,
  availableEdgeFields = [],
}: GraphSettingsPopoverProps) {
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
        <Button variant="outline" size="sm" className="h-7 text-xs">
          <Settings2 className="h-3 w-3 mr-1" />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto p-3" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-xs">Graph Settings</h4>
            {defaultConfig && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="h-6 text-[10px] px-2">
                <RotateCcw className="h-2.5 w-2.5 mr-1" />
                Reset
              </Button>
            )}
          </div>

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

            <div className="flex items-center justify-between">
              <Label htmlFor="cluster-by-type" className="text-xs">Cluster by Type</Label>
              <Switch
                id="cluster-by-type"
                checked={config.clusterByType}
                onCheckedChange={(checked) => updateConfig({ clusterByType: checked })}
              />
            </div>

            {config.clusterByType && (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Cluster Strength</Label>
                  <span className="text-[10px] text-muted-foreground">{config.clusterStrength.toFixed(1)}</span>
                </div>
                <Slider
                  min={0.1} max={1.0} step={0.1}
                  value={[config.clusterStrength]}
                  onValueChange={([v]) => updateConfig({ clusterStrength: v })}
                />
              </div>
            )}
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

            <div className="flex items-center justify-between">
              <Label htmlFor="show-node-icons" className="text-xs">Icons</Label>
              <Switch
                id="show-node-icons"
                checked={config.showNodeIcons}
                onCheckedChange={(checked) => updateConfig({ showNodeIcons: checked })}
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
      </PopoverContent>
    </Popover>
  );
}
