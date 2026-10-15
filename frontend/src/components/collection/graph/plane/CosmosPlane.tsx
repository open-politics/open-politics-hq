'use client';

/**
 * CosmosPlane — a Network laid out and drawn on the GPU (cosmos.gl).
 *
 * The plane owns exactly one thing: the cosmos `Graph` — its lifecycle, its
 * buffers, its camera. Everything it draws arrives as props already computed
 * (`channels.ts`), so what a node *looks like* is decided by the panel and
 * what it *is* by the Network; the plane only pushes buffers when their
 * identity changes.
 *
 * **Layers ride on top.** Children render inside the plane's box and read it
 * through `usePlane()`: the camera (`spaceToScreen`), the live positions, and a
 * `subscribe` that fires once per animation frame in which anything moved —
 * a simulation tick, a zoom, a drag, a transition. Labels are the first such
 * layer; a deck.gl overlay, a lasso, a minimap are the same contract.
 *
 * Transparent by construction: cosmos clears to alpha and paints its own
 * background on the div, which is left unset — so the plane can sit over a map
 * as well as on a panel.
 */
import React, {
  createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef,
} from 'react';
import { Graph, type GraphConfig } from '@cosmos.gl/graph';
import { cn } from '@/lib/utils';
import type { Network } from './network';
import { positionsById, seedPositions } from './channels';

// ─── The contract layers read ───────────────────────────────────────────────

export interface PlaneView {
  /** The cosmos instance, for a layer that needs more than this view. Null
   *  until mounted. */
  readonly graph: Graph | null;
  readonly network: Network;
  /** Space → CSS pixels within the plane's box. */
  spaceToScreen(p: [number, number]): [number, number];
  /** Called once per frame in which anything on the plane moved. */
  subscribe(listener: () => void): () => void;
}

const PlaneContext = createContext<PlaneView | null>(null);

export function usePlane(): PlaneView {
  const view = useContext(PlaneContext);
  if (!view) throw new Error('usePlane() outside a <CosmosPlane>');
  return view;
}

export interface PlaneHandle {
  readonly view: PlaneView;
  fit(duration?: number): void;
  /** Centre on a node and zoom in to it. */
  focus(index: number, duration?: number): void;
  /** Fit the given nodes into view. */
  frame(indices: number[], duration?: number): void;
  zoomBy(factor: number, duration?: number): void;
  /** Live positions, `[x0, y0, x1, y1, …]` in space units. */
  positions(): ArrayLike<number>;
  /** Re-heat the layout. */
  reheat(alpha?: number): void;
  pause(): void;
  resume(): void;
  readonly running: boolean;
}

export interface PlaneBuffers {
  colors: Float32Array;
  sizes: Float32Array;
  linkColors: Float32Array;
  linkWidths: Float32Array;
  linkArrows: boolean[];
  linkStrength: Float32Array;
}

export interface CosmosPlaneProps {
  network: Network;
  /** Where nodes were last seen, by id — what a freshly mounted plane starts
   *  from. Once mounted, a replacing network starts from the live layout of
   *  the one it replaces instead. Read only when `network` changes. */
  layout?: ReadonlyMap<string, [number, number]>;
  buffers: PlaneBuffers;
  /** 1 = present. Absent nodes leave the layout and fade out in place. */
  visible?: Uint8Array | null;
  /** Everything not listed greys out. Null clears. */
  highlight?: { points: number[]; links: number[] } | null;
  focused?: number | null;
  /** Theme-dependent knobs (rings, greyout). Merged over the plane's defaults. */
  config?: GraphConfig;
  onPointClick?: (index: number) => void;
  onBackgroundClick?: () => void;
  onHover?: (index: number | null) => void;
  /** A network is leaving the plane — replaced, or the plane unmounting —
   *  and this is where its nodes ended up. What a reopened graph seeds from. */
  onLayout?: (network: Network, positions: ArrayLike<number>) => void;
  /** The layout started or came to rest. */
  onRunning?: (running: boolean) => void;
  className?: string;
  children?: React.ReactNode;
}

export const SPACE_SIZE = 4096;

/** The plane's own defaults — tuned for the large, sparse graphs runs produce. */
const BASE: GraphConfig = {
  backgroundColor: [0, 0, 0, 0],
  spaceSize: SPACE_SIZE,
  attribution: '',
  fitViewOnInit: false,
  rescalePositions: false,
  enableDrag: true,
  scalePointsOnZoom: true,
  scaleLinksOnZoom: false,
  curvedLinks: false,
  linkDefaultArrows: false,
  linkArrowsSizeScale: 0.75,
  linkVisibilityDistanceRange: [60, 260],
  linkVisibilityMinTransparency: 0.2,
  pointGreyoutOpacity: 0.12,
  linkGreyoutOpacity: 0.04,
  renderHoveredPointRing: true,
  hoveredPointCursor: 'pointer',
  simulationGravity: 0.2,
  simulationRepulsion: 0.8,
  simulationLinkSpring: 0.6,
  simulationLinkDistance: 6,
  simulationFriction: 0.86,
  simulationDecay: 4000,
  transitionDuration: 400,
};

export const CosmosPlane = forwardRef<PlaneHandle, CosmosPlaneProps>(function CosmosPlane(
  {
    network, layout, buffers, visible, highlight, focused, config,
    onPointClick, onBackgroundClick, onHover, onLayout, onRunning, className, children,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const listeners = useRef(new Set<() => void>());
  const frameQueued = useRef(false);
  const running = useRef(false);

  // Handlers change every render; cosmos keeps the ones it was built with.
  const handlers = useRef({ onPointClick, onBackgroundClick, onHover, onLayout, onRunning });
  handlers.current = { onPointClick, onBackgroundClick, onHover, onLayout, onRunning };
  const setRunning = (r: boolean) => {
    running.current = r;
    handlers.current.onRunning?.(r);
  };

  const networkRef = useRef(network);
  /** Where every node of the current network is — absent ones where they were
   *  when they left, so hiding a type never costs its nodes their place. */
  const stash = useRef<Float32Array | null>(null);
  const currentLayout = (graph: Graph): number[] => {
    const live = graph.getPointPositions();
    const kept = stash.current;
    if (kept) for (let k = 0; k < live.length; k++) if (!Number.isFinite(live[k])) live[k] = kept[k];
    return live;
  };
  /** Hand the current network's layout to whoever remembers it. */
  const retire = () => {
    const graph = graphRef.current;
    if (graph && networkRef.current.size > 0) {
      handlers.current.onLayout?.(networkRef.current, currentLayout(graph));
    }
  };

  /** Fan one notification per frame out to the layers, however many cosmos
   *  callbacks fired in it. */
  const moved = useRef(() => {
    if (frameQueued.current) return;
    frameQueued.current = true;
    requestAnimationFrame(() => {
      frameQueued.current = false;
      listeners.current.forEach((fn) => fn());
    });
  }).current;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const div = host.current;
    if (!div) return;
    const graph = new Graph(div, {
      ...BASE,
      ...config,
      onPointClick: (i) => handlers.current.onPointClick?.(i),
      onBackgroundClick: () => handlers.current.onBackgroundClick?.(),
      onPointMouseOver: (i) => handlers.current.onHover?.(i),
      onPointMouseOut: () => handlers.current.onHover?.(null),
      onSimulationStart: () => setRunning(true),
      onSimulationEnd: () => { setRunning(false); moved(); },
      onSimulationPause: () => setRunning(false),
      onSimulationUnpause: () => setRunning(true),
      onSimulationTick: moved,
      onZoom: moved,
      onDrag: moved,
      onTransition: moved,
      onTransitionEnd: moved,
    });
    graphRef.current = graph;
    return () => {
      // Before the network effect's own cleanup, which runs after this one on
      // unmount and would find the instance gone.
      retire();
      graphRef.current = null;
      graph.destroy();
    };
    // The instance lives as long as the plane; config changes go through
    // setConfigPartial below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data: a new network replaces everything ───────────────────────────────
  // What the instance holds, so the channel and visibility effects below — which
  // also fire in the commit that brought a new network — skip work the data
  // effect already did (and do not re-heat a layout it has just started).
  const appliedBuffers = useRef<PlaneBuffers | null>(null);
  const appliedVisible = useRef<Uint8Array | null | undefined>(undefined);
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    // Start from where the outgoing network's nodes are now — a live run
    // replacing its graph keeps its shape — or, on a fresh plane, from what
    // the caller remembers.
    const outgoing = networkRef.current;
    const previous = outgoing !== network && outgoing.size > 0
      ? positionsById(outgoing, currentLayout(graph))
      : layout;
    networkRef.current = network;
    const seed = seedPositions(network, SPACE_SIZE, previous);
    // The more of the layout is already known, the cooler it starts.
    let known = 0;
    if (previous) for (const id of network.id) if (previous.has(id)) known++;
    const share = network.size ? known / network.size : 0;
    const heat = share > 0.8 ? 0.08 : share > 0.3 ? 0.35 : 1;
    const links = new Float32Array(network.links * 2);
    for (let j = 0; j < network.links; j++) {
      links[2 * j] = network.source[j];
      links[2 * j + 1] = network.target[j];
    }
    stash.current = new Float32Array(seed);
    graph.setPointPositions(applyVisibility(stash.current, visible ?? null), true);
    graph.setLinks(links);
    pushBuffers(graph, buffers);
    appliedBuffers.current = buffers;
    appliedVisible.current = visible;
    graph.render(undefined, 0);
    graph.start(heat);
    let fit: ReturnType<typeof setTimeout> | undefined;
    if (heat >= 0.5) fit = setTimeout(() => graph.fitView(700, 0.12), 900);
    moved();
    return () => {
      if (fit) clearTimeout(fit);
      retire();
    };
    // Buffers and visibility follow in their own effects; this one runs only
    // when the graph itself is new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  // ── Channels: repaint without touching the layout ─────────────────────────
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || appliedBuffers.current === buffers) return;
    pushBuffers(graph, buffers);
    appliedBuffers.current = buffers;
    graph.render();
  }, [buffers]);

  // ── Visibility: absent nodes leave the layout ─────────────────────────────
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !stash.current || appliedVisible.current === visible) return;
    appliedVisible.current = visible;
    const live = graph.getPointPositions();
    // Remember where the present nodes are now, so a node brought back
    // returns to where it left rather than to where it started.
    for (let k = 0; k < live.length; k++) if (Number.isFinite(live[k])) stash.current[k] = live[k];
    graph.setPointPositions(applyVisibility(stash.current, visible ?? null), true);
    // Snapped: a position transition pauses the simulation until it ends, and
    // the neighbours of what left should settle into the gap at once.
    graph.render(undefined, 0);
    graph.start(0.15);
  }, [visible]);

  // ── Highlight, focus, theme ───────────────────────────────────────────────
  useEffect(() => {
    graphRef.current?.setConfigPartial({
      highlightedPointIndices: highlight?.points,
      highlightedLinkIndices: highlight?.links,
      focusedPointIndex: focused ?? undefined,
    });
  }, [highlight, focused]);

  useEffect(() => {
    if (config) graphRef.current?.setConfigPartial(config);
  }, [config]);

  // ── What layers and the panel read ────────────────────────────────────────
  const view = useMemo<PlaneView>(() => ({
    get graph() { return graphRef.current; },
    network,
    spaceToScreen: (p) => graphRef.current?.spaceToScreenPosition(p) ?? [NaN, NaN],
    subscribe: (fn) => {
      listeners.current.add(fn);
      return () => { listeners.current.delete(fn); };
    },
  }), [network]);

  useImperativeHandle(ref, () => ({
    view,
    fit: (d = 500) => graphRef.current?.fitView(d, 0.12),
    focus: (i, d = 600) => graphRef.current?.zoomToPointByIndex(i, d, 4, false),
    frame: (indices, d = 600) => {
      if (indices.length) graphRef.current?.fitViewByPointIndices(indices, d, 0.25);
    },
    zoomBy: (f, d = 250) => {
      const g = graphRef.current;
      if (g) g.setZoomLevel(g.getZoomLevel() * f, d);
    },
    positions: () => graphRef.current?.getPointPositions() ?? [],
    reheat: (alpha = 0.6) => graphRef.current?.start(alpha),
    pause: () => graphRef.current?.pause(),
    resume: () => graphRef.current?.unpause(),
    get running() { return running.current; },
  }), [view]);

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* cosmos sizes its canvas to this box; an absolute fill keeps it from
          inheriting a collapsed height from a flex parent. */}
      <div ref={host} className="absolute inset-0" />
      <PlaneContext.Provider value={view}>
        <div className="pointer-events-none absolute inset-0">{children}</div>
      </PlaneContext.Provider>
    </div>
  );
});

function pushBuffers(graph: Graph, b: PlaneBuffers) {
  graph.setPointColors(b.colors);
  graph.setPointSizes(b.sizes);
  graph.setLinkColors(b.linkColors);
  graph.setLinkWidths(b.linkWidths);
  graph.setLinkArrows(b.linkArrows);
  graph.setLinkStrength(b.linkStrength);
}

/** Positions with absent nodes set to NaN — cosmos's own "not here". */
function applyVisibility(positions: Float32Array, visible: Uint8Array | null): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < out.length / 2; i++) {
    const shown = !visible || visible[i] === 1;
    out[2 * i] = shown ? positions[2 * i] : NaN;
    out[2 * i + 1] = shown ? positions[2 * i + 1] : NaN;
  }
  return out;
}
