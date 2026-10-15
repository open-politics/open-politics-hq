'use client';

/**
 * PlaneLink — a line between two nodes, over the plane, following them.
 *
 * A layer on `usePlane()` like the labels: the two nodes are tracked (as this
 * link's own set — `PlaneView.track`) and the line moves every frame they do.
 * For drawing attention to a relation the graph does not hold — the pair the
 * resolver is weighing, a comparison — never for the graph's own links, which
 * cosmos draws.
 *
 *   tone    `pending` dashed and moving · `joined` solid · `apart` faint, dotted
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { usePlane } from './CosmosPlane';

export type LinkTone = 'pending' | 'joined' | 'apart';

export function PlaneLink({ from, to, tone }: { from: number; to: number; tone: LinkTone }) {
  const plane = usePlane();
  const line = useRef<SVGLineElement>(null);

  useEffect(() => {
    const owner = `link:${from}:${to}`;
    plane.track(owner, [from, to]);
    const paint = () => {
      const el = line.current;
      const g = plane.graph;
      if (!el || !g) return;
      const at = g.getTrackedPointPositionsMap();
      const a = at.get(from), b = at.get(to);
      if (!a || !b) { el.style.display = 'none'; return; }
      const [x1, y1] = g.spaceToScreenPosition(a);
      const [x2, y2] = g.spaceToScreenPosition(b);
      el.style.display = '';
      el.setAttribute('x1', String(x1));
      el.setAttribute('y1', String(y1));
      el.setAttribute('x2', String(x2));
      el.setAttribute('y2', String(y2));
    };
    paint();
    const off = plane.subscribe(paint);
    return () => { off(); plane.track(owner, []); };
  }, [plane, from, to]);

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <line
        ref={line}
        className={cn(
          'plane-link',
          tone === 'pending' && 'plane-link-pending',
          tone === 'joined' && 'plane-link-joined',
          tone === 'apart' && 'plane-link-apart',
        )}
      />
    </svg>
  );
}
