"use client";

/**
 * AnalyticsOverlayToolbar — per-panel toggles for timeline analytics.
 *
 * Emits an `AnalyticsOverlayConfig` the chart reads to overlay derived
 * series (rolling avg, trend line, peak markers, stats bands). The config
 * itself persists on `panelConfig.settings.analyticsOverlays` so the
 * user's selections survive reloads.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { LineChart, Sparkles } from 'lucide-react';

export interface AnalyticsOverlayConfig {
  rollingAvg: boolean;
  rollingAvgWindow: number;
  trendLine: boolean;
  peakMarkers: boolean;
  statsBands: boolean;
}

export const DEFAULT_ANALYTICS_OVERLAYS: AnalyticsOverlayConfig = {
  rollingAvg: false,
  rollingAvgWindow: 7,
  trendLine: false,
  peakMarkers: false,
  statsBands: false,
};

export interface AnalyticsOverlayToolbarProps {
  value: AnalyticsOverlayConfig;
  onChange: (next: AnalyticsOverlayConfig) => void;
  disabled?: boolean;
}

export function AnalyticsOverlayToolbar({
  value,
  onChange,
  disabled,
}: AnalyticsOverlayToolbarProps) {
  const active =
    (value.rollingAvg ? 1 : 0) +
    (value.trendLine ? 1 : 0) +
    (value.peakMarkers ? 1 : 0) +
    (value.statsBands ? 1 : 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={disabled}
          title="Analytics overlays"
        >
          <Sparkles className="h-3 w-3 mr-1" />
          Overlays{active > 0 ? ` (${active})` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3" align="end">
        <div className="flex items-center gap-2 mb-2">
          <LineChart className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium">Timeline overlays</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={value.rollingAvg}
                onCheckedChange={(c) =>
                  onChange({ ...value, rollingAvg: c === true })
                }
              />
              Rolling avg
            </label>
            <Input
              type="number"
              min={1}
              max={99}
              value={value.rollingAvgWindow}
              onChange={(e) =>
                onChange({
                  ...value,
                  rollingAvgWindow: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="h-6 w-14 text-[11px]"
              disabled={!value.rollingAvg}
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={value.trendLine}
              onCheckedChange={(c) =>
                onChange({ ...value, trendLine: c === true })
              }
            />
            Trend line (linear)
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={value.peakMarkers}
              onCheckedChange={(c) =>
                onChange({ ...value, peakMarkers: c === true })
              }
            />
            Peak markers
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={value.statsBands}
              onCheckedChange={(c) =>
                onChange({ ...value, statsBands: c === true })
              }
            />
            Mean / min / max bands
          </label>
        </div>
        <div className="text-[10px] text-muted-foreground pt-2 border-t mt-2">
          Overlays compute client-side from the rendered data.
        </div>
      </PopoverContent>
    </Popover>
  );
}
