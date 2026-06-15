'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Table as TableIcon, TrendingUp, PieChart, MapPin, Network } from 'lucide-react';

// Panel types offered by the Ctrl+P quick picker. Mirrors the header's add-panel
// menu; kept here so the picker is self-contained and keyboard-driven.
export const PANEL_TYPES = [
  { type: 'table', name: 'Data Table', description: 'Tabular view with filtering and sorting', icon: TableIcon, color: 'bg-blue-500 dark:bg-blue-600' },
  { type: 'chart', name: 'Time Series / Bar Chart', description: 'Trends over time or count comparisons', icon: TrendingUp, color: 'bg-green-500 dark:bg-green-600' },
  { type: 'pie', name: 'Pie Chart', description: 'Distribution and proportion visualization', icon: PieChart, color: 'bg-amber-500 dark:bg-amber-600' },
  { type: 'map', name: 'Geographic Map', description: 'Spatial visualization of geocoded data', icon: MapPin, color: 'bg-red-500 dark:bg-red-600' },
  { type: 'graph', name: 'Knowledge Graph', description: 'Network visualization of relationships', icon: Network, color: 'bg-purple-500 dark:bg-purple-600' },
] as const;

export type PanelTypeDef = (typeof PANEL_TYPES)[number];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen panel type. The picker closes itself afterwards. */
  onPick: (def: PanelTypeDef) => void;
}

/**
 * Keyboard-first panel picker (opened via Ctrl+P). The list is the only focus
 * target — ↑/↓ move a highlighted index, Enter commits it, Esc closes (Radix
 * Dialog handles Esc). Options are plain divs (role="option") so Enter is
 * handled solely by the list keydown, never double-firing a native button.
 */
export const PanelTypePicker: React.FC<Props> = ({ open, onOpenChange, onPick }) => {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset the highlight every time the picker opens.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const choose = (i: number) => {
    const def = PANEL_TYPES[i];
    if (def) onPick(def);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (i + 1) % PANEL_TYPES.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (i - 1 + PANEL_TYPES.length) % PANEL_TYPES.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(index);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          // Focus the list itself, not the first option, so arrow keys drive
          // the highlight instead of native focus traversal.
          e.preventDefault();
          listRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">Add panel</DialogTitle>
        </DialogHeader>
        <div
          ref={listRef}
          role="listbox"
          aria-label="Panel types"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="grid grid-cols-1 gap-1 outline-none"
        >
          {PANEL_TYPES.map((p, i) => {
            const Icon = p.icon;
            const active = i === index;
            return (
              <div
                key={p.type}
                role="option"
                aria-selected={active}
                onClick={() => choose(i)}
                onMouseEnter={() => setIndex(i)}
                className={cn(
                  'flex items-start gap-2.5 p-2 rounded-md text-left w-full cursor-pointer transition-colors',
                  active ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/50',
                )}
              >
                <div className={cn('p-1.5 rounded-md text-white', p.color)}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h5 className="font-medium text-xs">{p.name}</h5>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{p.description}</p>
                </div>
                {active && <span className="self-center text-[11px] text-muted-foreground">↵</span>}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">↑↓ navigate · Enter to add · Esc to close</p>
      </DialogContent>
    </Dialog>
  );
};
