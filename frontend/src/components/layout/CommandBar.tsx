'use client';

/**
 * CommandBar — the line at the foot of the page (`lib/commandBar.ts`).
 *
 * A search field on the canvas below the page card — in the gap between the
 * page and the chat, the navigation bar's mirror — centered, a small card of
 * the same family. It lives in the shell's column, so the page card gives up
 * the room while it is in, and collapses the same way, by
 * `grid-template-rows`. It is a part of the chat strip (`--chat-pull`), so it
 * gives way as the chat comes up through its gap. What it offers rises out of
 * it over the page as a card, best match nearest the line, and an empty line,
 * focused, shows what can be done where it is aimed.
 *
 * Aim is read off the page: anything marked `data-bar-target` that has
 * offered a target becomes the target when you press or focus inside it. A
 * press anywhere else leaves the aim where it was — reaching for the bar, or
 * the run column beside a panel, does not lose it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUp, MessageSquare, Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { HUD_LABEL, HUD_NUM, HudOption } from '@/components/ui/chrome';
import {
  resolveTargets, useCommandBar, type BarCommand, type BarItem,
} from '@/lib/commandBar';
import { useChatStore } from '@/zustand_stores/storeChat';
import { usePushIntent } from '@/hooks/usePushIntent';

/** The row offered when the target has nothing to search. */
const ASK_KEY = '\0ask';

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const isEditable = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
};

/** Commands for what follows the `/`: names that start with it, then titles
 *  that contain it. */
function matchCommands(commands: BarCommand[], q: string): BarCommand[] {
  const s = q.trim().toLowerCase();
  if (!s) return commands;
  const byName = commands.filter((c) => c.name.startsWith(s));
  const byTitle = commands.filter((c) => !byName.includes(c) && c.title.toLowerCase().includes(s));
  return [...byName, ...byTitle];
}

export function CommandBar() {
  const pathname = usePathname();
  const present = useCommandBar((s) => s.present);
  const summoned = useCommandBar((s) => s.summoned);
  const aim = useCommandBar((s) => s.aim);
  const { aimed, page } = useCommandBar(useShallow(resolveTargets));
  const { hide, summon, setEngaged, setAim } = useCommandBar.getState();

  const [text, setText] = useState('');
  const [held, setHeld] = useState<BarItem[]>([]);
  // The verb on the line, by name: read from the targets at each render, so
  // it is always the live one — and goes, if its target does.
  const [verb, setVerb] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<BarItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Read at render: a target's finder and commands are its latest closure.
  const target = (aimed ?? page)?.ref.current ?? null;
  const finder = target?.find;
  // Identity-free: the target object is rebuilt on every render of its owner,
  // and the offers must not reset under the cursor when it is.
  const hasFinder = finder != null;
  const commands = useMemo(() => {
    const all = [...(aimed?.ref.current.commands ?? []), ...(page?.ref.current.commands ?? [])];
    // The aimed target's own come first and win a shared name.
    return all.filter((c, k) => all.findIndex((x) => x.name === c.name) === k);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aimed, page, text, verb]);
  const command = verb != null ? commands.find((c) => c.name === verb) ?? null : null;

  const listing = !asking && !command && text.startsWith('/');
  const options = useMemo<BarItem[]>(() => {
    if (asking) return [];
    if (listing) {
      return matchCommands(commands, text.slice(1)).map((c) => ({
        key: `/${c.name}`, label: c.title, hint: c.hint, chip: `/${c.name}`, data: c,
      }));
    }
    // A command's words are what it acts on, never a question.
    if (!hasFinder && !command && text.trim()) return [{ key: ASK_KEY, label: `Ask the chat: “${text.trim()}”`, hint: 'Nothing to search here — ? asks' }];
    return found;
  }, [asking, listing, commands, command, text, hasFinder, found]);
  useEffect(() => { setCursor(0); }, [options]);

  // What the finder offers, a beat after the typing — a field's values are a
  // request away, and a big network is a scan.
  useEffect(() => {
    if (asking || listing || !finder) { setFound([]); return; }
    if (!text.trim() && !held.at(-1)?.open) { setFound([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const out = await finder.suggest(text, held);
        if (alive) setFound(out);
      } catch {
        if (alive) setFound([]);
      }
    }, 80);
    return () => { alive = false; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, held, asking, listing, aim, hasFinder]);

  // Picks belong to the finder that offered them.
  useEffect(() => { setHeld([]); setVerb(null); }, [aim]);

  const engaged = focused || !!text || held.length > 0 || command != null || asking;
  useEffect(() => { setEngaged(engaged); }, [engaged, setEngaged]);

  // It sits outside the page, so a push up over the bar itself is its own.
  const root = useRef<HTMLDivElement>(null);
  const drawerOpen = useChatStore((s) => s.drawerOpen);
  usePushIntent(root, { direction: 'up', travel: 48, enabled: present && !engaged, onPush: hide });

  // Asked for the caret: once the bar is visible, which is the next frame.
  useEffect(() => {
    if (!summoned) return;
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [summoned]);

  // A new route is a new page: nothing aimed, nothing held, the bar away.
  useEffect(() => {
    setAim(null);
    setAsking(false);
    setText('');
    hide();
  }, [pathname, setAim, hide]);

  // `/` from anywhere on the page. Capture phase, so it is ours before the
  // resting chat's own `/` sees it; the pulled-up chat keeps it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (useChatStore.getState().drawerOpen) return;
      e.preventDefault();
      summon();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [summon]);

  // Aim follows the work: a press or focus inside an offered target.
  useEffect(() => {
    const onIntent = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-bar-target]');
      if (!el) return;
      const id = el.getAttribute('data-bar-target');
      const s = useCommandBar.getState();
      const next = id && s.targets[id] ? id : null;
      if (next !== s.aim) s.setAim(next);
    };
    window.addEventListener('pointerdown', onIntent, true);
    window.addEventListener('focusin', onIntent, true);
    return () => {
      window.removeEventListener('pointerdown', onIntent, true);
      window.removeEventListener('focusin', onIntent, true);
    };
  }, []);

  const reset = () => { setText(''); setHeld([]); setVerb(null); };

  /** What is held with `item` picked: it completes an open item, or joins. */
  const holdInto = (item: BarItem) => {
    const base = held.at(-1)?.open ? held.slice(0, -1) : held;
    const next = [...base, item];
    return finder?.settle ? finder.settle(next) : next;
  };

  const ask = (words: string) => {
    if (!words) return;
    const chat = useChatStore.getState();
    chat.setSeedPrompt(words);
    chat.openDrawer();
    reset();
    setAsking(false);
    input.current?.blur();
  };

  /** A command chosen: one that takes picks becomes the line's verb. */
  const choose = (c: BarCommand) => {
    if (c.takes) { setVerb(c.name); setText(''); } else { c.run([]); reset(); }
  };

  /** ↵ on the offer at `k` — or on what is held, with none. */
  const enter = (k: number) => {
    const opt = options[k];
    if (asking) { ask(text.trim()); return; }
    if (listing) {
      const c = opt?.data as BarCommand | undefined;
      if (c) choose(c);
      return;
    }
    if (opt?.key === ASK_KEY) { ask(text.trim()); return; }
    let next = held;
    if (opt && text.trim()) {
      next = holdInto(opt);
      if (opt.open) { setHeld(next); setText(''); return; }
    }
    const ready = next.filter((i) => !i.open);
    if (command) { command.run(ready); reset(); return; }
    if (ready.length && finder) { finder.go(ready); reset(); }
  };

  /** ⇥ on the offer at `k`: a command becomes the line's verb, a pick is held. */
  const tab = (k: number) => {
    const opt = options[k];
    if (!opt) return false;
    if (listing) { setVerb((opt.data as BarCommand).name); setText(''); return true; }
    if (opt.key === ASK_KEY) return false;
    setHeld(holdInto(opt));
    setText('');
    return true;
  };

  const onChange = (v: string) => {
    // `?` on an empty line asks; `/name ` takes the command.
    if (!text && !command && !held.length && v === '?') { setAsking(true); return; }
    const named = !asking && !command ? /^\/(\S+)\s$/.exec(v) : null;
    const c = named && commands.find((x) => x.name === named[1].toLowerCase());
    if (c) { setVerb(c.name); setText(''); return; }
    setText(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // The list reads upward from the line: ↑ moves away from it.
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); enter(cursor); }
    else if (e.key === 'Tab' && !e.shiftKey) { if (tab(cursor)) e.preventDefault(); }
    else if (e.key === 'Backspace' && !text) {
      if (held.length) setHeld(held.slice(0, -1));
      else if (command) { setText(`/${command.name}`); setVerb(null); e.preventDefault(); }
      else if (asking) setAsking(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (text) setText('');
      else if (held.length || command) { setHeld([]); setVerb(null); }
      else if (asking) setAsking(false);
      else { input.current?.blur(); hide(); }
    }
  };

  const turn = (k: number) => {
    if (!finder?.turn) return;
    setHeld(held.map((x, j) => (j === k ? finder.turn!(x) : x)));
    input.current?.focus();
  };

  const scope = aimed?.label ?? page?.label ?? null;
  const placeholder = asking ? (scope ? `Ask the chat about ${scope}…` : 'Ask the chat…')
    : command ? (command.takes ? `${command.title} — pick what to show, or ↵` : `${command.title} — ↵ to run`)
      : finder ? (finder.placeholder ?? `Search ${target?.label ?? ''}…`)
        : 'Type / for commands, ? to ask the chat';
  const keys: Array<[string, string]> = asking ? [['↵', 'ask'], ['⌫', 'back']]
    : listing ? [['⇥', 'take'], ['↵', 'run']]
      : command ? [['⇥', 'hold'], ['↵', 'run']]
        : finder ? [['⇥', 'hold'], ['↵', 'go'], ['/', 'commands']]
          : [['/', 'commands'], ['?', 'ask']];

  const blank = !text && !held.length && !command && !asking;
  const listed = focused && options.length > 0;
  // An empty line, focused: what can be done here, so `/` is not the only
  // way to find out.
  const starting = focused && blank && commands.length > 0;
  const heading = listing ? 'Commands'
    : options[0]?.key === ASK_KEY ? 'Nothing to search here'
      : held.at(-1)?.open ? `${held.at(-1)!.label} — its values`
        : `In ${target?.label ?? 'the page'}`;
  const ready = !!text.trim() || held.some((i) => !i.open) || command != null;

  return (
    <div
      ref={root}
      aria-hidden={!present}
      className={cn(
        'grid shrink-0 transition-[grid-template-rows,opacity,visibility] duration-200 ease-out motion-reduce:transition-none',
        present ? 'grid-rows-[1fr]' : 'invisible grid-rows-[0fr] opacity-0',
      )}
    >
      {/* Visible overflow while in, so the offers can rise over the page. */}
      <div
        data-chat-strip="bar"
        style={{ '--chat-pull': drawerOpen ? 1 : 0 } as React.CSSProperties}
        className={cn('relative z-30 min-h-0', present ? 'overflow-visible' : 'overflow-hidden', drawerOpen && 'pointer-events-none')}
      >
        {/* The card's gap above it is the page's margin; on a phone, where
            the page has none, the bar keeps its own. */}
        <div className="flex justify-center px-4 pb-[max(var(--strip-gap),env(safe-area-inset-bottom))] pt-[calc(var(--strip-gap)-var(--card-gap))]">
          <div className="@container/bar relative w-full max-w-[44rem]">
            {(listed || starting) && (
              <div
                // Keeps the caret in the line while an offer is clicked.
                onMouseDown={(e) => e.preventDefault()}
                className={cn(CARD, LIFT, 'absolute inset-x-0 bottom-full mb-2 overflow-hidden')}
              >
                {listed ? (
                  <>
                    <p className={cn(HUD_LABEL, 'px-3 pb-1 pt-2.5 text-hud-dimmer')}>{heading}</p>
                    <div className="flex max-h-[min(50dvh,22rem)] flex-col-reverse overflow-y-auto px-1.5 pb-1.5 [scrollbar-width:thin]">
                      {options.map((o, k) => (
                        <HudOption
                          key={o.key}
                          active={k === cursor}
                          label={o.label}
                          hint={o.hint}
                          trailing={o.chip?.startsWith('/') ? <Kbd>{o.chip}</Kbd>
                            : o.count != null ? <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{compact(o.count)}</span> : undefined}
                          onClick={() => enter(k)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2 p-3">
                    <p className={cn(HUD_LABEL, 'text-hud-dimmer')}>{finder ? `Search ${target?.label ?? ''}, or` : 'Here'}</p>
                    <div className="flex flex-wrap gap-1">
                      {commands.map((c) => (
                        <button
                          key={c.name}
                          type="button"
                          title={c.hint}
                          onClick={() => choose(c)}
                          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-hud-line px-2 text-[11px] text-hud-dim transition-colors hover:border-hud-line-strong hover:text-hud-fg [@media(pointer:coarse)]:h-9"
                        >
                          <span className="font-mono text-[10px] text-hud-dimmer">/{c.name}</span>
                          {c.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div
              className={cn(
                FIELD, 'flex min-h-12 items-center gap-1.5 p-1.5 transition-[border-color,box-shadow] duration-150',
                focused && 'border-hud-line-strong',
              )}
            >
              <div role="radiogroup" aria-label="Search or ask" className="flex shrink-0 items-center rounded-xl bg-hud-sunken p-0.5">
                <Mode on={!asking} icon={Search} label="Search" onClick={() => { setAsking(false); input.current?.focus(); }} />
                <Mode on={asking} icon={MessageSquare} label="Ask the chat (?)" onClick={() => { setAsking(true); input.current?.focus(); }} />
              </div>

              {/* What the line is aimed at: the panel, or the page around it. */}
              {aimed ? (
                <span className="inline-flex h-8 max-w-[38%] shrink-0 items-center gap-1.5 rounded-xl bg-hud-sunken pl-2.5 text-[12px] text-hud-fg">
                  <span className="truncate">{aimed.label}</span>
                  <button
                    type="button"
                    title="Aim at the page instead"
                    aria-label="Aim at the page instead"
                    onClick={() => { setAim(null); input.current?.focus(); }}
                    className="flex h-full items-center pl-0.5 pr-2 text-hud-dimmer hover:text-hud-fg"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ) : page ? (
                <span className="hidden max-w-[30%] shrink-0 truncate pl-1 text-[12px] text-hud-dimmer @md/bar:block">{page.label}</span>
              ) : null}

              <div
                onClick={() => input.current?.focus()}
                className="flex min-w-0 flex-1 cursor-text flex-wrap items-center gap-1 py-0.5"
              >
                {command && (
                  <span className="inline-flex h-6 items-center rounded-lg bg-hud-fill px-2 font-mono text-[11px] text-hud-fill-fg">
                    /{command.name}
                  </span>
                )}
                {held.map((item, k) => (
                  <span key={`${item.key}${k}`} className="inline-flex h-6 max-w-full items-center rounded-lg border border-hud-line text-[11px]"
                        onClick={(e) => e.stopPropagation()}>
                    {item.facet && <span className="pl-2 text-hud-dimmer">{item.facet}</span>}
                    {item.op && (
                      <button type="button" onClick={() => turn(k)} disabled={!finder?.turn}
                              title="Is · loosely · is not"
                              className={cn('h-full px-1.5 font-mono text-hud-fg hover:bg-hud-sunken disabled:hover:bg-transparent', !item.facet && 'rounded-l-lg')}>
                        {item.op}
                      </button>
                    )}
                    <button type="button" title="Take this off"
                            onClick={() => { setHeld(held.filter((_, j) => j !== k)); input.current?.focus(); }}
                            className="max-w-[180px] truncate pl-0.5 pr-2 text-hud-fg hover:text-hud-dim hover:line-through">
                      {item.open ? '…' : item.chip ?? item.label}
                    </button>
                  </span>
                ))}
                <input
                  ref={input}
                  value={text}
                  onChange={(e) => onChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  spellCheck={false}
                  aria-label="Command bar"
                  placeholder={placeholder}
                  className="h-8 min-w-[120px] flex-1 bg-transparent px-1.5 text-[13px] text-hud-fg outline-none placeholder:text-hud-dimmer"
                />
              </div>

              {focused ? (
                <span className="hidden shrink-0 items-center gap-2 pr-1 @xl/bar:flex">
                  {keys.map(([key, verb]) => (
                    <span key={key} className="inline-flex items-center gap-1 text-[10.5px] text-hud-dimmer">
                      <Kbd>{key}</Kbd>{verb}
                    </span>
                  ))}
                </span>
              ) : blank && (
                <span className="hidden shrink-0 pr-1 @md/bar:block"><Kbd>/</Kbd></span>
              )}

              {/* For a finger, and for anyone who reaches for a button. */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => enter(cursor)}
                disabled={!ready}
                aria-label={asking ? 'Ask' : command ? 'Run' : 'Go'}
                className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-hud-fill text-hud-fill-fg transition-opacity hover:opacity-90 disabled:opacity-0"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The line: a small card on the canvas, of the page and the chat's family. */
const FIELD = 'rounded-2xl border border-hud-line bg-background';
/** The offers: the chrome's glass, rounder, over the page. */
const CARD = 'rounded-2xl border border-hud-line bg-hud-surface backdrop-blur-xl backdrop-saturate-150';
/** The shadow the offers earn by rising over the page rather than sitting
 *  beside it. */
const LIFT = 'shadow-[0_18px_48px_-20px_rgb(0_0_0/0.45),0_2px_8px_-3px_rgb(0_0_0/0.12)]';

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border border-hud-line px-1 font-mono text-[10px] text-hud-dimmer">
      {children}
    </kbd>
  );
}

function Mode({ on, icon: Icon, label, onClick }: { on: boolean; icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-[10px] transition-colors [@media(pointer:coarse)]:size-9',
        on ? 'bg-hud-surface text-hud-fg shadow-sm' : 'text-hud-dimmer hover:text-hud-fg',
      )}
    >
      <Icon className="size-4 stroke-[1.5]" />
    </button>
  );
}

export default CommandBar;
