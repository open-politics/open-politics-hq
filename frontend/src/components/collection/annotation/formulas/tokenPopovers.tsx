'use client';

/**
 * Token popovers for FormulaMathLine — the inline editors users see when
 * they click a token on the math line.
 *
 * Each popover takes the current ``Formula``, the clicked ``MathToken``
 * (whose ``ref`` encodes the slot — see ``formulaMath.ts``), and an
 * ``onUpdate`` callback. The popover reads the slot, renders a tight
 * editor, and calls ``onUpdate(nextFormula)`` on change. The parent
 * (``FormulaMathLine``) closes the popover after each commit.
 *
 * Designed to be tight — popovers should fit in <320px wide, render
 * inline without scrolling for the common case, and avoid scrolly
 * select lists where a row of buttons would do.
 */

import React, { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { walkOutputContract, flattenFieldPaths, type FieldPath } from '@/lib/annotations/fieldPaths';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import type { Formula, Measure, Dimension, AnnotationSchemaRead } from '@/client';


// ─── Common props ────────────────────────────────────────────────────────────


export interface TokenPopoverProps {
  formula: Formula;
  ref: string;                  // the token's slot identifier
  schemas?: AnnotationSchemaRead[];
  onUpdate: (next: Formula) => void;
  onClose: () => void;
}


// ─── 1. Name ──────────────────────────────────────────────────────────────────


export const NamePopover: React.FC<TokenPopoverProps> = ({ formula, onUpdate, onClose }) => {
  const [draft, setDraft] = useState(formula.name);

  function commit() {
    const next = draft.trim();
    if (next && next !== formula.name) {
      onUpdate({ ...formula, name: next });
    }
    onClose();
  }

  return (
    <div className="space-y-2 w-64">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rename</div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onClose();
        }}
        autoFocus
        className="h-7 text-sm font-mono"
      />
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onClose}>cancel</Button>
        <Button size="sm" variant="default" className="h-6 text-xs" onClick={commit}>save</Button>
      </div>
    </div>
  );
};


// ─── 2. Aggregation picker ───────────────────────────────────────────────────


const AGG_OPTIONS: Array<{ value: Measure['agg']; label: string; hint: string }> = [
  { value: 'count',        label: 'count',        hint: 'rows per group' },
  { value: 'sum',          label: '∑ sum',        hint: 'sum of numeric / weighted' },
  { value: 'mean',         label: 'mean',         hint: 'average / weighted mean' },
  { value: 'median',       label: 'median',       hint: 'p50' },
  { value: 'mode',         label: 'mode',         hint: 'most common value' },
  { value: 'min',          label: 'min',          hint: 'smallest' },
  { value: 'max',          label: 'max',          hint: 'largest' },
  { value: 'distribution', label: 'distribution', hint: '{value: count} per group' },
  { value: 'top',          label: 'top N',        hint: 'evidence rows (not aggregated)' },
];

export const AggregationPopover: React.FC<TokenPopoverProps> = ({
  formula, ref: slot, onUpdate, onClose,
}) => {
  // slot is ``measure:<name>/agg`` or ``weight/agg``
  const measureName = slot.startsWith('measure:')
    ? slot.slice('measure:'.length).split('/')[0]
    : null;
  const measure = measureName
    ? formula.measures?.find(m => m.name === measureName) ?? null
    : null;
  const isWeight = slot === 'weight/agg';

  const current = isWeight ? (formula.weight?.agg ?? 'count') : (measure?.agg ?? 'count');

  function pick(next: Measure['agg']) {
    if (isWeight && formula.weight) {
      onUpdate({ ...formula, weight: { ...formula.weight, agg: next } });
    } else if (measure) {
      onUpdate({
        ...formula,
        measures: (formula.measures ?? []).map(m =>
          m.name === measure.name ? { ...m, agg: next } : m,
        ),
      });
    }
    onClose();
  }

  return (
    <div className="space-y-2 w-64">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Aggregation
      </div>
      <div className="grid grid-cols-1 gap-0.5">
        {AGG_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => pick(opt.value)}
            className={cn(
              'flex items-center justify-between gap-2 px-2 py-1 rounded text-sm',
              'hover:bg-accent text-left',
              current === opt.value && 'bg-accent/50',
            )}
          >
            <span className="font-mono">{opt.label}</span>
            <span className="text-[10px] text-muted-foreground">{opt.hint}</span>
            {current === opt.value && <Check className="h-3 w-3 text-foreground" />}
          </button>
        ))}
      </div>
    </div>
  );
};


// ─── 3. Field path picker ────────────────────────────────────────────────────


function useAllFieldPaths(schemas: AnnotationSchemaRead[] | undefined): FieldPath[] {
  return useMemo(() => {
    if (!schemas || schemas.length === 0) return [];
    const flat: FieldPath[] = [];
    for (const s of schemas) {
      const roots = walkOutputContract(s);
      flat.push(...flattenFieldPaths(roots));
    }
    return flat;
  }, [schemas]);
}

export const FieldPathPopover: React.FC<TokenPopoverProps> = ({
  formula, ref: slot, schemas, onUpdate, onClose,
}) => {
  const [search, setSearch] = useState('');
  const allPaths = useAllFieldPaths(schemas);

  const filtered = useMemo(() => {
    if (!search.trim()) return allPaths;
    const q = search.toLowerCase();
    return allPaths.filter(p =>
      p.path.toLowerCase().includes(q) ||
      p.label?.toLowerCase().includes(q),
    );
  }, [allPaths, search]);

  // Resolve current path so we can highlight it.
  const currentPath = resolvePath(formula, slot);

  function pick(path: string) {
    onUpdate(applyPath(formula, slot, path));
    onClose();
  }

  return (
    <div className="space-y-2 w-80">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Field path
      </div>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search paths…"
        autoFocus
        className="h-7 text-xs font-mono"
      />
      <ScrollArea className="h-64">
        <div className="space-y-0.5 pr-2">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground italic px-2 py-3">
              {schemas && schemas.length > 0
                ? 'No matching paths.'
                : 'No schemas attached to this run — bind one first.'}
            </div>
          ) : (
            filtered.map(p => (
              <button
                key={p.path}
                type="button"
                onClick={() => pick(p.path)}
                className={cn(
                  'w-full flex items-start gap-2 px-2 py-1 rounded text-left',
                  'hover:bg-accent',
                  currentPath === p.path && 'bg-accent/50',
                )}
              >
                <span className="font-mono text-[10px] flex-1 break-all">{p.path}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{p.shape}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};


function resolvePath(formula: Formula, slot: string): string | null {
  if (slot.startsWith('measure:')) {
    const [_, rest] = slot.split(':');
    const [name, kind] = rest.split('/');
    const m = formula.measures?.find(x => x.name === name);
    if (!m) return null;
    if (kind === 'path') return m.path ?? null;
    if (kind === 'top_by') return m.top_by ?? null;
  }
  if (slot === 'weight/path') return formula.weight?.path ?? null;
  if (slot.startsWith('dim:')) {
    const name = slot.slice('dim:'.length);
    return formula.group?.find(d => d.name === name)?.path ?? null;
  }
  return null;
}

function applyPath(formula: Formula, slot: string, path: string): Formula {
  if (slot.startsWith('measure:')) {
    const [_, rest] = slot.split(':');
    const [name, kind] = rest.split('/');
    const next = (formula.measures ?? []).map(m => {
      if (m.name !== name) return m;
      if (kind === 'path') return { ...m, path };
      if (kind === 'top_by') return { ...m, top_by: path };
      return m;
    });
    return { ...formula, measures: next };
  }
  if (slot === 'weight/path') {
    const cur = formula.weight ?? { name: '_w', path, agg: 'count' as const };
    return { ...formula, weight: { ...cur, path } };
  }
  if (slot.startsWith('dim:')) {
    const name = slot.slice('dim:'.length);
    const next = (formula.group ?? []).map(d =>
      d.name === name ? { ...d, path } : d,
    );
    return { ...formula, group: next };
  }
  return formula;
}


// ─── 4. Composition reference picker — @formula.col ─────────────────────────


export const CompositionPopover: React.FC<TokenPopoverProps> = ({
  formula, ref: slot, onUpdate, onClose,
}) => {
  // slot is ``composition:<formula>.<col>``
  const initial = slot.startsWith('composition:') ? slot.slice('composition:'.length) : '';
  const [refFormula, refCol] = initial.includes('.') ? initial.split('.', 2) : [initial, ''];

  // Saved formulas on this run come from the dashboard's formulas[]. The
  // composing formula is excluded so the author can't accidentally
  // reference themselves (cycle detection lives in the backend, but the
  // picker shouldn't suggest the loop).
  const formulas = useAnnotationRunStore(
    useShallow(s => (s.dashboardConfig?.formulas ?? []) as unknown as Formula[]),
  );
  const candidates = useMemo(
    () => formulas.filter(f => f.id !== formula.id),
    [formulas, formula.id],
  );

  const [selectedName, setSelectedName] = useState(refFormula);
  const target = useMemo(
    () => candidates.find(f => f.name === selectedName) ?? null,
    [candidates, selectedName],
  );

  function commit(formulaName: string, colName: string) {
    const ref = `@${formulaName}.${colName}`;
    // The math line renders derive expressions as opaque text tokens, so
    // we splice the new reference into the LAST derive's expression. The
    // user-facing affordance: clicking the @ token swaps the target; the
    // editor text-mode is the path for free-form expression edits.
    const derives = [...(formula.derives ?? [])];
    if (derives.length === 0) {
      onClose();
      return;
    }
    const lastIdx = derives.length - 1;
    const cur = derives[lastIdx];
    const next = cur.expr.replace(/@[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/, ref);
    derives[lastIdx] = { ...cur, expr: next };
    onUpdate({ ...formula, derives });
    onClose();
  }

  return (
    <div className="space-y-2 w-80">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Composition reference
      </div>
      {candidates.length === 0 ? (
        <div className="text-xs text-muted-foreground italic px-2 py-3">
          No other formulas on this run — author one first to compose against it.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground">Formula</label>
            <div className="grid grid-cols-1 gap-0.5 max-h-32 overflow-y-auto">
              {candidates.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedName(f.name)}
                  className={cn(
                    'flex items-center justify-between px-2 py-1 rounded text-sm',
                    'hover:bg-accent text-left',
                    selectedName === f.name && 'bg-accent/50',
                  )}
                >
                  <span className="font-mono">{f.name}</span>
                  {selectedName === f.name && <Check className="h-3 w-3" />}
                </button>
              ))}
            </div>
          </div>
          {target && (
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">Column</label>
              <div className="grid grid-cols-1 gap-0.5 max-h-32 overflow-y-auto">
                {[
                  ...(target.measures ?? []).map(m => m.name),
                  ...(target.derives ?? []).map(d => d.name),
                ].map(col => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => commit(target.name, col)}
                    className={cn(
                      'flex items-center justify-between px-2 py-1 rounded text-sm',
                      'hover:bg-accent text-left',
                      refCol === col && 'bg-accent/50',
                    )}
                  >
                    <span className="font-mono">{col}</span>
                    {refCol === col && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};


// ─── 5. Dimension editor ─────────────────────────────────────────────────────


const DIM_KIND_OPTIONS: Array<{ value: Dimension['kind']; label: string; hint: string }> = [
  { value: 'field',  label: 'field',  hint: 'plain categorical / numeric' },
  { value: 'entity', label: 'entity', hint: 'canon-resolvable name' },
  { value: 'time',   label: 'time',   hint: 'ISO date — adds interval' },
  { value: 'doc',    label: 'doc',    hint: 'document-level field' },
  { value: 'geo',    label: 'geo',    hint: 'geocoder-friendly' },
];

const INTERVAL_OPTIONS: Array<Dimension['interval']> = [
  'day', 'week', 'month', 'quarter', 'year',
];

export const DimensionPopover: React.FC<TokenPopoverProps> = ({
  formula, ref: slot, schemas, onUpdate, onClose,
}) => {
  // slot is ``dim:<name>``
  const dimName = slot.startsWith('dim:') ? slot.slice('dim:'.length) : null;
  const dim = dimName ? formula.group?.find(d => d.name === dimName) ?? null : null;

  const [name, setName] = useState(dim?.name ?? '');
  const [kind, setKind] = useState<Dimension['kind']>(dim?.kind ?? 'field');
  const [interval, setInterval] = useState<Dimension['interval']>(dim?.interval ?? 'month');
  const [showPathPicker, setShowPathPicker] = useState(false);
  const [path, setPath] = useState(dim?.path ?? '');

  const allPaths = useAllFieldPaths(schemas);
  const [pathSearch, setPathSearch] = useState('');
  const filteredPaths = useMemo(() => {
    if (!pathSearch.trim()) return allPaths;
    const q = pathSearch.toLowerCase();
    return allPaths.filter(p =>
      p.path.toLowerCase().includes(q) ||
      p.label?.toLowerCase().includes(q),
    );
  }, [allPaths, pathSearch]);

  function commit() {
    if (!dim) {
      onClose();
      return;
    }
    const next: Dimension = {
      ...dim,
      name: name.trim() || dim.name,
      kind,
      interval: kind === 'time' ? interval : null,
      path,
    };
    onUpdate({
      ...formula,
      group: (formula.group ?? []).map(d => d.name === dim.name ? next : d),
    });
    onClose();
  }

  function removeDim() {
    if (!dim) {
      onClose();
      return;
    }
    onUpdate({
      ...formula,
      group: (formula.group ?? []).filter(d => d.name !== dim.name),
    });
    onClose();
  }

  return (
    <div className="space-y-2 w-80">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Dimension
        </div>
        <Button
          size="sm" variant="ghost"
          className="h-5 text-[10px] text-muted-foreground hover:text-destructive"
          onClick={removeDim}
        >
          remove
        </Button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] text-muted-foreground">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-xs font-mono"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] text-muted-foreground">Path</label>
        <Button
          variant="outline" size="sm"
          className="w-full justify-start h-7 text-xs font-mono"
          onClick={() => setShowPathPicker(o => !o)}
        >
          {path || <span className="text-muted-foreground italic">pick a path</span>}
        </Button>
        {showPathPicker && (
          <div className="border rounded p-1.5 space-y-1.5">
            <Input
              value={pathSearch}
              onChange={(e) => setPathSearch(e.target.value)}
              placeholder="Search…"
              className="h-6 text-[10px] font-mono"
              autoFocus
            />
            <ScrollArea className="h-40">
              <div className="space-y-0.5 pr-2">
                {filteredPaths.slice(0, 50).map(p => (
                  <button
                    key={p.path}
                    type="button"
                    onClick={() => { setPath(p.path); setShowPathPicker(false); }}
                    className={cn(
                      'w-full flex items-start gap-2 px-1.5 py-0.5 rounded text-left',
                      'hover:bg-accent',
                      path === p.path && 'bg-accent/50',
                    )}
                  >
                    <span className="font-mono text-[10px] flex-1 break-all">{p.path}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{p.shape}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] text-muted-foreground">Kind</label>
        <div className="grid grid-cols-5 gap-1">
          {DIM_KIND_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKind(opt.value)}
              title={opt.hint}
              className={cn(
                'px-1.5 py-1 rounded text-[10px] border',
                kind === opt.value
                  ? 'bg-accent border-foreground/30'
                  : 'border-border hover:bg-accent/50',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {kind === 'time' && (
        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground">Interval</label>
          <div className="grid grid-cols-5 gap-1">
            {INTERVAL_OPTIONS.map(iv => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                className={cn(
                  'px-1.5 py-1 rounded text-[10px] border',
                  interval === iv
                    ? 'bg-accent border-foreground/30'
                    : 'border-border hover:bg-accent/50',
                )}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-1 pt-1">
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onClose}>cancel</Button>
        <Button size="sm" variant="default" className="h-6 text-xs" onClick={commit}>save</Button>
      </div>
    </div>
  );
};
