'use client';

/**
 * PanelFormulaBinder — header chip on a panel that shows the bound
 * Formula (if any) and lets the user pick one or unbind.
 *
 * Reads the formula list from dashboardConfig; calls onBindFormula
 * to write `formula_id` onto the panel. Formula-bound panels
 * delegate their projection to the formula; the inline projection is
 * ignored while bound.
 */

import React, { useState } from 'react';
import { Eye, Link, Link2Off, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { useShallow } from 'zustand/react/shallow';

export interface PanelFormulaBinderProps {
  formulaId?: string | null;
  onBind: (id: string | null) => void;
  /** Open the workspace to edit the bound formula (or to create new). */
  onEditFormula?: (id: string | null) => void;
}

const EMPTY_FORMULAS: readonly never[] = [];

export const PanelFormulaBinder: React.FC<PanelFormulaBinderProps> = ({
  formulaId,
  onBind,
  onEditFormula,
}) => {
  const formulas = useAnnotationRunStore(
    useShallow(s => s.dashboardConfig?.formulas ?? EMPTY_FORMULAS),
  );
  const [open, setOpen] = useState(false);
  const bound = formulaId ? formulas.find(o => o.id === formulaId) ?? null : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-6 text-[11px] px-1.5 gap-1',
            bound && 'text-blue-600 dark:text-blue-400',
          )}
          title={bound ? `Formula: ${bound.name}` : 'Bind to an Formula'}
        >
          <Eye className="h-3 w-3" />
          <span className="truncate max-w-[120px]">
            {bound ? bound.name : 'no obs'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start" side="bottom">
        <div className="px-2 py-1.5 border-b text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <span>bind to formula</span>
          <div className="flex-1" />
          {bound && onEditFormula && (
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => { onEditFormula(bound.id); setOpen(false); }}
            >
              <Pencil className="h-2.5 w-2.5 inline mr-0.5" />edit
            </button>
          )}
        </div>
        <ScrollArea className="max-h-[240px]">
          {formulas.length === 0 ? (
            <div className="px-3 py-3 text-[11px] italic text-muted-foreground">
              No formulas on this run yet. Create one from the runner header.
            </div>
          ) : (
            <ul className="divide-y">
              {formulas.map(obs => (
                <li key={obs.id}>
                  <button
                    type="button"
                    onClick={() => { onBind(obs.id); setOpen(false); }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40',
                      obs.id === formulaId && 'bg-muted/40 font-medium',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {obs.id === formulaId
                        ? <Link className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                        : <Link className="h-3 w-3 opacity-30" />}
                      <span className="truncate">{obs.name}</span>
                    </div>
                    {obs.description && (
                      <div className="text-[10px] text-muted-foreground truncate ml-4 mt-0.5">
                        {obs.description}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        {bound && (
          <div className="border-t p-1.5">
            <ButtonGroup className="w-full">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] flex-1"
                onClick={() => { onBind(null); setOpen(false); }}
              >
                <Link2Off className="h-3 w-3 mr-1" /> Unbind
              </Button>
            </ButtonGroup>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
