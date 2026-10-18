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
 * Names never sit on names (`declutter`): the hovered or focused node always
 * shows, then the pinned — the focus's neighbours, a window's loudest, what
 * is lit — then the sample's most frequent, each kept only where it overlaps
 * none already kept. Where the graph is dense the loudest speak; zoom in and
 * the rest find room.
 *
 * Two clocks. *Which* nodes are named is re-decided at most every
 * `RESAMPLE_MS` (a sample is a GPU read-back); *where* the names sit follows
 * every frame from cosmos's tracked positions, so they never trail the points.
 * And imperative on purpose: a pool of spans moved by transform, not a React
 * tree re-rendered sixty times a second.
 */
import { useEffect, useRef } from 'react';
import { usePlane } from './CosmosPlane';
import { declutter, labelWidth, type LabelCandidate } from './declutter';

const OCCURRENCE = 1;
const RESAMPLE_MS = 250;

export function PlaneLabels({
  pinned = [],
  emphasis = null,
  max = 96,
}: {
  /** Named first, where they fit. */
  pinned?: number[];
  /** Named larger, and always — the focused or hovered node. */
  emphasis?: number | null;
  /** Names drawn from the sample at most, beyond the pinned ones. */
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

  /** Decide which nodes carry a name: the emphasised, the pinned, then the
   *  most frequent entities in an even sample of the screen — each where its
   *  name overlaps none already chosen. */
  function resample() {
    const graph = plane.graph!;
    const net = plane.network;
    const { pinned, max, emphasis } = props.current;
    const sampled = graph.getSampledPointPositionsMap();
    const tracked = graph.getTrackedPointPositionsMap();
    const first = [...new Set(emphasis != null ? [emphasis, ...pinned] : pinned)];
    const taken = new Set(first);
    const sample = [...sampled.keys()]
      .filter((i) => !taken.has(i) && net.kind[i] !== OCCURRENCE)
      .sort((a, b) => net.frequency[b] - net.frequency[a]);
    const candidates: LabelCandidate[] = [];
    // Pinned the plane is not tracking yet have no position this frame: they
    // are named now and take their turn at the next decision.
    const unplaced: number[] = [];
    const add = (i: number, p: [number, number]) => {
      const [x, y] = graph.spaceToScreenPosition(p);
      const r = graph.spaceToScreenRadius(graph.getPointRadiusByIndex(i) ?? 2);
      candidates.push({ i, x, y, r, w: labelWidth(net.name[i], i === emphasis ? 12.5 : 11), h: 14 });
    };
    for (const i of first) {
      const p = tracked.get(i) ?? sampled.get(i);
      if (p) add(i, p as [number, number]); else unplaced.push(i);
    }
    for (const i of sample) add(i, sampled.get(i) as [number, number]);
    const kept = declutter(candidates, { must: emphasis != null ? new Set([emphasis]) : undefined });
    const fromSample = kept.filter((i) => !taken.has(i)).slice(0, max);
    named.current = [...unplaced, ...kept.filter((i) => taken.has(i)), ...fromSample];
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
