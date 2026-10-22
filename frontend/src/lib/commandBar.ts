/**
 * The command bar — one line at the foot of the page that searches, commands
 * and asks, aimed at whatever you are working on.
 *
 * It sits in the shell's vertical sequence between the page and the chat:
 * push down past the end of the page and it comes in; push on and the chat
 * comes up behind it. `/` from anywhere jumps into it.
 *
 * What it does with the words is up to its **target**, and the target is
 * whatever the page says you are aiming at — on the analysis page, the panel
 * you last worked in, named on the line itself.
 *
 *   words          searching within the target: its own finder offers, ⇥
 *                  holds a pick, ↵ acts on what is held
 *   /name          one of the target's commands, or the page's; a command
 *                  that `takes` holds picks from the same finder first, so
 *                  `/geo Berlin ⇥ Trump ⇥ Interest ↵` is one gesture
 *   ? (or toggle)  asking the chat
 *
 * The bar owns none of the meaning. A target is a finder and a list of
 * commands; the network panel's finder is its set builder's, so a pick reads
 * the same in the bar as in the panel. Registration follows
 * `useSurfaceCommands`: the target is read through a ref, so handlers always
 * see the latest closure without re-registering on every render.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { create } from 'zustand';

/** Something the bar offers as you type — and, held, a chip before the cursor. */
export interface BarItem {
  key: string;
  /** What it reads as an offer. */
  label: string;
  /** Beside the offer: what kind of thing it is, or where it comes from. */
  hint?: string;
  count?: number;
  /** Held, ahead of its label: the facet it narrows (`type`, `place`). */
  facet?: string;
  /** Held, its operator — a click turns it (`BarFinder.turn`). */
  op?: string;
  /** Held, how it reads when that differs from the offer. */
  chip?: string;
  /** Completed by the next pick — a field waiting for its value. */
  open?: boolean;
  /** The finder's own value; the bar never reads it. */
  data?: unknown;
}

/** How a target is searched. */
export interface BarFinder {
  /** What to offer for the words, after what is already held. */
  suggest: (text: string, held: BarItem[]) => BarItem[] | Promise<BarItem[]>;
  /** ↵ with no command: act on what is held. */
  go: (held: BarItem[]) => void;
  /** A held item with its operator turned. */
  turn?: (item: BarItem) => BarItem;
  /** What is held after a pick — a later pick may change how an earlier one
   *  reads. Not run after a turn: what the reader set by hand stays set. */
  settle?: (held: BarItem[]) => BarItem[];
  placeholder?: string;
}

export interface BarCommand {
  /** What follows the `/`. */
  name: string;
  title: string;
  hint?: string;
  /** Takes picks from the target's finder before it runs. Without any, it
   *  runs on what it already has. */
  takes?: boolean;
  run: (held: BarItem[]) => void;
}

export interface BarTarget {
  label: string;
  find?: BarFinder;
  commands?: BarCommand[];
}

/** The page's own target: what the bar falls back to with nothing aimed at. */
export const PAGE_TARGET = 'page';

interface Registered {
  label: string;
  ref: MutableRefObject<BarTarget>;
}

interface CommandBarState {
  /** In view at the foot of the page. */
  present: boolean;
  /** Focused or holding something — a gesture does not take it away then. */
  engaged: boolean;
  /** The target aimed at; null aims at the page. */
  aim: string | null;
  /** Bumped to ask the bar for the caret. */
  summoned: number;
  targets: Record<string, Registered>;
  show: () => void;
  hide: () => void;
  /** In view, with the caret in it. */
  summon: () => void;
  setEngaged: (engaged: boolean) => void;
  setAim: (aim: string | null) => void;
}

export const useCommandBar = create<CommandBarState>()((set) => ({
  present: false,
  engaged: false,
  aim: null,
  summoned: 0,
  targets: {},
  show: () => set({ present: true }),
  hide: () => set({ present: false }),
  summon: () => set((s) => ({ present: true, summoned: s.summoned + 1 })),
  setEngaged: (engaged) => set({ engaged }),
  setAim: (aim) => set({ aim }),
}));

/** The target the bar acts on, and the page's beneath it. */
export function resolveTargets(s: Pick<CommandBarState, 'aim' | 'targets'>) {
  const page = s.targets[PAGE_TARGET] ?? null;
  const aimed = s.aim != null && s.aim !== PAGE_TARGET ? s.targets[s.aim] ?? null : null;
  return { aimed, page };
}

/**
 * Offer a target to the bar under `id` while mounted. `null` offers nothing —
 * for a page whose target only exists once its data has loaded.
 */
export function useBarTarget(id: string | null, target: BarTarget): void {
  const ref = useRef(target);
  ref.current = target;
  const { label } = target;

  useEffect(() => {
    if (id == null) return;
    useCommandBar.setState((s) => ({ targets: { ...s.targets, [id]: { label, ref } } }));
    return () =>
      useCommandBar.setState((s) => {
        // Only our own entry: a remount of the same id may already own it.
        if (s.targets[id]?.ref !== ref) return s;
        const { [id]: _gone, ...rest } = s.targets;
        return { targets: rest };
      });
  }, [id, label]);
}
