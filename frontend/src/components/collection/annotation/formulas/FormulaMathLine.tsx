'use client';

/**
 * FormulaMathLine — the primitive renderer for a Formula as a single line
 * of paper-style math.
 *
 * This is intentionally a *primitive*: it takes a Formula, displays it as
 * styled tokens, and (optionally, when ``editable``) wires click-to-edit
 * popovers on each clickable token. It is droppable anywhere — inside the
 * FormulaWorkspace, on a panel header, in a chat message, on an
 * ObservationCard. Wherever a Formula needs to be shown, drop a
 * FormulaMathLine.
 *
 * Two modes:
 *   - display:  styled JSX, tokens are spans (no interactions). The default
 *               for inline references in non-edit contexts.
 *   - editable: same styling, but click-token-to-edit popovers wired and a
 *               small "edit text" button toggles to a textarea where the
 *               canonical math text is editable directly (parsed on blur).
 *
 * Rendering rules locked with the user (2026-05-20):
 *   - Hybrid glyphs: ∑ for sum; sum-form for weighted (∑(x · w) / ∑(w));
 *     `count`, `mean`, `median`, `mode`, `min`, `max`, `distribution`, `top N`
 *     spelled as words. Operators `·` `/` `+` `-`; logic `AND` / `OR`.
 *   - Field paths inside aggregates render as leaf-only; full path on hover/click.
 *   - Subscript dims: dim NAME only (path lives in popover). Time dims show
 *     `by interval` instead of the dim name when name == interval.
 *   - `where:` clause inline when short; wraps when long.
 *   - Composition references `@formula.col` render as a single styled chip.
 */

import React, { useMemo, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  parseFormula,
  renderFormula,
  tokenizeFormula,
  type MathToken,
} from '@/lib/annotations/formulaMath';
import {
  AggregationPopover,
  CompositionPopover,
  DimensionPopover,
  FieldPathPopover,
  NamePopover,
} from './tokenPopovers';
import type { AnnotationSchemaRead, Formula } from '@/client';


// ─── Token style table ───────────────────────────────────────────────────────


const tokenClass: Record<MathToken['kind'], string> = {
  name:              'font-semibold text-foreground',
  eq:                'text-muted-foreground',
  agg:               'text-sky-700 dark:text-sky-300 font-medium',
  field:             'text-emerald-700 dark:text-emerald-300',
  op:                'text-muted-foreground',
  paren:             'text-muted-foreground',
  'subscript-open':  'hidden',  // rendered as <sub> wrapper
  'subscript-close': 'hidden',
  'subscript-content': 'text-foreground',
  composition:       'text-violet-700 dark:text-violet-300 font-medium',
  'where-kw':        'text-muted-foreground',
  logic:             'text-muted-foreground',
  literal:           'text-amber-700 dark:text-amber-300',
  unknown:           'text-foreground',
};


// ─── Popover content dispatch ────────────────────────────────────────────────


function PopoverContentForToken({
  token, formula, schemas, onUpdate, onClose,
}: {
  token: MathToken;
  formula: Formula;
  schemas?: AnnotationSchemaRead[];
  onUpdate: (next: Formula) => void;
  onClose: () => void;
}) {
  if (!token.ref) return <UnknownSlot token={token} />;
  const common = { formula, ref: token.ref, schemas, onUpdate, onClose };
  if (token.kind === 'name')              return <NamePopover {...common} />;
  if (token.kind === 'agg')               return <AggregationPopover {...common} />;
  if (token.kind === 'field')             return <FieldPathPopover {...common} />;
  if (token.kind === 'subscript-content') return <DimensionPopover {...common} />;
  if (token.kind === 'composition')       return <CompositionPopover {...common} />;
  // ``unknown`` tokens carry the raw derive expression text. If the expr
  // references a saved formula via @name.col, route to the composition
  // popover so the user can swap the target without dropping to text mode.
  if (token.kind === 'unknown' && /@[A-Za-z_][A-Za-z0-9_]*/.test(token.text)) {
    const match = token.text.match(/@([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/);
    if (match) {
      const compRef = `composition:${match[1]}.${match[2] ?? ''}`;
      return <CompositionPopover {...common} ref={compRef} />;
    }
  }
  return <UnknownSlot token={token} />;
}

function UnknownSlot({ token }: { token: MathToken }) {
  // Fallback for token kinds we haven't wired editors for yet (composition,
  // filter literal — these stay text-mode-only for now).
  return (
    <div className="text-xs font-mono space-y-1 max-w-xs">
      <div className="text-muted-foreground">
        editor for <span className="font-semibold text-foreground">{token.kind}</span> tokens
        not wired yet — use the <span className="font-semibold text-foreground">edit</span> button
        to drop into text mode.
      </div>
    </div>
  );
}


// ─── Single token ────────────────────────────────────────────────────────────


interface TokenProps {
  token: MathToken;
  formula: Formula;
  editable: boolean;
  schemas?: AnnotationSchemaRead[];
  onUpdate?: (formula: Formula) => void;
}

function FormulaToken({ token, formula, editable, schemas, onUpdate }: TokenProps) {
  const [open, setOpen] = useState(false);
  const cls = tokenClass[token.kind] ?? '';

  // Non-clickable tokens. ``unknown`` is clickable when it contains an
  // ``@formula`` composition ref — the dispatch in PopoverContentForToken
  // gates the popover so non-composition unknowns still pass through here
  // as static text.
  const nonClickable: MathToken['kind'][] = [
    'eq', 'op', 'paren', 'where-kw', 'subscript-open', 'subscript-close',
  ];
  const unknownHasComp = token.kind === 'unknown'
    && /@[A-Za-z_][A-Za-z0-9_]*/.test(token.text);
  if (
    !editable
    || nonClickable.includes(token.kind)
    || (token.kind === 'unknown' && !unknownHasComp)
  ) {
    // ``field`` tokens carry the full path in their resolved formula slot;
    // show the dotted JSONB path on hover from the live formula lookup so
    // the tooltip stays accurate after popover edits.
    const tooltipPath = token.kind === 'field'
      ? resolveFieldPath(formula, token.ref) ?? undefined
      : undefined;
    return (
      <span className={cls} title={tooltipPath}>
        {token.text}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            cls,
            'cursor-pointer rounded px-0.5 hover:bg-accent/40 hover:underline decoration-dotted underline-offset-4',
            'focus:outline-none focus:ring-1 focus:ring-ring',
          )}
        >
          {token.text}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-2">
        <PopoverContentForToken
          token={token}
          formula={formula}
          schemas={schemas}
          onUpdate={(next) => onUpdate?.(next)}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}


/** Lookup the live JSONB path for a ``field`` token's slot — used for the
 *  hover tooltip so it always reflects the current formula body. */
function resolveFieldPath(formula: Formula, slot?: string): string | null {
  if (!slot) return null;
  if (slot.startsWith('measure:')) {
    const [, rest] = slot.split(':');
    const [name, kind] = rest.split('/');
    const m = formula.measures?.find(x => x.name === name);
    if (!m) return null;
    if (kind === 'path') return m.path ?? null;
    if (kind === 'top_by') return m.top_by ?? null;
  }
  if (slot === 'weight/path') return formula.weight?.path ?? null;
  return null;
}


// ─── Subscript batcher ───────────────────────────────────────────────────────


/**
 * Walks the flat token stream and folds runs between ``subscript-open`` and
 * ``subscript-close`` into a styled <sub> wrapper. The interior tokens stay
 * individually clickable.
 */
function renderTokenStream(
  tokens: MathToken[],
  formula: Formula,
  editable: boolean,
  schemas?: AnnotationSchemaRead[],
  onUpdate?: (formula: Formula) => void,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let subBuf: React.ReactNode[] | null = null;
  let key = 0;

  for (const tok of tokens) {
    if (tok.kind === 'subscript-open') {
      subBuf = [];
      // small leading underscore as a visual anchor; the `_` reads as the
      // math subscript marker without being a clickable token.
      out.push(
        <span key={`o-${key++}`} className="text-muted-foreground"> _</span>
      );
      continue;
    }
    if (tok.kind === 'subscript-close') {
      if (subBuf) {
        out.push(
          <sub
            key={`sub-${key++}`}
            className="text-[0.75em] align-sub mx-0.5"
          >
            {subBuf}
          </sub>
        );
      }
      subBuf = null;
      continue;
    }
    const node = (
      <FormulaToken
        key={`t-${key++}`}
        token={tok}
        formula={formula}
        editable={editable}
        schemas={schemas}
        onUpdate={onUpdate}
      />
    );
    if (subBuf) subBuf.push(node);
    else out.push(node);
  }
  return out;
}


// ─── The component ──────────────────────────────────────────────────────────


export interface FormulaMathLineProps {
  formula: Formula;
  /** When true, clickable tokens open popovers and the "edit text" toggle
   *  is available. Default false — purely display. */
  editable?: boolean;
  /** Called when an edit lands (popover change, text-edit blur). */
  onUpdate?: (formula: Formula) => void;
  /** Schemas attached to the formula's run. Field/Dimension popovers
   *  use this to populate the path tree. Optional — popovers degrade
   *  gracefully when omitted (the field picker shows an empty-schema
   *  message). */
  schemas?: AnnotationSchemaRead[];
  /** Extra class for the outer container. */
  className?: string;
}

export function FormulaMathLine({
  formula,
  editable = false,
  onUpdate,
  schemas,
  className,
}: FormulaMathLineProps) {
  const [textMode, setTextMode] = useState(false);
  const [draft, setDraft] = useState<string>(() => renderFormula(formula));
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  const tokens = useMemo(() => tokenizeFormula(formula), [formula]);

  // Reset draft when the formula changes underneath us (e.g. via a popover).
  React.useEffect(() => {
    setDraft(renderFormula(formula));
  }, [formula]);

  if (textMode && editable) {
    return (
      <div className={cn('font-mono text-sm leading-relaxed', className)}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const result = parseFormula(draft);
            setParseErrors(result.errors);
            // Merge parsed body onto the existing formula (preserve id, etc.).
            onUpdate?.({ ...formula, ...result.formula });
            setTextMode(false);
          }}
          autoFocus
          rows={2}
          className={cn(
            'w-full px-2 py-1 rounded border bg-background',
            'font-mono text-sm leading-relaxed resize-y min-h-[2rem]',
            'focus:outline-none focus:ring-1 focus:ring-ring',
          )}
        />
        {parseErrors.length > 0 && (
          <ul className="mt-1 text-xs text-destructive">
            {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className={cn('font-mono text-sm leading-relaxed flex flex-wrap items-baseline', className)}>
      {renderTokenStream(tokens, formula, editable, schemas, onUpdate)}
      {editable && (
        <button
          type="button"
          onClick={() => setTextMode(true)}
          className="ml-3 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
          title="Edit as text"
        >
          edit
        </button>
      )}
    </div>
  );
}
