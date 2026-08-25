'use client';

/**
 * FieldConnectors — the SVG overlay that traces "this field reuses that field's
 * vocabulary" links inside the schema editor's outline, the same way the
 * AssetManager traces a source into the bundle it streams to.
 *
 * The unit drawn is a TRUNK, not a link. Refs in a real schema are a fan-in:
 * a dozen fields (`within`, `at`, `follows`, whatever is buried in a collapsed
 * object) all reuse a handful of canonical ones (`actors`, `places`). Drawn as
 * independent brackets that costs a lane per link and lights a dozen lines the
 * moment you touch a popular target — the picture goes opaque exactly where the
 * schema is most interesting. Grouped by target it costs a lane per *vocabulary*:
 * one vertical run down the gutter, a stub into every row that reuses it. A lane
 * means something, and there are three of them instead of thirteen.
 *
 * Lanes are allocated greedily, longest trunk first, into the outermost track no
 * overlapping trunk occupies — so trunks nest outside-in and disjoint ones share
 * a lane. The gutter isn't this component's to lay out: it measures what it needs
 * and reports it through `onGutterWidth`, and the outline pads its rows over by
 * that much (AssetManager does the same with the source rail's `mr-12`).
 *
 * Focus is what keeps it readable, and it works at two grains. `focusedIds` are
 * link ids, so a trunk can be partly lit: hover one row that reuses `places` and
 * you get the bright run from that row to `places` only, drawn over the faint
 * full trunk — the individual link, in the context of the vocabulary it belongs
 * to. Hover the target row instead and the whole fan-in lights.
 *
 * Two deliberate choices in how it measures:
 *  - y comes from `offsetTop` (scroll-content space) so the overlay rides the
 *    scroll for free with no scroll listener; x comes from the container's
 *    computed padding, which vertical scroll can't move.
 *  - geometry never depends on focus. Paths are built at render time from the
 *    measured trunks, and the MutationObserver ignores `class` — otherwise every
 *    row hover would re-measure the whole overlay.
 *
 * A field nested inside a collapsed object has no row to anchor to. Rather than
 * dropping it silently, the endpoint falls back to the nearest mounted ancestor
 * and is drawn as a hollow diamond: "continues inside this one". Since it joins
 * an existing trunk it costs no extra lane.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface FieldAnchor {
  /** the field's row id (`data-field-id`) */
  id: string;
  /** ancestor row ids, nearest first — fallback anchors when the row is collapsed away */
  ancestors: string[];
}

export interface FieldLink {
  id: string;
  /** the referencing field */
  source: FieldAnchor;
  /** the field whose vocabulary it inherits */
  target: FieldAnchor;
  /** human-readable "source → target", for the hover tooltip */
  label?: string;
}

/** The outline's resting left padding, with no trunks drawn. */
export const OUTLINE_GUTTER_MIN = 8;

const EDGE = 5;         // inset before the outermost lane
const LANE_GAP = 10;    // spacing between lanes
const MAX_GUTTER = 46;  // the outline rail is only 256px wide — lanes compress past this
const ELBOW = 5;
const SPAN_PAD = 6;     // vertical clearance two trunks need to share a lane
const HIT_W = 13;       // invisible stroke width that makes a stub grabbable

/**
 * A trunk at `laneX` spanning `ys`, with a horizontal stub into each row: the
 * outermost two rows get rounded corners, everything between meets the trunk as
 * a plain T. One `d` for the whole fan-in.
 */
function trunkPath(stubX: number, laneX: number, ys: number[]): string {
  const sorted = [...ys].sort((a, b) => a - b);
  const top = sorted[0];
  const bot = sorted[sorted.length - 1];
  if (bot - top < 1) return `M ${laneX} ${top} L ${stubX} ${top}`;
  const r = Math.max(0, Math.min(ELBOW, (bot - top) / 2, stubX - laneX));
  const seg: string[] = [];
  if (r < 0.5) {
    seg.push(`M ${stubX} ${top} L ${laneX} ${top} L ${laneX} ${bot} L ${stubX} ${bot}`);
  } else {
    seg.push(
      `M ${stubX} ${top} L ${laneX + r} ${top} Q ${laneX} ${top} ${laneX} ${top + r}`,
      `L ${laneX} ${bot - r} Q ${laneX} ${bot} ${laneX + r} ${bot} L ${stubX} ${bot}`,
    );
  }
  for (const y of sorted.slice(1, -1)) seg.push(`M ${laneX} ${y} L ${stubX} ${y}`);
  return seg.join(' ');
}

/**
 * Track allocation over y-intervals: longest span first, each taking the
 * outermost lane whose occupants all clear it.
 */
function allocateLanes(spans: Array<{ id: string; top: number; bot: number }>) {
  const lanes: Array<Array<[number, number]>> = [];
  const laneOf = new Map<string, number>();
  const byLength = [...spans].sort((a, b) => (b.bot - b.top) - (a.bot - a.top));
  for (const s of byLength) {
    let k = 0;
    while (k < lanes.length && lanes[k].some(([t, b]) => s.top < b + SPAN_PAD && t < s.bot + SPAN_PAD)) k++;
    if (k === lanes.length) lanes.push([]);
    lanes[k].push([s.top, s.bot]);
    laneOf.set(s.id, k);
  }
  return { laneOf, laneCount: lanes.length };
}

/** One row a trunk touches. */
interface Member {
  /** the link this stub represents — null for the trunk's own target row */
  linkId: string | null;
  /** the row to select when this stub is clicked */
  fieldId: string;
  y: number;
  collapsed: boolean;
  label?: string;
}

interface Trunk {
  /** the target field id — a trunk *is* one field's vocabulary */
  key: string;
  laneX: number;
  target: Member;
  sources: Member[];
}

interface Geometry {
  stubX: number;
  height: number;
  trunks: Trunk[];
}

const EMPTY: Geometry = { stubX: OUTLINE_GUTTER_MIN, height: 0, trunks: [] };

export const FieldConnectors: React.FC<{
  scrollRef: React.RefObject<HTMLElement | null>;
  /** every link worth drawing — the outline decides visibility, this decides shape */
  links: FieldLink[];
  /** link ids drawn at full strength; the rest of their trunk stays faint */
  focusedIds?: ReadonlySet<string>;
  /** stubs under the pointer, as link ids — lets the outline light the rows they join */
  onHoverLinks?: (ids: string[] | null) => void;
  /** clicking a stub jumps to the row it touches */
  onPickField?: (fieldId: string) => void;
  /** how much left padding the outline needs to fit the lanes */
  onGutterWidth?: (width: number) => void;
}> = ({ scrollRef, links, focusedIds, onHoverLinks, onPickField, onGutterWidth }) => {
  const [geom, setGeom] = useState<Geometry>(EMPTY);
  // Which stub is under the pointer. A `null` linkId means the trunk's own target
  // stub — hovering that lights the whole vocabulary rather than one link.
  const [hovered, setHovered] = useState<{ trunkKey: string; linkId: string | null } | null>(null);
  const rafRef = useRef<number>(0);
  const reportedRef = useRef<number>(-1);
  const settleRef = useRef<number>(0);
  const measureRef = useRef<() => void>(() => {});

  // Re-measure every frame for a short window. The gutter's padding transition
  // changes layout without mutating the DOM per frame, so neither observer below
  // sees it — without this the stubs would snap to their final x while the rows
  // are still sliding.
  const kickSettle = useCallback(() => {
    cancelAnimationFrame(settleRef.current);
    let start = 0;
    const step = (ts: number) => {
      if (start === 0) start = ts;
      measureRef.current();
      if (ts - start < 320) settleRef.current = requestAnimationFrame(step);
    };
    settleRef.current = requestAnimationFrame(step);
  }, []);

  // Report only on change: this feeds the parent's padding, which feeds our
  // measured stubX. Row heights are padding-independent (names truncate, never
  // wrap), so it settles instead of oscillating — and every change kicks a settle
  // window, since a lane count that shifts mid-session (expanding an object adds
  // rows, and rows can add trunks) moves the gutter just like mount does.
  const report = useCallback((width: number) => {
    if (reportedRef.current === width) return;
    reportedRef.current = width;
    onGutterWidth?.(width);
    kickSettle();
  }, [onGutterWidth, kickSettle]);

  const measure = useCallback(() => {
    const c = scrollRef.current;
    const bail = () => {
      setGeom((prev) => (prev.trunks.length === 0 ? prev : EMPTY));
      report(OUTLINE_GUTTER_MIN);
    };
    if (!c || links.length === 0) { bail(); return; }

    const row = (id: string) => c.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"]`);
    // The field's own row if it's mounted, else the nearest ancestor still on
    // screen — a link into a collapsed object should read as folded away, not as
    // absent.
    const anchor = (a: FieldAnchor): { y: number; collapsed: boolean } | null => {
      const own = row(a.id);
      if (own) return { y: own.offsetTop + own.offsetHeight / 2, collapsed: false };
      for (const id of a.ancestors) {
        const el = row(id);
        if (el) return { y: el.offsetTop + el.offsetHeight / 2, collapsed: true };
      }
      return null;
    };

    // Group by target: every field that reuses the same vocabulary rides one trunk.
    const byTarget = new Map<string, { target: Member; sources: Map<string, Member> }>();
    for (const l of links) {
      const t = anchor(l.target);
      const s = anchor(l.source);
      if (!t || !s) continue;
      if (Math.abs(t.y - s.y) < 1) continue; // both ends folded into the same row
      let trunk = byTarget.get(l.target.id);
      if (!trunk) {
        trunk = {
          target: { linkId: null, fieldId: l.target.id, y: t.y, collapsed: t.collapsed },
          sources: new Map(),
        };
        byTarget.set(l.target.id, trunk);
      }
      trunk.sources.set(l.source.id, {
        linkId: l.id,
        fieldId: l.source.id,
        y: s.y,
        collapsed: s.collapsed,
        label: l.label,
      });
    }
    if (byTarget.size === 0) { bail(); return; }

    const spans = [...byTarget].map(([key, t]) => {
      const ys = [t.target.y, ...[...t.sources.values()].map((m) => m.y)];
      return { id: key, top: Math.min(...ys), bot: Math.max(...ys) };
    });
    const { laneOf, laneCount } = allocateLanes(spans);

    // Lanes want LANE_GAP apart; past MAX_GUTTER they compress to fit rather than
    // eat the 256px rail. Lane 0 is outermost, so the widest trunk sits furthest
    // from the rows and the nesting reads outside-in.
    const wanted = Math.min(MAX_GUTTER, EDGE + laneCount * LANE_GAP);
    const gap = (wanted - EDGE) / laneCount;
    report(wanted);

    // Padding is what the parent actually applied — during its transition this
    // trails `wanted`, and the settle loop re-reads it each frame so the stubs
    // track the rows instead of snapping at the end.
    const stubX = parseFloat(getComputedStyle(c).paddingLeft) || wanted;
    const trunks = [...byTarget].map(([key, t]) => ({
      key,
      laneX: Math.min(EDGE + (laneOf.get(key) ?? 0) * gap, stubX - 3),
      target: t.target,
      sources: [...t.sources.values()],
    }));
    setGeom({ stubX, height: c.scrollHeight, trunks });
  }, [scrollRef, links, report]);

  useEffect(() => {
    measureRef.current = measure;
    const c = scrollRef.current;
    if (!c) return;
    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(c);
    // Rows appear and vanish as objects expand — childList catches that. `class`
    // is deliberately not watched: row hover would otherwise re-measure the whole
    // overlay on every pointer move.
    const mo = new MutationObserver(schedule);
    mo.observe(c, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    kickSettle();

    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(settleRef.current);
    };
  }, [scrollRef, measure, kickSettle]);

  const { stubX, height, trunks } = geom;

  const hover = useCallback((next: { trunkKey: string; linkId: string | null } | null) => {
    setHovered(next);
    if (!next) { onHoverLinks?.(null); return; }
    // Hovering the target stub means the whole vocabulary; a source stub means
    // just that one link.
    const t = trunks.find((x) => x.key === next.trunkKey);
    onHoverLinks?.(
      next.linkId
        ? [next.linkId]
        : (t?.sources.map((m) => m.linkId).filter((id): id is string => !!id) ?? []),
    );
  }, [onHoverLinks, trunks]);

  // Paths are derived here, not in measure, so focus never triggers a re-measure.
  // `lit` is the subset of a trunk actually being traced — drawn bright over the
  // faint whole, which is what shows one link inside its vocabulary.
  const drawn = useMemo(() => trunks.map((t) => {
    const all = [t.target, ...t.sources];
    // Hovering a target stub means the whole vocabulary. And with nothing focused
    // at all — "trace everything", untouched — there's nothing to contrast
    // against, so drawing every trunk faint would just wash the picture out.
    const wholeTrunk = (hovered?.trunkKey === t.key && hovered.linkId === null)
      || (!hovered && (focusedIds?.size ?? 0) === 0);
    const lit = wholeTrunk
      ? t.sources
      : t.sources.filter((m) => m.linkId === hovered?.linkId || (!!m.linkId && !!focusedIds?.has(m.linkId)));
    return {
      trunk: t,
      members: all,
      d: trunkPath(stubX, t.laneX, all.map((m) => m.y)),
      dLit: lit.length > 0 ? trunkPath(stubX, t.laneX, [t.target.y, ...lit.map((m) => m.y)]) : null,
      litIds: new Set(lit.map((m) => m.fieldId)),
      whole: lit.length === t.sources.length,
    };
  }), [trunks, stubX, hovered, focusedIds]);

  const marker = (m: Member, isTarget: boolean, on: boolean) => {
    const key = `${m.fieldId}-${isTarget ? 't' : 's'}`;
    if (m.collapsed) {
      return (
        <rect
          key={key}
          x={stubX - 2.6}
          y={m.y - 2.6}
          width={5.2}
          height={5.2}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          transform={`rotate(45 ${stubX} ${m.y})`}
        />
      );
    }
    return isTarget
      ? <circle key={key} cx={stubX} cy={m.y} r={on ? 3.6 : 3.2} fill="none" stroke="currentColor" strokeWidth={1.6} />
      : <circle key={key} cx={stubX} cy={m.y} r={2.6} fill="currentColor" />;
  };

  if (trunks.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-20 overflow-visible"
      width={stubX + 6}
      height={height}
      aria-hidden="true"
    >
      {drawn.map(({ trunk, members, d, dLit, litIds, whole }) => (
        <g key={trunk.key}>
          {/* The vocabulary, faint — context for whatever is lit. Skipped when the
              whole trunk is lit, so it isn't drawn twice. */}
          {!whole && (
            <g className="text-cyan-500/30">
              <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              {members.map((m) => marker(m, m === trunk.target, false))}
            </g>
          )}
          {(dLit || whole) && (
            <g className="text-cyan-500">
              <path d={whole ? d : dLit!} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              {members
                .filter((m) => whole || m === trunk.target || litIds.has(m.fieldId))
                .map((m) => marker(m, m === trunk.target, true))}
            </g>
          )}
          {/* Per-stub hit areas: a fat invisible stroke over each horizontal run,
              so you can pick one link out of the fan rather than the whole trunk. */}
          {members.map((m) => (
            <path
              key={`hit-${m.fieldId}`}
              d={`M ${trunk.laneX} ${m.y} L ${stubX} ${m.y}`}
              fill="none"
              stroke="transparent"
              strokeWidth={HIT_W}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onMouseEnter={() => hover({ trunkKey: trunk.key, linkId: m.linkId })}
              onMouseLeave={() => hover(null)}
              onClick={() => onPickField?.(m.fieldId)}
            >
              {m.label && <title>{m.label}</title>}
            </path>
          ))}
        </g>
      ))}
    </svg>
  );
};

export default FieldConnectors;
