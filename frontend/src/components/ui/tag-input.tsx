'use client';

/**
 * TagInput — a minimal, accessible chip input for editing a string array.
 *
 * Replaces the repeated Input + Badge + X pattern (aliases, types, tags,
 * parents). Add with Enter or comma; remove with the chip's × or Backspace on
 * an empty field. Values are de-duplicated and trimmed.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Visual weight of the chips. */
  variant?: 'secondary' | 'outline';
  className?: string;
  'aria-label'?: string;
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Add…',
  disabled = false,
  variant = 'secondary',
  className,
  'aria-label': ariaLabel,
}: TagInputProps) {
  const [draft, setDraft] = React.useState('');

  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (value.includes(v)) { setDraft(''); return; }
    onChange([...value, v]);
    setDraft('');
  };

  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      removeAt(value.length - 1);
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="h-8 text-sm"
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <Badge key={`${v}-${i}`} variant={variant} className="gap-1 pr-1 font-normal">
              <span className="truncate max-w-[16rem]">{v}</span>
              {!disabled && (
                <button
                  type="button"
                  className="ml-0.5 rounded-sm opacity-60 hover:opacity-100 hover:bg-background/40"
                  onClick={() => removeAt(i)}
                  aria-label={`Remove ${v}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
