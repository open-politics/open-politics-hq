'use client';

/**
 * The reading — where and when each section's rows are read from, and why.
 *
 * Inference is the default and it says what it did: *declared* (the schema
 * said so), *structural* (the first field declared a date), *discovered* (the
 * first field whose values resolve to places). Any of it can be overridden per
 * section — another field, or none at all — and the override is saved with the
 * panel. "Auto" hands the choice back to inference.
 */
import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  HUD_LABEL, HUD_PROSE, HUD_SURFACE, HudButton, HudOverline,
} from '@/components/ui/chrome';
import type {
  BindingPick, OverviewPlan, SchemaPlanWire, SectionPlan,
} from '@/lib/overview/types';

const AUTO = '__auto__';
const NONE = '__none__';

/** `document.events[*].at` → `at`; `document.dated` → `dated`. */
function short(section: SectionPlan, path: string | null): string {
  if (!path) return '—';
  const base = section.path ? `${section.path}.` : 'document.';
  const rel = path.startsWith(base) ? path.slice(base.length) : path;
  return rel.replace(/\[\*\]/g, '') || section.label;
}

const SOURCE: Record<string, string> = {
  declared: 'declared', structural: 'date field', discovered: 'resolves',
  picked: 'picked', none: 'none',
};

function Slot({
  section, which, schema, pick, onPick,
}: {
  section: SectionPlan;
  which: 'time' | 'place';
  schema: SchemaPlanWire;
  pick: BindingPick | undefined;
  onPick: (value: string | null | undefined) => void;
}) {
  const binding = section[which];
  const candidates = which === 'time' ? section.time_candidates : section.place_candidates;
  const picked = pick && which in pick;
  const value = !picked ? AUTO : pick![which] == null ? NONE : String(pick![which]);
  const stat = (path: string) => {
    const d = schema.discovery[path];
    return d ? ` · ${d[0]}/${d[1]}` : '';
  };
  const disabled = which === 'place' && section.frame === 'interest';

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => onPick(v === AUTO ? undefined : v === NONE ? null : v)}
    >
      <SelectTrigger
        className={cn(
          'h-7 w-full gap-1 rounded-md border-hud-line bg-transparent px-2 text-[11px] shadow-none',
          'focus:ring-0 data-[state=open]:border-hud-line-strong',
          picked ? 'text-hud-fg' : 'text-hud-dim',
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="text-[11px]">
        <SelectItem value={AUTO} className="text-[11px]">
          Auto · {binding.source === 'none' && !picked ? 'none found'
            : `${short(section, picked ? null : binding.path)}${picked ? '' : ` (${SOURCE[binding.source]})`}`}
        </SelectItem>
        <SelectItem value={NONE} className="text-[11px]">None</SelectItem>
        {candidates.map((p) => (
          <SelectItem key={p} value={p} className="text-[11px]">
            {short(section, p)}{which === 'place' ? stat(p) : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ReadingPopover({
  plan, picks, onChange,
}: {
  plan: OverviewPlan | null;
  picks: Record<string, BindingPick>;
  onChange: (next: Record<string, BindingPick>) => void;
}) {
  const set = (key: string, which: 'time' | 'place', value: string | null | undefined) => {
    const next = { ...picks };
    const cur = { ...(next[key] ?? {}) };
    if (value === undefined) delete cur[which];
    else cur[which] = value;
    if (Object.keys(cur).length) next[key] = cur;
    else delete next[key];
    onChange(next);
  };
  const overridden = Object.keys(picks).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <HudButton icon={SlidersHorizontal} size="sm" active={overridden > 0}
                   count={overridden || undefined} title="Where and when rows are read from" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6}
                      className={cn(HUD_SURFACE, 'w-[380px] rounded-lg p-3')}>
        <HudOverline>Reading</HudOverline>
        <p className={cn(HUD_PROSE, 'mt-1.5 text-hud-dim')}>
          Where and when each section&apos;s rows sit. Inferred from the schema
          and its values unless you pick.
        </p>
        <div className="mt-3 max-h-[52vh] space-y-3 overflow-y-auto pr-1">
          {(plan?.schemas ?? []).map((schema) => (
            <div key={schema.id} className="space-y-1.5">
              {(plan?.schemas.length ?? 0) > 1 && (
                <div className={cn(HUD_LABEL, 'text-hud-dimmer')}>{schema.name}</div>
              )}
              <div className={cn(HUD_LABEL, 'grid grid-cols-[1fr_7.5rem_7.5rem] gap-2 text-hud-dimmer')}>
                <span>Section</span><span>When</span><span>Where</span>
              </div>
              {schema.sections.map((s) => (
                <div key={s.key} className="grid grid-cols-[1fr_7.5rem_7.5rem] items-center gap-2">
                  <span className="truncate text-[11.5px] text-hud-fg/85" title={s.path ?? 'the document itself'}>
                    {s.label}
                    {s.frame && <span className="ml-1 text-hud-dimmer">· {s.frame}</span>}
                  </span>
                  <Slot section={s} which="time" schema={schema} pick={picks[s.key]}
                        onPick={(v) => set(s.key, 'time', v)} />
                  <Slot section={s} which="place" schema={schema} pick={picks[s.key]}
                        onPick={(v) => set(s.key, 'place', v)} />
                </div>
              ))}
            </div>
          ))}
          {!plan && <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>Reading the schema…</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
