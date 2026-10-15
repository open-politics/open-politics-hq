import { useEffect, type RefObject } from 'react';

/**
 * useWheelScrollX — lets a mouse wheel move a strip that scrolls sideways.
 *
 * A notched wheel only reports vertical motion, so over a region that scrolls
 * on the x axis it does nothing: the strip is reachable by trackpad, touch and
 * shift-wheel, and stuck for everyone else. This turns vertical wheel travel
 * into horizontal travel, and only that. A trackpad's own sideways swipe,
 * pinch-zoom (which arrives as a ctrl-wheel), a wheel something inside has
 * already claimed (a graph zooming), content under the pointer that can still
 * scroll vertically (a table in a panel), a strip with nothing to scroll, and a
 * strip already at the end it is being pushed toward are all left alone — so
 * the wheel still reaches whatever scrolls inside and around the strip.
 *
 * ```tsx
 * const ref = useScrollEdges<HTMLDivElement>('x');
 * useWheelScrollX(ref);
 * <div ref={ref} className="scroll-edges-x overflow-x-auto">…</div>
 * ```
 */
export function useWheelScrollX(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Whether something between the target and the strip can still scroll
    // vertically the way the wheel is going. That content keeps the wheel.
    const contentTakes = (from: EventTarget | null, delta: number) => {
      for (let node = from as Element | null; node && node !== el; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow !== 'auto' && overflow !== 'scroll') continue;
        const room = delta > 0
          ? node.scrollTop + node.clientHeight < node.scrollHeight - 1
          : node.scrollTop > 1;
        if (room) return true;
      }
      return false;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      if (contentTakes(e.target, e.deltaY)) return;

      // Firefox reports a notched wheel in lines; a page step is a viewport.
      const delta =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * el.clientWidth
        : e.deltaY;

      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      if (delta < 0 && el.scrollLeft <= 0) return;
      if (delta > 0 && el.scrollLeft >= max - 1) return;

      el.scrollLeft += delta;
      e.preventDefault();
    };

    // Not passive: `preventDefault` is what keeps the wheel from also
    // scrolling whatever the strip sits in.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}

export default useWheelScrollX;
