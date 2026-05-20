'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Filter, Eye, EyeOff, Search } from 'lucide-react';

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
        <Button variant="outline" size="sm" className={`h-6 text-[11px] px-1.5 ${hasActiveFilters ? 'border-amber-500 text-amber-600 dark:text-amber-400' : ''}`}>
          <Filter className="h-3 w-3 mr-1" />
          Filter
          {hasActiveFilters && (
            <span className="ml-1 bg-amber-500 text-white rounded-full text-[10px] px-1.5 leading-4">
              {hiddenEntityTypes.size + hiddenPredicates.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="max-h-[60vh] overflow-y-auto">
          {/* Entity Types Section */}
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Entity Types</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={showAllEntities}>
                  <Eye className="h-2.5 w-2.5 mr-0.5" />All
                </Button>
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={hideAllEntities}>
                  <EyeOff className="h-2.5 w-2.5 mr-0.5" />None
                </Button>
              </div>
            </div>

            {entityTypes.length > 10 && (
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search types..."
                  value={entitySearch}
                  onChange={e => setEntitySearch(e.target.value)}
                  className="h-6 text-xs pl-7 pr-2"
                />
              </div>
            )}

            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {filteredEntityTypes.map(({ type, color, count }) => {
                const isHidden = hiddenEntityTypes.has(type);
                return (
                  <div
                    key={type}
                    className={`flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer text-xs transition-all hover:bg-accent/50 ${isHidden ? 'opacity-40' : ''}`}
                    onClick={() => toggleEntityType(type)}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: isHidden ? 'var(--graph-edge-stroke)' : color }}
                    />
                    <span className={`flex-1 truncate ${isHidden ? 'line-through' : ''}`}>{type}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Predicates Section */}
          {predicateTypes.length > 0 && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Edge Predicates</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={showAllPredicates}>
                    <Eye className="h-2.5 w-2.5 mr-0.5" />All
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={hideAllPredicates}>
                    <EyeOff className="h-2.5 w-2.5 mr-0.5" />None
                  </Button>
                </div>
              </div>

              {predicateTypes.length > 10 && (
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search predicates..."
                    value={predicateSearch}
                    onChange={e => setPredicateSearch(e.target.value)}
                    className="h-6 text-xs pl-7 pr-2"
                  />
                </div>
              )}

              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {filteredPredicates.map(({ predicate, count }) => {
                  const isHidden = hiddenPredicates.has(predicate);
                  return (
                    <div
                      key={predicate}
                      className={`flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer text-xs transition-all hover:bg-accent/50 ${isHidden ? 'opacity-40' : ''}`}
                      onClick={() => togglePredicate(predicate)}
                    >
                      <span className={`flex-1 truncate ${isHidden ? 'line-through' : ''}`}>{predicate}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
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
