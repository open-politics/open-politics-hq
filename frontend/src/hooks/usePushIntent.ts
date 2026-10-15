import { useEffect, useRef, type RefObject } from 'react';

/** A pause this long ends a wheel gesture. Wheels have no "lift". */
export const GESTURE_GAP_MS = 220;
/** A finger covers distance faster than a wheel reports it. */
const TOUCH_SCALE = 0.6;

// ─── Shared reading of a gesture ─────────────────────────────────────────────

/** Something between `from` and `root` handles its own gestures — a graph or
 *  map on `touch-action: none` keeps its wheel and its finger. */
export function ownsGestures(from: EventTarget | null, root: Element) {
  for (let el = from as Element | null; el && el !== root; el = el.parentElement) {
    if (getComputedStyle(el).touchAction === 'none') return true;
  }
  return false;
}

/** Every vertical scroller between `from` and `root` is already at the edge a
 *  push in `sign` (1 down, -1 up) is heading for. */
export function atEdge(from: EventTarget | null, root: Element, sign: number) {
  for (let el = from as Element | null; el && el !== root; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const room = sign > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 1;
    if (room) return false;
  }
  return true;
}

/** A wheel event's vertical travel in px, or 0 when it is not a vertical
 *  scroll at all: a pinch (ctrl-wheel), a shift-wheel, or a mostly sideways
 *  swipe. Firefox reports a notched wheel in lines. */
export function wheelDy(e: WheelEvent, pageHeight: number) {
  if (e.ctrlKey || e.shiftKey) return 0;
  const unit =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
    : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pageHeight
    : 1;
  const dy = e.deltaY * unit;
  return Math.abs(dy) <= Math.abs(e.deltaX * unit) ? 0 : dy;
}

export interface PushIntentOptions {
  direction: 'up' | 'down';
  /** Wheel travel, in px, before the push counts. Small for a flick; larger
   *  for "resistance" — a push the user has to mean. */
  travel: number;
  /**
   * Count only a push *past* the content: one that starts with every vertical
   * scroller under the pointer already at the edge it is pushing toward, and
   * keeps going. Momentum that coasts into the edge does not count — that push
   * started in the content, so the user has to push again.
   */
  pastEdge?: boolean;
  /** Listening at all. By default a push only counts if it started while
   *  enabled, so enabling mid-gesture never fires on that gesture. */
  enabled: boolean;
  /**
   * Let a push already under way when this becomes enabled carry on into it,
   * counting travel from that moment. One continuous swipe can then move
   * through the sequence — the bar leaves, and the same swipe, pushed a little
   * further, arrives at the drawer — the way scrolling would.
   */
  continuing?: boolean;
  onPush: () => void;
}

/**
 * usePushIntent — reads a vertical scroll gesture as an instruction.
 *
 * HQ's shell is a vertical sequence: the navigation bar above the content and
 * the chat drawer below it. Moving between them is scrolling, extended past
 * the content's own scroll: push down and the bar leaves; push down again at
 * the end and the drawer arrives; push up at the drawer's top and the content
 * returns; push up at the content's top and the bar returns. Each of those is
 * one of these, and the chrome then snaps — nothing rests half-shown.
 *
 * It reads gestures rather than `scroll` events because the moves that matter
 * scroll nothing: pushing past an edge, or on content that does not scroll.
 * Gestures something under the pointer owns are left alone: a ctrl-wheel is a
 * pinch, and anything on `touch-action: none` — a graph or map handling its
 * own zoom and pan — keeps its wheel and its finger.
 */
export function usePushIntent(
  ref: RefObject<HTMLElement | null>,
  { direction, travel: needed, pastEdge = false, enabled, continuing = false, onPush }: PushIntentOptions,
) {
  const onPushRef = useRef(onPush);
  useEffect(() => {
    onPushRef.current = onPush;
  });

  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    const sign = direction === 'down' ? 1 : -1;

    // ── Wheel ──────────────────────────────────────────────────────────────
    // A gesture under way at the moment of enabling is, by default, already
    // started and unarmed; `continuing` treats its next event as a start.
    let last = continuing ? -Infinity : performance.now();
    let lastSign = sign;
    let travel = 0;
    let armed = false;

    const onWheel = (e: WheelEvent) => {
      const dy = wheelDy(e, root.clientHeight);
      if (dy === 0 || ownsGestures(e.target, root)) return;

      // A pause or a reversal starts a new gesture, armed only if it starts
      // where it is allowed to.
      const s = Math.sign(dy);
      if (e.timeStamp - last > GESTURE_GAP_MS || s !== lastSign) {
        travel = 0;
        armed = s === sign && (!pastEdge || atEdge(e.target, root, sign));
      }
      last = e.timeStamp;
      lastSign = s;
      if (!armed) return;

      travel += Math.abs(dy);
      if (travel < needed) return;
      armed = false;
      onPushRef.current();
    };

    // ── Touch: measured from where the finger landed ───────────────────────
    let start: { x: number; y: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // Armed for either direction here; the move decides which it was.
      start = e.touches.length === 1 && !ownsGestures(e.target, root) && (!pastEdge || atEdge(e.target, root, sign))
        ? { x: t.clientX, y: t.clientY }
        : null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      // The finger moves against the content: lifting it scrolls down.
      const dy = (start.y - t.clientY) * sign;
      if (dy <= 0 || Math.abs(dy) <= Math.abs(start.x - t.clientX)) return;
      if (dy < needed * TOUCH_SCALE) return;
      start = null;
      onPushRef.current();
    };

    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
    };
  }, [ref, enabled, direction, needed, pastEdge, continuing]);
}

export default usePushIntent;
