'use client';

/**
 * PropertyTypePicker — a compact Popover+Command combobox for a canon property's
 * value-type. Same interaction grammar as the annotation schema editor's
 * DataTypePicker, scoped to the flat canon property vocabulary
 * (`CANON_PROP_TYPES`).
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CANON_PROP_TYPES, CANON_PROP_TYPE_MAP, type CanonPropType } from './canonProperties';

interface Props {
  value: CanonPropType;
  onValueChange: (value: CanonPropType) => void;
  disabled?: boolean;
  className?: string;
  align?: 'start' | 'end';
}

export const PropertyTypePicker: React.FC<Props> = ({ value, onValueChange, disabled, className, align = 'start' }) => {
  const [open, setOpen] = useState(false);
  const selected = CANON_PROP_TYPE_MAP[value] ?? CANON_PROP_TYPE_MAP.text;
  const SelectedIcon = selected.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-8 justify-between gap-2 px-2.5 font-normal text-xs', className)}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <SelectedIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{selected.label}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align={align} onWheel={(e) => e.stopPropagation()}>
        <Command>
          <CommandList>
            <CommandEmpty>No matching type.</CommandEmpty>
            <CommandGroup>
              {CANON_PROP_TYPES.map(opt => {
                const Icon = opt.icon;
                const isSelected = opt.value === value;
                return (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    keywords={[opt.label, opt.description]}
                    onSelect={() => { onValueChange(opt.value); setOpen(false); }}
                    className="flex items-start gap-2.5 py-1.5"
                  >
                    <div className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
                      isSelected ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted/50 text-muted-foreground',
                    )}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('text-sm font-medium', isSelected && 'text-primary')}>{opt.label}</span>
                        {isSelected && <Check className="h-3 w-3 text-primary" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">{opt.description}</p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default PropertyTypePicker;
