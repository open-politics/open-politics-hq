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
 *   chip       type = Person · Org    the operator turns on a click (= ~ ≠);
 *                                     a value comes off on a click
 *   Enter      the highlighted suggestion; ⇧Enter narrows apart instead of
 *              joining a term of the same kind
 *   ⌫          on an empty input, the last value comes off
 *   a field    `sentiment` → its values: the builder holds the field, with its
 *              own operator, until a value is picked
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HUD_NUM, HUD_PROSE, HudOption } from '@/components/ui/chrome';
import {
  OP_GLYPH, dropValue, fieldLabel, nextOp, type NodeSet, type Term, type TermKind, type TermOp,
} from '@/components/collection/graph/plane';
import { suggest, valueSuggestions, type Catalog, type FieldOption, type Suggestion } from './suggest';

export type TermPick = Extract<Suggestion, { kind: 'term' }>;

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function SetBuilder({
  active, hue, catalog, nameOf, loadValues, onTerms, onPick, onEscape, inputRef, disabled,
}: {
  /** The set being built — null: finding. */
  active: NodeSet | null;
  hue?: string;
  catalog: Catalog | null;
  nameOf: (kind: TermKind, value: string) => string;
  loadValues: (field: FieldOption, search: string) => Promise<Array<{ value: string; count: number }>>;
  onTerms: (terms: Term[]) => void;
  /** `apart`: narrow as a term of its own. The event says whether shift was
   *  held — the panel marks a node for merging then. */
  onPick: (pick: TermPick, how: { apart: boolean; shift: boolean }) => void;
  onEscape?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [field, setField] = useState<FieldOption | null>(null);
  const [fieldOp, setFieldOp] = useState<TermOp>('=');
  const [values, setValues] = useState<Array<{ value: string; count: number }>>([]);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;

  // A field's values, asked again as the words narrow them.
  useEffect(() => {
    if (!field) { setValues([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      loadValues(field, text.trim()).then((v) => { if (alive) setValues(v); }).catch(() => { if (alive) setValues([]); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, text]);
  useEffect(() => { setField(null); setText(''); }, [active?.id]);

  const options = useMemo<Suggestion[]>(() => {
    if (field) return valueSuggestions(field, fieldOp, text, values);
    return catalog ? suggest(text, catalog) : [];
  }, [field, fieldOp, text, values, catalog]);
  useEffect(() => { setCursor(0); }, [options]);

  const pick = (s: Suggestion, apart: boolean, shift: boolean) => {
    if (s.kind === 'field') {
      setField(s.field);
      setFieldOp('=');
      setText('');
      input.current?.focus();
      return;
    }
    onPick(s, { apart, shift });
    if (!shift) { setText(''); setField(null); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const s = options[cursor];
      if (s) pick(s, e.shiftKey, false);
    } else if (e.key === 'Backspace' && !text) {
      if (field) setField(null);
      else if (active?.terms.length) {
        const k = active.terms.length - 1;
        const t = active.terms[k];
        onTerms(dropValue(active, k, t.values[t.values.length - 1]).terms);
      }
    } else if (e.key === 'Escape') {
      if (text) setText('');
      else if (field) setField(null);
      else { input.current?.blur(); onEscape?.(); }
    }
  };

  const open = focused && options.length > 0;
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
                    onOp={() => onTerms(active.terms.map((x, j) => (j === k ? { ...x, op: nextOp(x.op, x.measure) } : x)))}
                    onDrop={(v) => onTerms(dropValue(active, k, v).terms)} />
        ))}
        {field && (
          <span className="inline-flex h-5 items-center rounded bg-hud-sunken pl-1 text-[10.5px]">
            <span className="text-hud-dim">{field.label}</span>
            <button type="button" title="Is · contains · is not"
                    onClick={(e) => { e.stopPropagation(); setFieldOp(nextOp(fieldOp)); input.current?.focus(); }}
                    className="px-1 font-mono text-hud-fg hover:bg-hud-line">
              {OP_GLYPH[fieldOp]}
            </button>
          </span>
        )}
        <input
          ref={input}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder={field ? `${field.label} ${OP_GLYPH[fieldOp]} …`
            : active ? (active.terms.length ? 'and…' : 'Gather… a name, type, group, place, field')
              : 'Find, or gather a set…'}
          className="h-5 min-w-[72px] flex-1 bg-transparent px-0.5 text-[11px] text-hud-fg outline-none placeholder:text-hud-dimmer"
        />
        {(text || field) && (
          <button type="button" title="Clear" onClick={(e) => { e.stopPropagation(); setText(''); setField(null); }}
                  className="flex size-4 items-center justify-center text-hud-dimmer hover:text-hud-fg">
            <X className="size-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-60 overflow-y-auto pt-0.5 [scrollbar-width:thin]"
             onMouseDown={(e) => e.preventDefault()}>
          {options.map((s, k) => (
            <HudOption
              key={k}
              active={k === cursor}
              label={s.label}
              hint={s.hint}
              trailing={s.kind === 'term' && s.count != null
                ? <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{compact(s.count)}</span> : undefined}
              onClick={(e) => pick(s, e.altKey, e.shiftKey)}
            />
          ))}
          <p className={cn(HUD_PROSE, 'px-3 pb-0.5 pt-1 text-[10px] text-hud-dimmer')}>
            {field ? 'Pick a value · ⌫ back to fields'
              : active ? '↵ adds · ⇧↵ narrows apart'
                : '↵ goes to a name · anything else starts a set'}
          </p>
        </div>
      )}
    </div>
  );
}

/** A term: what it reads, its operator, its values — each a click away. */
function TermChip({
  term, nameOf, onOp, onDrop,
}: {
  term: Term;
  nameOf: (kind: TermKind, value: string) => string;
  onOp: () => void;
  onDrop: (value: string) => void;
}) {
  const what = term.kind === 'value' ? fieldLabel(term.field ?? '') : term.kind === 'entity' ? null : term.kind;
  return (
    <span className="inline-flex h-5 max-w-full items-center rounded bg-hud-sunken text-[10.5px]"
          onClick={(e) => e.stopPropagation()}>
      {what && <span className="pl-1 text-hud-dimmer">{what}</span>}
      <button type="button" onClick={onOp}
              title={term.op === '=' ? 'is — click: loosely (contains, or with what it links to)'
                : term.op === '~' ? 'loosely — click: is not' : 'is not — click: is'}
              className="px-1 font-mono text-hud-fg hover:bg-hud-line">
        {OP_GLYPH[term.op]}
      </button>
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
      <span className="w-0.5" />
    </span>
  );
}
