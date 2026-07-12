'use client';

/**
 * ParentPicker — pick a canon entry's parents by searching the canon's own
 * entries instead of hand-typing portable refs. Stored values stay portable
 * strings (an entry's `external_id` when it has one, else its `uuid`); selected
 * refs render as chips resolved to the target's canonical name. A ref that
 * matches no current entry shows as a raw mono chip — unresolved, never broken —
 * and you can still add such a ref by hand (cross-deployment / not-yet-imported).
 */
import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CanonEntryRead } from '@/client';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Candidate entries (the canon's entries). */
  entries: CanonEntryRead[];
  /** Entry being edited — excluded from candidates and self-ref guarded. */
  selfId?: number;
  disabled?: boolean;
}

/** The portable ref to store for an entry: external_id if present, else uuid. */
const refOf = (e: CanonEntryRead) => e.external_id || e.uuid;

export const ParentPicker: React.FC<Props> = ({ value, onChange, entries, selfId, disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // ref → entry, for resolving stored values back to display names.
  const byRef = useMemo(() => {
    const m = new Map<string, CanonEntryRead>();
    for (const e of entries) {
      if (e.external_id) m.set(e.external_id, e);
      m.set(e.uuid, e);
    }
    return m;
  }, [entries]);

  const candidates = useMemo(() => {
    const chosen = new Set(value);
    const q = query.trim().toLowerCase();
    return entries
      .filter(e => e.id !== selfId)
      .filter(e => !chosen.has(refOf(e)))
      .filter(e => !q
        || e.canonical.toLowerCase().includes(q)
        || (e.external_id ?? '').toLowerCase().includes(q)
        || (e.aliases ?? []).some(a => a.toLowerCase().includes(q)))
      .slice(0, 50);
  }, [entries, value, query, selfId]);

  const q = query.trim();
  const canAddRaw = q.length > 0 && !value.includes(q) && !byRef.has(q);

  const add = (ref: string) => { if (ref && !value.includes(ref)) onChange([...value, ref]); setQuery(''); };
  const remove = (ref: string) => onChange(value.filter(r => r !== ref));

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" disabled={disabled} className="h-8 w-full justify-start gap-1.5 px-2.5 font-normal text-sm text-muted-foreground">
            <Plus className="h-3.5 w-3.5" />
            Add a parent…
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search entries…" className="text-sm" />
            <CommandList>
              {candidates.length === 0 && !canAddRaw && <CommandEmpty>No matching entries.</CommandEmpty>}
              {candidates.length > 0 && (
                <CommandGroup heading="Entries">
                  {candidates.map(e => (
                    <CommandItem key={e.id} value={String(e.id)} onSelect={() => add(refOf(e))} className="flex items-center gap-2">
                      <span className="flex-1 truncate">{e.canonical}</span>
                      {e.type && <span className="text-[10px] text-muted-foreground">{e.type}</span>}
                      {e.external_id && <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[100px]">{e.external_id}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {canAddRaw && (
                <CommandGroup heading="Raw ref">
                  <CommandItem value={`__raw__${q}`} onSelect={() => add(q)} className="flex items-center gap-2">
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Add ref “<span className="font-mono">{q}</span>”</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(ref => {
            const hit = byRef.get(ref);
            return (
              <Badge key={ref} variant={hit ? 'secondary' : 'outline'} className={cn('gap-1 pr-1 font-normal', !hit && 'border-dashed')}>
                <span className={cn('truncate max-w-[14rem]', !hit && 'font-mono text-muted-foreground')}>
                  {hit ? hit.canonical : ref}
                </span>
                {!disabled && (
                  <button type="button" className="ml-0.5 rounded-sm opacity-60 hover:opacity-100 hover:bg-background/40"
                    onClick={() => remove(ref)} aria-label={`Remove ${hit ? hit.canonical : ref}`}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ParentPicker;
