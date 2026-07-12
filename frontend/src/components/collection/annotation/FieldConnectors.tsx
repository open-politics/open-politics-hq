'use client';

/**
 * FieldConnectors — an SVG overlay that draws the "this field reuses that
 * field's vocabulary" links inside the schema editor's outline, the same way
 * the AssetManager traces a source into the bundle it streams to.
 *
 * Both endpoints live in one vertical list, so each link is a rounded bracket
 * hugging the left gutter: a stub at each row, joined down the rail. Endpoints
 * are measured in scroll-content space (`offsetTop`), so the overlay is a child
 * of the scroll container and rides the scroll for free — no scroll listener,
 * only resize / DOM-mutation recompute (rows appear as objects expand).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface FieldLink {
  id: string;
  sourceId: string;   // the referencing field (data-field-id)
  targetId: string;   // the field whose vocabulary it inherits
  active?: boolean;    // one endpoint is selected → emphasize
}

const STUB_X = 15;   // where the little horizontal stub meets the row
const RAIL_X = 4;    // the vertical rail down the gutter
const ELBOW = 5;

/** Rounded left-bracket from row y1 to row y2 through the gutter rail. */
function bracketPath(y1: number, y2: number): string {
  const top = Math.min(y1, y2);
  const bot = Math.max(y1, y2);
  const r = Math.max(0, Math.min(ELBOW, (bot - top) / 2, STUB_X - RAIL_X));
  return [
    `M ${STUB_X} ${top}`,
    `L ${RAIL_X + r} ${top}`,
    `Q ${RAIL_X} ${top} ${RAIL_X} ${top + r}`,
    `L ${RAIL_X} ${bot - r}`,
    `Q ${RAIL_X} ${bot} ${RAIL_X + r} ${bot}`,
    `L ${STUB_X} ${bot}`,
  ].join(' ');
}

export const FieldConnectors: React.FC<{
  scrollRef: React.RefObject<HTMLElement | null>;
  links: FieldLink[];
}> = ({ scrollRef, links }) => {
  const [paths, setPaths] = useState<Array<{ id: string; d: string; y1: number; y2: number; active: boolean }>>([]);
  const [height, setHeight] = useState(0);
  const rafRef = useRef<number>(0);

  const measure = useCallback(() => {
    const c = scrollRef.current;
    if (!c || links.length === 0) { setPaths([]); return; }
    const rowMid = (id: string): number | null => {
      const el = c.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"]`);
      if (!el) return null;               // collapsed / not mounted → skip
      return el.offsetTop + el.offsetHeight / 2;
    };
    const out: typeof paths = [];
    for (const l of links) {
      const y1 = rowMid(l.sourceId);
      const y2 = rowMid(l.targetId);
      if (y1 == null || y2 == null || Math.abs(y1 - y2) < 1) continue;
      out.push({ id: l.id, d: bracketPath(y1, y2), y1, y2, active: !!l.active });
    }
    setPaths(out);
    setHeight(c.scrollHeight);
  }, [scrollRef, links]);

  useEffect(() => {
    measure();
    const c = scrollRef.current;
    if (!c) return;
    const schedule = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(schedule);
    ro.observe(c);
    const mo = new MutationObserver(schedule);
    mo.observe(c, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(rafRef.current); };
  }, [measure]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-20 overflow-visible"
      width={STUB_X + 4}
      height={height}
      aria-hidden="true"
    >
      {paths.map(p => (
        <g key={p.id} className={cn(p.active ? 'text-cyan-500' : 'text-cyan-500/45')}>
          <path d={p.d} fill="none" stroke="currentColor" strokeWidth={p.active ? 2 : 1.5} strokeLinecap="round" />
          <circle cx={STUB_X} cy={p.y1} r={p.active ? 3 : 2.5} fill="currentColor" />
          <circle cx={STUB_X} cy={p.y2} r={2.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
        </g>
      ))}
    </svg>
  );
};

export default FieldConnectors;
