'use client';

/**
 * SetBuilder — one row to find in the network and build sets from it.
 *
 * With nothing picked it is the find box: type, and a name goes straight to
 * its node. Picking anything else — a type, a group, a place, every name that
 * contains the words, a field's value — starts a set. With a set picked it
 * builds that set: its terms sit before the cursor as chips, and what you pick
 * joins them (`plane/sets.ts`).
 *
 * It reads what is typed, too, in the queries' dialect (`dialect.ts`):
 * `type:Person location = Gaza ~ceasefire` is a line of three clauses, and ↵
 * takes it whole. Every offer shows how it is typed, at the foot.
 *
 *   chip       type = Person · Org    the operator turns on a click (= ∗ ≠);
 *                                     a value comes off on a click
 *   Enter      the highlighted offer; ⇧Enter narrows apart instead of
 *              joining a term of the same kind
 *   ⌫          on an empty input, the last chip turns back into its words
 *   a field    picked, its key is written (`location = `) and its values
 *              offered — nothing is held that cannot be read in the input
 *   ≈          any words, by meaning: the nodes closest to them. Its chip
 *              says how far it reaches and what it reads — the nodes' own
 *              names, their documents, or both
 *   the dot    on a graded term, how much it counts: not at all, as it
 *              reads, decisively
 *   ⬚ inside   a room's own term: what is drawn inside it (or ≠, outside)
 *   like …     a held room's snapshot — the meaning of what it read
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HUD_LABEL, HUD_NUM, HUD_PROSE, HUD_SURFACE, HudOption, HudOverline, HudSegmented } from '@/components/ui/chrome';
import {
  CMPS, CMP_GLYPH, OP_GLYPH, dropValue, fieldLabel, graded, likeLabel, nextOp, reachLabel, reachRange,
  type NodeSet, type Term, type TermKind,
} from '@/components/collection/graph/plane';
import { keyOf, openField, read, spell } from './dialect';
import { suggest, type Catalog, type FieldOption, type Suggestion, type Value } from './suggest';

export type TermPick = Extract<Suggestion, { kind: 'term' }>;

/** What a meaning's answer stands on — for its chip. */
export interface MeaningReading {
  /** Documents with chunks, of the network's. */
  documents: number;
  ofDocuments: number;
  /** Names with a vector, of the network's. */
  names: number;
  ofNames: number;
  /** How similar the documents at the reach's edge read — a cosine. */
  edge: number | null;
}

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Each kind of offer at a glance, in a column of its own. */
const GLYPH: Record<TermKind, string> = {
  entity: '●', name: '∗', type: '◇', group: '◎', place: '⌖', set: '▢', value: 'ƒ', about: '≈', region: '⬚',
};
const glyphOf = (s: Suggestion) => (s.kind === 'field' ? 'ƒ' : s.kind === 'text' ? '›' : s.typed ? '↵' : GLYPH[s.term.kind]);

export function SetBuilder({
  active, hue, catalog, nameOf, loadValues, readingOf, onTerms, onPick, onEscape, inputRef, disabled,
}: {
  /** The set being built — null: finding. */
  active: NodeSet | null;
  hue?: string;
  catalog: Catalog | null;
  nameOf: (kind: TermKind, value: string) => string;
  loadValues: (field: FieldOption, search: string) => Promise<Value[]>;
  /** A meaning's answer, read for its chip; undefined while it loads. */
  readingOf?: (term: Term) => MeaningReading | undefined;
  onTerms: (terms: Term[]) => void;
  /** `apart`: narrow as a term of its own. The event says whether shift was
   *  held — the panel marks a node for merging then. */
  onPick: (pick: TermPick, how: { apart: boolean; shift: boolean }) => void;
  onEscape?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [values, setValues] = useState<{ path: string; items: Value[] } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const fields = catalog?.fields ?? [];

  // The values of the field being typed to, asked again as the words narrow.
  const open = catalog ? openField(text, catalog) : null;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      loadValues(open.field, open.search.trim())
        .then((items) => { if (alive) setValues({ path: open.field.path, items }); })
        .catch(() => { if (alive) setValues({ path: open.field.path, items: [] }); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.field.path, open?.search]);
  useEffect(() => { setText(''); }, [active?.id]);

  const options = useMemo<Suggestion[]>(() => {
    if (!catalog) return [];
    const all = suggest(text, catalog, open && values?.path === open.field.path ? values.items : []);
    // The pinned two last, where the cursor reaches them after the rest.
    return [...all.filter((s) => !(s.kind === 'term' && s.pinned)), ...all.filter((s) => s.kind === 'term' && s.pinned)];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, values, catalog]);
  useEffect(() => { setCursor(0); }, [options]);
  const listed = options.filter((s) => !(s.kind === 'term' && s.pinned));
  const pinned = options.slice(listed.length);

  /** Words in place of the clause being typed — a key to go on from. */
  const write = (words: string) => {
    const last = catalog ? read(text, catalog).at(-1) : undefined;
    setText(`${last ? text.slice(0, last.at) : ''}${words}`);
    input.current?.focus();
  };

  const pick = (s: Suggestion, apart: boolean, shift: boolean) => {
    if (s.kind === 'field') { write(`${keyOf(s.field, fields)} = `); return; }
    if (s.kind === 'text') { if (s.text) write(s.text); return; }
    onPick(s, { apart, shift });
    if (!shift) setText('');
  };

  /** How an offer is typed — taught at the foot. */
  const spelling = (s: Suggestion | undefined): string | undefined => {
    if (!s) return undefined;
    if (s.kind === 'field') return `${keyOf(s.field, fields)} = …`;
    if (s.kind === 'text') return s.text || undefined;
    return [...(s.also ?? []), s.term].map((t) => spell(t, nameOf, fields)).filter(Boolean).join(' ') || undefined;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const s = options[cursor];
      if (s) pick(s, e.shiftKey, false);
    } else if (e.key === 'Backspace' && !text && active?.terms.length) {
      // The last chip back into its words, to be written again — or, for
      // what cannot be typed (a room's inside, a score), its last value off.
      e.preventDefault();
      const k = active.terms.length - 1;
      const t = active.terms[k];
      const words = spell(t, nameOf, fields);
      if (words) { onTerms(active.terms.slice(0, k)); setText(words); }
      else onTerms(dropValue(active, k, t.values[t.values.length - 1]).terms);
    } else if (e.key === 'Escape') {
      if (text) setText('');
      else { input.current?.blur(); onEscape?.(); }
    }
  };

  const shown = focused && options.length > 0;
  const lit = spelling(options[cursor]);
  return (
    <div>
      <div
        onClick={() => input.current?.focus()}
        className={cn('flex min-h-7 cursor-text flex-wrap items-center gap-0.5 rounded-lg border px-1 py-0.5',
                      focused || active ? 'border-hud-line-strong' : 'border-hud-line hover:border-hud-line-strong')}
      >
        {active ? (
          <span aria-hidden className="mx-0.5 size-2 shrink-0 rounded-full" style={{ background: hue }} />
        ) : (
          <Search className="mx-0.5 size-3 shrink-0 text-hud-dimmer" />
        )}
        {active?.terms.map((t, k) => (
          <TermChip key={`${t.kind}${t.field ?? ''}${k}`} term={t} nameOf={nameOf}
                    reading={t.kind === 'about' ? readingOf?.(t) : undefined}
                    onOp={() => onTerms(active.terms.map((x, j) => (j !== k ? x
                      : x.cmp ? { ...x, cmp: CMPS[(CMPS.indexOf(x.cmp) + 1) % CMPS.length] }
                        : { ...x, op: nextOp(x.op, graded(x) || x.kind === 'region') })))}
                    onChange={(next) => onTerms(active.terms.map((x, j) => (j === k ? next : x)))}
                    onDrop={(v) => onTerms(dropValue(active, k, v).terms)} />
        ))}
        <input
          ref={input}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder={active ? (active.terms.length ? 'and…' : 'Gather… a name, type:Person, location = …, ~meaning')
            : 'Find, or gather — type:Person  location = …  ~meaning'}
          className="h-5 min-w-[72px] flex-1 bg-transparent px-0.5 text-[11px] text-hud-fg outline-none placeholder:text-hud-dimmer"
        />
        {text && (
          <button type="button" title="Clear" onClick={(e) => { e.stopPropagation(); setText(''); }}
                  className="flex size-4 items-center justify-center text-hud-dimmer hover:text-hud-fg">
            <X className="size-3" />
          </button>
        )}
      </div>
      {shown && (
        <div className="pt-0.5" onMouseDown={(e) => e.preventDefault()}>
          <div className="max-h-60 overflow-y-auto [scrollbar-width:thin]">
            {listed.map((s, k) => (
              <HudOption
                key={k}
                active={k === cursor}
                label={<><span aria-hidden className="inline-block w-3.5 font-mono text-hud-dimmer">{glyphOf(s)}</span>{s.label}</>}
                hint={s.hint}
                trailing={s.kind === 'term' && s.count != null
                  ? <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{compact(s.count)}</span> : undefined}
                onClick={(e) => pick(s, e.altKey, e.shiftKey)}
              />
            ))}
          </div>
          {pinned.length > 0 && (
            <div className="grid grid-cols-2 gap-0.5 px-1 pt-0.5">
              {pinned.map((s, k) => {
                const at = listed.length + k;
                return (
                  <button key={k} type="button" onClick={(e) => pick(s, e.altKey, e.shiftKey)}
                          data-active={at === cursor || undefined}
                          className={cn('flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[10.5px]',
                                        at === cursor ? 'border-hud-line-strong bg-hud-sunken text-hud-fg' : 'border-hud-line text-hud-dim hover:bg-hud-sunken')}>
                    <span aria-hidden className="font-mono text-hud-dimmer">{glyphOf(s)}</span>
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {s.kind === 'term' && s.count != null && <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{compact(s.count)}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <p className={cn(HUD_PROSE, 'flex gap-2 px-3 pb-0.5 pt-1 text-[10px] text-hud-dimmer')}>
            <span className="shrink-0">{!active && options[cursor]?.kind === 'term' && (options[cursor] as TermPick).node != null
              && !(options[cursor] as TermPick).also?.length ? '↵ goes to it' : active ? '↵ adds · ⇧↵ apart' : '↵ starts a set'}</span>
            {lit && <span className="min-w-0 truncate font-mono text-hud-dim" title="How it is typed">{lit}</span>}
          </p>
        </div>
      )}
    </div>
  );
}

/** A term: what it reads, its operator, its values — each a click away. */
function TermChip({
  term, nameOf, reading, onOp, onChange, onDrop,
}: {
  term: Term;
  nameOf: (kind: TermKind, value: string) => string;
  reading?: MeaningReading;
  onOp: () => void;
  onChange: (term: Term) => void;
  onDrop: (value: string) => void;
}) {
  const about = term.kind === 'about';
  const region = term.kind === 'region';
  const what = term.kind === 'value' ? fieldLabel(term.field ?? '') : term.kind === 'entity' || about || region ? null : term.kind;
  return (
    <span className="inline-flex h-5 max-w-full items-center rounded bg-hud-sunken text-[10.5px]"
          onClick={(e) => e.stopPropagation()}>
      {graded(term) && <StrengthDot value={term.strength ?? 1} onChange={(strength) => onChange({ ...term, strength })} />}
      {what && <span className="pl-1 text-hud-dimmer">{what}</span>}
      <button type="button" onClick={onOp}
              title={region ? (term.op === '!' ? 'outside the room — click: inside' : 'inside the room — click: outside')
                : term.cmp ? 'compared — click: the next comparison (> ≥ < ≤)'
                : graded(term)
                ? (term.op === '!' ? 'taken away by degree — click: held' : 'held — click: taken away by degree')
                : term.op === '=' ? 'is — click: loosely (contains, or with what it links to)'
                : term.op === '~' ? 'loosely (∗) — click: is not' : 'is not — click: is'}
              className="px-1 font-mono text-hud-fg hover:bg-hud-line">
        {about ? (term.op === '!' ? '≠≈' : '≈') : region ? (term.op === '!' ? '≠⬚' : '⬚')
          : term.cmp ? `${term.op === '!' ? 'not ' : ''}${CMP_GLYPH[term.cmp]}` : OP_GLYPH[term.op]}
      </button>
      {region && (
        <button type="button" onClick={() => onDrop('')} title="Take this off — the room then holds what the set has"
                className="px-0.5 text-hud-fg hover:text-hud-dim hover:line-through">
          {term.op === '!' ? 'outside' : 'inside'}
        </button>
      )}
      {term.measure && (
        <button type="button" onClick={() => onDrop('')} title="Take this off"
                className="px-0.5 text-hud-fg hover:text-hud-dim hover:line-through">
          by score
        </button>
      )}
      {term.values.map((v, k) => (
        <React.Fragment key={v}>
          {k > 0 && <span className="text-hud-dimmer">/</span>}
          <button type="button" onClick={() => onDrop(v)} title="Take this off"
                  className="max-w-[128px] truncate px-0.5 text-hud-fg hover:text-hud-dim hover:line-through">
            {nameOf(term.kind, v)}
          </button>
        </React.Fragment>
      ))}
      {!!term.like?.length && (
        <>
          {term.values.length > 0 && <span className="text-hud-dimmer">/</span>}
          <button type="button" title="What the room read when it was pinned — click: take it off"
                  onClick={() => (term.values.length ? onChange({ ...term, like: undefined }) : onDrop(''))}
                  className="truncate px-0.5 text-hud-fg hover:text-hud-dim hover:line-through">
            {likeLabel(term.like.length)}
          </button>
        </>
      )}
      {about && <MeaningTune term={term} reading={reading} onChange={onChange} />}
      <span className="w-0.5" />
    </span>
  );
}

/** How much a graded term counts — `a^s`: hollow not at all, full as it
 *  reads, ringed decisively. A click turns it. */
function StrengthDot({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const next = value === 1 ? 2 : value === 2 ? 0 : 1;
  const says = value === 0 ? 'Counts not at all — it still holds the set to what it reaches'
    : value === 2 ? 'Counts decisively' : 'Counts as it reads';
  return (
    <button type="button" onClick={() => onChange(next)} title={`${says} — click: ${next === 0 ? 'not at all' : next === 2 ? 'decisively' : 'as it reads'}`}
            className="flex h-5 w-3.5 shrink-0 items-center justify-center pl-0.5">
      <span aria-hidden className={cn('rounded-full',
        value === 0 ? 'size-1.5 border border-hud-dim'
          : value === 2 ? 'size-1.5 bg-hud-fg ring-1 ring-hud-fg ring-offset-1 ring-offset-hud-sunken'
            : 'size-1.5 bg-hud-fg')} />
    </button>
  );
}

const REACHES = [
  { value: '0.02', label: '2%' },
  { value: '0.05', label: '5%' },
  { value: '0.1', label: '10%' },
  { value: '0.25', label: '25%' },
  { value: '0.5', label: '50%' },
  { value: '1', label: 'All', title: 'Every node it can read, by degree' },
];
const BASES = [
  { value: '0', label: 'Names', title: 'The nodes’ own names, by what they say' },
  { value: '0.5', label: 'Both', title: 'Names and documents, blended — a node with one reads that one' },
  { value: '1', label: 'Documents', title: 'The documents behind each node, by their passages' },
];
const nearest = (v: number, options: { value: string }[]) =>
  options.reduce((best, o) => (Math.abs(Number(o.value) - v) < Math.abs(Number(best.value) - v) ? o : best)).value;
const count = (n: number) => n.toLocaleString();

/** A meaning's reach and what it reads, a few steps each — and what its
 *  answer stands on, so a weak meaning reads weak. */
function MeaningTune({ term, reading, onChange }: { term: Term; reading?: MeaningReading; onChange: (t: Term) => void }) {
  const share = term.range ? 1 - term.range[0] : 1;
  const basis = term.basis ?? 0.5;
  const taking = term.op === '!';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button"
                title={taking ? 'Taken away by degree — click to read what it stands on' : 'How far it reaches, and what it reads'}
                className={cn(HUD_NUM, 'px-1 text-hud-dim hover:bg-hud-line hover:text-hud-fg')}>
          {taking ? 'by degree' : term.range ? reachLabel(term.range).replace('closest ', '') : 'all'}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={6} className={cn(HUD_SURFACE, 'w-[244px] space-y-2.5 rounded-lg p-2.5')}>
        <HudOverline>≈ {[...term.values, ...(term.like?.length ? [likeLabel(term.like.length)] : [])].join(' / ')}</HudOverline>
        {!taking && (
          <div className="space-y-1">
            <span className={cn(HUD_LABEL, 'text-hud-dim')}>Reach — the closest</span>
            <HudSegmented size="sm" className="w-full" value={nearest(share, REACHES)} options={REACHES}
                          onChange={(v) => onChange({ ...term, range: Number(v) >= 1 ? undefined : reachRange(Number(v)) })} />
            {reading?.edge != null && term.range && (
              <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
                Documents at its edge read {reading.edge.toFixed(2)} alike{reading.edge < 0.3 ? ' — weak: little here is close' : ''}.
              </p>
            )}
          </div>
        )}
        <div className="space-y-1">
          <span className={cn(HUD_LABEL, 'text-hud-dim')}>Reads</span>
          <HudSegmented size="sm" className="w-full" value={nearest(basis, BASES)} options={BASES}
                        onChange={(v) => onChange({ ...term, basis: Number(v) })} />
        </div>
        <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>
          {reading
            ? <>{count(reading.names)} of {count(reading.ofNames)} names and {count(reading.documents)} of {count(reading.ofDocuments)} documents are embedded; the rest are left out, not counted far.</>
            : 'Reading…'}
        </p>
      </PopoverContent>
    </Popover>
  );
}
