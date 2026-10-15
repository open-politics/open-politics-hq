'use client';

/**
 * Resolver — the logic model merging and typing entities, as a live ticker.
 *
 * No card: text over the network with the labels' own halo, so it reads like
 * part of the picture and covers as little of it as possible. The pair being
 * weighed is two rows — name and type — with a marching line between them; the
 * verdict lands in place (the line drawn solid and the kept name and chosen type
 * lit for a merge, ≠ for two entities, an amber trace when it was not sure),
 * then slides down into the trail of the last few, fading as it goes. The
 * network shows the same pair ringed and linked, and folds a merge into one node.
 *
 *   ⏸ / ▶      pause the line to clean up; nothing new is decided meanwhile
 *   run|canon  where a new decision takes effect
 *   ⟲ n        the history — every decision, what the model was shown, roll
 *              back, decide by hand
 */
import React, { useEffect, useMemo, useState } from 'react';
import { History, Pause, Play, RotateCcw } from 'lucide-react';
import type { EntityDecisionOut, ManualDecision, ResolverState } from '@/client';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  HUD_NUM, HUD_PROSE, HUD_SURFACE, HudButton, HudOverline, HudSegmented,
} from '@/components/ui/chrome';
import { relTime } from '@/components/collection/home/HomePanel';
import type { OnStage } from '@/hooks/useResolution';

/** How long a verdict holds the stage before it joins the trail. */
const LINGER_MS = 1800;
/** Verdicts kept in the trail under the stage. */
const TRAIL = 3;

const REASON: Record<string, string> = {
  type: 'same name, two types', spelling: 'spelled alike', acronym: 'an acronym', contains: 'one name inside the other',
};
const STATUS: Record<string, string> = {
  merged: 'merged', separate: 'kept apart', unsure: 'unsure', rolled_back: 'rolled back', pending: 'waiting',
};

/** A bare control on the ticker: an icon or a word, no chrome. */
function Bare({ title, onClick, active, children }: {
  title: string; onClick: () => void; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={cn('pointer-events-auto inline-flex items-center gap-0.5 rounded px-0.5 transition-colors',
                          active ? 'text-hud-fg' : 'text-hud-dim hover:text-hud-fg')}>
      {children}
    </button>
  );
}

export function ResolverTicker({
  state, current, seeding, onSet, onFocus, history, className,
}: {
  state: ResolverState | null;
  current: OnStage | null;
  /** The run's graph is being read for pairs. */
  seeding: boolean;
  onSet: (patch: { running?: boolean; scope?: 'run' | 'canon' }) => void;
  /** Bring a pair into view on the network. */
  onFocus?: (d: EntityDecisionOut) => void;
  /** The history control — `ResolverHistory`. */
  history: React.ReactNode;
  className?: string;
}) {
  const running = !!state?.running;
  const counts = state?.counts ?? {};
  const waiting = counts.pending ?? 0;

  // The stage holds the pair being judged, or a verdict for a moment; verdicts
  // then move into the trail.
  const [trail, setTrail] = useState<EntityDecisionOut[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (current?.phase !== 'decided') return;
    const d = current.decision;
    setTrail((xs) => [d, ...xs.filter((x) => x.id !== d.id)].slice(0, TRAIL + 1));
    const t = setTimeout(() => tick((x) => x + 1), LINGER_MS);
    return () => clearTimeout(t);
  }, [current]);
  const onStage = current && (current.phase === 'judging' || Date.now() - current.at < LINGER_MS) ? current : null;
  const past = trail.filter((d) => d.id !== onStage?.decision.id).slice(0, TRAIL);

  const status = !running ? (waiting || counts.merged ? 'paused' : 'resolver off')
    : seeding ? 'finding pairs in the graph…'
    : onStage?.phase === 'judging' ? 'judging'
    : waiting ? 'resolving' : 'listening for new pairs';

  return (
    <section aria-label="Resolver" className={cn('resolver-ticker pointer-events-none w-[320px]', className)}>
      <div className={cn(HUD_NUM, 'flex items-center gap-1.5 text-hud-dim')}>
        <span className={cn('size-1.5 shrink-0 rounded-full', running ? 'animate-pulse bg-hud-fg' : 'bg-hud-line-strong')} />
        <span className="text-hud-fg/80">{status}</span>
        {(counts.merged ?? 0) > 0 && <span>· {counts.merged.toLocaleString()} merged</span>}
        {(counts.unsure ?? 0) > 0 && <span className="text-amber-600 dark:text-amber-400">· {counts.unsure.toLocaleString()} unsure</span>}
        {waiting > 0 && <span>· {waiting.toLocaleString()} waiting</span>}
        <span className="flex-1" />
        <Bare title={state?.scope === 'canon' ? 'New merges also go into the run\'s canon — click for run only'
                                              : 'New decisions stay with the run — click to write merges into the canon too'}
              onClick={() => onSet({ scope: state?.scope === 'canon' ? 'run' : 'canon' })}
              active={state?.scope === 'canon'}>
          {state?.scope === 'canon' ? 'canon' : 'run'}
        </Bare>
        {history}
        <Bare title={running ? 'Pause — decide nothing new while you clean up' : 'Run — let the logic model merge and type entities'}
              onClick={() => onSet({ running: !running })} active={running}>
          {running ? <Pause className="size-3" /> : <Play className="size-3" />}
        </Bare>
      </div>

      {onStage && <Stage onStage={onStage} onFocus={onFocus} />}

      {past.length > 0 && (
        <ol className="mt-0.5 space-y-px">
          {past.map((d, k) => (
            <li key={d.id} style={{ opacity: 0.6 - k * 0.18 }}
                className={cn(HUD_NUM, 'truncate text-hud-fg')}>
              <button type="button" className="pointer-events-auto truncate text-left" onClick={() => onFocus?.(d)}>
                {line(d)}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** One verdict as a ticker line. */
function line(d: EntityDecisionOut): string {
  const kept = d.keep === 'b' ? d.b.name : d.a.name;
  const other = d.keep === 'b' ? d.a.name : d.b.name;
  if (d.status === 'merged') return `${other} → ${kept} · ${d.type ?? ''}`;
  if (d.status === 'separate') return `${d.a.name} ≠ ${d.b.name}`;
  if (d.status === 'unsure') return `${d.a.name} ? ${d.b.name} — yours to decide`;
  return `${d.a.name} · ${d.b.name} — ${STATUS[d.status] ?? d.status}`;
}

/** The pair on stage: two rows, and the line between them. */
function Stage({ onStage, onFocus }: { onStage: OnStage; onFocus?: (d: EntityDecisionOut) => void }) {
  const { decision: d, phase } = onStage;
  const decided = phase === 'decided';
  const merged = decided && d.status === 'merged';
  const apart = decided && d.status === 'separate';
  const unsure = decided && d.status === 'unsure';
  const p = d.p_same;

  return (
    <button type="button" onClick={() => onFocus?.(d)} title="Show the pair on the network"
            className="pointer-events-auto relative mt-1 block w-full text-left">
      <svg className="pointer-events-none absolute left-[3px] top-[9px] h-[18px] w-[6px] overflow-visible" aria-hidden>
        <line x1="3" y1="0" x2="3" y2="18" key={`${d.id}:${phase}:${d.status}`}
              className={cn('resolver-line',
                            !decided && 'resolver-line-judging',
                            merged && 'resolver-line-merged',
                            unsure && 'resolver-line-unsure',
                            apart && 'opacity-0')} />
      </svg>
      <Row name={d.a.name} type={d.a.type} kept={merged && d.keep !== 'b'} folded={merged && d.keep === 'b'}
           chosenType={decided && !apart ? d.type ?? null : null} />
      {apart && <span className={cn(HUD_NUM, 'absolute left-[2px] top-[9px] text-hud-dim')}>≠</span>}
      <Row name={d.b.name} type={d.b.type} kept={merged && d.keep === 'b'} folded={merged && d.keep !== 'b'}
           chosenType={decided && !apart ? d.type ?? null : null} />
      <p className={cn(HUD_NUM, 'truncate pl-4 text-hud-dim')}>
        {!decided ? REASON[d.reason] ?? d.reason
          : merged ? `p ${p?.toFixed(2)} · one entity · ${d.type}`
          : apart ? `p ${p?.toFixed(2)} · two entities`
          : `p ${p?.toFixed(2)} · unsure — yours to decide`}
      </p>
    </button>
  );
}

function Row({
  name, type, kept, folded, chosenType,
}: { name: string; type: string; kept: boolean; folded: boolean; chosenType: string | null }) {
  const typeChosen = chosenType != null && chosenType.trim().toLowerCase() === type.trim().toLowerCase();
  return (
    <div className="flex h-[18px] items-center gap-1.5 pl-4">
      <span className={cn('min-w-0 truncate text-[12.5px] leading-none transition-colors duration-300',
                          kept ? 'font-semibold text-hud-fg' : folded ? 'text-hud-dimmer' : 'text-hud-fg')}>
        {name}
      </span>
      <span className={cn('shrink-0 text-[10.5px] leading-none transition-colors duration-300',
                          typeChosen ? 'font-medium text-hud-fg underline decoration-1 underline-offset-2' : 'text-hud-dim')}>
        {type}
      </span>
    </div>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

const FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'merged', label: 'Merged' },
  { value: 'unsure', label: 'Unsure' },
  { value: 'separate', label: 'Apart' },
  { value: 'rolled_back', label: 'Undone' },
];

export function ResolverHistory({
  count, items, total, load, onRollback, onChange, onFocus,
}: {
  count: number;
  items: EntityDecisionOut[];
  total: number | null;
  load: (status: string | null, more?: boolean) => void;
  onRollback: (id: number) => void;
  onChange: (id: number, body: ManualDecision) => void;
  onFocus?: (d: EntityDecisionOut) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  useEffect(() => { if (open) load(filter === 'all' ? null : filter); }, [open, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title="Every decision — roll back or decide by hand"
                className="pointer-events-auto inline-flex items-center gap-0.5 rounded px-0.5 text-hud-dim transition-colors hover:text-hud-fg">
          <History className="size-3" />
          {count > 0 && <span className="tabular-nums">{count.toLocaleString()}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className={cn(HUD_SURFACE, 'w-[420px] rounded-lg p-2.5')}>
        <div className="flex items-center justify-between gap-2 px-0.5 pb-2">
          <HudOverline>Decisions</HudOverline>
          <HudSegmented size="sm" value={filter} onChange={setFilter} options={FILTERS} />
        </div>
        <ol className="max-h-[56vh] space-y-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {items.map((d) => (
            <DecisionRow key={d.id} d={d} onRollback={onRollback} onChange={onChange} onFocus={onFocus} />
          ))}
          {items.length === 0 && (
            <li className={cn(HUD_PROSE, 'px-1 py-2 text-hud-dimmer')}>Nothing decided yet.</li>
          )}
          {total != null && items.length < total && (
            <li>
              <button type="button" onClick={() => load(filter === 'all' ? null : filter, true)}
                      className={cn(HUD_NUM, 'w-full py-1.5 text-hud-dim hover:text-hud-fg')}>
                {(total - items.length).toLocaleString()} more
              </button>
            </li>
          )}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

function DecisionRow({
  d, onRollback, onChange, onFocus,
}: {
  d: EntityDecisionOut;
  onRollback: (id: number) => void;
  onChange: (id: number, body: ManualDecision) => void;
  onFocus?: (d: EntityDecisionOut) => void;
}) {
  const [open, setOpen] = useState(d.status === 'unsure');
  const [verdict, setVerdict] = useState<'merged' | 'separate'>(d.status === 'separate' ? 'separate' : 'merged');
  const [keep, setKeep] = useState<'a' | 'b'>(d.keep === 'b' ? 'b' : 'a');
  const types = useMemo(() => {
    const out = new Map<string, string>();
    for (const t of [d.type, d.a.type, d.b.type, ...Object.keys(d.p_type ?? {})]) {
      if (t && !out.has(t.trim().toLowerCase())) out.set(t.trim().toLowerCase(), t);
    }
    return [...out.values()];
  }, [d]);
  const [type, setType] = useState(d.type ?? d.a.type);
  const kept = d.status === 'merged' ? (d.keep === 'b' ? 'b' : 'a') : null;
  const skipped = typeof d.canon_effect?.skipped === 'string' ? d.canon_effect.skipped : null;

  return (
    <li className="rounded-md px-1.5 py-1 hover:bg-hud-sunken/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="block w-full text-left">
        <div className="flex items-center gap-1.5 text-[11.5px]">
          <span className={cn('truncate', kept === 'a' ? 'font-medium text-hud-fg' : 'text-hud-fg/80')}>{d.a.name}</span>
          <span className="shrink-0 text-hud-dimmer">{d.status === 'separate' ? '≠' : '⟷'}</span>
          <span className={cn('truncate', kept === 'b' ? 'font-medium text-hud-fg' : 'text-hud-fg/80')}>{d.b.name}</span>
          <span className="flex-1" />
          <span className={cn('shrink-0 rounded px-1.5 py-px text-[10px]',
                              d.status === 'unsure' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : d.status === 'merged' ? 'bg-hud-fg text-background' : 'bg-hud-sunken text-hud-dim')}>
            {STATUS[d.status] ?? d.status}
          </span>
        </div>
        <div className={cn(HUD_NUM, 'mt-0.5 flex gap-1.5 text-hud-dimmer')}>
          {d.status === 'merged' && d.type && <span>{d.type}</span>}
          {d.p_same != null && <span>p {d.p_same.toFixed(2)}</span>}
          <span>{d.by == null ? 'model' : 'you'}</span>
          {d.scope === 'canon' && <span title={skipped ?? 'written into the canon'}>· canon{skipped ? ' (skipped)' : ''}</span>}
          {d.at && <span>· {relTime(d.at)}</span>}
        </div>
      </button>

      {open && (
        <div className="mt-1.5 space-y-2 border-t border-hud-line pt-1.5">
          <pre className={cn(HUD_PROSE, 'whitespace-pre-wrap font-mono text-[10px] text-hud-dim')}>{d.state}</pre>
          <div className="flex flex-wrap items-center gap-1.5">
            <HudSegmented<'merged' | 'separate'> size="sm" value={verdict} onChange={setVerdict}
                          options={[{ value: 'merged', label: 'One entity' }, { value: 'separate', label: 'Two' }]} />
            {verdict === 'merged' && (
              <>
                <HudSegmented<'a' | 'b'> size="sm" value={keep} onChange={setKeep}
                              options={[{ value: 'a', label: shorten(d.a.name) }, { value: 'b', label: shorten(d.b.name) }]} />
                <select value={type} onChange={(e) => setType(e.target.value)}
                        className="h-6 rounded-md border border-hud-line bg-transparent px-1 text-[11px] text-hud-fg">
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {onFocus && (
              <HudButton size="sm" onClick={() => onFocus(d)}>Show</HudButton>
            )}
            <span className="flex-1" />
            {(d.status === 'merged' || d.status === 'separate') && (
              <HudButton size="sm" icon={RotateCcw} onClick={() => onRollback(d.id)}
                         title="Undo — out of effect (and out of the canon), and not asked again">
                Roll back
              </HudButton>
            )}
            <HudButton size="sm" active onClick={() => onChange(d.id, verdict === 'merged' ? { verdict, keep, type } : { verdict })}>
              Decide
            </HudButton>
          </div>
          {(d.trail ?? []).length > 0 && (
            <ol className={cn(HUD_NUM, 'space-y-0.5 text-hud-dimmer')}>
              {(d.trail ?? []).map((t, k) => (
                <li key={k}>
                  was {STATUS[String(t.status)] ?? String(t.status)}
                  {t.p_same != null ? ` · p ${Number(t.p_same).toFixed(2)}` : null}
                  {` · ${t.by == null ? 'model' : 'you'}`}
                  {t.at ? ` · ${relTime(String(t.at))}` : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

const shorten = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
