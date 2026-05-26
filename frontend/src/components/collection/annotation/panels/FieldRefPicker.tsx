"use client";

/**
 * FieldRefPicker — hierarchical typed field tree picker.
 *
 * Renders the schema's output-contract tree (objects expandable, arrays
 * collapsible, leaves leafy). Click a leaf or an array node to select it
 * as a field reference. Search filters across the whole tree. Each row
 * carries a shape badge so users can see at a glance what they're
 * binding.
 *
 * Two modes:
 *  - ``single``  emits ``string | null``
 *  - ``multi``   emits ``string[]``
 *
 * Array nodes (``isArrayNode === true``) are valid picks in both modes —
 * the path includes ``[*]`` so downstream consumers can route through
 * the engine's explosion contract. The same picker drives the panel's
 * row-explosion slot.
 *
 * Replaces the flat list version. Cell density mirrors the schema
 * editor's field tree so users have a consistent mental model.
 */

import React, { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X as XIcon, Search, ChevronRight, ChevronDown, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { AnnotationSchemaRead } from '@/client';
import {
  walkOutputContract,
  type FieldPath,
  type FieldShape,
} from '@/lib/annotations/fieldPaths';

export type FieldRefPickerValue =
  | { kind: 'single'; value: string | null }
  | { kind: 'multi'; value: string[] };

export interface FieldRefPickerProps {
  schemas: AnnotationSchemaRead[];
  /** Active schema id. ``null`` = walk every schema (concatenated trees). */
  schemaId: number | null | undefined;
  /** Field shapes the slot accepts. Empty = any. Rows with a non-
   *  accepted shape are visible but disabled (so users still see the
   *  hierarchy context but can't pick incompatible leaves). */
  accepts?: ReadonlyArray<FieldShape>;
  value: FieldRefPickerValue;
  onChange: (next: FieldRefPickerValue) => void;
  triggerClassName?: string;
  emptyLabel?: string;
  placeholder?: string;
}

function shapeColor(shape: FieldShape): string {
  switch (shape) {
    case 'string':              return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800';
    case 'number':              return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800';
    case 'boolean':             return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800';
    case 'date':                return 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800';
    case 'enum_string':         return 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950 dark:text-fuchsia-300 dark:border-fuchsia-800';
    case 'entity':
    case 'array_entity':        return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800';
    case 'array_string':
    case 'array_string_enum':
    case 'array_number':        return 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800';
    case 'triplet':             return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800';
    case 'object':
    case 'array_object':        return 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700';
    default:                    return 'bg-muted text-muted-foreground border-border';
  }
}

/** Walk the run's schemas and return the rooted field trees (preserves
 *  nesting). When ``schemaId`` is null and more than one schema exists,
 *  returns one tree per schema. */
function buildFieldTrees(
  schemas: AnnotationSchemaRead[],
  schemaId: number | null | undefined,
): Array<{ schemaId: number; schemaName: string; roots: FieldPath[] }> {
  const target = schemaId == null
    ? schemas
    : schemas.filter((s) => s.id === schemaId);
  return target.map((s) => ({
    schemaId: s.id,
    schemaName: s.name,
    roots: walkOutputContract(s),
  }));
}

/** True if any node in the subtree (including the node itself) matches
 *  the query string (label or path substring). */
function subtreeMatchesQuery(node: FieldPath, q: string): boolean {
  if (!q) return true;
  if (node.label.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) {
    return true;
  }
  return node.children.some((c) => subtreeMatchesQuery(c, q));
}

/** Determine if the node is itself pickable (has a path + acceptable
 *  shape). Container nodes with empty paths or with shapes we don't
 *  accept are visible but disabled (still expandable). */
function isPickable(node: FieldPath, accepts: ReadonlyArray<FieldShape>): boolean {
  if (!node.path) return false;
  if (accepts.length === 0) return true;
  return accepts.includes(node.shape);
}

interface TreeRowProps {
  node: FieldPath;
  depth: number;
  query: string;
  accepts: ReadonlyArray<FieldShape>;
  isPicked: (path: string) => boolean;
  togglePath: (path: string) => void;
  collapsed: Set<string>;
  toggleCollapse: (path: string) => void;
}

function TreeRow({
  node,
  depth,
  query,
  accepts,
  isPicked,
  togglePath,
  collapsed,
  toggleCollapse,
}: TreeRowProps) {
  const q = query.trim().toLowerCase();
  if (q && !subtreeMatchesQuery(node, q)) return null;

  const hasChildren = node.children.length > 0;
  // When the user is searching, auto-expand matched branches so the hit
  // is visible. Otherwise honor the user's collapse state.
  const isCollapsed = q ? false : collapsed.has(node.path);
  const pickable = isPickable(node, accepts);
  const picked = pickable && isPicked(node.path);

  return (
    <>
      <li>
        <div
          className={cn(
            'group flex items-start gap-1 px-2 py-1 rounded text-left',
            picked && 'bg-muted/60',
            pickable && 'hover:bg-muted cursor-pointer',
            !pickable && 'opacity-70',
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            if (pickable) togglePath(node.path);
          }}
        >
          {/* Expand/collapse caret — only when this node has children */}
          {hasChildren ? (
            <button
              type="button"
              className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(node.path);
              }}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed
                ? <ChevronRight className="h-3 w-3" />
                : <ChevronDown className="h-3 w-3" />}
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" aria-hidden />
          )}

          {/* Pick indicator */}
          <Check
            className={cn(
              'h-3 w-3 mt-1 flex-shrink-0',
              picked ? 'opacity-100' : 'opacity-0',
            )}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  'text-xs truncate',
                  pickable ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {node.label}
              </span>
              <Badge
                variant="outline"
                className={cn('text-[9px] px-1 py-0 flex-shrink-0', shapeColor(node.shape))}
              >
                {node.shape}
              </Badge>
              {node.isArrayNode && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 flex-shrink-0 bg-muted text-muted-foreground"
                >
                  [*]
                </Badge>
              )}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground truncate">
              {node.path || <em className="italic">(root)</em>}
            </div>
          </div>
        </div>
      </li>
      {hasChildren && !isCollapsed && (
        <li>
          <ul className="m-0 p-0">
            {node.children.map((child) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                query={query}
                accepts={accepts}
                isPicked={isPicked}
                togglePath={togglePath}
                collapsed={collapsed}
                toggleCollapse={toggleCollapse}
              />
            ))}
          </ul>
        </li>
      )}
    </>
  );
}

export function FieldRefPicker({
  schemas,
  schemaId,
  accepts = [],
  value,
  onChange,
  triggerClassName,
  emptyLabel,
  placeholder,
}: FieldRefPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Default-collapsed array containers so the tree is scannable; users
  // expand what they want to dive into. Tracked by path string.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const trees = useMemo(
    () => buildFieldTrees(schemas, schemaId),
    [schemas, schemaId],
  );

  // Any pickable nodes anywhere in the trees?
  const hasAnyPickable = useMemo(() => {
    const walk = (n: FieldPath): boolean => {
      if (isPickable(n, accepts)) return true;
      return n.children.some(walk);
    };
    return trees.some((t) => t.roots.some(walk));
  }, [trees, accepts]);

  const triggerLabel = (() => {
    if (value.kind === 'single') {
      if (!value.value) return placeholder ?? 'Pick a field…';
      return value.value;
    }
    if (value.value.length === 0) return placeholder ?? 'Pick fields…';
    if (value.value.length <= 2) return value.value.join(', ');
    return `${value.value[0]} +${value.value.length - 1}`;
  })();

  const isPicked = (path: string): boolean => {
    if (value.kind === 'single') return value.value === path;
    return value.value.includes(path);
  };

  function togglePath(path: string) {
    if (value.kind === 'single') {
      onChange({ kind: 'single', value: path });
      setOpen(false);
      return;
    }
    const has = value.value.includes(path);
    onChange({
      kind: 'multi',
      value: has ? value.value.filter((p) => p !== path) : [...value.value, path],
    });
  }

  function toggleCollapse(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function clear() {
    if (value.kind === 'single') onChange({ kind: 'single', value: null });
    else onChange({ kind: 'multi', value: [] });
  }

  const showClear =
    (value.kind === 'single' && value.value) ||
    (value.kind === 'multi' && value.value.length > 0);

  return (
    <div className={cn('flex items-center gap-1', triggerClassName)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 px-2 text-xs justify-between flex-1 min-w-0 font-mono',
              !showClear && 'text-muted-foreground',
            )}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown className="h-3 w-3 opacity-50 flex-shrink-0 ml-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[480px] p-0" align="start">
          <div className="border-b p-2 space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fields…"
                className="h-7 pl-7 text-xs"
              />
            </div>
            {showClear && (
              <button
                type="button"
                className="w-full text-[11px] text-muted-foreground hover:text-destructive flex items-center justify-center gap-1 py-1 rounded hover:bg-muted/60"
                onClick={() => {
                  clear();
                  setOpen(false);
                }}
              >
                <XIcon className="h-3 w-3" />
                Clear selection
              </button>
            )}
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {!hasAnyPickable ? (
              <div className="p-4 text-xs text-muted-foreground italic">
                {emptyLabel ?? (
                  schemas.length === 0
                    ? 'No schemas in this run.'
                    : (accepts.length > 0
                        ? `No fields of shape ${accepts.join(' / ')} in this schema.`
                        : 'No fields available.')
                )}
              </div>
            ) : (
              <div className="p-1">
                {trees.map((tree) => (
                  <div key={tree.schemaId} className="pb-1">
                    {/* Schema heading — only when multiple schemas are
                        visible at once. Single-schema mode skips it. */}
                    {trees.length > 1 && (
                      <div className="px-2 py-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b mb-1">
                        <FolderTree className="h-3 w-3" />
                        {tree.schemaName}
                      </div>
                    )}
                    <ul className="m-0 p-0">
                      {tree.roots.map((root) => (
                        <TreeRow
                          key={root.path}
                          node={root}
                          depth={0}
                          query={query}
                          accepts={accepts}
                          isPicked={isPicked}
                          togglePath={togglePath}
                          collapsed={collapsed}
                          toggleCollapse={toggleCollapse}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {showClear && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 flex-shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => clear()}
          title="Clear selection"
        >
          <XIcon className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
