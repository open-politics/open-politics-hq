'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronsUpDown, Folder, FolderPlus, Slash } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BundleRead } from '@/client';

interface BundlePickerProps {
  bundles: BundleRead[];
  /** Selected existing bundle id, or undefined for none/create-new. */
  value: number | undefined;
  /** Pick an existing bundle (or undefined to clear → root). */
  onChange: (id: number | undefined) => void;
  /** Create-new bundle name (controlled). When set with value=undefined, a new
   *  bundle is created on submit. Omit the pair to hide the create-new affordance. */
  newName?: string;
  onNewNameChange?: (name: string) => void;
  className?: string;
  /** Show the "No bundle (root)" choice. Default true. Set false where root
   *  isn't a valid target (e.g. a live run's watch-list — you can't watch root). */
  allowRoot?: boolean;
  /** Trigger label when nothing is selected. Default "No bundle (root)". Use for
   *  adder-mode pickers (value stays undefined) e.g. "Add a bundle to watch…". */
  placeholder?: string;
}

interface Row {
  bundle: BundleRead;
  depth: number;
}

/**
 * Flatten the bundle forest into depth-tagged rows (parents before children),
 * ordered by name within each level. Orphans (parent not present) become roots.
 */
function flatten(bundles: BundleRead[]): Row[] {
  const ids = new Set(bundles.map((b) => b.id));
  const byParent = new Map<number | null, BundleRead[]>();
  for (const b of bundles) {
    const parent = b.parent_bundle_id != null && ids.has(b.parent_bundle_id) ? b.parent_bundle_id : null;
    const arr = byParent.get(parent) ?? [];
    arr.push(b);
    byParent.set(parent, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  const out: Row[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const b of byParent.get(parent) ?? []) {
      out.push({ bundle: b, depth });
      walk(b.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const ROW = 'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm hover:bg-muted';
const ACTIVE = 'bg-muted font-medium';

/**
 * Hierarchical single-bundle picker — a compact popover tree built from the flat
 * bundle list (`parent_bundle_id`). Three outcomes: pick an existing bundle,
 * create a new one (name it), or none/root. Purpose-built rather than reusing the
 * full AssetSelector so it stays light enough to drop into a form field.
 */
export function BundlePicker({ bundles, value, onChange, newName, onNewNameChange, className, allowRoot = true, placeholder }: BundlePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const rows = React.useMemo(() => flatten(bundles), [bundles]);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    // Searching flattens the indentation — matches read clearer as a plain list.
    return rows.filter((r) => r.bundle.name.toLowerCase().includes(q)).map((r) => ({ ...r, depth: 0 }));
  }, [rows, query]);

  const selected = value != null ? bundles.find((b) => b.id === value) : undefined;
  const creatingNew = value == null && !!newName?.trim();
  const label = selected ? selected.name : creatingNew ? `New: ${newName}` : (placeholder ?? 'No bundle (root)');

  const pickExisting = (id: number) => {
    onChange(id);
    onNewNameChange?.('');
    setOpen(false);
    setQuery('');
  };
  const pickRoot = () => {
    onChange(undefined);
    onNewNameChange?.('');
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn('w-full justify-between text-sm font-normal', className)}>
          <span className="flex min-w-0 items-center gap-1.5">
            {creatingNew ? <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b p-1.5">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bundles…"
            className="h-7 text-sm"
          />
        </div>

        <div className="max-h-60 overflow-y-auto p-1">
          {allowRoot && (
            <button type="button" className={cn(ROW, value == null && !creatingNew && ACTIVE)} onClick={pickRoot}>
              <Slash className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">No bundle (root)</span>
              {value == null && !creatingNew && <Check className="size-3.5 shrink-0" />}
            </button>
          )}

          {filtered.map(({ bundle, depth }) => (
            <button
              key={bundle.id}
              type="button"
              className={cn(ROW, value === bundle.id && ACTIVE)}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => pickExisting(bundle.id)}
            >
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{bundle.name}</span>
              {value === bundle.id && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}

          {filtered.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">No bundles match.</div>
          )}
        </div>

        {onNewNameChange && (
          <div className="flex items-center gap-1.5 border-t p-1.5">
            <FolderPlus className={cn('size-3.5 shrink-0', creatingNew ? 'text-blue-500' : 'text-muted-foreground')} />
            <Input
              value={newName ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onNewNameChange(v);
                if (v && value != null) onChange(undefined); // creating new supersedes a prior pick
              }}
              placeholder="…or create a new bundle"
              className="h-7 border-0 px-1 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
