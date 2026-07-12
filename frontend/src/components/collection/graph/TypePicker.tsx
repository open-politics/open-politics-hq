'use client';

/**
 * TypePicker — choose an entity `type` for a canon entry. A searchable combobox
 * over the canon's *declared* types (the keys of `type_schemas`, marked with a
 * dot) unioned with types already *observed* on entries, plus inline create of
 * a brand-new type. Picking a declared type is what lights up its typed
 * property slots in the entry editor.
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown, Plus, Shapes } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onValueChange: (type: string) => void;
  /** Types the canon declares a property shape for (keys of type_schemas). */
  declaredTypes?: string[];
  /** Types already in use on entries (no declared shape). */
  observedTypes?: string[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export const TypePicker: React.FC<Props> = ({
  value, onValueChange, declaredTypes = [], observedTypes = [], disabled,
  className, placeholder = 'Pick or create a type…',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const declaredSet = useMemo(() => new Set(declaredTypes), [declaredTypes]);
  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...declaredTypes, ...observedTypes]) {
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [declaredTypes, observedTypes]);

  const q = query.trim().toLowerCase();
  const filtered = q ? all.filter(t => t.toLowerCase().includes(q)) : all;
  const exact = all.some(t => t.toLowerCase() === q);
  const isDeclared = value && declaredSet.has(value);

  const pick = (t: string) => { onValueChange(t); setOpen(false); setQuery(''); };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-8 justify-between gap-2 px-2.5 font-normal text-sm', className)}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            {value
              ? <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isDeclared ? 'bg-primary' : 'bg-muted-foreground/40')} />
              : <Shapes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search or create a type…" className="text-sm" />
          <CommandList>
            {filtered.length === 0 && !q && <CommandEmpty>No types yet — type to create one.</CommandEmpty>}
            {filtered.length > 0 && (
              <CommandGroup heading="Types">
                {filtered.map(t => (
                  <CommandItem key={t} value={t} onSelect={() => pick(t)} className="flex items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', declaredSet.has(t) ? 'bg-primary' : 'bg-muted-foreground/40')} />
                    <span className="flex-1 truncate">{t}</span>
                    {declaredSet.has(t) && <span className="text-[10px] text-muted-foreground">declared</span>}
                    {t === value && <Check className="h-3.5 w-3.5 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {q && !exact && (
              <CommandGroup heading="Create">
                <CommandItem value={`__create__${query}`} onSelect={() => pick(query.trim())} className="flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Create “<span className="font-medium">{query.trim()}</span>”</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default TypePicker;
