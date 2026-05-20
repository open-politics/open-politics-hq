'use client';

/**
 * FormulaListPopover — header trigger that lists run-scoped formulas
 * and opens the workspace for new/edit.
 *
 * Sits next to Save/Settings/Focus in the runner header. Reads formulas
 * from the dashboardConfig (JSON-only persistence). Clicking a row or
 * "New formula" calls back to the host to mount the workspace.
 */

import React, { useMemo, useState } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { useShallow } from 'zustand/react/shallow';

export interface FormulaListPopoverProps {
  onOpenFormula: (id: string | null) => void;
}

const EMPTY_FORMULAS: readonly never[] = [];

export const FormulaListPopover: React.FC<FormulaListPopoverProps> = ({ onOpenFormula }) => {
  const formulas = useAnnotationRunStore(
    useShallow(s => s.dashboardConfig?.formulas ?? EMPTY_FORMULAS),
  );
  const removeFormula = useAnnotationRunStore(s => s.removeFormula);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? formulas.filter(o => o.name.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q))
      : formulas;
    return [...list].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  }, [formulas, filter]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5">
          <Eye className="h-3 w-3 mr-1 text-blue-600 dark:text-blue-400" />
          <span className="hidden lg:inline">Formulas</span>
          {formulas.length > 0 && (
            <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
              {formulas.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="end" side="bottom">
        <div className="p-2 border-b flex items-center gap-2">
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter formulas…"
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => { onOpenFormula(null); setOpen(false); }}
          >
            <Plus className="h-3 w-3 mr-1" />
            New
          </Button>
        </div>
        <ScrollArea className="max-h-[320px]">
          {sorted.length === 0 ? (
            <div className="p-4 text-[11px] italic text-muted-foreground">
              No formulas yet. Hit "New" to author one.
            </div>
          ) : (
            <ul className="divide-y">
              {sorted.map(obs => {
                const updated = obs.updated_at ? new Date(obs.updated_at) : null;
                return (
                  <li key={obs.id} className="flex items-center hover:bg-muted/40">
                    <button
                      type="button"
                      onClick={() => { onOpenFormula(obs.id); setOpen(false); }}
                      className="flex-1 text-left px-3 py-1.5"
                    >
                      <div className="text-xs font-medium truncate">{obs.name}</div>
                      {obs.description && (
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {obs.description}
                        </div>
                      )}
                      <div className="text-[9px] text-muted-foreground tabular-nums mt-0.5">
                        {updated ? updated.toLocaleString() : ''}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete "${obs.name}"?`)) removeFormula(obs.id);
                      }}
                      className="px-2 py-2 text-muted-foreground hover:text-destructive"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
