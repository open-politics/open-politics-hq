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
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, LayoutPanelLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
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

function Row({
  active, label, hint, onClick,
}: { active: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[10px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

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
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 shrink-0', activeCount > 0 && 'text-sky-500')}
          title="Panes and map"
        >
          <LayoutPanelLeft className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] p-2">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Map — where
        </p>
        {MAP_MODES.map(m => (
          <Row
            key={m.value}
            active={viewConfig.mapMode === m.value}
            label={m.label}
            hint={m.hint}
            onClick={() => onViewConfigChange({ ...viewConfig, mapMode: m.value })}
          />
        ))}

        <div className="my-1.5 border-t border-border/60" />
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bottom band — when × where
        </p>
        <Row
          active={lanesOn}
          label="Lanes"
          hint="One row per place (or kind, or cluster), occurrences drawn as bars on the same clock the scrubber runs."
          onClick={() => onHudConfigChange({
            ...hudConfig,
            lanes: { ...hudConfig.lanes, enabled: !lanesOn },
          })}
        />
        {lanesOn && (
          <Row
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
      </PopoverContent>
    </Popover>
  );
}
