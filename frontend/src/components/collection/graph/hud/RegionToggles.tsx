'use client';

/**
 * Which HUD regions are up, and what the map is doing.
 *
 * These existed as config the moment the panes did — `mapMode` and
 * `lanes.enabled` were both read, persisted and honoured, and neither had a
 * single control anywhere in the app. A region nobody can turn on is
 * indistinguishable from a region nobody built.
 *
 * Grouped into one popover because they are one decision: how much of the
 * canvas you are willing to trade for context. The map is here rather than in
 * the settings popover for the same reason — `underlay` and `region` are two
 * answers to "where", not two render options.
 */
import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LayoutPanelLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HUD_SURFACE, HudButton, HudOption, HudOverline } from '@/components/ui/chrome';
import type { GraphViewConfig } from '../graphTypes';
import type { HudConfig } from './hudChannels';

interface Props {
  viewConfig: GraphViewConfig;
  onViewConfigChange: (next: GraphViewConfig) => void;
  hudConfig: HudConfig;
  onHudConfigChange: (next: HudConfig) => void;
}

const MAP_MODES: Array<{
  value: GraphViewConfig['mapMode'];
  label: string;
  hint: string;
}> = [
  { value: 'off', label: 'No map', hint: 'Force layout only.' },
  {
    value: 'underlay',
    label: 'World underlay',
    hint: 'Country outlines painted under the graph, in the same projection — geocoded nodes sit where they are.',
  },
  {
    value: 'region',
    label: 'Place clusters',
    hint: 'A left-rail list of the places on screen. Clicking one writes a near: filter, scoping every pane at once.',
  },
];

export function RegionToggles({
  viewConfig, onViewConfigChange, hudConfig, onHudConfigChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const lanesOn = hudConfig.lanes.enabled;
  const activeCount =
    (viewConfig.mapMode !== 'off' ? 1 : 0) + (lanesOn ? 1 : 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HudButton
          icon={LayoutPanelLeft}
          active={activeCount > 0}
          title="Panes and map"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className={cn(HUD_SURFACE, 'w-[19rem] space-y-3 p-2.5')}>
        <section className="space-y-0.5">
          <HudOverline>Map — where</HudOverline>
          {MAP_MODES.map(m => (
            <HudOption
              key={m.value}
              active={viewConfig.mapMode === m.value}
              label={m.label}
              hint={m.hint}
              onClick={() => onViewConfigChange({ ...viewConfig, mapMode: m.value })}
            />
          ))}
        </section>

        <section className="space-y-0.5">
          <HudOverline>Bottom band — when × where</HudOverline>
          <HudOption
            active={lanesOn}
            label="Lanes"
            hint="One row per place (or kind, or cluster), occurrences drawn as bars on the same clock the scrubber runs."
            onClick={() => onHudConfigChange({
              ...hudConfig,
              lanes: { ...hudConfig.lanes, enabled: !lanesOn },
            })}
          />
          {lanesOn && (
            <HudOption
              active={hudConfig.lanes.clock === 'activity'}
              label="Use the second clock"
              hint="Bars span the period each row is ABOUT rather than when it was recorded. Where the two differ — a deposition describing events fifteen years earlier — the difference is the finding."
              onClick={() => onHudConfigChange({
                ...hudConfig,
                lanes: {
                  ...hudConfig.lanes,
                  clock: hudConfig.lanes.clock === 'activity' ? 'time' : 'activity',
                },
              })}
            />
          )}
        </section>
      </PopoverContent>
    </Popover>
  );
}
