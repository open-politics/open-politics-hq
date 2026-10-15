'use client';

/**
 * PlaneLabels — names over the plane, the first layer on `usePlane()`.
 *
 * cosmos draws no text. Naming every node of a large graph would be unreadable
 * and slow, so a few times a second this asks cosmos for an evenly spread
 * sample of the points on screen (`getSampledPointPositionsMap`, one per
 * `pointSamplingDistance` cell) and names the most frequent entities among
 * them. Zooming in shrinks each cell's share of the graph, so more names
 * appear exactly where there is room for them.
 *
 * `pinned` nodes — the focus, its neighbours, the hovered one — are always
 * named, wherever they are.
 *
 * Two clocks. *Which* nodes are named is re-decided at most every
 * `RESAMPLE_MS` (a sample is a GPU read-back); *where* the names sit follows
 * every frame from cosmos's tracked positions, so they never trail the points.
 * And imperative on purpose: a pool of spans moved by transform, not a React
 * tree re-rendered sixty times a second.
 */
import { useEffect, useRef } from 'react';
import { usePlane } from './CosmosPlane';

const OCCURRENCE = 1;
const RESAMPLE_MS = 250;

export function PlaneLabels({
  pinned = [],
  emphasis = null,
  max = 48,
}: {
  /** Always named, wherever they are. */
  pinned?: number[];
  /** Named larger — the focused or hovered node. */
  emphasis?: number | null;
  /** Names drawn from the sample, beyond the pinned ones. */
  max?: number;
}) {
  const plane = usePlane();
  const box = useRef<HTMLDivElement>(null);
  const pool = useRef<HTMLSpanElement[]>([]);
  const named = useRef<number[]>([]);
  const sampledAt = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const props = useRef({ pinned, emphasis, max });
  props.current = { pinned, emphasis, max };

  useEffect(() => {
    sampledAt.current = 0; // the pinned set changed: decide again now
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plane, pinned, emphasis, max]);

  useEffect(() => {
    const off = plane.subscribe(paint);
    return () => {
      off();
      if (trailing.current) clearTimeout(trailing.current);
      plane.track('labels', []);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plane]);

  /** Decide which nodes carry a name: the pinned ones, then the most
   *  frequent entities in an even sample of the screen. */
  function resample() {
    const graph = plane.graph!;
    const net = plane.network;
    const { pinned, max } = props.current;
    const taken = new Set(pinned);
    const sample = [...graph.getSampledPointPositionsMap().keys()]
      .filter((i) => !taken.has(i) && net.kind[i] !== OCCURRENCE)
      .sort((a, b) => net.frequency[b] - net.frequency[a])
      .slice(0, max);
    named.current = [...pinned, ...sample];
    plane.track('labels', named.current);
    sampledAt.current = performance.now();
  }

  function paint() {
    const graph = plane.graph;
    const root = box.current;
    if (!graph || !root) return;
    if (performance.now() - sampledAt.current > RESAMPLE_MS) resample();
    else if (!trailing.current) {
      // The view may stop moving inside the window: decide once more after
      // it, so the names fit where the camera came to rest.
      trailing.current = setTimeout(() => {
        trailing.current = null;
        sampledAt.current = 0;
        paint();
      }, RESAMPLE_MS);
    }

    const net = plane.network;
    const { emphasis, pinned } = props.current;
    const pinnedSet = new Set(pinned);
    const at = graph.getTrackedPointPositionsMap();
    let k = 0;
    for (const i of named.current) {
      const p = at.get(i);
      if (!p) continue; // absent, or tracked from the next frame on
      if (k === pool.current.length) {
        const span = document.createElement('span');
        span.className = 'plane-label';
        root.appendChild(span);
        pool.current.push(span);
      }
      const span = pool.current[k++];
      const [x, y] = graph.spaceToScreenPosition(p);
      const r = graph.spaceToScreenRadius(graph.getPointRadiusByIndex(i) ?? 2);
      if (span.textContent !== net.name[i]) span.textContent = net.name[i];
      span.style.transform = `translate(${Math.round(x + r + 3)}px, ${Math.round(y - 7)}px)`;
      span.dataset.emphasis = i === emphasis ? '1' : pinnedSet.has(i) ? '2' : '';
      span.style.display = '';
    }
    for (; k < pool.current.length; k++) pool.current[k].style.display = 'none';
  }

  return <div ref={box} className="plane-labels absolute inset-0 overflow-hidden" aria-hidden />;
}
