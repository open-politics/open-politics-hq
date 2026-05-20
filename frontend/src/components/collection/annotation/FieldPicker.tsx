'use client';

/**
 * FieldPicker — single-select hierarchical field picker with search.
 *
 * Walks an annotation schema's `output_contract` via ``walkOutputContract`` and
 * renders the result as a collapsible tree inside a popover. Used by the
 * filter row and the time-axis source picker; the panel role picker keeps its
 * own multi-select tree because it carries role-shape filtering and explosion
 * toggles that do not apply here.
 *
 * Emits dot-paths in the same grammar as ``core/filters.py`` (single `[*]`
 * explosion node permitted), so the value round-trips through the backend
 * filter parser without rewriting.
 */
import React, { useMemo, useState } from 'react';
import type { AnnotationSchemaRead } from '@/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, ChevronRight, Search as SearchIcon, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  walkOutputContract,
  findFieldPath,
  type FieldPath,
  type FieldShape,
} from '@/lib/annotations/fieldPaths';

export interface FieldPickerProps {
  schema: AnnotationSchemaRead | null | undefined;
  value: string | null | undefined;
  onChange: (path: string | null) => void;
  /** Only nodes with these shapes are selectable; others render disabled. */
  acceptedShapes?: ReadonlyArray<FieldShape>;
  /** Disable picking object/array container nodes — only scalar/leaf fields. */
  leavesOnly?: boolean;
  placeholder?: string;
  disabled?: boolean;
  triggerClassName?: string;
  /** Width of the popover content. Defaults to 320px. */
  popoverWidth?: number;
  /** Empty-state copy when the schema has no compatible fields. */
  emptyMessage?: string;
}

const CONTAINER_SHAPES: ReadonlyArray<FieldShape> = ['object', 'array_object', 'triplet'];

function nodeMatches(p: FieldPath, query: string): boolean {
  if (!query) return true;
  return (
    p.label.toLowerCase().includes(query) ||
    p.path.toLowerCase().includes(query) ||
    (p.description?.toLowerCase().includes(query) ?? false)
  );
}

function subtreeMatches(p: FieldPath, query: string): boolean {
  if (nodeMatches(p, query)) return true;
  return p.children.some((c) => subtreeMatches(c, query));
}

function isSelectable(
  p: FieldPath,
  acceptedShapes?: ReadonlyArray<FieldShape>,
  leavesOnly?: boolean,
): boolean {
  if (p.shape === 'unknown') return false;
  if (acceptedShapes && !acceptedShapes.includes(p.shape)) return false;
  if (leavesOnly && CONTAINER_SHAPES.includes(p.shape)) return false;
  return true;
}

interface TreeNodeProps {
  node: FieldPath;
  depth: number;
  selected: string | null;
  query: string;
  acceptedShapes?: ReadonlyArray<FieldShape>;
  leavesOnly?: boolean;
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onPick: (path: string) => void;
}

function TreeNode({
  node,
  depth,
  selected,
  query,
  acceptedShapes,
  leavesOnly,
  collapsed,
  setCollapsed,
  onPick,
}: TreeNodeProps) {
  if (!subtreeMatches(node, query)) return null;

  // While the user is searching, force-open every visible parent so matching
  // descendants are reachable without manual expansion.
  const open = query !== '' ? true : !collapsed[node.path];
  const selectable = isSelectable(node, acceptedShapes, leavesOnly);
  const isSelected = selected === node.path;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        role={selectable ? 'button' : undefined}
        tabIndex={selectable ? 0 : -1}
        className={cn(
          'flex items-center gap-1.5 py-0.5 px-1 rounded text-xs',
          selectable ? 'hover:bg-muted/40 cursor-pointer' : 'opacity-50 cursor-not-allowed',
          isSelected && 'bg-primary/10 text-primary',
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          if (selectable) onPick(node.path);
        }}
        onKeyDown={(e) => {
          if (selectable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onPick(node.path);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="h-4 w-4 flex items-center justify-center shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((s) => ({ ...s, [node.path]: open }));
            }}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <span className="flex-1 min-w-0 truncate">
          <span className="font-mono">{node.label}</span>
          <span className="text-muted-foreground ml-1">({node.shape})</span>
        </span>
      </div>
      {open &&
        node.children.map((c) => (
          <TreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            selected={selected}
            query={query}
            acceptedShapes={acceptedShapes}
            leavesOnly={leavesOnly}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            onPick={onPick}
          />
        ))}
    </div>
  );
}

export function FieldPicker({
  schema,
  value,
  onChange,
  acceptedShapes,
  leavesOnly,
  placeholder = 'Select field…',
  disabled,
  triggerClassName,
  popoverWidth = 320,
  emptyMessage = 'No fields in this schema.',
}: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const paths = useMemo(() => walkOutputContract(schema ?? null), [schema]);
  const currentNode = useMemo(
    () => (value ? findFieldPath(paths, value) : null),
    [paths, value],
  );
  const query = search.trim().toLowerCase();

  const triggerLabel = (() => {
    if (!value) return <span className="text-muted-foreground">{placeholder}</span>;
    if (currentNode) {
      return (
        <span className="truncate">
          {currentNode.label}
          <span className="text-muted-foreground ml-1">({currentNode.shape})</span>
        </span>
      );
    }
    return <span className="truncate font-mono">{value}</span>;
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-7 text-xs justify-between font-normal min-w-0',
            !value && 'text-muted-foreground',
            triggerClassName,
          )}
        >
          <span className="truncate flex-1 text-left">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 ml-1 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-2" style={{ width: popoverWidth }} align="start">
        <div className="flex items-center gap-1 mb-1.5">
          <SearchIcon className="h-3 w-3 text-muted-foreground shrink-0" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fields…"
            className="h-7 text-xs"
            autoFocus
          />
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              title="Clear selection"
            >
              <XIcon className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto border rounded bg-background p-1">
          {paths.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2 text-center italic">
              {emptyMessage}
            </div>
          ) : (
            paths.map((p) => (
              <TreeNode
                key={p.path}
                node={p}
                depth={0}
                selected={value ?? null}
                query={query}
                acceptedShapes={acceptedShapes}
                leavesOnly={leavesOnly}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
                onPick={(picked) => {
                  onChange(picked);
                  setOpen(false);
                  setSearch('');
                }}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
