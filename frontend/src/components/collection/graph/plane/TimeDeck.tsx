'use client';

/**
 * TimeDeck — the network as a deck of time slices, seen from the present.
 *
 * The flat time view lays time out left to right. This one turns it into
 * depth: each node sits in the slice of its time, at its place in the plane's
 * own layout, and the slices stack away from the reader. The present is the
 * front of the deck — drawn flat, at the plane's scale, named — and what comes
 * after waits behind it, smaller, fainter, converging on a vanishing point off
 * to the upper right. Links that reach from one time to another become lines
 * into the depth: streams, in the colour of where they start.
 *
 * **Scrolling is travelling.** The wheel moves the present through time, one
 * slice per notch; the slices ahead come forward into the light, the one left
 * behind grows past the reader and fades. Drag pans, pinch or ctrl-wheel
 * zooms. Nothing is rotated: the camera looks straight ahead and the vanishing
 * point is a lens shift (deck.gl's viewport padding), so the present stays a
 * true 2D graph — no tilt, no foreshortening — and only the depth recedes.
 *
 * The viewpoint is the reader's: how deep the slices stack (`depth`), how far
 * ahead stays visible (`ahead`), and where the depth converges (`vanish`).
 * Anchors in the groups' space (`anchoring.ts`) stand in the deck as pillars
 * through time — a stream gathers along each.
 *
 * A layer on `usePlane()` like the map and the labels: the plane keeps running
 * the layout (groups, so a topic is a region and its stream a colour) with its
 * own canvas hidden, and the deck reads the positions. One deck.gl layer per
 * slice, so travelling only changes each slice's opacity — a uniform, not a
 * buffer — and a scroll costs nothing per node.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useThemeVersion, resolveVarToRgba } from '@/lib/theme/cssColor';
import type { Network } from './network';
import { usePlane } from './CosmosPlane';

export interface TimeDeckProps {
  /** Per node: its slice (index into the timeline's cells), -1 = none. */
  slice: Int32Array;
  /** How many slices the timeline has. */
  slices: number;
  /** The present: the first and last slice of it. */
  present: [number, number];
  /** One notch of the wheel: +1 forward in time, -1 back. */
  onStep: (delta: number) => void;
  visible: Uint8Array | null;
  /** RGBA 0..1 per node — the panel's colouring. */
  colors: Float32Array;
  /** Diameter in px at the plane's scale, per node. */
  sizes: Float32Array;
  /** Drawn at full strength; the rest recede. Null = everything. */
  emphasis: Uint8Array | null;
  /** Named whatever slice they are in. */
  pinned: readonly number[];
  /** Depth between slices, as a share of the view's height. */
  depth?: number;
  /** Slices ahead over which the light falls by e. */
  ahead?: number;
  /** Where the depth converges, as a share of the view from its centre
   *  (right, down). */
  vanish?: [number, number];
  /** Anchors, as pillars through the slices. */
  anchors?: ReadonlyArray<{ id: string; x: number; y: number }>;
  /** Asked once the deck is up. */
  onReady?: (api: DeckApi) => void;
  onPick: (index: number, event: MouseEvent) => void;
  onHover: (index: number | null) => void;
  onBackground: () => void;
}

export interface DeckApi {
  frame: () => void;
  zoomBy: (f: number) => void;
  /** Plane space on the present's slice ↔ screen px within the deck. */
  project: (p: [number, number]) => [number, number];
  unproject: (s: [number, number]) => [number, number];
  subscribe: (fn: () => void) => () => void;
}

export const DECK_DEFAULTS = { depth: 0.32, ahead: 3, vanish: [0.3, -0.3] as [number, number] };
const FOVY = 40;
/** Slices ahead of the present keep this much light, falling off per slice. */
const AHEAD = 0.42;
/** Wheel travel per slice, px. */
const NOTCH = 70;
/** Names per slice: in the present, and ahead of it. */
const NAMED_PRESENT = 40;
const NAMED_AHEAD = 4;

/** How much light slice k gets with the present's front at f (continuous). */
export function sliceAlpha(k: number, front: number, width: number, falloff = DECK_DEFAULTS.ahead): number {
  const d = k - front;
  if (d < 0) return Math.max(0, 1 + d / 0.8);                 // behind: gone within a slice
  if (d <= width) return 1;
  return AHEAD * Math.exp(-(d - width) / falloff);
}

/** Slices: the nodes in each, the links each starts (the nearer end's
 *  slice), and the names worth showing. */
export function deckSlices(net: Network, slice: Int32Array, count: number, visible: Uint8Array | null) {
  const nodes: number[][] = Array.from({ length: count }, () => []);
  const links: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < net.size; i++) {
    const k = slice[i];
    if (k >= 0 && (!visible || visible[i])) nodes[k].push(i);
  }
  for (let j = 0; j < net.links; j++) {
    const s = net.source[j], t = net.target[j];
    const a = slice[s], b = slice[t];
    if (a < 0 || b < 0 || (visible && (!visible[s] || !visible[t]))) continue;
    links[Math.min(a, b)].push(j);
  }
  const named = nodes.map((ns) => [...ns]
    .filter((i) => net.kind[i] === 0)
    .sort((x, y) => net.frequency[y] - net.frequency[x])
    .slice(0, NAMED_PRESENT));
  return { nodes, links, named };
}

type DeckModules = {
  Deck: any; OrbitView: any; ScatterplotLayer: any; LineLayer: any; TextLayer: any;
};

/** Looking straight down the depth, with the lens shifted: viewport padding
 *  moves where the camera's axis — the vanishing point — lands on screen. */
function makeView(M: DeckModules, vanish: [number, number]) {
  const pct = (v: number) => `${Math.round(Math.abs(v) * 200)}%`;
  return new M.OrbitView({
    orbitAxis: 'Y', fovy: FOVY,
    padding: {
      left: vanish[0] > 0 ? pct(vanish[0]) : 0, right: vanish[0] < 0 ? pct(vanish[0]) : 0,
      top: vanish[1] > 0 ? pct(vanish[1]) : 0, bottom: vanish[1] < 0 ? pct(vanish[1]) : 0,
    },
  });
}

export function TimeDeck(props: TimeDeckProps) {
  const plane = usePlane();
  const net = plane.network;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const deck = useRef<any>(null);
  const mods = useRef<DeckModules | null>(null);
  const themeVersion = useThemeVersion();

  const latest = useRef(props);
  latest.current = props;

  const data = useMemo(
    () => deckSlices(net, props.slice, props.slices, props.visible),
    [net, props.slice, props.slices, props.visible]);
  // Input handlers are bound once; everything they draw from is read fresh.
  const dataRef = useRef(data);
  dataRef.current = data;
  const netRef = useRef(net);
  netRef.current = net;

  // ── What the frame is drawn from — refs, so travelling never re-renders ──
  const s = useRef({
    positions: null as Float32Array | null,
    posVersion: 0,
    centre: [0, 0] as [number, number],
    target: [0, 0] as [number, number],
    zoom: 0,
    fitZoom: 0,
    depth: 1,
    view: null as any,
    viewKey: '',
    listeners: new Set<() => void>(),
    front: props.present[0],
    width: props.present[1] - props.present[0],
    framed: false,
    queued: false,
    wheel: 0,
    size: [1, 1] as [number, number],
  }).current;

  const theme = useMemo(() => ({
    fg: resolveVarToRgba('--hud-fg', [40, 40, 40, 255]),
    halo: resolveVarToRgba('--background', [250, 250, 250, 255]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [themeVersion]);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  /** The camera, as deck.gl's viewState: looking straight down the depth,
   *  the vanishing point shifted off-centre and the present kept centred. */
  const vanishNow = () => latest.current.vanish ?? DECK_DEFAULTS.vanish;
  const viewOf = (M: DeckModules) => {
    const v = vanishNow();
    const key = `${v[0]}:${v[1]}`;
    if (key !== s.viewKey) { s.view = makeView(M, v); s.viewKey = key; }
    return s.view;
  };
  /** The depth between slices in world units: fixed once framed, so zooming
   *  is moving closer — the depth deepens — not reshaping the deck. */
  const depthOf = () => ((latest.current.depth ?? DECK_DEFAULTS.depth) * s.size[1]) / 2 ** s.fitZoom;

  const viewState = () => {
    const [w, h] = s.size;
    const v = vanishNow();
    const px = v[0] * w, py = v[1] * h;                      // screen px, y down
    const unit = 2 ** s.zoom;
    // The camera's axis — its target — sits at the vanishing point; the
    // present's centre is that far back from it, so it lands mid-view.
    return {
      target: [s.target[0] + px / unit, s.target[1] - py / unit, -s.front * s.depth] as [number, number, number],
      zoom: s.zoom,
      rotationX: 0,
      rotationOrbit: 0,
    };
  };

  const viewport = () => {
    const M = mods.current;
    if (!M) return null;
    return viewOf(M).makeViewport({ width: s.size[0], height: s.size[1], viewState: viewState() });
  };

  /** Fit the drawn nodes: centre on them, zoom so they fill the view. */
  const frame = () => {
    const pos = s.positions;
    if (!pos) return;
    const xs: number[] = [], ys: number[] = [];
    const { nodes } = dataRef.current;
    for (const ns of nodes) for (const i of ns) {
      const x = pos[2 * i], y = pos[2 * i + 1];
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
    if (!xs.length) return;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (v: number[], t: number) => v[Math.min(v.length - 1, Math.floor(t * v.length))];
    const x0 = q(xs, 0.03), x1 = q(xs, 0.97), y0 = q(ys, 0.03), y1 = q(ys, 0.97);
    s.centre = [(x0 + x1) / 2, (y0 + y1) / 2];
    s.target = [...s.centre];
    const [w, h] = s.size;
    s.zoom = s.fitZoom = Math.log2(Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0)) * 0.78);
    s.depth = depthOf();
    s.framed = true;
    draw();
  };

  const zoomAt = (factor: number, at?: [number, number]) => {
    const before = viewport();
    const p = at ?? [s.size[0] / 2, s.size[1] / 2];
    const w0 = before?.unproject(p);
    s.zoom = Math.max(s.fitZoom - 4, Math.min(s.fitZoom + 7, s.zoom + Math.log2(factor)));
    const after = viewport();
    const w1 = after?.unproject(p);
    if (w0 && w1) { s.target[0] += w0[0] - w1[0]; s.target[1] += w0[1] - w1[1]; }
    draw();
  };

  // ── Drawing ───────────────────────────────────────────────────────────────
  const layers = () => {
    const M = mods.current!;
    const pos = s.positions!;
    const { colors, sizes, emphasis, pinned, slice, anchors } = latest.current;
    const falloff = latest.current.ahead ?? DECK_DEFAULTS.ahead;
    const { nodes, links, named } = dataRef.current;
    const net = netRef.current;
    const theme = themeRef.current;
    const z = (k: number) => -k * s.depth;
    const unit = 1 / 2 ** s.fitZoom;                            // world units per px at the framing zoom
    const rgba = (i: number, a: number): [number, number, number, number] => {
      const dim = emphasis && !emphasis[i] ? 0.12 : 1;
      return [colors[4 * i] * 255, colors[4 * i + 1] * 255, colors[4 * i + 2] * 255, colors[4 * i + 3] * 255 * a * dim];
    };
    const pinnedSet = new Set(pinned);
    const out: any[] = [];
    const deepest = Math.min(nodes.length - 1, Math.ceil(s.front + s.width + 4.2 * falloff));
    // Far to near, so the present is drawn last, over what waits behind it.
    for (let k = deepest; k >= Math.max(0, Math.floor(s.front - 1)); k--) {
      const alpha = sliceAlpha(k, s.front, s.width, falloff);
      if (alpha < 0.01) continue;
      const present = k >= Math.round(s.front) && k <= Math.round(s.front) + s.width;
      const triggers = [s.posVersion, emphasis, colors];
      out.push(new M.LineLayer({
        id: `l-${k}`,
        data: links[k],
        opacity: alpha * (present ? 0.5 : 0.7),
        getSourcePosition: (j: number) => {
          const a = net.source[j];
          return [pos[2 * a], pos[2 * a + 1], z(slice[a])];
        },
        getTargetPosition: (j: number) => {
          const b = net.target[j];
          return [pos[2 * b], pos[2 * b + 1], z(slice[b])];
        },
        getColor: (j: number) => {
          // A stream wears the colour of where it starts — its nearer end.
          const a = net.source[j], b = net.target[j];
          const from = slice[a] <= slice[b] ? a : b;
          return rgba(from, 0.55);
        },
        getWidth: 1,
        widthUnits: 'pixels',
        updateTriggers: { getSourcePosition: triggers, getTargetPosition: triggers, getColor: triggers },
      }));
      out.push(new M.ScatterplotLayer({
        id: `n-${k}`,
        data: nodes[k],
        opacity: alpha,
        pickable: alpha > 0.3,
        radiusUnits: 'common',
        radiusMinPixels: 0.8,
        radiusMaxPixels: 36,
        getPosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k)],
        getRadius: (i: number) => (sizes[i] / 2) * unit,
        getFillColor: (i: number) => rgba(i, 1),
        updateTriggers: { getPosition: triggers, getRadius: [sizes], getFillColor: triggers },
      }));
      const names = present
        ? [...new Set([...named[k], ...nodes[k].filter((i) => pinnedSet.has(i))])]
        : named[k].slice(0, NAMED_AHEAD);
      if (names.length && alpha > 0.06) {
        out.push(new M.TextLayer({
          id: `t-${k}`,
          data: names,
          opacity: present ? 1 : alpha,
          characterSet: 'auto',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontWeight: 500,
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          outlineWidth: 3,
          outlineColor: [theme.halo[0], theme.halo[1], theme.halo[2], 230],
          sizeUnits: 'common',
          sizeMinPixels: 7,
          sizeMaxPixels: 15,
          getSize: (i: number) => (pinnedSet.has(i) ? 12.5 : 11) * unit,
          getText: (i: number) => net.name[i],
          getPosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k)],
          getPixelOffset: (i: number) => [Math.max(4, sizes[i] / 2 + 3), 0],
          getColor: (i: number) => [theme.fg[0], theme.fg[1], theme.fg[2], emphasis && !emphasis[i] ? 60 : 235],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          updateTriggers: { getPosition: triggers, getColor: triggers, getSize: [pinned], getPixelOffset: [sizes] },
        }));
      }
    }
    // Anchors: pillars from the present into the depth.
    if (anchors?.length) {
      const far = -(s.front + s.width + 4.2 * falloff) * s.depth;
      out.push(new M.LineLayer({
        id: 'anchors',
        data: anchors,
        getSourcePosition: (a: { x: number; y: number }) => [a.x, a.y, -s.front * s.depth],
        getTargetPosition: (a: { x: number; y: number }) => [a.x, a.y, far],
        getColor: [theme.fg[0], theme.fg[1], theme.fg[2], 150],
        getWidth: 1.5,
        widthUnits: 'pixels',
        updateTriggers: { getSourcePosition: [s.front, s.depth], getTargetPosition: [s.front, s.depth, falloff] },
      }));
    }
    return out;
  };

  function draw() {
    if (s.queued) return;
    s.queued = true;
    requestAnimationFrame(() => {
      s.queued = false;
      const d = deck.current;
      if (!d || !s.positions || !s.framed) return;
      // Ease the front toward the present: travel reads as motion, and the
      // slices ahead brighten as they come.
      const [lo, hi] = latest.current.present;
      const goal = lo;
      s.width = hi - lo;
      const gap = goal - s.front;
      s.front = Math.abs(gap) < 0.002 ? goal : s.front + gap * 0.16;
      s.depth = depthOf();
      d.setProps({ views: viewOf(mods.current!), viewState: viewState(), layers: layers() });
      s.listeners.forEach((fn) => fn());
      if (s.front !== goal) draw();
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    (async () => {
      const [core, lay] = await Promise.all([import('@deck.gl/core'), import('@deck.gl/layers')]);
      if (disposed || !canvas.current || !host.current) return;
      mods.current = {
        Deck: core.Deck, OrbitView: core.OrbitView,
        ScatterplotLayer: lay.ScatterplotLayer, LineLayer: lay.LineLayer, TextLayer: lay.TextLayer,
      };
      const r = host.current.getBoundingClientRect();
      s.size = [Math.max(1, r.width), Math.max(1, r.height)];
      deck.current = new core.Deck({
        canvas: canvas.current,
        width: '100%',
        height: '100%',
        views: viewOf(mods.current),
        viewState: viewState() as any,  // deck types its viewState for the map view
        controller: false,
        layers: [],
        pickingRadius: 4,
        getCursor: ({ isHovering }: { isHovering: boolean }) => (isHovering ? 'pointer' : 'grab'),
        onClick: (info: any, event: any) => {
          const src: MouseEvent = event?.srcEvent ?? event;
          if (info?.layer?.id?.startsWith('n-') && info.index >= 0) {
            latest.current.onPick(info.object as number, src);
          } else latest.current.onBackground();
        },
        onHover: (info: any) => {
          latest.current.onHover(info?.layer?.id?.startsWith('n-') && info.index >= 0 ? (info.object as number) : null);
        },
        onResize: ({ width, height }: { width: number; height: number }) => {
          s.size = [Math.max(1, width), Math.max(1, height)];
          draw();
        },
      });
      latest.current.onReady?.({
        frame,
        zoomBy: (f) => zoomAt(f),
        project: ([x, y]) => {
          const vp = viewport();
          if (!vp) return [NaN, NaN];
          const [sx, sy] = vp.project([x, y, -s.front * s.depth]);
          return [sx, sy];
        },
        unproject: ([sx, sy]) => {
          const vp = viewport();
          if (!vp) return [NaN, NaN];
          const [x, y] = vp.unproject([sx, sy]);
          return [x, y];
        },
        subscribe: (fn) => { s.listeners.add(fn); return () => { s.listeners.delete(fn); }; },
      });
      read();
    })().catch((err) => console.error('[TimeDeck] failed to start', err));
    return () => {
      disposed = true;
      deck.current?.finalize();
      deck.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── The layout, as the plane runs it ──────────────────────────────────────
  const lastRead = useRef(0);
  function read() {
    const graph = plane.graph;
    if (!graph) return;
    const live = graph.getPointPositions();
    if (!live.length) return;
    s.positions = Float32Array.from(live);
    s.posVersion++;
    if (!s.framed) frame();
    else draw();
  }
  useEffect(() => plane.subscribe(() => {
    // The layout moves every frame while it runs; the deck follows four times
    // a second — reading positions back off the GPU is not free.
    const now = performance.now();
    if (now - lastRead.current < 250) return;
    lastRead.current = now;
    read();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [plane]);

  // Anything the props change is a redraw; the present eases on its own.
  useEffect(() => { draw(); }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Input: wheel travels, drag pans, pinch zooms ──────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.01), [e.clientX - r.left, e.clientY - r.top]);
        return;
      }
      s.wheel += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      while (Math.abs(s.wheel) >= NOTCH) {
        const step = Math.sign(s.wheel);
        s.wheel -= step * NOTCH;
        latest.current.onStep(step);
      }
    };
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      const unit = 2 ** s.zoom;
      s.target[0] -= dx / unit;
      s.target[1] += dy / unit;
      draw();
    };
    const onUp = () => { drag = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={host} className="pointer-events-auto absolute inset-0 touch-none">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
