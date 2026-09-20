'use client';

/**
 * QueryBar — one bar, wherever a query is written.
 *
 * The panel has one; every unlinked pane has its own. They are the same
 * component because they write the same language: a pane's query is not a
 * lesser filter form, it is the same string evaluated over a narrower set.
 * Two bar components would be two grammars within a week.
 *
 * Three properties it holds, and each replaces something that went wrong:
 *
 * * **A draft, committed by a person.** The value only changes on Enter, blur
 *   or Apply. This matters most for the ✨ path: the model *proposes* into the
 *   draft and never commits on the analyst's behalf, because a query that ran
 *   itself is a finding nobody chose to look for.
 * * **Tier colours.** A pill's tier is a real cost signal — tier 1 is pushed
 *   into SQL and scales with the corpus; tiers 2 and 3 run over the capped
 *   projection. Saying so beats implying otherwise.
 * * **Amber, not red, for what the run cannot answer.** GQL's free-text
 *   fallback is right for a half-typed human and dangerous for a model: a
 *   hallucinated `sector:finance` becomes a plausible substring match and
 *   returns something. Amber keeps both readings.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  CornerDownLeft, Filter, HelpCircle, Layers, Loader2, Sparkles, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  HUD_INPUT, HUD_LABEL, HUD_NUM, HUD_PROSE, HUD_SURFACE, HudButton, HudOverline,
} from '@/components/ui/chrome';
import {
  EMPTY_INDEX, applyCompletion, completions,
  type Completion, type GraphIndex,
} from './complete';
import {
  GQL_EXAMPLES, GQL_PREFIXES, GQL_TOKENS,
  type GraphQueryPill,
  appendGraphToken, parseGraphQueryToPills, removeGraphPill,
} from '@/lib/query/graph_query_language';

// A pill's hue is the one place in this bar where colour is load-bearing: it
// is a cost signal, not decoration. So the pills keep their hue and lose their
// fill — a tinted background on every pill turned the row into a stack of
// coloured blocks and made the tier harder to read, not easier. A dot carries
// the hue; the text stays neutral and legible.
const TIER_STYLE: Record<1 | 2 | 3, { dot: string; note: string }> = {
  1: {
    dot: 'bg-emerald-500',
    note: 'Pushed into SQL — filtered before aggregation, scales with the corpus.',
  },
  2: {
    dot: 'bg-sky-500',
    note: 'Computed on the assembled projection (the capped top-N node set).',
  },
  3: {
    dot: 'bg-violet-500',
    note: 'Traversal over the projection, applied after every other filter.',
  },
};

/** One thing the run cannot answer, from the validate endpoint. */
export interface QueryWarning {
  token: string;
  why: string;
  didYouMean?: string[];
}

export interface QueryBarProps {
  value: string;
  onChange: (next: string) => void;
  /** A query proposed from outside — the companion, a directive, an ✨ reply.
   *  Lands in the **draft**, never in the value: the proposer shows its work
   *  and the person commits. Change this to propose again; the bar seeds the
   *  draft on each new value it has not already seen. */
  proposed?: string | null;
  placeholder?: string;
  /** Compact form for a pane header. */
  dense?: boolean;
  nodeCount?: number;
  edgeCount?: number;
  nodeCap?: number | null;
  /** Amber pills — tokens that parse but this run has no values for. */
  warnings?: QueryWarning[];
  /** Natural language → query. Returns the proposed string; the bar puts it in
   *  the DRAFT and waits for a person. Absent ⇒ no ✨ button. */
  onAsk?: (prose: string) => Promise<string>;
  /** What this run is addressable by — `graph.meta.index`. Drives completion.
   *
   *  The addressing ladder was only ever *stated after the fact*: you wrote
   *  `CLUSTER:Location`, the query ran, and the legend told you what it had
   *  decided you meant. Right thing to say, wrong time. A completion says it
   *  while there is still a choice. */
  index?: GraphIndex;
  className?: string;
}

export function QueryBar({
  value, onChange, proposed, placeholder, dense, nodeCount, edgeCount, nodeCap,
  warnings, onAsk, index, className,
}: QueryBarProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  // A proposal seeds the draft and stops there. Tracked by last-seen rather
  // than by equality with the draft, so re-proposing the same string after the
  // analyst has edited it still lands.
  const lastProposed = useRef<string | null>(null);
  useEffect(() => {
    if (proposed == null || proposed === lastProposed.current) return;
    lastProposed.current = proposed;
    setDraft(proposed);
  }, [proposed]);

  // ── Completion ────────────────────────────────────────────────────────
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(
    () => (open ? completions(draft, caret, index ?? EMPTY_INDEX) : []),
    [open, draft, caret, index],
  );
  useEffect(() => { setActive(0); }, [suggestions.length]);

  const accept = (c: Completion) => {
    const next = applyCompletion(draft, caret, c);
    setDraft(next.text);
    setOpen(false);
    // Restore the caret after React writes the value, or it jumps to the end
    // and the next keystroke edits the wrong token.
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(next.caret, next.caret);
      inputRef.current?.focus();
      setCaret(next.caret);
    });
  };

  const [asking, setAsking] = useState(false);
  const [prose, setProse] = useState('');
  const [busy, setBusy] = useState(false);
  const proseRef = useRef<HTMLTextAreaElement>(null);

  const pills = useMemo(() => parseGraphQueryToPills(value), [value]);
  const dirty = draft !== value;
  const commit = () => { if (dirty) onChange(draft.trim()); };

  const warned = useMemo(
    () => new Set((warnings ?? []).map(w => w.token.toLowerCase())),
    [warnings],
  );

  const ask = async () => {
    if (!onAsk || !prose.trim()) return;
    setBusy(true);
    try {
      // Into the draft. The person commits — see the class docstring.
      setDraft(await onAsk(prose.trim()));
      setAsking(false);
      setProse('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Filter className={cn(
            'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-hud-dimmer',
            dense ? 'h-3 w-3' : 'h-3.5 w-3.5',
          )} />
          <Input
            ref={inputRef}
            value={draft}
            onChange={e => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setOpen(true);
            }}
            onSelect={e => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
            onKeyDown={e => {
              const list = suggestions;
              if (open && list.length) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault(); setActive(i => (i + 1) % list.length); return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive(i => (i - 1 + list.length) % list.length); return;
                }
                // Tab accepts, Enter commits. Two gestures because they are two
                // intentions, and conflating them means every completion you
                // did not want also runs a query.
                if (e.key === 'Tab') { e.preventDefault(); accept(list[active]); return; }
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
              }
              if (e.key === 'Enter') { e.preventDefault(); setOpen(false); commit(); }
              if (e.key === 'Escape') { setDraft(value); setOpen(false); }
            }}
            // Blur commits, but not before a click on a suggestion lands.
            onBlur={() => { setTimeout(() => setOpen(false), 120); commit(); }}
            placeholder={placeholder
              ?? 'Filter, walk, fold — type:Person degree>2 BY place'}
            className={cn(HUD_INPUT, 'pl-7 pr-14 font-mono',
                          dense ? 'h-7 text-[10px]' : 'h-8 text-[11px]')}
            spellCheck={false}
          />
          {open && suggestions.length > 0 && (
            <ul className={cn(HUD_SURFACE,
                              'absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto p-1')}>
              {suggestions.map((c, i) => (
                <li key={`${c.group}:${c.value}`}>
                  <button
                    type="button"
                    // `onMouseDown` — `onClick` fires after blur has already
                    // closed the list.
                    onMouseDown={e => { e.preventDefault(); accept(c); }}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-[11px]',
                      'transition-colors',
                      i === active
                        ? 'bg-hud-fill text-hud-fill-fg'
                        : 'text-hud-dim hover:bg-hud-sunken',
                    )}
                  >
                    <span className="font-mono">{c.value}</span>
                    <span className={cn('ml-auto truncate text-[10px]',
                                        i === active ? 'opacity-70' : 'text-hud-dimmer')}>
                      {c.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* One slot, one affordance. A bar that is dirty offers Apply and a
              bar that is clean offers Clear — never both, so the slot never
              shifts under the cursor. */}
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
            {dirty ? (
              <HudButton size="sm" icon={CornerDownLeft} onClick={commit}
                         title="Apply (Enter)"
                         className="border-transparent hover:border-transparent" />
            ) : value ? (
              <HudButton size="sm" icon={X} onClick={() => onChange('')}
                         title="Clear"
                         className="border-transparent hover:border-transparent" />
            ) : null}
          </div>
        </div>

        {onAsk && (
          <Popover
            open={asking}
            onOpenChange={o => { setAsking(o); if (o) setTimeout(() => proseRef.current?.focus(), 0); }}
          >
            <PopoverTrigger asChild>
              <HudButton
                icon={Sparkles}
                size={dense ? 'sm' : 'md'}
                active={asking}
                title="Ask in plain language"
              />
            </PopoverTrigger>
            <PopoverContent align="end" className={cn(HUD_SURFACE, 'w-96 p-2.5')}>
              <p className={cn(HUD_PROSE, 'mb-2 text-hud-dim')}>
                Describe what you want to see. The query lands in the bar for
                you to check — nothing runs until you press Enter.
              </p>
              <Textarea
                ref={proseRef}
                value={prose}
                onChange={e => setProse(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(); }
                }}
                rows={3}
                placeholder="who converges on port privatisation without ever touching"
                className={cn(HUD_INPUT, 'mb-2 text-[11px]')}
              />
              <div className="flex items-center justify-end gap-1.5">
                <span className={cn(HUD_NUM, 'mr-auto text-hud-dimmer')}>⌘↵</span>
                <HudButton
                  size="sm"
                  icon={busy ? Loader2 : undefined}
                  disabled={busy || !prose.trim()}
                  onClick={ask}
                  className={busy ? '[&_svg]:animate-spin' : undefined}
                >
                  Propose
                </HudButton>
              </div>
            </PopoverContent>
          </Popover>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <HudButton icon={HelpCircle} size={dense ? 'sm' : 'md'} title="Query syntax" />
          </PopoverTrigger>
          <PopoverContent align="end" className={cn(HUD_SURFACE, 'w-[32rem] space-y-3 p-3')}>
            <div>
              <p className="mb-1 text-[11px] font-medium text-hud-fg">Graph query</p>
              <p className={cn(HUD_PROSE, 'text-hud-dim')}>
                Space is AND, comma is OR, <code className="font-mono text-hud-fg">-</code> negates.
                UPPERCASE is a channel — it binds what the filters selected rather
                than narrowing it.
              </p>
            </div>

            <section className="space-y-1.5">
              <HudOverline>Prefixes</HudOverline>
              <div className="grid grid-cols-2 gap-x-3 gap-y-px">
                {GQL_PREFIXES.map(p => (
                  <button
                    key={p.prefix}
                    onClick={() => setDraft(d => appendGraphToken(d, p.prefix))}
                    className="flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-left
                               transition-colors hover:bg-hud-sunken"
                  >
                    <code className="font-mono text-[11px] text-hud-fg">{p.prefix}</code>
                    <span className="truncate text-[10px] text-hud-dimmer">{p.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* The gotchas, not just the syntax. This is the half that makes
                the difference between a query that parses and one that answers
                the question that was asked. */}
            <section className="space-y-1.5">
              <HudOverline>Worth knowing</HudOverline>
              <div className="max-h-40 space-y-1 overflow-y-auto px-1.5">
                {GQL_TOKENS.filter(t => t.semantics).map(t => (
                  <div key={t.token} className="leading-snug">
                    <code className="font-mono text-[10px] text-hud-fg">{t.token}</code>
                    <span className="ml-1.5 text-[10px] text-hud-dimmer">{t.semantics}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-1.5">
              <HudOverline>Examples</HudOverline>
              <div className="max-h-40 space-y-px overflow-y-auto">
                {GQL_EXAMPLES.map(ex => (
                  <button
                    key={ex.q}
                    onClick={() => { setDraft(ex.q); onChange(ex.q); }}
                    className="block w-full rounded-md px-1.5 py-1 text-left
                               transition-colors hover:bg-hud-sunken"
                  >
                    <code className="font-mono text-[11px] text-hud-fg">{ex.q}</code>
                    <span className="ml-1.5 text-[10px] text-hud-dimmer">{ex.desc}</span>
                  </button>
                ))}
              </div>
            </section>
          </PopoverContent>
        </Popover>
      </div>

      {(pills.length > 0 || (warnings?.length ?? 0) > 0) && (
        <TooltipProvider>
          <div className="flex flex-wrap items-center gap-1">
            {pills.map((p, i) => (
              <Pill
                key={`${p.raw}-${i}`}
                pill={p}
                warning={warned.has(p.raw.toLowerCase())
                  ? warnings!.find(w => w.token.toLowerCase() === p.raw.toLowerCase())
                  : undefined}
                onRemove={() => onChange(removeGraphPill(value, i))}
              />
            ))}
            {nodeCount != null && (
              <span className={cn(HUD_NUM, 'ml-auto flex items-center gap-1.5 text-hud-dimmer')}>
                {nodeCount}n · {edgeCount ?? 0}e
                {nodeCap ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex cursor-help items-center gap-0.5 underline decoration-dotted underline-offset-2">
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
            )}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

function Pill({ pill, warning, onRemove }: {
  pill: GraphQueryPill;
  warning?: QueryWarning;
  onRemove: () => void;
}) {
  const style = TIER_STYLE[pill.tier];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'group inline-flex h-6 items-center gap-1.5 rounded-md border pl-2 pr-1',
            'text-[10px] transition-colors',
            warning
              ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
              : 'border-hud-line text-hud-dim hover:border-hud-line-strong',
          )}
        >
          {/* The tier, as a dot. Two pixels of hue against neutral text reads
              faster than the same hue smeared over the whole pill. */}
          {!warning && (
            <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} />
          )}
          {pill.negated && (
            <span className={cn(HUD_LABEL, 'text-hud-dimmer')}>not</span>
          )}
          <span className="text-hud-dimmer">{pill.label}</span>
          <span className="font-mono text-hud-fg">{pill.value}</span>
          <button
            onClick={onRemove}
            className="rounded p-0.5 text-hud-dimmer opacity-0 transition-opacity
                       hover:text-hud-fg group-hover:opacity-100"
            title="Remove"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[18rem] text-xs">
        {warning ? (
          <>
            <p>{warning.why}</p>
            {warning.didYouMean?.length ? (
              <p className="mt-1 text-muted-foreground">
                Did you mean: {warning.didYouMean.join(' · ')}
              </p>
            ) : null}
          </>
        ) : style.note}
      </TooltipContent>
    </Tooltip>
  );
}
