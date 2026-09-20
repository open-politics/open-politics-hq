import { useCallback, useEffect, useRef } from 'react';

/**
 * useScrollEdges — tells a scroll container which of its edges have more
 * content behind them.
 *
 * HQ never renders a scrollbar (see the Scrolling section in `globals.css`),
 * which removes the usual signal that a region continues past its edge. This
 * restores the signal as a fade at the edge that actually has something behind
 * it: the hook writes `data-edge-start` / `data-edge-end`, and the
 * `.scroll-edges` / `.scroll-edges-x` classes turn those into a mask.
 *
 * Position is measured, never assumed, so a region that fits its box is never
 * masked and nothing fades against empty space. The measurement is cheap
 * (three numbers off the element, no layout thrash) and it re-runs on scroll,
 * on resize of the element, and on mutation of its contents — the three ways
 * "is there more?" can change without the component re-rendering.
 *
 * ```tsx
 * const ref = useScrollEdges<HTMLDivElement>();
 * <div ref={ref} className="scroll-edges overflow-y-auto">…</div>
 * ```
 */
export function useScrollEdges<T extends HTMLElement>(
  axis: 'y' | 'x' = 'y',
) {
  const ref = useRef<T | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const [pos, size, scrollSize] = axis === 'y'
      ? [el.scrollTop, el.clientHeight, el.scrollHeight]
      : [el.scrollLeft, el.clientWidth, el.scrollWidth];

    // A 1px slack absorbs sub-pixel layout and elastic overscroll, both of
    // which otherwise leave a hairline fade permanently switched on at rest.
    const overflows = scrollSize - size > 1;
    const atStart = pos <= 1;
    const atEnd = pos + size >= scrollSize - 1;

    // Writing attributes rather than state keeps this off the render path —
    // a scroll handler that re-renders a large table is how scrolling gets
    // slow, and nothing in React needs to know these values.
    el.dataset.edgeStart = String(overflows && !atStart);
    el.dataset.edgeEnd = String(overflows && !atEnd);
  }, [axis]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    measure();

    el.addEventListener('scroll', measure, { passive: true });

    // The element can start overflowing without ever scrolling: it gets
    // narrower, or its contents grow. Both are watched, because a fade that
    // only appears after the first scroll is a fade that appears too late.
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  return ref;
}

export default useScrollEdges;
