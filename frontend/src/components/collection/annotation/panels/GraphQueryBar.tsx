'use client';

/**
 * GraphQueryBar — the single locus of "what's shown".
 *
 * One text field, three tiers behind it (see `lib/query/graph_query_language`
 * and `modules/graph/gql.py`). The bar shows which tier each pill runs in,
 * because it is a real distinction: a tier-1 pill is pushed into SQL and scales
 * with the corpus, while tier 2/3 pills run over the *projection* — the capped
 * top-N node set — so `hops:3` walks that view, not the whole database. Saying
 * so beats implying otherwise.
 *
 * The value lives on `panel_config`, which is what makes the companion able to
 * drive it: the LLM writes a query string, the user sees exactly what was
 * written and can edit it. Same pattern as the content explorer.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CornerDownLeft, Filter, HelpCircle, Layers, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GQL_EXAMPLES,
  GQL_PREFIXES,
  type GraphQueryPill,
  appendGraphToken,
  parseGraphQueryToPills,
  removeGraphPill,
} from '@/lib/query/graph_query_language';

const TIER_STYLE: Record<1 | 2 | 3, { cls: string; note: string }> = {
  1: {
    cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    note: 'Pushed into SQL — filtered before aggregation, scales with the corpus.',
  },
  2: {
    cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
    note: 'Computed on the assembled projection (the capped top-N node set).',
  },
  3: {
    cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
    note: 'Traversal over the projection, applied after every other filter.',
  },
};

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Node/edge counts after filtering, for the result readout. */
  nodeCount: number;
  edgeCount: number;
  /** The cap in force, so "top N" is stated rather than assumed. */
  nodeCap?: number | null;
  className?: string;
}

export function GraphQueryBar({
  value, onChange, nodeCount, edgeCount, nodeCap, className,
}: Props) {
  // Local draft so typing doesn't refetch on every keystroke; committed on
  // Enter or blur. The graph query is a server round-trip, not a live filter.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const pills = useMemo(() => parseGraphQueryToPills(value), [value]);
  const dirty = draft !== value;

  const commit = () => { if (dirty) onChange(draft.trim()); };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') setDraft(value);
            }}
            onBlur={commit}
            placeholder='Filter and traverse — type:Person degree>2 from:"Merkel" hops:2'
            className="h-8 pl-7 pr-16 font-mono text-xs"
            spellCheck={false}
          />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {dirty && (
              <Button
                size="icon" variant="ghost" className="h-5 w-5"
                onClick={commit} title="Apply (Enter)"
              >
                <CornerDownLeft className="h-3 w-3" />
              </Button>
            )}
            {value && !dirty && (
              <Button
                size="icon" variant="ghost" className="h-5 w-5"
                onClick={() => onChange('')} title="Clear"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[30rem] p-3">
            <p className="mb-2 text-xs font-medium">Graph query</p>
            <p className="mb-2.5 text-[11px] leading-snug text-muted-foreground">
              Space is AND, comma is OR, <code className="font-mono">-</code> negates.
              Same grammar as the asset search bar, plus traversal.
            </p>
            <div className="mb-2.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              {GQL_PREFIXES.map(p => (
                <button
                  key={p.prefix}
                  onClick={() => setDraft(d => appendGraphToken(d, p.prefix))}
                  className="flex items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/60"
                >
                  <code className="font-mono text-[11px]">{p.prefix}</code>
                  <span className="truncate text-[10px] text-muted-foreground">{p.hint}</span>
                </button>
              ))}
            </div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">Examples</p>
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {GQL_EXAMPLES.map(ex => (
                <button
                  key={ex.q}
                  onClick={() => { setDraft(ex.q); onChange(ex.q); }}
                  className="block w-full rounded px-1.5 py-1 text-left hover:bg-muted/60"
                >
                  <code className="font-mono text-[11px]">{ex.q}</code>
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{ex.desc}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {(pills.length > 0 || value) && (
        <TooltipProvider>
          <div className="flex flex-wrap items-center gap-1">
            {pills.map((p, i) => (
              <Pill key={`${p.raw}-${i}`} pill={p} onRemove={() => onChange(removeGraphPill(value, i))} />
            ))}
            <span className="ml-auto flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
              {nodeCount} nodes · {edgeCount} edges
              {nodeCap ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex cursor-help items-center gap-0.5 underline decoration-dotted">
                      <Layers className="h-2.5 w-2.5" />
                      top {nodeCap}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[18rem] text-xs">
                    Shape filters and traversal run over this projection — the
                    highest-frequency {nodeCap} nodes — not the whole corpus.
                    Row filters (green) are applied in the database first.
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </span>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

function Pill({ pill, onRemove }: { pill: GraphQueryPill; onRemove: () => void }) {
  const style = TIER_STYLE[pill.tier];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn('h-5 gap-1 pl-1.5 pr-1 text-[10px] font-normal', style.cls)}
        >
          {pill.negated && <span className="font-semibold">not</span>}
          <span className="opacity-70">{pill.label}</span>
          <span className="font-mono">{pill.value}</span>
          <button onClick={onRemove} className="ml-0.5 rounded hover:bg-background/60">
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[18rem] text-xs">{style.note}</TooltipContent>
    </Tooltip>
  );
}
