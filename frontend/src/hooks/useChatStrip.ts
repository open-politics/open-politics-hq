import { useEffect, useRef, type RefObject } from 'react';
import { useChatStore } from '@/zustand_stores/storeChat';
import { atEdge, ownsGestures, wheelDy } from './usePushIntent';

/** The first stretch of a push moves the strip at half rate: resistance, so
 *  overshooting the end of a page shows the chat is there without bringing
 *  it. Past it the strip moves with the hand. */
const DETENT = 120;
/** Let go past this share of the way and the strip carries on to the other
 *  end; short of it, it goes back. */
const COMMIT = 0.4;
/** A finger flicked this fast (px/ms) carries on whatever the distance. */
const FLICK = 0.5;
/** How far past either end the strip gives, as a share of its length. */
const GIVE = 0.04;
/** A pause this long ends a wheel gesture — wheels have no lift — and is the
 *  moment the strip is let go. */
const RELEASE_MS = 160;
/** Finger travel before a touch counts as a push rather than a tap. */
const SLOP = 8;

const strip = () => document.querySelectorAll<HTMLElement>('[data-chat-strip]');
const part = (name: 'page' | 'window' | 'peek') =>
  document.querySelector<HTMLElement>(`[data-chat-strip="${name}"]`);

/** Hold the strip at `pull`, under the hand: no transition. */
function follow(pull: number) {
  part('page')?.setAttribute('data-chat-moved', '');
  for (const el of strip()) {
    el.setAttribute('data-following', '');
    el.style.setProperty('--chat-pull', pull.toFixed(4));
  }
}

/** Let go of it at `from`; it settles at `to` over a time scaled to the way
 *  it has left to go, so a near-finished pull does not crawl home. */
function settle(from: number, to: 0 | 1) {
  const ms = Math.round(180 + 320 * Math.min(1, Math.abs(to - from)));
  for (const el of strip()) {
    el.removeAttribute('data-following');
    el.style.setProperty('--chat-pull-ms', `${ms}ms`);
    el.style.setProperty('--chat-pull', String(to));
    window.setTimeout(() => el.style.removeProperty('--chat-pull-ms'), ms + 50);
  }
  if (from === 0 && to === 0) part('page')?.removeAttribute('data-chat-moved');
}

/**
 * useChatStrip — the page and the chat are one strip, and scrolling moves along it.
 *
 * Past the end of the page the chat is there, the next card down, out of view.
 * Pushing on past the end does not trigger it; it *moves* it: the strip
 * follows the wheel or the finger, page and window together, at first
 * against some resistance and then one to one, and when you let go it settles
 * at whichever end you were nearer, or the one you flicked toward. The way
 * back is the same move upward, from the top of the thread or over the peek.
 *
 * Where along the strip you are is one number, `--chat-pull` (0 resting,
 * 1 pulled up), on every `[data-chat-strip]` part. React writes the settled
 * value from `drawerOpen`; this writes it under the hand and at the release,
 * straight to the DOM, so following a gesture re-renders nothing. The CSS in
 * `globals.css` turns it into each part's position.
 *
 * Listens on the window rather than the page, because the part under the
 * pointer changes as the strip moves: a push that starts on the page ends over
 * the window it brought up.
 */
export function useChatStrip(
  page: RefObject<HTMLElement | null>,
  { canOpen, onPull }: { canOpen: boolean; /** A pull has begun. */ onPull?: () => void },
) {
  const canOpenRef = useRef(canOpen);
  const onPullRef = useRef(onPull);
  useEffect(() => {
    canOpenRef.current = canOpen;
    onPullRef.current = onPull;
  });

  // The page carries a transform only while it is away from rest: a
  // transform makes it the containing block of every `fixed` thing inside
  // it, which at rest would pull those out of place.
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    if (useChatStore.getState().drawerOpen) el.setAttribute('data-chat-moved', '');
    const unsubscribe = useChatStore.subscribe((s, prev) => {
      if (s.drawerOpen && !prev.drawerOpen) el.setAttribute('data-chat-moved', '');
    });
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== el || e.propertyName !== '--chat-pull' || el.hasAttribute('data-following')) return;
      if (parseFloat(getComputedStyle(el).getPropertyValue('--chat-pull')) === 0) el.removeAttribute('data-chat-moved');
    };
    el.addEventListener('transitionend', onEnd);
    return () => {
      unsubscribe();
      el.removeEventListener('transitionend', onEnd);
    };
  }, [page]);

  useEffect(() => {
    /** A pull under way: which end it left, which way that is, how far the
     *  hand has gone, and how long the strip is. */
    let drag: { from: 0 | 1; dir: 1 | -1; travel: number; length: number } | null = null;

    // Whether a push in `dir`, starting at `target`, is one the strip takes.
    const takes = (target: EventTarget | null, dir: number) => {
      const open = useChatStore.getState().drawerOpen;
      const node = target as Node | null;
      const win = part('window');
      if (open) {
        if (dir !== -1) return false;
        // Over the peek, any push up; over the thread, only one past its top —
        // scrolling up through the conversation is reading it, not leaving.
        if (part('peek')?.contains(node)) return true;
        return !!win?.contains(node) && atEdge(target, win, -1);
      }
      if (dir !== 1) return false;
      // Anything on the chat card itself — the handle's neighbour, mid-move.
      if (win?.contains(node)) return true;
      const el = page.current;
      return !!el?.contains(node) && canOpenRef.current && atEdge(target, el, 1);
    };

    const begin = (dir: 1 | -1) => {
      const win = part('window');
      drag = {
        from: dir === 1 ? 0 : 1,
        dir,
        travel: 0,
        length: Math.max(240, (win?.offsetHeight ?? window.innerHeight * 0.8) - 24),
      };
      onPullRef.current?.();
    };

    // Where the strip is for the hand's travel: resistance first, one to one
    // after, and a little give past the end.
    const progress = (d: NonNullable<typeof drag>) => {
      const moved = d.travel < DETENT ? d.travel / 2 : d.travel - DETENT / 2;
      const p = moved / d.length;
      return p <= 1 ? p : 1 + Math.min(GIVE, (p - 1) * 0.15);
    };
    const pullOf = (d: NonNullable<typeof drag>) => (d.from === 0 ? progress(d) : 1 - progress(d));

    const release = (velocity = 0) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      const along = velocity * d.dir;
      const go = along > FLICK || (along > -FLICK && progress(d) > COMMIT);
      const to: 0 | 1 = go ? (d.from === 0 ? 1 : 0) : d.from;
      settle(pullOf(d), to);
      const s = useChatStore.getState();
      if (to === 1 && !s.drawerOpen) s.openDrawer();
      if (to === 0 && s.drawerOpen) s.closeDrawer();
    };

    // ── Wheel ──────────────────────────────────────────────────────────────
    // A wheel gesture is a run of events without a pause. It may start the
    // strip only at its beginning — momentum coasting into the end of the page
    // started in the page — with one exception: the push that took the
    // navigation bar away may carry on into the chat, as scrolling would.
    let last = -Infinity;
    let lastSign = 0;
    let pending = false;
    let timer = 0;

    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return; // a sideways strip turned it into its own scroll
      const dy = wheelDy(e, window.innerHeight);
      if (dy === 0 || ownsGestures(e.target, document.body)) return;
      const sign = Math.sign(dy);
      const fresh = e.timeStamp - last > RELEASE_MS || (!drag && sign !== lastSign);
      last = e.timeStamp;
      lastSign = sign;
      if (fresh) pending = true;

      if (!drag) {
        if (!pending) return;
        if (!takes(e.target, sign)) {
          // Refused only because the bar is still there: ask again on the
          // next event of this push, which may be after it has gone.
          const waitingOnBar = !canOpenRef.current && !!page.current?.contains(e.target as Node);
          if (!waitingOnBar) pending = false;
          return;
        }
        pending = false;
        begin(sign as 1 | -1);
      }

      const d = drag!;
      d.travel = Math.max(0, d.travel + dy * d.dir);
      follow(pullOf(d));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => release(), RELEASE_MS);
    };

    // ── Touch ──────────────────────────────────────────────────────────────
    let touch: { x: number; y: number; target: EventTarget | null; base: number } | null = null;
    let samples: { t: number; y: number }[] = [];

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touch = e.touches.length === 1 && !ownsGestures(e.target, document.body)
        ? { x: t.clientX, y: t.clientY, target: e.target, base: 0 }
        : null;
      samples = [];
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touch || e.touches.length !== 1) return;
      const t = e.touches[0];
      // The finger moves against the content: lifting it scrolls down.
      const dy = touch.y - t.clientY;
      if (!drag) {
        if (Math.abs(dy) < SLOP) return;
        const sign = Math.sign(dy);
        if (Math.abs(dy) <= Math.abs(touch.x - t.clientX) || !takes(touch.target, sign)) {
          touch = null;
          return;
        }
        begin(sign as 1 | -1);
        touch.base = dy;
      }
      const d = drag!;
      d.travel = Math.max(0, (dy - touch.base) * d.dir);
      follow(pullOf(d));
      samples.push({ t: e.timeStamp, y: dy });
      if (samples.length > 6) samples.shift();
    };

    const onTouchEnd = () => {
      touch = null;
      if (!drag) return;
      // Velocity over the last few moves, px/ms, positive scrolling down.
      const a = samples[0];
      const b = samples[samples.length - 1];
      release(a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0);
    };

    const opts = { passive: true } as const;
    window.addEventListener('wheel', onWheel, opts);
    window.addEventListener('touchstart', onTouchStart, opts);
    window.addEventListener('touchmove', onTouchMove, opts);
    window.addEventListener('touchend', onTouchEnd, opts);
    window.addEventListener('touchcancel', onTouchEnd, opts);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [page]);
}

export default useChatStrip;
