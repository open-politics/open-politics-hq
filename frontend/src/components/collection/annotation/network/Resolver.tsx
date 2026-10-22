'use client';

/**
 * Resolver — the logic model merging and typing entities, as a live ticker.
 *
 * No card: text over the network with the labels' own halo, so it reads like
 * part of the picture and covers as little of it as possible. The group being
 * weighed is a head and the labels that might be it, a marching line down the
 * side; the verdicts land in place, one per member (folded into the head for a
 * merge, ≠ for another entity, an amber ? when it was not sure), with the
 * chosen name and type lit, then slide down into the trail of the last few,
 * fading as they go. The network shows the same group ringed and linked, and
 * folds each merge into one node.
 *
 *   ⏸ / ▶      pause the line to clean up; nothing new is decided meanwhile
 *   run|canon  where a new decision takes effect
 *   ⟲ n        the history — by group, what the model was shown, one-click
 *              answers for what it was unsure of, roll back, decide by hand
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

type Decision = EntityDecisionOut;

/** How long a verdict holds the stage before it joins the trail. */
const LINGER_MS = 1800;
/** Verdicts kept in the trail under the stage. */
const TRAIL = 3;
/** Members drawn on the stage; the rest are counted. */
const SHOWN = 4;

const REASON: Record<string, string> = {
  type: 'same name, other types', spelling: 'spelled alike', acronym: 'an acronym',
  contains: 'one name inside the other', head: 'same last word',
};
const STATUS: Record<string, string> = {
  merged: 'merged', separate: 'kept apart', unsure: 'unsure', rolled_back: 'rolled back', pending: 'waiting',
};
const MARK: Record<string, string> = { merged: '✓', separate: '≠', unsure: '?', rolled_back: '↺', pending: '·' };
const AMBER = 'text-amber-600 dark:text-amber-400';

const same = (x: string | null | undefined, y: string) => !!x && x.trim().toLowerCase() === y.trim().toLowerCase();
/** The label a decision's merge carries: the group's, else the kept side's. */
const chosen = (d: Decision) => d.name ?? (d.keep === 'b' ? d.b.name : d.a.name);
/** One group's identity — what the stage, the trail and the history key on. */
const keyOf = (ds: Decision[]) => ds[0]?.group ?? `#${ds[0]?.id}`;

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
  /** Bring a group's labels into view on the network. */
  onFocus?: (ds: Decision[]) => void;
  /** The history control — `ResolverHistory`. */
  history: React.ReactNode;
  className?: string;
}) {
  const running = !!state?.running;
  const counts = state?.counts ?? {};
  const waiting = counts.pending ?? 0;

  // The stage holds the group being judged, or its verdicts for a moment;
  // they then move into the trail.
  const [trail, setTrail] = useState<Decision[][]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (current?.phase !== 'decided') return;
    const ds = current.decisions;
    setTrail((xs) => [ds, ...xs.filter((x) => keyOf(x) !== keyOf(ds))].slice(0, TRAIL + 1));
    const t = setTimeout(() => tick((x) => x + 1), LINGER_MS);
    return () => clearTimeout(t);
  }, [current]);
  const onStage = current && (current.phase === 'judging' || Date.now() - current.at < LINGER_MS) ? current : null;
  const past = trail.filter((ds) => !onStage || keyOf(ds) !== keyOf(onStage.decisions)).slice(0, TRAIL);

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
        {(counts.unsure ?? 0) > 0 && <span className={AMBER}>· {counts.unsure.toLocaleString()} unsure</span>}
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
          {past.map((ds, k) => (
            <li key={keyOf(ds)} style={{ opacity: 0.6 - k * 0.18 }}
                className={cn(HUD_NUM, 'truncate text-hud-fg')}>
              <button type="button" className="pointer-events-auto truncate text-left" onClick={() => onFocus?.(ds)}>
                {line(ds)}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A group's verdicts as one ticker line. */
function line(ds: Decision[]): string {
  const head = ds[0].a.name;
  const members = (status: string) => ds.filter((d) => d.status === status).map((d) => d.b.name);
  const joined = members('merged'), apart = members('separate'), unsure = members('unsure');
  if (joined.length) {
    const lead = ds.find((d) => d.status === 'merged')!;
    const name = chosen(lead);
    const rest = [unsure.length && `${unsure.length} unsure`, apart.length && `${apart.length} apart`].filter(Boolean);
    return `${[head, ...joined].filter((n) => !same(name, n)).join(', ')} → ${name} · ${lead.type ?? ''}`
      + (rest.length ? ` · ${rest.join(' · ')}` : '');
  }
  if (unsure.length) return `${head} ? ${unsure.join(', ')} — yours to decide`;
  if (apart.length) return `${head} ≠ ${apart.join(', ')}`;
  return `${head} · ${ds[0].b.name} — ${STATUS[ds[0].status] ?? ds[0].status}`;
}

/** The group on stage: the head, its members under it, the line down the side. */
function Stage({ onStage, onFocus }: { onStage: OnStage; onFocus?: (ds: Decision[]) => void }) {
  const { decisions: ds, phase } = onStage;
  const decided = phase === 'decided';
  const head = ds[0].a;
  const joined = ds.filter((d) => d.status === 'merged');
  const name = decided && joined.length ? chosen(joined[0]) : null;
  const kind = name ? joined[0].type ?? null : null;
  const shown = ds.slice(0, SHOWN);
  const count = (status: string) => ds.filter((d) => d.status === status).length;

  const footer = !decided
    ? [`${ds.length} label${ds.length === 1 ? '' : 's'}`, ...new Set(ds.map((d) => REASON[d.reason] ?? d.reason))]
    : [joined.length && `${joined.length} joined`, count('unsure') && `${count('unsure')} unsure — yours to decide`,
       count('separate') && `${count('separate')} apart`].filter(Boolean);

  return (
    <button type="button" onClick={() => onFocus?.(ds)} title="Show the group on the network"
            className="pointer-events-auto relative mt-1 block w-full text-left">
      <svg className="pointer-events-none absolute left-[3px] top-[9px] w-[6px] overflow-visible" style={{ height: 18 * shown.length }} aria-hidden>
        <line x1="3" y1="0" x2="3" y2={18 * shown.length} key={`${keyOf(ds)}:${phase}`}
              className={cn('resolver-line',
                            !decided && 'resolver-line-judging',
                            decided && joined.length > 0 && 'resolver-line-merged',
                            decided && !joined.length && count('unsure') > 0 && 'resolver-line-unsure',
                            decided && !joined.length && !count('unsure') && 'opacity-0')} />
      </svg>
      <Row name={head.name} type={head.type}
           kept={!!name && same(name, head.name)} folded={!!name && !same(name, head.name)} chosenType={kind} />
      {shown.map((d) => (
        <Row key={d.id} name={d.b.name} type={d.b.type} mark={decided ? d.status : null}
             kept={d.status === 'merged' && same(name, d.b.name)} folded={d.status === 'merged' && !same(name, d.b.name)}
             chosenType={d.status === 'merged' ? kind : null} />
      ))}
      <p className={cn(HUD_NUM, 'truncate pl-4 text-hud-dim')}>
        {ds.length > SHOWN && `+${ds.length - SHOWN} more · `}
        {footer.join(' · ')}
        {name && ` · ${name} · ${kind ?? ''}`}
      </p>
    </button>
  );
}

function Row({
  name, type, mark = null, kept, folded, chosenType,
}: { name: string; type: string; mark?: string | null; kept: boolean; folded: boolean; chosenType: string | null }) {
  const typeChosen = same(chosenType, type);
  return (
    <div className="relative flex h-[18px] items-center gap-1.5 pl-4">
      {(mark === 'separate' || mark === 'unsure') && (
        <span className={cn(HUD_NUM, 'absolute left-[2px]', mark === 'unsure' ? AMBER : 'text-hud-dim')}>{MARK[mark]}</span>
      )}
      <span className={cn('min-w-0 truncate text-[12.5px] leading-none transition-colors duration-300',
                          kept ? 'font-semibold text-hud-fg'
                            : folded ? 'text-hud-dimmer'
                            : mark === 'separate' ? 'text-hud-dim'
                            : mark === 'unsure' ? AMBER : 'text-hud-fg')}>
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

/** Rows by the group they were asked in, in the order they arrive. */
function groupsOf(items: Decision[]): Decision[][] {
  const out = new Map<string, Decision[]>();
  for (const d of items) {
    const k = keyOf([d]);
    out.set(k, [...(out.get(k) ?? []), d]);
  }
  return [...out.values()];
}

export function ResolverHistory({
  count, items, total, load, onRollback, onChange, onFocus,
}: {
  count: number;
  items: Decision[];
  total: number | null;
  load: (status: string | null, more?: boolean) => void;
  onRollback: (id: number) => void;
  onChange: (id: number, body: ManualDecision) => void;
  onFocus?: (ds: Decision[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  useEffect(() => { if (open) load(filter === 'all' ? null : filter); }, [open, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupsOf(items), [items]);

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
        <ol className="max-h-[56vh] divide-y divide-hud-line overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {groups.map((ds) => (
            <GroupRow key={keyOf(ds)} ds={ds} onRollback={onRollback} onChange={onChange} onFocus={onFocus} />
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

/** A head and what was decided about each label weighed against it. */
function GroupRow({
  ds, onRollback, onChange, onFocus,
}: {
  ds: Decision[];
  onRollback: (id: number) => void;
  onChange: (id: number, body: ManualDecision) => void;
  onFocus?: (ds: Decision[]) => void;
}) {
  const head = ds[0].a;
  const lead = ds.find((d) => d.status === 'merged');
  const latest = ds.reduce<string | null>((t, d) => (d.at && (!t || d.at > t) ? d.at : t), null);
  return (
    <li className="px-1 py-1.5">
      <button type="button" onClick={() => onFocus?.(ds)} title="Show on the network"
              className="flex w-full items-baseline gap-1.5 text-left text-[11.5px]">
        <span className="truncate font-medium text-hud-fg">{head.name}</span>
        <span className="shrink-0 text-[10.5px] text-hud-dim">{head.type}</span>
        {lead && <span className="min-w-0 truncate text-hud-dim">→ {chosen(lead)} · {lead.type}</span>}
        <span className="flex-1" />
        <span className={cn(HUD_NUM, 'shrink-0 text-hud-dimmer')}>
          {ds.some((d) => d.by != null) ? 'you' : 'model'}{latest ? ` · ${relTime(latest)}` : ''}
        </span>
      </button>
      <ol className="mt-0.5">
        {ds.map((d) => <MemberRow key={d.id} d={d} onRollback={onRollback} onChange={onChange} onFocus={onFocus} />)}
      </ol>
    </li>
  );
}

/** One label against its head: a mark, the label, p — open for the rest. */
function MemberRow({
  d, onRollback, onChange, onFocus,
}: {
  d: Decision;
  onRollback: (id: number) => void;
  onChange: (id: number, body: ManualDecision) => void;
  onFocus?: (ds: Decision[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const keep: 'a' | 'b' = d.keep === 'b' ? 'b' : 'a';
  const tone = d.status === 'unsure' ? AMBER : d.status === 'merged' ? 'text-hud-fg/80' : 'text-hud-dim';
  return (
    <li>
      <div className="flex h-5 items-center gap-1.5 pl-1 text-[11px]">
        <button type="button" onClick={() => setOpen((o) => !o)} title={STATUS[d.status] ?? d.status}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className={cn(HUD_NUM, 'w-2.5 shrink-0 text-center', tone)}>{MARK[d.status] ?? '·'}</span>
          <span className={cn('truncate', tone)}>{d.b.name}</span>
          <span className="shrink-0 text-[10px] text-hud-dimmer">{d.b.type}</span>
          {d.p_same != null && <span className={cn(HUD_NUM, 'shrink-0 text-hud-dimmer')}>{d.p_same.toFixed(2)}</span>}
          {d.scope === 'canon' && <span className={cn(HUD_NUM, 'shrink-0 text-hud-dimmer')}>canon</span>}
        </button>
        {d.status === 'unsure' && (
          <span className={cn(HUD_NUM, 'flex shrink-0 gap-1')}>
            <Bare title="One entity — merge it" onClick={() => onChange(d.id, { verdict: 'merged', keep, type: d.type ?? d.a.type })}>one</Bare>
            <Bare title="Two entities — keep it apart" onClick={() => onChange(d.id, { verdict: 'separate' })}>two</Bare>
          </span>
        )}
      </div>
      {open && <Detail d={d} onRollback={onRollback} onChange={onChange} onFocus={onFocus} />}
    </li>
  );
}

/** What the model was shown, a person's decision over it, and every earlier verdict. */
function Detail({
  d, onRollback, onChange, onFocus,
}: {
  d: Decision;
  onRollback: (id: number) => void;
  onChange: (id: number, body: ManualDecision) => void;
  onFocus?: (ds: Decision[]) => void;
}) {
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
  const skipped = typeof d.canon_effect?.skipped === 'string' ? d.canon_effect.skipped : null;

  return (
    <div className="mb-1.5 ml-5 mt-1 space-y-2 border-l border-hud-line pl-2">
      <pre className={cn(HUD_PROSE, 'max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-hud-dim')}>{d.state}</pre>
      {skipped && <p className={cn(HUD_NUM, 'text-hud-dimmer')}>canon: {skipped}</p>}
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
        {onFocus && <HudButton size="sm" onClick={() => onFocus([d])}>Show</HudButton>}
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
  );
}

const shorten = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
