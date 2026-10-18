'use client';

/**
 * TimeDeck — the run as a space-time cube, seen from the present.
 *
 * The plate is the groups layout — a node keeps its place at every time, so
 * a region is a topic — and depth is time. What is there at each time comes
 * from `presence.ts`, read by `deck.ts`:
 *
 *   threads   an actor present over consecutive slices is a line straight back
 *             through the deck, its dot in each slice sized by how loud it is
 *             there — a burst is a thread thickening
 *   points    occurrences, and anything seen once, in their slice
 *   flat      relations between two things present at the same time lie in
 *             that slice; only the present's slices draw them
 *   streams   links whose ends never meet in time run across the depth
 *
 * The present is the front — named where names fit, loudest first
 * (`declutter`), its relations drawn — and what comes after
 * waits behind it, fainter, converging on a vanishing point. At the present
 * the deck marks change: a ring where a thread begins (an actor entering the
 * story), a ghost where one that ran up to now has gone quiet.
 *
 * **Scrolling is travelling.** The wheel moves the present through time, one
 * slice per notch; what is ahead comes forward into the light. Drag pans,
 * pinch or ctrl-wheel zooms. Nothing is rotated: the camera looks straight
 * ahead and the vanishing point is a lens shift (deck.gl's viewport padding),
 * so the present stays a true 2D graph and only the depth recedes.
 *
 * The viewpoint is the reader's: how deep the slices stack (`depth`), how far
 * ahead stays visible (`ahead`), and where the depth converges (`vanish`) —
 * set on the deck itself by ⌘-dragging (Ctrl elsewhere): the depth converges
 * under the pointer, and is kept once it lets go (`onVanish`). Anchors in the
 * groups' space (`anchoring.ts`) stand as pillars through time.
 *
 * **The slicer** (`slicer`) cuts the deck at one instant: a plane on the fixed
 * plate, never a box. The camera moves to the cut and the past stays behind
 * the reader as a trace of threads, so the cut sits inside the stream; the
 * streams through it mark it as points. Its slice is lit and named; the rest
 * of the window steps back to pages, and ⇧-scroll moves the cut through them.
 * Its name opens the instant's documents (`onCut`).
 *
 * A layer on `usePlane()` like the map and the labels: the plane keeps running
 * the layout with its own canvas hidden, and the deck reads the positions. A
 * few deck.gl layers per slice, so travelling only changes their opacity — a
 * uniform, not a buffer — and a scroll costs nothing per node.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useThemeVersion, resolveVarToRgba } from '@/lib/theme/cssColor';
import { hexToRgba } from './channels';
import { usePlane } from './CosmosPlane';
import { declutter, labelWidth, type LabelCandidate } from './declutter';
import type { Presence } from './presence';
import type { Inset } from './PlaneAnchors';
import {
  DECK_DEFAULTS, cutAlpha, deckChange, deckCrossings, deckExtent, deckSlices, sliceAlpha,
  type DeckData,
} from './deck';

export interface TimeDeckProps {
  /** When each node is there (`presenceOf`); its cells are the slices. */
  presence: Presence;
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
  /** Named first, whatever slice they are in, where they fit. */
  pinned: readonly number[];
  /** Named always — the hovered or focused node. */
  featured?: number | null;
  /** Depth between slices, as a share of the view's height. */
  depth?: number;
  /** Slices ahead over which the light falls by e. */
  ahead?: number;
  /** Where the depth converges, as a share of the view from its centre
   *  (right, down). */
  vanish?: [number, number];
  /** The canvas the panel's cards leave open — framing fits inside it. */
  inset?: Inset;
  /** Anchors, as pillars through the slices, in their set's hue. */
  anchors?: ReadonlyArray<{ id: string; x: number; y: number; hue?: string }>;
  /** Cut the deck at one instant of the present, named by its slice — null:
   *  no cut. */
  slicer?: { label: (slice: number) => string } | null;
  /** The cut's name was clicked: open that instant. */
  onCut?: (slice: number) => void;
  /** A ⌘-drag on the deck has settled where the depth converges. */
  onVanish?: (vanish: [number, number]) => void;
  /** Asked once the deck is up. */
  onReady?: (api: DeckApi) => void;
  onPick: (index: number, event: MouseEvent) => void;
  /** A click on a pile: every node under the pointer, nearest first. */
  onStack?: (nodes: number[], event: MouseEvent) => void;
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

export { DECK_DEFAULTS };
const FOVY = 40;
/** Wheel travel per slice, px. */
const NOTCH = 70;
/** Names per slice ahead of the present. */
const NAMED_AHEAD = 4;
/** How far off-centre the vanishing point may go, as a share of the view. */
export const VANISH_REACH = 0.45;
/** The slicer's corner marks, px on screen. */
const CORNER = 14;
/** A dot's size between its quietest and loudest time, as a share of its
 *  full size: never smaller than this. */
const QUIETEST = 0.45;

type DeckModules = {
  Deck: any; OrbitView: any; ScatterplotLayer: any; LineLayer: any; TextLayer: any; SolidPolygonLayer: any;
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
    () => deckSlices(net, props.presence, props.visible),
    [net, props.presence, props.visible]);
  // Input handlers are bound once; everything they draw from is read fresh.
  const dataRef = useRef(data);
  dataRef.current = data;
  const netRef = useRef(net);
  netRef.current = net;

  // ── What the frame is drawn from — refs, so travelling never re-renders ──
  const s = useRef({
    positions: null as Float32Array | null,
    posVersion: 0,
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
    plate: { version: -1, data: null as DeckData | null, box: null as [number, number, number, number] | null },
    /** The cut, in slices past the front — eased toward `cutGoal`. */
    cut: 0,
    cutGoal: 0,
    cutWheel: 0,
    cross: { key: '', data: null as DeckData | null, at: new Float32Array(0) as Float32Array },
    change: { k: -1, data: null as DeckData | null, onset: [] as number[], quiet: [] as number[], loud: new Map<number, number>() },
    /** Where a ⌘-drag holds the vanishing point, until the prop catches up. */
    vanishLive: null as [number, number] | null,
    /** The press was a ⌘-drag's: the click it ends in picks nothing. */
    viewpointGesture: false,
    /** ⌘ is held. */
    viewpointKey: false,
  }).current;
  const marker = useRef<HTMLSpanElement>(null);

  const theme = useMemo(() => ({
    fg: resolveVarToRgba('--hud-fg', [40, 40, 40, 255]),
    halo: resolveVarToRgba('--background', [250, 250, 250, 255]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [themeVersion]);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  /** Where the camera looks: the cut, or the front without one. */
  const focus = () => s.front + s.cut;
  const vanishNow = () => s.vanishLive ?? latest.current.vanish ?? DECK_DEFAULTS.vanish;
  const viewOf = (M: DeckModules) => {
    const v = vanishNow();
    const key = `${v[0]}:${v[1]}`;
    if (key !== s.viewKey) { s.view = makeView(M, v); s.viewKey = key; }
    return s.view;
  };
  /** The depth between slices in world units: fixed once framed, so zooming
   *  is moving closer — the depth deepens — not reshaping the deck. */
  const depthOf = () => ((latest.current.depth ?? DECK_DEFAULTS.depth) * s.size[1]) / 2 ** s.fitZoom;

  /** The camera, as deck.gl's viewState: looking straight down the depth,
   *  the vanishing point shifted off-centre and the present kept centred. */
  const viewState = () => {
    const [w, h] = s.size;
    const v = vanishNow();
    const px = v[0] * w, py = v[1] * h;                      // screen px, y down
    const unit = 2 ** s.zoom;
    // The camera's axis — its target — sits at the vanishing point; the
    // present's centre is that far back from it, so it lands mid-view.
    return {
      target: [s.target[0] + px / unit, s.target[1] - py / unit, -focus() * s.depth] as [number, number, number],
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

  /** The plate: where everything drawn lies, as the layout stands. */
  const plateNow = () => {
    const d = dataRef.current;
    if (s.positions && (s.plate.version !== s.posVersion || s.plate.data !== d)) {
      s.plate = { version: s.posVersion, data: d, box: deckExtent(s.positions, d.drawn) };
    }
    return s.plate.box;
  };

  /** Fit the plate into the canvas the panel's cards leave open. */
  const frame = () => {
    const box = plateNow();
    if (!box) return;
    const [x0, y0, x1, y1] = box;
    const [w, h] = s.size;
    const ins = latest.current.inset ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const ow = Math.max(1, w - ins.left - ins.right), oh = Math.max(1, h - ins.top - ins.bottom);
    s.zoom = s.fitZoom = Math.log2(Math.min(ow / Math.max(1, x1 - x0), oh / Math.max(1, y1 - y0)) * 0.92);
    // The open canvas's centre is off the screen's by half the difference of
    // its insets; the plate's centre goes there (y is up in the deck).
    const u = 2 ** s.zoom;
    s.target = [(x0 + x1) / 2 - (ins.left - ins.right) / 2 / u, (y0 + y1) / 2 + (ins.top - ins.bottom) / 2 / u];
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

  /** What changes at slice k — threads beginning, threads gone quiet — and
   *  how loud each node is there. */
  const changeAt = (k: number) => {
    const d = dataRef.current;
    if (s.change.k !== k || s.change.data !== d) {
      const { onset, quiet } = deckChange(d, k);
      const loud = new Map<number, number>();
      d.nodes[k]?.forEach((i, q) => loud.set(i, d.loud[k][q]));
      s.change = { k, data: d, onset, quiet, loud };
    }
    return s.change;
  };

  // ── Drawing ───────────────────────────────────────────────────────────────
  const layers = () => {
    const M = mods.current!;
    const pos = s.positions!;
    const { colors, sizes, emphasis, pinned, anchors, presence } = latest.current;
    const falloff = latest.current.ahead ?? DECK_DEFAULTS.ahead;
    const d = dataRef.current;
    const net = netRef.current;
    const theme = themeRef.current;
    const z = (k: number) => -k * s.depth;
    const unit = 1 / 2 ** s.fitZoom;                            // world units per px at the framing zoom
    const toScreen = 2 ** s.zoom;                               // px per world unit at the present
    const rgba = (i: number, a: number): [number, number, number, number] => {
      const dim = emphasis && !emphasis[i] ? 0.12 : 1;
      return [colors[4 * i] * 255, colors[4 * i + 1] * 255, colors[4 * i + 2] * 255, colors[4 * i + 3] * 255 * a * dim];
    };
    /** A node's radius in a slice where it has m mentions: its full size at
     *  its loudest time, down to QUIETEST of it. */
    const radius = (i: number, m: number) =>
      (sizes[i] / 2) * unit * (QUIETEST + (1 - QUIETEST) * Math.sqrt(m / Math.max(1, presence.peak[i])));
    const pinnedSet = new Set(pinned);
    const slicing = !!latest.current.slicer;
    const at = focus(), atK = Math.round(at);
    const lo = Math.round(s.front), hi = lo + s.width;
    const lightOf = (k: number) => (slicing ? cutAlpha(k, s.front, s.width, at, falloff) : sliceAlpha(k, s.front, s.width, falloff));
    const triggers = [s.posVersion, emphasis, colors, d];
    const out: any[] = [];
    const deepest = Math.min(d.nodes.length - 1, Math.ceil(s.front + s.width + 4.2 * falloff));
    const nearest = Math.max(0, Math.floor(slicing ? at - 3 : s.front - 1));
    const change = changeAt(atK);
    const onsetSet = new Set(change.onset);
    const { names, dx } = nameSlices(deepest, nearest, slicing, atK, lo, hi, change.onset, pinnedSet);
    const featured = latest.current.featured;

    // Far to near, so the present is drawn last, over what waits behind it.
    // The slicer goes in where the cut is, among the slices.
    let sliced = !slicing || !plateNow();
    for (let k = deepest; k >= nearest; k--) {
      if (!sliced && k <= at + 1e-3) { out.push(...slicerLayers()); sliced = true; }
      const alpha = lightOf(k);
      if (alpha < 0.01) continue;
      const lit = slicing ? k === atK : k >= lo && k <= hi;
      // Behind the reader with a cut — the past — only threads remain.
      const dots = !slicing || k > s.front - 1;

      // Threads: each actor's line into the next slice.
      if (d.threads[k].length) {
        out.push(new M.LineLayer({
          id: `th-${k}`,
          data: d.threads[k],
          opacity: Math.min(alpha, lightOf(k + 1)) * 0.6,
          getSourcePosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k)],
          getTargetPosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k + 1)],
          getColor: (i: number) => rgba(i, 0.7),
          getWidth: 1.25,
          widthUnits: 'pixels',
          updateTriggers: { getSourcePosition: triggers, getTargetPosition: triggers, getColor: triggers },
        }));
      }
      // Streams: links whose ends never meet in time, across the depth.
      if (d.streams[k].length) {
        out.push(new M.LineLayer({
          id: `x-${k}`,
          data: d.streams[k],
          opacity: alpha * 0.6,
          getSourcePosition: (j: number) => {
            const a = net.source[j];
            return [pos[2 * a], pos[2 * a + 1], z(d.span[2 * j])];
          },
          getTargetPosition: (j: number) => {
            const b = net.target[j];
            return [pos[2 * b], pos[2 * b + 1], z(d.span[2 * j + 1])];
          },
          getColor: (j: number) => {
            // A stream wears the colour of where it starts — its nearer end.
            const from = d.span[2 * j] <= d.span[2 * j + 1] ? net.source[j] : net.target[j];
            return rgba(from, 0.55);
          },
          getWidth: 1,
          widthUnits: 'pixels',
          updateTriggers: { getSourcePosition: triggers, getTargetPosition: triggers, getColor: triggers },
        }));
      }
      // Relations at this time, where the present is read.
      const flat = lit || (slicing && k > atK && k <= hi);
      if (flat && d.flat[k].length) {
        out.push(new M.LineLayer({
          id: `l-${k}`,
          data: d.flat[k],
          opacity: alpha * (lit ? 0.55 : 0.4),
          getSourcePosition: (j: number) => [pos[2 * net.source[j]], pos[2 * net.source[j] + 1], z(k)],
          getTargetPosition: (j: number) => [pos[2 * net.target[j]], pos[2 * net.target[j] + 1], z(k)],
          getColor: (j: number) => rgba(net.source[j], 0.5),
          getWidth: 1,
          widthUnits: 'pixels',
          updateTriggers: { getSourcePosition: triggers, getTargetPosition: triggers, getColor: triggers },
        }));
      }
      if (dots) {
        out.push(new M.ScatterplotLayer({
          id: `n-${k}`,
          data: d.nodes[k],
          opacity: alpha,
          pickable: alpha > 0.3,
          radiusUnits: 'common',
          radiusMinPixels: 0.8,
          radiusMaxPixels: 36,
          getPosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k)],
          getRadius: (i: number, { index }: { index: number }) => radius(i, d.loud[k][index]),
          getFillColor: (i: number) => rgba(i, 1),
          updateTriggers: { getPosition: triggers, getRadius: [sizes, d], getFillColor: triggers },
        }));
      }
      // Change, where the present is: a ring where a thread begins, a ghost
      // where one that ran up to now has gone quiet.
      if (k === atK) {
        const px = (i: number, m: number) => Math.max(0.8, Math.min(36, radius(i, m) * toScreen));
        if (change.quiet.length) {
          out.push(new M.ScatterplotLayer({
            id: 'quiet',
            data: change.quiet,
            stroked: true, filled: false,
            radiusUnits: 'pixels', lineWidthUnits: 'pixels',
            getPosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k)],
            getRadius: (i: number) => Math.max(2.5, px(i, 1)),
            getLineColor: (i: number) => rgba(i, 0.55),
            getLineWidth: 1,
            updateTriggers: { getPosition: triggers, getRadius: [sizes, s.zoom, d], getLineColor: triggers },
          }));
        }
        if (change.onset.length) {
          out.push(new M.ScatterplotLayer({
            id: 'onset',
            data: change.onset,
            stroked: true, filled: false,
            radiusUnits: 'pixels', lineWidthUnits: 'pixels',
            getPosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k)],
            getRadius: (i: number) => px(i, change.loud.get(i) ?? 1) + 3.5,
            getLineColor: (i: number) => [theme.fg[0], theme.fg[1], theme.fg[2], emphasis && !emphasis[i] ? 50 : 210],
            getLineWidth: 1.25,
            updateTriggers: { getPosition: triggers, getRadius: [sizes, s.zoom, d], getLineColor: [emphasis, theme] },
          }));
        }
      }
      const shown = names.get(k) ?? [];
      if (shown.length && alpha > 0.06) {
        out.push(new M.TextLayer({
          id: `t-${k}`,
          data: shown,
          opacity: lit ? 1 : alpha,
          characterSet: 'auto',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontWeight: 500,
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          outlineWidth: 3,
          outlineColor: [theme.halo[0], theme.halo[1], theme.halo[2], 230],
          sizeUnits: 'common',
          sizeMinPixels: 7,
          sizeMaxPixels: 15,
          getSize: (i: number) => (i === featured || pinnedSet.has(i) || (k === atK && onsetSet.has(i)) ? 12.5 : 11) * unit,
          getText: (i: number) => net.name[i],
          getPosition: (i: number) => [pos[2 * i], pos[2 * i + 1], z(k)],
          // Where `declutter` measured it: just right of the dot as drawn.
          getPixelOffset: (i: number) => [dx.get(i) ?? 4, 0],
          getColor: (i: number) => [theme.fg[0], theme.fg[1], theme.fg[2],
            emphasis && !emphasis[i] ? 60 : k === atK && onsetSet.has(i) ? 255 : 225],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          updateTriggers: {
            getPosition: triggers, getColor: [...triggers, change], getSize: [pinned, change, featured], getPixelOffset: [dx],
          },
        }));
      }
    }
    if (!sliced) out.push(...slicerLayers());
    // Anchors: pillars from the present into the depth.
    if (anchors?.length) {
      const far = -(s.front + s.width + 4.2 * falloff) * s.depth;
      out.push(new M.LineLayer({
        id: 'anchors',
        data: anchors,
        getSourcePosition: (a: { x: number; y: number }) => [a.x, a.y, -focus() * s.depth],
        getTargetPosition: (a: { x: number; y: number }) => [a.x, a.y, far],
        getColor: (a: { hue?: string }) => {
          if (!a.hue) return [theme.fg[0], theme.fg[1], theme.fg[2], 150];
          const [r, g, b] = hexToRgba(a.hue);
          return [r * 255, g * 255, b * 255, 190];
        },
        getWidth: 2,
        widthUnits: 'pixels',
        updateTriggers: {
          getSourcePosition: [s.front, s.cut, s.depth], getTargetPosition: [s.front, s.depth, falloff], getColor: [anchors],
        },
      }));
    }
    return out;
  };

  /** Which names show, per slice: the present's — the featured node, the
   *  pinned, the actors entering the story, then the loudest — and a few
   *  ahead; nothing behind the reader. One placement across all of them,
   *  nearest slice first, so no name sits on another (`declutter`). */
  const nameSlices = (
    deepest: number, nearest: number, slicing: boolean, atK: number, lo: number, hi: number,
    onset: readonly number[], pinnedSet: ReadonlySet<number>,
  ): { names: Map<number, number[]>; dx: Map<number, number> } => {
    const vp = viewport();
    const out = new Map<number, number[]>();
    const dx = new Map<number, number>();
    if (!vp) return { names: out, dx };
    const d = dataRef.current;
    const { sizes, presence, featured } = latest.current;
    const net = netRef.current;
    const pos = s.positions!;
    const unit = 1 / 2 ** s.fitZoom;
    const [w, h] = s.size;
    const candidates: Array<LabelCandidate & { k: number }> = [];
    const offer = (k: number, i: number, m: number, larger: boolean) => {
      const z = -k * s.depth;
      const [x, y] = vp.project([pos[2 * i], pos[2 * i + 1], z]);
      if (!(x > -40 && x < w + 40 && y > -20 && y < h + 20)) return;
      // Pixels per world unit at this slice's depth.
      const [x1] = vp.project([pos[2 * i] + 1, pos[2 * i + 1], z]);
      const scale = Math.abs(x1 - x);
      const r = (sizes[i] / 2) * unit * scale * (0.45 + 0.55 * Math.sqrt(m / Math.max(1, presence.peak[i])));
      const font = Math.max(7, Math.min(15, (larger ? 12.5 : 11) * unit * scale));
      candidates.push({ i, k, x, y, r: Math.min(36, r), w: labelWidth(net.name[i], font), h: font + 3 });
    };
    const isLit = (k: number) => (slicing ? k === atK : k >= lo && k <= hi);
    const litSlices: number[] = [];
    for (let k = Math.max(nearest, 0); k <= deepest; k++) if (isLit(k)) litSlices.push(k);
    for (const k of litSlices) {
      const loud = new Map<number, number>();
      d.nodes[k].forEach((i, q) => loud.set(i, d.loud[k][q]));
      const here = (i: number) => loud.has(i);
      const order = [
        ...(featured != null && here(featured) ? [featured] : []),
        ...d.nodes[k].filter((i) => pinnedSet.has(i)),
        ...(k === atK ? onset : []),
        ...d.named[k],
      ];
      const seen = new Set<number>();
      for (const i of order) {
        if (seen.has(i)) continue;
        seen.add(i);
        offer(k, i, loud.get(i) ?? 1, pinnedSet.has(i) || (k === atK && onset.includes(i)) || i === featured);
      }
    }
    const ahead = slicing ? atK : hi;
    for (let k = ahead + 1; k <= deepest; k++) {
      d.named[k].slice(0, NAMED_AHEAD).forEach((i) => offer(k, i, 1, false));
    }
    const kept = new Set(declutter(candidates, { must: featured != null ? new Set([featured]) : undefined }));
    for (const c of candidates) {
      if (!kept.has(c.i)) continue;
      kept.delete(c.i);                                         // once, in its nearest slice
      dx.set(c.i, c.r + 3);
      const list = out.get(c.k);
      if (list) list.push(c.i); else out.set(c.k, [c.i]);
    }
    return { names: out, dx };
  };

  /** The cut: a plane at one instant on the plate — a faint face, its edge and
   *  corners, its name — the window's other slices as pages, and the streams
   *  passing through it. */
  const slicerLayers = () => {
    const M = mods.current!;
    const pos = s.positions!;
    const { slicer, presence, colors, emphasis } = latest.current;
    const slices = presence.cells.length;
    const d = dataRef.current;
    const net = netRef.current;
    const { fg, halo } = themeRef.current;
    const [x0, y0, x1, y1] = s.plate.box!;
    const ink = (a: number): [number, number, number, number] => [fg[0], fg[1], fg[2], a];
    const at = focus(), atK = Math.round(at), lo = Math.round(s.front);
    const zf = -at * s.depth;
    const c = CORNER / 2 ** s.zoom;
    // Whichever edge the screen shows on top carries the name.
    const vp = viewport();
    const top = vp && vp.project([x0, y0, zf])[1] < vp.project([x0, y1, zf])[1] ? y0 : y1;
    const corners: Array<[number, number]> = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const marks = (z: number) => corners.flatMap(([x, y]) => [
      { from: [x, y, z], to: [x + (x === x0 ? c : -c), y, z] },
      { from: [x, y, z], to: [x, y + (y === y0 ? c : -c), z] },
    ]);
    const ring = (z: number) => corners.map(([x, y], k) => {
      const [nx, ny] = corners[(k + 1) % 4];
      return { from: [x, y, z], to: [nx, ny, z] };
    });
    const line = (id: string, data: any[], color: [number, number, number, number], width: number) => new M.LineLayer({
      id, data, getSourcePosition: (e: any) => e.from, getTargetPosition: (e: any) => e.to,
      getColor: color, getWidth: width, widthUnits: 'pixels',
      parameters: { depthWriteEnabled: false },
    });
    const pages: any[] = [];
    for (let k = lo; k <= lo + s.width; k++) if (k !== atK) pages.push(...ring(-k * s.depth));
    const out: any[] = [
      new M.SolidPolygonLayer({
        id: 'slicer-face',
        data: [[[x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf]]],
        getPolygon: (e: any) => e,
        getFillColor: ink(8),
        _full3d: true,
        parameters: { depthWriteEnabled: false },
      }),
      line('slicer-pages', pages, ink(30), 1),
      line('slicer-edge', ring(zf), ink(64), 1),
      line('slicer-corners', marks(zf), ink(190), 1.5),
    ];
    // Streams from earlier, where they pierce the cut.
    const key = `${at.toFixed(3)}:${s.posVersion}`;
    if (s.cross.key !== key || s.cross.data !== d) {
      s.cross = { key, data: d, at: deckCrossings(net, d, pos, at) };
    }
    const through = s.cross.at;
    if (through.length) {
      out.push(new M.ScatterplotLayer({
        id: 'slicer-cross',
        data: { length: through.length / 3 },
        radiusUnits: 'pixels',
        getPosition: (_: unknown, { index }: { index: number }) => [through[3 * index], through[3 * index + 1], zf],
        getRadius: 1.6,
        getFillColor: (_: unknown, { index }: { index: number }) => {
          const j = through[3 * index + 2];
          const a = net.source[j], b = net.target[j];
          const from = d.span[2 * j] <= d.span[2 * j + 1] ? a : b;
          const dim = emphasis && !emphasis[a] && !emphasis[b] ? 0.15 : 1;
          return [colors[4 * from] * 255, colors[4 * from + 1] * 255, colors[4 * from + 2] * 255, 220 * dim];
        },
        updateTriggers: { getPosition: [key], getFillColor: [key, colors, emphasis] },
        parameters: { depthWriteEnabled: false },
      }));
    }
    if (slicer) {
      out.push(new M.TextLayer({
        id: 'slicer-label',
        data: [
          { text: slicer.label(atK), at: [x0, top, zf], anchor: 'start', weight: 600 },
          {
            text: s.width > 0 ? `${atK - lo + 1} of ${s.width + 1} · ${atK + 1} / ${slices}` : `${atK + 1} / ${slices}`,
            at: [x1, top, zf], anchor: 'end', weight: 500,
          },
        ],
        pickable: true,
        characterSet: 'auto',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
        outlineWidth: 3,
        outlineColor: [halo[0], halo[1], halo[2], 230],
        sizeUnits: 'pixels',
        getSize: 10.5,
        getText: (e: any) => e.text,
        getPosition: (e: any) => e.at,
        getTextAnchor: (e: any) => e.anchor,
        getAlignmentBaseline: 'bottom',
        getPixelOffset: [0, -6],
        getColor: (e: any) => ink(e.weight === 600 ? 220 : 130),
        updateTriggers: { getText: [slicer.label, atK, lo, s.width, slices] },
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
      // The cut stays inside the window; without a slicer it rests at the front.
      s.cutGoal = Math.min(s.cutGoal, s.width);
      const cutGoal = latest.current.slicer ? s.cutGoal : 0;
      const cutGap = cutGoal - s.cut;
      s.cut = Math.abs(cutGap) < 0.002 ? cutGoal : s.cut + cutGap * 0.16;
      s.depth = depthOf();
      d.setProps({ views: viewOf(mods.current!), viewState: viewState(), layers: layers() });
      s.listeners.forEach((fn) => fn());
      if (s.front !== goal || s.cut !== cutGoal) draw();
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
        SolidPolygonLayer: lay.SolidPolygonLayer,
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
        getCursor: ({ isHovering }: { isHovering: boolean }) => (
          s.viewpointKey ? 'crosshair' : isHovering ? 'pointer' : 'grab'),
        onClick: (info: any, event: any) => {
          if (s.viewpointGesture) { s.viewpointGesture = false; return; }
          const src: MouseEvent = event?.srcEvent ?? event;
          if (info?.layer?.id === 'slicer-label') {
            latest.current.onCut?.(Math.round(focus()));
          } else if (info?.layer?.id?.startsWith('n-') && info.index >= 0) {
            // A pile — nodes drawn over one another — is asked about, not guessed.
            const under: any[] = src?.shiftKey ? [] : deck.current?.pickMultipleObjects({ x: info.x, y: info.y, radius: 2, depth: 40 }) ?? [];
            const nodes = [...new Set(under.filter((h) => h?.layer?.id?.startsWith('n-')).map((h) => h.object as number))];
            if (nodes.length > 1 && latest.current.onStack) latest.current.onStack(nodes, src);
            else latest.current.onPick(info.object as number, src);
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
          const [sx, sy] = vp.project([x, y, -focus() * s.depth]);
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
  // The cut turned on: the plate, framed in the open canvas — once; the
  // camera is the reader's after that.
  const slicing = !!props.slicer;
  const wasSlicing = useRef(slicing);
  useEffect(() => {
    if (slicing && !wasSlicing.current && s.positions) frame();
    wasSlicing.current = slicing;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slicing]);
  // A settled vanishing point has reached the props: theirs again.
  useEffect(() => { s.vanishLive = null; draw(); }, // eslint-disable-line react-hooks/exhaustive-deps
            [props.vanish?.[0], props.vanish?.[1]]);

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
      // ⇧ (or ⌥): the cut moves through the window, the window stays.
      if ((e.shiftKey || e.altKey) && latest.current.slicer && s.width > 0) {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        s.cutWheel += e.deltaMode === 1 ? d * 30 : d;
        while (Math.abs(s.cutWheel) >= NOTCH) {
          const step = Math.sign(s.cutWheel);
          s.cutWheel -= step * NOTCH;
          s.cutGoal = Math.max(0, Math.min(s.width, s.cutGoal + step));
        }
        draw();
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
    let viewpoint = false;
    /** The vanishing point under the pointer, as a share of the view. */
    const vanishAt = (e: PointerEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      const clamp = (v: number) => Math.round(Math.max(-VANISH_REACH, Math.min(VANISH_REACH, v)) * 100) / 100;
      return [clamp((e.clientX - r.left) / r.width - 0.5), clamp((e.clientY - r.top) / r.height - 0.5)];
    };
    const showMarker = (v: [number, number] | null) => {
      const m = marker.current;
      if (!m) return;
      m.style.display = v ? '' : 'none';
      if (v) { m.style.left = `${(0.5 + v[0]) * 100}%`; m.style.top = `${(0.5 + v[1]) * 100}%`; }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey) {
        viewpoint = true;
        s.viewpointGesture = true;
        s.vanishLive = vanishAt(e);
        showMarker(s.vanishLive);
        draw();
        return;
      }
      drag = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (viewpoint) {
        s.vanishLive = vanishAt(e);
        showMarker(s.vanishLive);
        draw();
        return;
      }
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
    const onUp = () => {
      drag = null;
      if (!viewpoint) return;
      viewpoint = false;
      showMarker(null);
      if (s.vanishLive) latest.current.onVanish?.(s.vanishLive);
      // A click comes after the release, or none does.
      setTimeout(() => { s.viewpointGesture = false; }, 0);
    };
    // ⌘ held: the pointer says it sets the viewpoint.
    const onKey = (e: KeyboardEvent) => {
      const on = e.metaKey || e.ctrlKey;
      if (on === s.viewpointKey) return;
      s.viewpointKey = on;
      if (canvas.current) canvas.current.style.cursor = on ? 'crosshair' : 'grab';
    };
    // ⌘-tab away and back: the key went up somewhere else.
    const onBlur = () => { s.viewpointKey = false; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
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
      {/* Where the depth converges, while a ⌘-drag moves it. */}
      <span ref={marker} aria-hidden style={{ display: 'none' }}
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-hud-fg bg-background/60 shadow-sm" />
    </div>
  );
}
