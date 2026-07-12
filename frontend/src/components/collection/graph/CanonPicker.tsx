'use client';

/**
 * CanonPicker — multi-select for a run's declared coordinate frame (canon_ids).
 *
 * Mirrors the live-run "Bundles to watch" idiom: removable pills for the
 * chosen canons + a searchable popover to add more. The first selected canon
 * is the primary (curation resolves/writes into it); later canons are the
 * frame the union read will use once that lands.
 */
import * as React from 'react';
import { Check, ChevronsUpDown, Library, Plus, X } from 'lucide-react';
import type { CanonRead } from '@/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface CanonPickerProps {
  canons: CanonRead[];
  value: number[];
  onChange: (next: number[]) => void;
  defaultCanonId?: number | null;
  placeholder?: string;
  className?: string;
}

export function CanonPicker({
  canons,
  value,
  onChange,
  defaultCanonId,
  placeholder = 'Attach a canon…',
  className,
}: CanonPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const byId = React.useMemo(() => new Map(canons.map((c) => [c.id, c])), [canons]);
  const available = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return canons.filter(
      (c) => !value.includes(c.id) && (!q || c.name.toLowerCase().includes(q)),
    );
  }, [canons, value, query]);

  const add = (id: number) => {
    if (!value.includes(id)) onChange([...value, id]);
    setQuery('');
  };
  const remove = (id: number) => onChange(value.filter((x) => x !== id));

  return (
    <div className={cn('space-y-2', className)}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id, i) => {
            const c = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
              >
                <Library className="h-3 w-3 text-muted-foreground" />
                <span className="truncate max-w-[12rem]">{c?.name ?? `Canon ${id}`}</span>
                {i === 0 && (
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">primary</span>
                )}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="opacity-60 hover:opacity-100 hover:text-red-500"
                  aria-label={`Detach ${c?.name ?? `canon ${id}`}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="h-8 w-full justify-between text-sm font-normal">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              {placeholder}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="border-b p-1.5">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search canons…"
              className="h-7 text-sm"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {available.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => add(c.id)}
              >
                <Library className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{c.name}</span>
                {defaultCanonId === c.id && (
                  <span className="text-[10px] text-muted-foreground">default</span>
                )}
                <Check className="h-3.5 w-3.5 shrink-0 opacity-0" />
              </button>
            ))}
            {available.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                {canons.length === 0 ? 'No canons yet.' : 'All canons attached.'}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
