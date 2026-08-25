'use client';

import React, { useState, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Filter, Eye, EyeOff, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  HUD_INPUT, HUD_SURFACE, HudButton, HudGroup, HudOverline, HudReadout,
} from './chrome';

interface EntityTypeEntry {
  type: string;
  color: string;
  count: number;
}

interface PredicateEntry {
  predicate: string;
  count: number;
}

interface GraphFilterPanelProps {
  entityTypes: EntityTypeEntry[];
  hiddenEntityTypes: Set<string>;
  onHiddenEntityTypesChange: (hidden: Set<string>) => void;
  predicateTypes: PredicateEntry[];
  hiddenPredicates: Set<string>;
  onHiddenPredicatesChange: (hidden: Set<string>) => void;
}

export function GraphFilterPanel({
  entityTypes,
  hiddenEntityTypes,
  onHiddenEntityTypesChange,
  predicateTypes,
  hiddenPredicates,
  onHiddenPredicatesChange,
}: GraphFilterPanelProps) {
  const [entitySearch, setEntitySearch] = useState('');
  const [predicateSearch, setPredicateSearch] = useState('');

  const filteredEntityTypes = useMemo(() => {
    if (!entitySearch) return entityTypes;
    const q = entitySearch.toLowerCase();
    return entityTypes.filter(e => e.type.toLowerCase().includes(q));
  }, [entityTypes, entitySearch]);

  const filteredPredicates = useMemo(() => {
    if (!predicateSearch) return predicateTypes;
    const q = predicateSearch.toLowerCase();
    return predicateTypes.filter(p => p.predicate.toLowerCase().includes(q));
  }, [predicateTypes, predicateSearch]);

  const toggleEntityType = (type: string) => {
    const next = new Set(hiddenEntityTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onHiddenEntityTypesChange(next);
  };

  const togglePredicate = (predicate: string) => {
    const next = new Set(hiddenPredicates);
    if (next.has(predicate)) next.delete(predicate);
    else next.add(predicate);
    onHiddenPredicatesChange(next);
  };

  const showAllEntities = () => onHiddenEntityTypesChange(new Set());
  const hideAllEntities = () => onHiddenEntityTypesChange(new Set(entityTypes.map(e => e.type)));
  const showAllPredicates = () => onHiddenPredicatesChange(new Set());
  const hideAllPredicates = () => onHiddenPredicatesChange(new Set(predicateTypes.map(p => p.predicate)));

  const hasActiveFilters = hiddenEntityTypes.size > 0 || hiddenPredicates.size > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <HudButton
          icon={Filter}
          tone={hasActiveFilters ? 'warn' : 'neutral'}
          count={hasActiveFilters
            ? hiddenEntityTypes.size + hiddenPredicates.size
            : undefined}
          title={hasActiveFilters
            ? 'Some types or predicates are hidden'
            : 'Hide entity types and predicates'}
        >
          Filter
        </HudButton>
      </PopoverTrigger>
      <PopoverContent className={cn(HUD_SURFACE, 'w-72 p-0')} align="end">
        <div className="max-h-[60vh] overflow-y-auto">
          {/* Entity types */}
          <div className="space-y-2 p-2.5">
            <HudOverline
              trailing={
                <HudGroup size="sm">
                  <HudButton icon={Eye} onClick={showAllEntities} title="Show all" />
                  <HudButton icon={EyeOff} onClick={hideAllEntities} title="Hide all" />
                </HudGroup>
              }
            >
              Entity types
            </HudOverline>

            {entityTypes.length > 10 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-hud-dimmer" />
                <Input
                  placeholder="Search types…"
                  value={entitySearch}
                  onChange={e => setEntitySearch(e.target.value)}
                  className={cn(HUD_INPUT, 'h-7 pl-7 pr-2 text-[11px]')}
                />
              </div>
            )}

            <div className="max-h-48 space-y-px overflow-y-auto">
              {filteredEntityTypes.map(({ type, color, count }) => {
                const isHidden = hiddenEntityTypes.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px]',
                      'transition-colors hover:bg-hud-sunken',
                      isHidden ? 'text-hud-dimmer' : 'text-hud-fg',
                    )}
                    onClick={() => toggleEntityType(type)}
                  >
                    {/* The type's own colour is the one hue in this row that
                        means something, so it stays even when hidden — dimmed,
                        not swapped for grey. Swapping it lost the only thing
                        tying the row to the nodes on the canvas. */}
                    <span
                      aria-hidden
                      className={cn('h-2 w-2 shrink-0 rounded-full transition-opacity',
                                    isHidden && 'opacity-25')}
                      style={{ backgroundColor: color }}
                    />
                    <span className={cn('flex-1 truncate', isHidden && 'line-through')}>
                      {type}
                    </span>
                    <HudReadout>{count}</HudReadout>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Predicates */}
          {predicateTypes.length > 0 && (
            <div className="space-y-2 border-t border-hud-line p-2.5">
              <HudOverline
                trailing={
                  <HudGroup size="sm">
                    <HudButton icon={Eye} onClick={showAllPredicates} title="Show all" />
                    <HudButton icon={EyeOff} onClick={hideAllPredicates} title="Hide all" />
                  </HudGroup>
                }
              >
                Predicates
              </HudOverline>

              {predicateTypes.length > 10 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-hud-dimmer" />
                  <Input
                    placeholder="Search predicates…"
                    value={predicateSearch}
                    onChange={e => setPredicateSearch(e.target.value)}
                    className={cn(HUD_INPUT, 'h-7 pl-7 pr-2 text-[11px]')}
                  />
                </div>
              )}

              <div className="max-h-48 space-y-px overflow-y-auto">
                {filteredPredicates.map(({ predicate, count }) => {
                  const isHidden = hiddenPredicates.has(predicate);
                  return (
                    <button
                      key={predicate}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px]',
                        'transition-colors hover:bg-hud-sunken',
                        isHidden ? 'text-hud-dimmer' : 'text-hud-fg',
                      )}
                      onClick={() => togglePredicate(predicate)}
                    >
                      <span className={cn('flex-1 truncate', isHidden && 'line-through')}>
                        {predicate}
                      </span>
                      <HudReadout>{count}</HudReadout>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
