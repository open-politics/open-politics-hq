'use client';

/**
 * SchemaFieldTreePopover — nested, searchable, scrollable schema field picker.
 *
 * Replaces the long flat ``Select`` dropdowns used in the FormulaWorkspace.
 * Mirrors the tree UX from ``RolePicker``'s internal ``FieldTree`` but lives
 * as a standalone reusable surface so the formula editor, future schema
 * editors, and ad-hoc filter builders can share one picker.
 *
 * Modes:
 *   - ``single``: toggling a path replaces the selection. Emits [] or [path].
 *   - ``multi``:  toggling a path adds/removes. Selection is a list.
 *
 * Accept filter: ``acceptShapes`` mutes paths whose ``shape`` isn't allowed;
 * they still appear in the tree for navigability but the checkbox is disabled.
 *
 * Rendering: the trigger shows a summary (path label / N selected). The popover
 * body has a fixed-height scrollable tree + a search box. No overflow leaks.
 */

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { FieldPath, FieldShape } from '@/lib/annotations/fieldPaths';

export interface SchemaFieldTreePopoverProps {
  /** Nested tree roots from ``walkOutputContract(schema)``. */
  roots: FieldPath[];
  /** Currently selected paths (single-mode: 0-or-1 elements). */
  selected: string[];
  /** Emits the next selection. */
  onChange: (next: string[]) => void;
  /** ``'single'`` (default) or ``'multi'``. */
  mode?: 'single' | 'multi';
  /** Optional shape filter — non-accepted paths render disabled (muted). */
  acceptShapes?: ReadonlySet<FieldShape>;
  /** Label shown to the left of the trigger value. */
  triggerLabel?: string;
  /** Placeholder text when nothing is selected. */
  placeholder?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Width preset — ``'auto'`` (default) sizes to content; ``'full'`` fills parent. */
  width?: 'auto' | 'full';
  className?: string;
}

export const SchemaFieldTreePopover: React.FC<SchemaFieldTreePopoverProps> = ({
  roots,
  selected,
  onChange,
  mode = 'single',
  acceptShapes,
  triggerLabel,
  placeholder = 'Pick a field',
  disabled = false,
  width = 'auto',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const accepts = (shape: FieldShape): boolean => {
    if (!acceptShapes || acceptShapes.size === 0) return true;
    return acceptShapes.has(shape);
  };

  const toggle = (path: string) => {
    if (mode === 'single') {
      onChange(selectedSet.has(path) ? [] : [path]);
      setOpen(false);
    } else {
      onChange(
        selectedSet.has(path)
          ? selected.filter((p) => p !== path)
          : [...selected, path],
      );
    }
  };

  // Trigger summary text — single-mode shows the path, multi-mode shows count.
  let triggerText: React.ReactNode;
  if (selected.length === 0) {
    triggerText = <span className="text-muted-foreground italic">{placeholder}</span>;
  } else if (mode === 'single') {
    triggerText = (
      <span className="truncate font-mono text-[10px]" title={selected[0]}>
        {selected[0]}
      </span>
    );
  } else {
    triggerText = (
      <span className="text-[10px]">
        {selected.length} path{selected.length !== 1 ? 's' : ''}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-6 px-1.5 gap-1 text-[10px] min-w-0 justify-start',
            width === 'full' && 'w-full',
            className,
          )}
        >
          {triggerLabel && (
            <span className="text-muted-foreground shrink-0">{triggerLabel}</span>
          )}
          <span className="flex-1 min-w-0 text-left truncate">{triggerText}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start" side="bottom">
        <div className="p-1.5 border-b">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter paths…"
            className="h-7 text-xs"
            autoFocus
          />
        </div>
        <ScrollArea className="h-[280px]">
          <div className="p-1 text-xs">
            {roots.length === 0 ? (
              <div className="px-2 py-3 text-[11px] italic text-muted-foreground">
                No fields in this schema.
              </div>
            ) : (
              roots.map((node) => (
                <FieldNode
                  key={node.path}
                  node={node}
                  depth={0}
                  search={search.trim().toLowerCase()}
                  selectedSet={selectedSet}
                  accepts={accepts}
                  onToggle={toggle}
                />
              ))
            )}
          </div>
        </ScrollArea>
        {mode === 'multi' && selected.length > 0 && (
          <div className="border-t p-1.5 flex items-center gap-1 text-[10px]">
            <span className="text-muted-foreground">{selected.length} selected</span>
            <div className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 text-[10px] px-1"
              onClick={() => onChange([])}
            >
              <X className="h-2.5 w-2.5 mr-0.5" /> Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

interface FieldNodeProps {
  node: FieldPath;
  depth: number;
  search: string;
  selectedSet: Set<string>;
  accepts: (shape: FieldShape) => boolean;
  onToggle: (path: string) => void;
}

const FieldNode: React.FC<FieldNodeProps> = ({
  node,
  depth,
  search,
  selectedSet,
  accepts,
  onToggle,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const matchesSearch = (n: FieldPath): boolean => {
    if (!search) return true;
    if (
      n.label.toLowerCase().includes(search) ||
      n.path.toLowerCase().includes(search) ||
      (n.description?.toLowerCase().includes(search) ?? false)
    ) {
      return true;
    }
    return n.children.some(matchesSearch);
  };

  if (!matchesSearch(node)) return null;

  const open = !collapsed;
  const isSelected = selectedSet.has(node.path);
  const accepted = accepts(node.shape);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted/50 cursor-pointer',
          !accepted && 'opacity-50',
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={(e) => {
          // Click on row toggles selection unless click was on chevron/checkbox.
          if ((e.target as HTMLElement).closest('[data-no-toggle]')) return;
          if (accepted) onToggle(node.path);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            data-no-toggle
            className="h-3.5 w-3.5 flex items-center justify-center shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )}
        <Checkbox
          data-no-toggle
          checked={isSelected}
          disabled={!accepted}
          onCheckedChange={() => {
            if (accepted) onToggle(node.path);
          }}
          className="h-3 w-3 shrink-0"
        />
        <span
          className="flex-1 min-w-0 truncate font-mono text-[10.5px]"
          title={node.path}
        >
          {node.label}
        </span>
        <span className="text-[9px] text-muted-foreground shrink-0">
          {node.shape}
        </span>
        {isSelected && <Check className="h-3 w-3 text-blue-600 dark:text-blue-400 shrink-0" />}
      </div>
      {open &&
        hasChildren &&
        node.children.map((child) => (
          <FieldNode
            key={child.path}
            node={child}
            depth={depth + 1}
            search={search}
            selectedSet={selectedSet}
            accepts={accepts}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
};
