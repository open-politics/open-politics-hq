'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Settings2, RotateCcw } from 'lucide-react';
import type { GraphViewConfig, defaultGraphViewConfig } from './D3ForceGraph';

interface GraphSettingsPopoverProps {
  config: GraphViewConfig;
  onConfigChange: (config: GraphViewConfig) => void;
  defaultConfig?: GraphViewConfig;
}

export function GraphSettingsPopover({
  config,
  onConfigChange,
  defaultConfig,
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
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-2" />
          Graph Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Graph Settings</h4>
            {defaultConfig && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-7 text-xs"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>

          {/* Interaction Settings */}
          <div className="space-y-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Interaction
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="zoom-on-click" className="text-sm">
                Zoom on Node Click
              </Label>
              <Switch
                id="zoom-on-click"
                checked={config.zoomOnNodeClick}
                onCheckedChange={(checked) => updateConfig({ zoomOnNodeClick: checked })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="click-zoom-scale" className="text-sm">
                  Click Zoom Scale
                </Label>
                <span className="text-xs text-muted-foreground">{config.clickZoomScale.toFixed(1)}x</span>
              </div>
              <Slider
                id="click-zoom-scale"
                min={1.0}
                max={3.0}
                step={0.1}
                value={[config.clickZoomScale]}
                onValueChange={([value]) => updateConfig({ clickZoomScale: value })}
                disabled={!config.zoomOnNodeClick}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="zoom-transition" className="text-sm">
                  Zoom Transition (ms)
                </Label>
                <span className="text-xs text-muted-foreground">{config.zoomTransitionMs}ms</span>
              </div>
              <Slider
                id="zoom-transition"
                min={0}
                max={1000}
                step={50}
                value={[config.zoomTransitionMs]}
                onValueChange={([value]) => updateConfig({ zoomTransitionMs: value })}
              />
            </div>
          </div>

          {/* Layout Settings */}
          <div className="space-y-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Layout
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="charge-strength" className="text-sm">
                  Charge Strength
                </Label>
                <span className="text-xs text-muted-foreground">{config.chargeStrength}</span>
              </div>
              <Slider
                id="charge-strength"
                min={-1000}
                max={0}
                step={50}
                value={[config.chargeStrength]}
                onValueChange={([value]) => updateConfig({ chargeStrength: value })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="link-distance" className="text-sm">
                  Link Distance
                </Label>
                <span className="text-xs text-muted-foreground">{config.linkDistance}</span>
              </div>
              <Slider
                id="link-distance"
                min={50}
                max={400}
                step={10}
                value={[config.linkDistance]}
                onValueChange={([value]) => updateConfig({ linkDistance: value })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="warmup-ticks" className="text-sm">
                  Warmup Ticks
                </Label>
                <span className="text-xs text-muted-foreground">{config.warmupTicks}</span>
              </div>
              <Slider
                id="warmup-ticks"
                min={0}
                max={300}
                step={10}
                value={[config.warmupTicks]}
                onValueChange={([value]) => updateConfig({ warmupTicks: value })}
              />
            </div>
          </div>

          {/* Display Settings */}
          <div className="space-y-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Display
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="show-node-labels" className="text-sm">
                Show Node Labels
              </Label>
              <Switch
                id="show-node-labels"
                checked={config.showNodeLabels}
                onCheckedChange={(checked) => updateConfig({ showNodeLabels: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-edge-labels" className="text-sm">
                Show Edge Labels
              </Label>
              <Switch
                id="show-edge-labels"
                checked={config.showEdgeLabels}
                onCheckedChange={(checked) => updateConfig({ showEdgeLabels: checked })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="label-font-size" className="text-sm">
                  Label Font Size
                </Label>
                <span className="text-xs text-muted-foreground">{config.labelFontSize}px</span>
              </div>
              <Slider
                id="label-font-size"
                min={8}
                max={20}
                step={1}
                value={[config.labelFontSize]}
                onValueChange={([value]) => updateConfig({ labelFontSize: value })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="auto-fit" className="text-sm">
                Auto Fit on Load
              </Label>
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
