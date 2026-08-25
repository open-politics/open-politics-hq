'use client';

/**
 * Value — a rendered value, with the justification that produced it.
 *
 * **Justification is a property of a value, not a pane.** It used to be a
 * global switch (`hudShowJustifications`) on one panel plus an "Evidence" pane
 * with a three-way source selector — `inline | occurrences | both` — because
 * an inline justification and an `Evidence`-typed occurrence were modelled as
 * two different things. They are the same thing seen from two ends: something
 * the document said, and why the model believed it.
 *
 * So every surface renders values through here — a list cell, a matrix cell, a
 * lane tick, a node-info row, an edge label — and the rule is uniform:
 *
 *   **a value that has a justification always shows that it has one, and one
 *   gesture reveals it.**
 *
 * The other rule this component exists to hold: `quote` is what the document
 * said and `reasoning` is the model's account of why. They are styled
 * differently and the quote always leads, because it is the half a reader can
 * check. Presenting reasoning as though the document said it is the single
 * failure mode that would make this whole surface untrustworthy.
 */
import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Quote } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';

/** How a value is drawn, from what the schema declared about the field.
 *
 *  Mirrors `x-axis.kind` (`sections.py::AXIS_KINDS`). The kinds are the
 *  algebra — six of them, closed — so this switch can be exhaustive and stay
 *  that way. */
export type AxisKind =
  | 'nominal' | 'ordinal' | 'metric' | 'interval' | 'spatial' | 'polar';

export interface ValueProvenance {
  /** The document's own words. */
  quote?: string | null;
  /** The model's account of *why*. Never presented as a quote. */
  reasoning?: string | null;
  /** Where in the document. */
  locator?: string | null;
  source?: string | null;
  /** supports · contradicts · corrects · retracts. */
  stance?: string | null;
  confidence?: number | null;
  assetTitle?: string | null;
  annotationId?: number | null;
}

export interface ValueProps {
  value: React.ReactNode;
  /** Declared kind, when the schema said. Drives how the value is drawn. */
  axisKind?: AxisKind | null;
  /** Only meaningful for `metric`. `null` means uncalibrated: the engine
   *  refuses to sum it across documents, and so should a reader. */
  unit?: string | null;
  /** Ordered scale, for `ordinal` — position in it is the information. */
  order?: readonly string[] | null;
  provenance?: ValueProvenance | ValueProvenance[] | null;
  className?: string;
  /** Suppress the marker where the surface renders provenance itself (the
   *  evidence pane, which IS a list of justifications). */
  bare?: boolean;
}

const STANCE_TONE: Record<string, string> = {
  contradicts: 'text-rose-600 dark:text-rose-400',
  retracts: 'text-rose-600 dark:text-rose-400',
  denied: 'text-rose-600 dark:text-rose-400',
  corrects: 'text-amber-600 dark:text-amber-400',
  alleged: 'text-amber-600 dark:text-amber-400',
  supports: 'text-emerald-700 dark:text-emerald-400',
  documented: 'text-emerald-700 dark:text-emerald-400',
};

function asArray(p: ValueProps['provenance']): ValueProvenance[] {
  if (!p) return [];
  return Array.isArray(p) ? p : [p];
}

/** Does this justification say anything? An empty one must render no marker —
 *  a marker that reveals nothing teaches a reader to stop clicking. */
function hasContent(p: ValueProvenance): boolean {
  return Boolean(p.quote || p.reasoning || p.locator || p.source);
}

function ProvenanceCard({ p }: { p: ValueProvenance }) {
  return (
    <div className="space-y-1.5 text-[11px] leading-relaxed">
      {p.quote && (
        <p className="border-l-2 border-amber-400/80 pl-2 italic text-foreground">
          {p.quote}
        </p>
      )}
      {p.reasoning && (
        <p className="text-muted-foreground">{p.reasoning}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {p.stance && (
          <span className={cn('font-medium', STANCE_TONE[p.stance.toLowerCase()])}>
            {p.stance}
          </span>
        )}
        {p.locator && <span>{p.locator}</span>}
        {p.source && <span className="truncate">{p.source}</span>}
        {p.assetTitle && <span className="truncate italic">{p.assetTitle}</span>}
        {p.confidence != null && (
          <span className="tabular-nums">{(p.confidence * 100).toFixed(0)}%</span>
        )}
      </div>
    </div>
  );
}

/** How the value itself is drawn, before any provenance. */
function Rendered({ value, axisKind, unit, order }: ValueProps) {
  if (axisKind === 'metric') {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n)) {
      return (
        <span className="tabular-nums">
          {n.toLocaleString()}
          {/* An uncalibrated metric is marked as one. The engine refuses to
              sum it across documents; a reader should know not to either. */}
          <span className="ml-1 text-[10px] text-muted-foreground">
            {unit ?? 'uncalibrated'}
          </span>
        </span>
      );
    }
  }

  if (axisKind === 'ordinal' && order?.length) {
    const i = order.findIndex(o => o === String(value));
    return (
      <span className="inline-flex items-baseline gap-1">
        <span>{value}</span>
        {i >= 0 && (
          // Position in the declared scale, not just the word. `alleged` and
          // `documented` are not interchangeable and should not look it.
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {i + 1}/{order.length}
          </span>
        )}
      </span>
    );
  }

  if (axisKind === 'polar') {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n)) {
      return (
        <span className={cn('tabular-nums',
          n < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400')}>
          {n > 0 ? '+' : ''}{n.toLocaleString()}
        </span>
      );
    }
  }

  return <>{value}</>;
}

export function Value(props: ValueProps) {
  const { className, bare } = props;
  const [open, setOpen] = useState(false);
  const items = asArray(props.provenance).filter(hasContent);

  if (bare || items.length === 0) {
    return (
      <span className={className}>
        <Rendered {...props} />
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          className={cn(
            'group inline-flex items-baseline gap-0.5 text-left',
            'underline decoration-dotted decoration-amber-500/60 underline-offset-2',
            'hover:decoration-amber-500',
            className,
          )}
          title={
            items.length === 1
              ? 'Show the words behind this'
              : `${items.length} justifications`
          }
        >
          <Rendered {...props} />
          <Quote className="h-2.5 w-2.5 shrink-0 self-start text-amber-500/70 group-hover:text-amber-500" />
          {items.length > 1 && (
            <span className="text-[9px] tabular-nums text-amber-600/80">
              {items.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-h-72 overflow-y-auto space-y-2 p-2.5"
        onClick={e => e.stopPropagation()}
      >
        {items.map((p, i) => (
          <React.Fragment key={p.annotationId ?? i}>
            {i > 0 && <div className="border-t border-border/50" />}
            <ProvenanceCard p={p} />
          </React.Fragment>
        ))}
      </PopoverContent>
    </Popover>
  );
}
