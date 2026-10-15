'use client';

/**
 * The network's two core views beyond its default — **Time** and **Geo** —
 * each a button that opens a lean popup to say how, and lays the network out
 * that way. With neither on, the network is laid out by its groups.
 *
 * The popups ask in the reader's words, not the schema's: *as stated* or *as
 * published* for time; for place, the place-ladder presets the canvas graph
 * already offers (`forcegraph/anchors.RUNG_PRESETS`) — which claims about a
 * node's whereabouts to trust, and how much. Which field holds a time or a
 * place is the engine's business (the projections' own bindings, then the
 * document's); these choose between the claims it found.
 */
import React, { useState } from 'react';
import { Clock, Globe2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  HUD_PROSE, HUD_SURFACE, HudButton, HudOption, HudOverline, HudSegmented,
} from '@/components/ui/chrome';
import { RUNG_PRESETS } from '@/components/collection/graph/plane';
import type { NetworkView } from '@/lib/annotations/types';

type TimeChoice = NonNullable<NetworkView['time']>;
type GeoChoice = NonNullable<NetworkView['geo']>;

export const DEFAULT_TIME: TimeChoice = { source: 'stated', grain: 'auto', mode: 'flat' };
export const DEFAULT_GEO: GeoChoice = { preset: 'stated', neighbours: true };

const GRAINS: Array<{ value: TimeChoice['grain']; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: 'A step that gives the span 20–120 columns' },
  { value: 'day', label: 'Day', title: 'One column per day' },
  { value: 'week', label: 'Week', title: 'One column per week' },
  { value: 'month', label: 'Month', title: 'One column per month' },
  { value: 'year', label: 'Year', title: 'One column per year' },
];

function Lean({
  icon, label, active, title, children,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  title: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HudButton size="sm" icon={icon} active={active} title={title}>{label}</HudButton>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className={cn(HUD_SURFACE, 'w-[300px] rounded-lg p-3')}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export function TimeButton({
  active, value, onApply, onLeave,
}: {
  active: boolean;
  value: TimeChoice | undefined;
  onApply: (v: TimeChoice) => void;
  onLeave: () => void;
}) {
  const [draft, setDraft] = useState<TimeChoice>(value ?? DEFAULT_TIME);
  return (
    <Lean icon={Clock} label="Time" active={active} title="Lay the network out along time">
      {(close) => (
        <div className="space-y-2.5">
          <HudOverline>Time</HudOverline>
          <div>
            <HudOption active={(draft.mode ?? 'flat') === 'flat'} label="Flat"
                       hint="Left to right by when each node is. Brush or play a window to stream its names."
                       onClick={() => setDraft({ ...draft, mode: 'flat' })} />
            <HudOption active={draft.mode === 'deep'} label="Deep"
                       hint="Time as depth: the present in front, what follows waiting behind it. Scroll to travel."
                       onClick={() => setDraft({ ...draft, mode: 'deep' })} />
          </div>
          <div>
            <HudOption active={draft.source === 'stated'} label="As stated"
                       hint="When the row says it happened, else the document's own date."
                       onClick={() => setDraft({ ...draft, source: 'stated' })} />
            <HudOption active={draft.source === 'published'} label="As published"
                       hint="When the documents behind it came out — the one time that is not a claim."
                       onClick={() => setDraft({ ...draft, source: 'published' })} />
          </div>
          <HudSegmented size="sm" className="w-full" value={draft.grain}
                        onChange={(grain) => setDraft({ ...draft, grain })} options={GRAINS} />
          <div className="flex justify-end gap-1.5 pt-0.5">
            {active && (
              <HudButton size="sm" onClick={() => { onLeave(); close(); }}>Back to groups</HudButton>
            )}
            <HudButton size="sm" active onClick={() => { onApply(draft); close(); }}>
              {active ? 'Apply' : 'Lay out by time'}
            </HudButton>
          </div>
        </div>
      )}
    </Lean>
  );
}

export function GeoButton({
  active, value, onApply, onLeave,
}: {
  active: boolean;
  value: GeoChoice | undefined;
  onApply: (v: GeoChoice) => void;
  onLeave: () => void;
}) {
  const [draft, setDraft] = useState<GeoChoice>(value ?? DEFAULT_GEO);
  return (
    <Lean icon={Globe2} label="Geo" active={active} title="Lay the network out on the map">
      {(close) => (
        <div className="space-y-2.5">
          <HudOverline>Place</HudOverline>
          <p className={cn(HUD_PROSE, 'text-hud-dim')}>
            Each node at its place, on the map. Which claims to place it by:
          </p>
          <div>
            {Object.entries(RUNG_PRESETS).map(([key, p]) => (
              <HudOption key={key} active={draft.preset === key} label={p.label} hint={p.hint}
                         onClick={() => setDraft({ ...draft, preset: key })} />
            ))}
          </div>
          <HudOption active={draft.neighbours} label="Bring unplaced neighbours"
                     hint="Keep nodes with no place of their own when they link to one that has."
                     onClick={() => setDraft({ ...draft, neighbours: !draft.neighbours })} />
          <div className="flex justify-end gap-1.5 pt-0.5">
            {active && (
              <HudButton size="sm" onClick={() => { onLeave(); close(); }}>Back to groups</HudButton>
            )}
            <HudButton size="sm" active onClick={() => { onApply(draft); close(); }}>
              {active ? 'Apply' : 'Lay out on the map'}
            </HudButton>
          </div>
        </div>
      )}
    </Lean>
  );
}
