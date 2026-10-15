'use client';

/**
 * NetworkPanel — a run's whole graph, laid out and drawn on the GPU.
 *
 * The knowledge-graph panel's graph (same engine, same query language) for
 * runs too large for a canvas renderer. Three core views, one primitive
 * (`plane/arrange.ts`):
 *
 *   Groups (default)  communities of the graph, collapsed into named groups —
 *                     what it is about, in its own entities — opened by
 *                     double-click or from the list, one level at a time
 *   Time              left to right by when; brush or play a window and its
 *                     names stream across the plane
 *   Geo               each node at its place, on the overview's map, which
 *                     follows the plane's camera
 *
 *   top-left      query · Time · Geo · find, then the lists: groups, places,
 *                 the window, entities — each opens like the overview's
 *   top-right     of how many — or the documents behind what is selected
 *   bottom-left   types, occurrences, the unconnected
 *   bottom        the time strip, in the time view
 *   bottom-right  camera and layout
 *
 * Whatever is selected — a node, a group, a place, a window — opens the same
 * drill column the overview opens: the documents behind it, then one of them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Activity, Boxes, CircleDot, Clock, Contrast, Eye, EyeOff, Flame, MapPin, Maximize2, Minimize2, Minus,
  Pause, Play, Plus, Scan, Search, Spline, Unlink,
} from 'lucide-react';
import type { GraphConfig } from '@cosmos.gl/graph';
import { NetworkService, type AnnotationSchemaRead } from '@/client';
import { cn } from '@/lib/utils';
import {
  HUD_INPUT, HUD_LABEL, HUD_NUM, HUD_PROSE, HUD_SURFACE, HudButton, HudGroup, HudLiveDot,
  HudOption, HudSegmented, HudStat,
} from '@/components/ui/chrome';
import { resolveEntityColor } from '@/lib/annotations/colors';
import { resolveVarToRgba, useThemeVersion } from '@/lib/theme/cssColor';
import type { NetworkView, NetworkVizConfig, PanelConfig } from '@/lib/annotations/types';
import type { TimeWindow } from '@/lib/overview/derive';
import { useSurfaceCommands } from '@/hooks/useSurfaceCommands';
import { useNetwork } from '@/hooks/useNetwork';
import { useAssetPages } from '@/hooks/useAssetPages';
import { useResolution } from '@/hooks/useResolution';
import {
  CosmosPlane, GROUP_HUES, PlaneLabels, PlaneLink, PlaneMap, RUNG_PRESETS, SPACE_SIZE, annotationsOf, byGroups,
  byPlace, byTime, cellOf, collapse, degree, expandedKeys, expansionOf, findNodes, groupPath, headsOf,
  groupsAt, groupColors, identity, inheritFrom, keyIndex, linkArrows, linkColors, linkStrength, linkWidths, merge,
  nodeKey,
  linksOf, louvain, membersOf, neighbours, nodeTimes, pointColors, pointSizes, positionsById,
  publishedAt, topLevel, topRanks, typeCounts, visibility,
  type Expansion, type Grain, type Network, type Palette, type PlaneHandle, type PlacePreset,
  type Rgba,
} from '@/components/collection/graph/plane';
import { DRILL_W, DrillColumn } from '../drill/DrillColumn';
import type { DrillSubject } from '../drill/AssetListCard';
import { RankCard, type RankItem } from '../overview/RankCard';
import { TimeStrip } from '../overview/TimeStrip';
import { DEFAULT_GEO, DEFAULT_TIME, GeoButton, TimeButton } from './ViewButtons';
import { ResolverHistory, ResolverTicker } from './Resolver';

const DEFAULT_CONFIG: NetworkVizConfig = {
  kind: 'network', q: null, max_nodes: null, hidden_types: [], view: { occurrences: true },
};

const BUDGETS: Array<{ value: string; label: string; title: string }> = [
  { value: 'all', label: 'All', title: 'Every node the query returns' },
  { value: '20000', label: '20k', title: 'The 20,000 most frequent nodes' },
  { value: '5000', label: '5k', title: 'The 5,000 most frequent nodes' },
];

/** A group is at least this many nodes; fewer are drawn as themselves. */
const MIN_GROUP = 3;
/** Names around a selection — beyond these, the highlight says it. */
const NAMED = 28;
/** Rows in each list. */
const LISTED = 60;
/** One step of a playing window. */
const STEP_MS = 900;
/** Two clicks on one group within this open it. */
const DOUBLE_CLICK_MS = 350;

/** Where each panel's nodes last were, by id, for a remount. */
const LAYOUTS = new Map<string, Map<string, [number, number]>>();

type Core = NonNullable<NetworkView['core']>;
type Selection = { kind: 'node'; id: string } | { kind: 'place'; coord: number } | null;

const toUnit = ([r, g, b, a]: [number, number, number, number]): Rgba => [r / 255, g / 255, b / 255, a / 255];
const byFrequency = (net: Network) => (a: number, b: number) => net.frequency[b] - net.frequency[a];

function useTheme() {
  const version = useThemeVersion();
  return useMemo(() => {
    const fg = toUnit(resolveVarToRgba('--hud-fg', [40, 40, 40, 255]));
    const palette: Palette = {
      edge: toUnit(resolveVarToRgba('--graph-edge-stroke', [153, 153, 153, 255])),
      occurrence: toUnit(resolveVarToRgba('--hud-dim', [120, 120, 120, 200])),
    };
    const config: GraphConfig = { hoveredPointRingColor: fg, focusedPointRingColor: fg, outlinedPointRingColor: fg };
    return { palette, config };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}

export function NetworkPanel({
  panel, infospaceId, runId, schemas, onUpdatePanel,
}: {
  panel: PanelConfig;
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  onUpdatePanel: (updates: Partial<PanelConfig>) => void;
}) {
  const config: NetworkVizConfig = {
    ...DEFAULT_CONFIG,
    ...((panel.panel_config as NetworkVizConfig | undefined) ?? {}),
  };
  const setConfig = useCallback((patch: Partial<NetworkVizConfig>) => {
    onUpdatePanel({ panel_config: { ...config, ...patch } as any });
  }, [config, onUpdatePanel]);
  const setView = (patch: Partial<NetworkView>) => setConfig({ view: { ...config.view, ...patch } });

  const stream = useNetwork({
    infospaceId, runId, q: config.q, maxNodes: config.max_nodes, mergeMaps: panel.merge_maps as any,
  });
  // The resolver's merges, folded into the network as they land — everything
  // below (groups, views, lists, search) reads the merged network.
  const resolution = useResolution({ infospaceId, runId });
  const raw = stream.network;
  const merged = useMemo(() => (raw ? merge(raw, resolution.effect) : null), [raw, resolution.effect]);
  const base = merged?.net ?? null;
  const rawIndex = useMemo(() => (raw ? keyIndex(raw) : null), [raw]);
  const plane = useRef<PlaneHandle>(null);
  const { palette, config: planeConfig } = useTheme();

  const core: Core = config.view?.core ?? 'groups';
  const timeChoice = config.view?.time ?? DEFAULT_TIME;
  const geoChoice = config.view?.geo ?? DEFAULT_GEO;

  // ── Groups ────────────────────────────────────────────────────────────────
  const communities = useMemo(() => (base ? louvain(base) : null), [base]);
  const ranks = useMemo(
    () => (base && communities ? topRanks(base, communities, MIN_GROUP) : null), [base, communities]);
  const groups = useMemo(
    () => (base && communities ? groupsAt(base, communities, topLevel(communities), MIN_GROUP) : []),
    [base, communities]);
  // What is open, by head and depth — it survives the re-clustering a live
  // run does on every refresh (`collapse.Expansion`).
  const [expansions, setExpansions] = useState<Expansion[]>([]);
  const expanded = useMemo(
    () => (base && communities ? expandedKeys(base, communities, expansions, MIN_GROUP) : new Set<string>()),
    [base, communities, expansions]);
  const heads = useMemo(
    () => (base && communities ? headsOf(base, communities, MIN_GROUP) : null), [base, communities]);

  // ── What the plane draws ──────────────────────────────────────────────────
  const view = useMemo(() => {
    if (!base) return null;
    return core === 'groups' && communities && heads
      ? collapse(base, communities, expanded, { minGroup: MIN_GROUP, heads })
      : identity(base);
  }, [base, communities, heads, expanded, core]);
  const net = view?.net ?? null;
  const rankOf = useCallback(
    (u: number) => (view && ranks ? ranks[view.memberIds[view.memberOffsets[u]]] : -1), [view, ranks]);
  // Whatever appears starts where its group was — opening a group, folding
  // one, or leaving the groups view for time or the map.
  const inherit = useMemo(
    () => (view && communities && heads ? inheritFrom(view, communities, heads, MIN_GROUP) : undefined),
    [view, communities, heads]);

  const timeline = useMemo(() => {
    if (!net || core !== 'time') return null;
    const times = nodeTimes(net, timeChoice.source, (i) => publishedAt(net, i));
    const grain = timeChoice.grain === 'auto' ? undefined : (timeChoice.grain as Grain);
    return byTime(net, times, SPACE_SIZE, grain, `time:${timeChoice.source}`);
  }, [net, core, timeChoice.source, timeChoice.grain]);

  const geography = useMemo(() => (
    net && core === 'geo'
      ? byPlace(net, geoChoice.preset as PlacePreset, SPACE_SIZE, { keepNeighbours: geoChoice.neighbours })
      : null
  ), [net, core, geoChoice.preset, geoChoice.neighbours]);

  const arrangement = useMemo(() => {
    if (!net) return null;
    if (timeline) return timeline.arrangement;
    if (geography) return geography.arrangement;
    return byGroups(net, rankOf);
  }, [net, timeline, geography, rankOf]);

  // Over the map, the network can bury what it sits on. Quiet: what has no
  // place of its own all but fades, links recede, and the map firms up.
  const quiet = core === 'geo' && (config.view?.quiet ?? true);
  const buffers = useMemo(() => {
    if (!net) return null;
    const colors = core === 'groups' ? groupColors(net, rankOf, palette) : pointColors(net, palette);
    const links = linkColors(net, palette);
    if (quiet && geography) {
      for (let i = 0; i < net.size; i++) if (geography.coord[i] < 0) colors[4 * i + 3] *= 0.15;
      for (let j = 0; j < net.links; j++) links[4 * j + 3] *= 0.3;
    }
    return {
      colors,
      sizes: pointSizes(net),
      linkColors: links,
      linkWidths: linkWidths(net),
      linkArrows: linkArrows(net),
      linkStrength: linkStrength(net),
    };
  }, [net, palette, core, rankOf, quiet, geography]);
  const planeLook = useMemo(() => ({
    ...planeConfig,
    pointGreyoutOpacity: quiet ? 0.03 : 0.12,
    linkGreyoutOpacity: quiet ? 0.005 : 0.04,
  }), [planeConfig, quiet]);

  const onLayout = useCallback((n: Network, positions: ArrayLike<number>) => {
    LAYOUTS.set(panel.id, positionsById(n, positions));
  }, [panel.id]);

  const hidden = useMemo(() => new Set(config.hidden_types ?? []), [config.hidden_types]);
  const showOccurrences = config.view?.occurrences !== false;
  // The unconnected are noise among groups and the point on a map or a
  // timeline, so the default follows the view until the reader says.
  const showIsolated = config.view?.isolated ?? core !== 'groups';
  const visible = useMemo(() => {
    if (!net) return null;
    const v = visibility(net, hidden);
    const include = arrangement?.include;
    for (let i = 0; i < net.size; i++) {
      if (!showOccurrences && net.kind[i] === 1) v[i] = 0;
      if (!showIsolated && net.members[i] === 1 && degree(net, i) === 0) v[i] = 0;
      if (include && !include[i]) v[i] = 0;
    }
    return v;
  }, [net, hidden, showOccurrences, showIsolated, arrangement]);

  // ── Selection: a node or group, a place — and, in time, a window ──────────
  const [selection, setSelectionState] = useState<Selection>(null);
  const [openAsset, setOpenAsset] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [win, setWin] = useState<TimeWindow>(null);
  const [playing, setPlaying] = useState(false);
  const select = useCallback((s: Selection) => {
    setSelectionState(s);
    setOpenAsset(null);
  }, []);

  const focused = net && selection?.kind === 'node' ? net.index.get(selection.id) ?? null : null;
  const place = geography && selection?.kind === 'place'
    ? geography.places.find((p) => p.coord === selection.coord) ?? null : null;
  const windowNodes = useMemo(() => {
    if (!net || !timeline || !win) return null;
    const lo = cellOf(win[0], timeline.grain);
    const out: number[] = [];
    for (let i = 0; i < net.size; i++) {
      const c = timeline.cell[i];
      if (c >= lo && c <= win[1] && (!visible || visible[i])) out.push(i);
    }
    return out.sort(byFrequency(net));
  }, [net, timeline, win, visible]);

  /** What the drill column and the highlight are about, in that order of say. */
  const subject = useMemo(() => {
    if (!net) return null;
    if (focused != null) {
      const near = neighbours(net, focused);
      return {
        key: `node:${net.id[focused]}`,
        nodes: [focused],
        highlight: { points: [focused, ...near], links: linksOf(net, [focused]) },
        named: [focused, ...near.sort(byFrequency(net)).slice(0, NAMED)],
      };
    }
    const set = place?.nodes ?? windowNodes;
    if (!set) return null;
    const inSet = new Set(set);
    const links: number[] = [];
    for (let j = 0; j < net.links; j++) if (inSet.has(net.source[j]) && inSet.has(net.target[j])) links.push(j);
    return {
      key: place ? `place:${place.coord}` : `window:${win![0]}:${win![1]}`,
      nodes: set,
      highlight: { points: set, links },
      named: [...set].sort(byFrequency(net)).slice(0, NAMED),
    };
  }, [net, focused, place, windowNodes, win]);


  // ── The resolver's pair, on the network ───────────────────────────────────
  // Ringed, named and linked while it is judged and for a moment after; a
  // merge then folds the two into one node, and the link has nothing to join.
  const [stage, setStage] = useState(resolution.current);
  useEffect(() => {
    setStage(resolution.current);
    if (resolution.current?.phase !== 'decided') return;
    const t = setTimeout(() => setStage(null), 2200);
    return () => clearTimeout(t);
  }, [resolution.current]);
  /** The drawn node a resolver label sits in now — through merges and groups. */
  const drawnAt = useCallback((side: { name: string; type: string }) => {
    const r = rawIndex?.get(nodeKey(side.name, side.type));
    if (r === undefined || !merged || !view) return null;
    return view.unitOf[merged.unitOf[r]];
  }, [rawIndex, merged, view]);
  const stageUnits = useMemo(() => {
    if (!stage) return null;
    const a = drawnAt(stage.decision.a), b = drawnAt(stage.decision.b);
    return a == null || b == null ? null : { a, b };
  }, [stage, drawnAt]);
  const focusPair = useCallback((d: { a: { name: string; type: string }; b: { name: string; type: string } }) => {
    const a = drawnAt(d.a), b = drawnAt(d.b);
    if (a == null || !net) return;
    select({ kind: 'node', id: net.id[a] });
    plane.current?.frame(b == null || b === a ? [a] : [a, b]);
  }, [drawnAt, net, select]);

  const pinned = useMemo(() => {
    const named = [...(subject?.named ?? [])];
    for (const i of [hover, stageUnits?.a, stageUnits?.b]) if (i != null && !named.includes(i)) named.push(i);
    return named;
  }, [subject, hover, stageUnits]);

  // ── The documents behind it ───────────────────────────────────────────────
  const annotations = useMemo(
    () => (net && subject ? annotationsOf(net, subject.nodes) : null), [net, subject]);
  const pages = useAssetPages(
    annotations && subject ? `network:${infospaceId}:${runId}:${stream.shownKey}:${core}:${subject.key}` : null,
    (offset, limit) => NetworkService.networkAssets({
      infospaceId, runId, requestBody: { annotations: annotations!, offset, limit },
    }),
  );

  // ── Opening and folding groups ────────────────────────────────────────────
  const expand = useCallback((key: string) => {
    if (!view || !communities) return;
    const e = expansionOf(view, communities, key, MIN_GROUP);
    if (e) setExpansions((xs) => [...xs, e]);
  }, [view, communities]);

  /** Fold the innermost open group around base node i. */
  const fold = useCallback((i: number) => {
    if (!base || !communities) return;
    const key = [...groupPath(communities, i, MIN_GROUP)].reverse().find((k) => expanded.has(k));
    if (!key) return;
    setExpansions((xs) => xs.filter((x) => {
      const at = base.index.get(x.head);
      return at === undefined || groupPath(communities, at, MIN_GROUP)[x.depth] !== key;
    }));
  }, [base, communities, expanded]);

  /** Every group above base node i opened, so the node itself is drawn. */
  const reveal = useCallback((i: number) => {
    if (!base || !communities || core !== 'groups') return;
    const path = groupPath(communities, i, MIN_GROUP);
    const add: Expansion[] = [];
    path.forEach((key, depth) => { if (!expanded.has(key)) add.push({ head: base.id[i], depth }); });
    if (add.length) setExpansions((xs) => [...xs, ...add]);
  }, [base, communities, core, expanded]);

  // Framing waits for what it frames to be drawn — a revealed node exists only
  // once the collapse it asked for has run.
  const [pendingFrame, setPendingFrame] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingFrame || !net) return;
    const i = net.index.get(pendingFrame);
    if (i === undefined) return;
    setPendingFrame(null);
    plane.current?.frame([i, ...neighbours(net, i)]);
  }, [pendingFrame, net]);

  /** Go to a node of the network underneath — opening its groups if needed. */
  const goToBase = useCallback((i: number) => {
    if (!base) return;
    reveal(i);
    select({ kind: 'node', id: base.id[i] });
    setPendingFrame(base.id[i]);
  }, [base, reveal, select]);

  const lastClick = useRef<{ i: number; at: number } | null>(null);
  const onPointClick = (i: number) => {
    if (!net || !view) return;
    const now = performance.now();
    const twice = lastClick.current?.i === i && now - lastClick.current.at < DOUBLE_CLICK_MS;
    lastClick.current = { i, at: now };
    const key = view.group[i];
    if (twice && key) { expand(key); return; }
    select(selection?.kind === 'node' && selection.id === net.id[i] ? null : { kind: 'node', id: net.id[i] });
  };

  // ── The query and finding ─────────────────────────────────────────────────
  const [draft, setDraft] = useState(config.q ?? '');
  useEffect(() => { setDraft(config.q ?? ''); }, [config.q]);
  const commit = () => {
    const q = draft.trim() || null;
    if (q !== (config.q ?? null)) setConfig({ q });
  };
  const [find, setFind] = useState('');
  const found = useMemo(() => (base ? findNodes(base, find) : []), [base, find]);

  useSurfaceCommands('graph', {
    query: (p) => setDraft(String(p?.q ?? '')),
    focus: (p) => {
      const name = String(p?.name ?? '').trim();
      const hit = base && name ? findNodes(base, name, 1)[0] : undefined;
      if (hit != null) goToBase(hit);
    },
    clearQuery: () => setConfig({ q: null }),
  });

  // ── Time: playing a window ────────────────────────────────────────────────
  const cells = useMemo(() => timeline?.bins.map((b) => b.t) ?? [], [timeline]);
  useEffect(() => {
    if (!playing || cells.length === 0 || !timeline) return;
    const id = setInterval(() => {
      setWin((w) => {
        // Keep the window's width in cells; step it one cell later.
        const from = w ? cells.findIndex((c) => c >= cellOf(w[0], timeline.grain)) : -1;
        const to = w ? cells.findIndex((c) => c > w[1]) : -1;
        const width = w && from >= 0 ? Math.max(1, (to < 0 ? cells.length : to) - from) : 1;
        const next = from + 1;
        if (next + width > cells.length) { setPlaying(false); return w; }
        return [cells[next], cells[next + width - 1]];
      });
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, cells, timeline]);
  useEffect(() => { if (core !== 'time') { setPlaying(false); setWin(null); } }, [core]);

  // ── Lists ─────────────────────────────────────────────────────────────────
  const entityItems = useMemo<RankItem[]>(() => {
    if (!base) return [];
    const out: number[] = [];
    for (let i = 0; i < base.size; i++) if (base.kind[i] === 0) out.push(i);
    return out.sort(byFrequency(base)).slice(0, LISTED).map((i) => ({
      id: base.id[i], name: base.name[i], count: base.frequency[i],
      hint: base.types[base.type[i]] || undefined,
    }));
  }, [base]);
  const groupItems = useMemo<RankItem[]>(() => groups.slice(0, LISTED).map((g, r) => ({
    id: g.key, name: g.label, count: g.size, swatch: GROUP_HUES[r % GROUP_HUES.length],
    hint: `${g.size.toLocaleString()} nodes${expanded.has(g.key) ? ' · open' : ''}`,
  })), [groups, expanded]);
  const placeItems = useMemo<RankItem[]>(() => (geography?.places ?? []).slice(0, LISTED).map((p) => ({
    id: String(p.coord), name: p.name, count: p.nodes.length,
  })), [geography]);
  const windowItems = useMemo<RankItem[]>(() => (net && windowNodes ? windowNodes.slice(0, LISTED).map((i) => ({
    id: net.id[i], name: net.name[i], count: net.frequency[i], hint: net.types[net.type[i]] || undefined,
  })) : []), [net, windowNodes]);

  const pickGroup = (key: string) => {
    if (!view || !net) return;
    const g = groups.find((x) => x.key === key);
    if (!g) return;
    const unit = view.unitOf[g.members[0]];
    if (view.group[unit] === key) {
      select({ kind: 'node', id: net.id[unit] });
      plane.current?.frame([unit, ...neighbours(net, unit)]);
    } else {
      // Open already: frame what it opened into.
      plane.current?.frame([...new Set(g.members.map((i) => view.unitOf[i]))]);
    }
  };
  const pickPlace = (id: string) => {
    const p = geography?.places.find((x) => String(x.coord) === id);
    if (!p) return;
    select(selection?.kind === 'place' && selection.coord === p.coord ? null : { kind: 'place', coord: p.coord });
    plane.current?.frame(p.nodes);
  };
  const pickEntity = (id: string) => {
    const i = base?.index.get(id);
    if (i !== undefined) goToBase(i);
  };

  // ── Legend ────────────────────────────────────────────────────────────────
  const legend = useMemo(() => {
    if (!base) return [];
    const counts = typeCounts(base);
    const entityTypes = new Set<number>();
    for (let i = 0; i < base.size; i++) if (base.kind[i] === 0) entityTypes.add(base.type[i]);
    return [...entityTypes]
      .map((t) => ({ name: base.types[t] || 'unknown', count: counts[t] }))
      .sort((a, b) => b.count - a.count);
  }, [base]);
  const [legendAll, setLegendAll] = useState(false);
  const toggleType = (name: string) => {
    const next = new Set(hidden);
    if (next.has(name)) next.delete(name); else next.add(name);
    setConfig({ hidden_types: [...next] });
  };
  const counts = useMemo(() => {
    if (!base) return { occurrences: 0, isolated: 0 };
    let occurrences = 0, isolated = 0;
    for (let i = 0; i < base.size; i++) {
      occurrences += base.kind[i];
      if (degree(base, i) === 0) isolated++;
    }
    return { occurrences, isolated };
  }, [base]);

  // ── Camera & layout ───────────────────────────────────────────────────────
  const [running, setRunning] = useState(true);
  const toggleLayout = () => (running ? plane.current?.pause() : plane.current?.reheat(0.3));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (openAsset != null) setOpenAsset(null);
    else if (selection) select(null);
    else if (win) { setWin(null); setPlaying(false); }
    else return;
    e.stopPropagation();
  };

  // ── The drill column's subject ────────────────────────────────────────────
  const drill = useMemo((): { subject: DrillSubject; context: string[]; actions?: React.ReactNode } | null => {
    if (!net || !view || !subject) return null;
    if (focused != null) {
      const key = view.group[focused];
      const members = net.members[focused];
      const enclosing = !key && communities
        ? groupPath(communities, membersOf(view, focused)[0], MIN_GROUP).some((k) => expanded.has(k))
        : false;
      return {
        subject: {
          icon: key ? Boxes : net.kind[focused] === 1 ? Activity : CircleDot,
          name: net.name[focused],
          caption: key ? `group of ${members.toLocaleString()}` : net.types[net.type[focused]] || 'node',
          unit: 'annotations',
        },
        context: [`${degree(net, focused).toLocaleString()} links`],
        actions: key ? (
          <HudButton size="sm" icon={Maximize2} title="Open the group (or double-click it)"
                     className="-mr-1 border-transparent" onClick={() => expand(key)} />
        ) : enclosing ? (
          <HudButton size="sm" icon={Minimize2} title="Fold back into its group"
                     className="-mr-1 border-transparent"
                     onClick={() => { fold(membersOf(view, focused)[0]); select(null); }} />
        ) : undefined,
      };
    }
    if (place) {
      return {
        subject: {
          icon: MapPin, name: place.name,
          caption: `${place.nodes.length.toLocaleString()} nodes placed here`, unit: 'annotations',
        },
        context: [RUNG_PRESETS[geoChoice.preset as PlacePreset]?.label ?? geoChoice.preset],
      };
    }
    if (win && timeline) {
      const fmt = timeline.grain === 'year' ? 'yyyy'
        : timeline.grain === 'day' || timeline.grain === 'week' ? 'd MMM yy' : 'MMM yyyy';
      return {
        subject: {
          icon: Clock,
          name: `${format(new Date(win[0]), fmt)} – ${format(new Date(win[1]), fmt)}`,
          caption: `${subject.nodes.length.toLocaleString()} nodes in this window`, unit: 'annotations',
        },
        context: [timeChoice.source === 'published' ? 'as published' : 'as stated'],
      };
    }
    return null;
  }, [net, view, subject, focused, place, win, timeline, communities, expanded, expand, fold, select,
      geoChoice.preset, timeChoice.source]);

  const drilling = drill != null;
  const building = stream.status === 'building' || stream.status === 'connecting';

  return (
    <div className="@container/network relative h-full min-h-[420px] w-full overflow-hidden bg-background"
         onKeyDown={onKeyDown}>
      {net && buffers && (
        <CosmosPlane
          ref={plane}
          className={cn('absolute inset-0 transition-opacity duration-300', stream.stale && 'opacity-60')}
          network={net}
          layout={LAYOUTS.get(panel.id)}
          inherit={inherit}
          arrangement={arrangement}
          buffers={buffers}
          visible={visible}
          highlight={subject?.highlight ?? null}
          focused={focused}
          outlined={stageUnits ? [stageUnits.a, stageUnits.b] : null}
          config={planeLook}
          backdrop={core === 'geo' ? <PlaneMap contrast={quiet ? 'high' : 'normal'} /> : undefined}
          onPointClick={onPointClick}
          onBackgroundClick={() => select(null)}
          onHover={setHover}
          onLayout={onLayout}
          onRunning={setRunning}
        >
          <PlaneLabels pinned={pinned} emphasis={hover ?? focused} />
          {stage && stageUnits && stageUnits.a !== stageUnits.b && (
            <PlaneLink from={stageUnits.a} to={stageUnits.b}
                       tone={stage.phase === 'judging' ? 'pending' : stage.decision.status === 'merged' ? 'joined' : 'apart'} />
          )}
        </CosmosPlane>
      )}

      {/* ── Top-left: what is drawn, how, and finding in it ──────────── */}
      <div className="pointer-events-none absolute inset-y-3 left-3 flex w-[300px] max-w-[calc(100%-1.5rem)] flex-col gap-2">
        <div className={cn(HUD_SURFACE, 'pointer-events-auto space-y-1.5 rounded-lg p-1.5')}>
          <div className="flex items-center gap-1.5">
            <label className="relative block min-w-0 flex-1">
              <Spline className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-hud-dimmer" />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(config.q ?? ''); }}
                placeholder='Query — type:Person from:"…"'
                spellCheck={false}
                className={cn(HUD_INPUT, 'h-7 w-full border pl-6 pr-2 font-mono text-[11px] outline-none',
                              draft !== (config.q ?? '') && 'border-hud-line-strong')}
              />
            </label>
            <TimeButton active={core === 'time'} value={config.view?.time}
                        onApply={(time) => setView({ core: 'time', time })}
                        onLeave={() => setView({ core: 'groups' })} />
            <GeoButton active={core === 'geo'} value={config.view?.geo}
                       onApply={(geo) => setView({ core: 'geo', geo })}
                       onLeave={() => setView({ core: 'groups' })} />
          </div>
          {draft !== (config.q ?? '') && (
            <p className={cn(HUD_PROSE, 'px-1 text-hud-dimmer')}>Enter to apply · Esc to discard</p>
          )}
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-hud-dimmer" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && found[0] != null) { goToBase(found[0]); setFind(''); }
                if (e.key === 'Escape') setFind('');
              }}
              placeholder="Find a node"
              disabled={!base}
              className={cn(HUD_INPUT, 'h-7 w-full border pl-6 pr-2 text-[11px] outline-none')}
            />
          </label>
          {find && base && (
            <div className="max-h-56 overflow-y-auto">
              {found.length === 0 && <p className={cn(HUD_PROSE, 'px-2 py-1 text-hud-dimmer')}>No node by that name.</p>}
              {found.map((i) => (
                <HudOption
                  key={i}
                  label={base.name[i]}
                  hint={`${base.types[base.type[i]] || 'unknown'} · ${degree(base, i).toLocaleString()} links`}
                  trailing={<span className={cn(HUD_NUM, 'text-hud-dimmer')}>{base.frequency[i].toLocaleString()}</span>}
                  onClick={() => { goToBase(i); setFind(''); }}
                />
              ))}
            </div>
          )}
        </div>

        {base && core === 'groups' && (
          <RankCard className="pointer-events-auto max-h-[42%] @max-[640px]/network:hidden" title="Groups"
                    total={groups.length} unit="groups" items={groupItems} onPick={pickGroup}
                    highlighted={focused != null && view?.group[focused] ? view.group[focused] : null} />
        )}
        {geography && (
          <RankCard className="pointer-events-auto max-h-[42%] @max-[640px]/network:hidden" title="Places"
                    total={geography.places.length} unit="places" items={placeItems} onPick={pickPlace}
                    highlighted={place ? String(place.coord) : null} />
        )}
        {timeline && windowNodes && (
          <RankCard className="pointer-events-auto max-h-[42%] @max-[640px]/network:hidden" title="In this window"
                    total={windowNodes.length} unit="nodes" items={windowItems}
                    onPick={(id) => select({ kind: 'node', id })}
                    highlighted={selection?.kind === 'node' ? selection.id : null} />
        )}
        {base && (
          <RankCard className="pointer-events-auto min-h-0 flex-1 basis-0 @max-[640px]/network:hidden" title="Entities"
                    total={base.size - counts.occurrences} unit="named" items={entityItems} onPick={pickEntity}
                    highlighted={selection?.kind === 'node' ? selection.id : null} />
        )}
      </div>

      {/* ── Top-right: of how many ─────────────────────────────────────── */}
      {!drilling && (
        <section className={cn(HUD_SURFACE, 'absolute right-3 top-3 w-[188px] rounded-lg px-3 py-2.5 @max-[520px]/network:hidden')}>
          <div className="flex items-baseline justify-between">
            <span className={cn(HUD_LABEL, 'text-hud-dim')}>
              {core === 'time' ? 'Over time' : core === 'geo' ? 'On the map' : 'Network'}
            </span>
            <HudLiveDot status={stream.status} live={!!stream.frame?.run.live} />
          </div>
          <div className="mt-1 text-[22px] font-light leading-none tracking-tight text-hud-fg tabular-nums">
            {base ? base.size.toLocaleString() : '—'}
            <span className={cn(HUD_LABEL, 'ml-1.5 align-middle text-hud-dimmer')}>nodes</span>
          </div>
          {base && net && (
            <div className="mt-2.5 space-y-1.5">
              <HudStat label="links" value={base.links.toLocaleString()} />
              {core === 'groups' && <HudStat label="groups" value={groups.length.toLocaleString()} />}
              {core === 'groups' && <HudStat label="drawn" value={net.size.toLocaleString()} />}
              {timeline && (
                <HudStat label="dated" value={`${Math.round(100 * (1 - timeline.undated / Math.max(1, net.size)))}%`}
                         meter={1 - timeline.undated / Math.max(1, net.size)} />
              )}
              {timeline && timeline.outside > 0 && <HudStat label="outside" value={timeline.outside.toLocaleString()} />}
              {geography && (
                <HudStat label="placed" value={`${Math.round(100 * geography.placed / Math.max(1, net.size))}%`}
                         meter={geography.placed / Math.max(1, net.size)} />
              )}
              {geography && <HudStat label="places" value={geography.places.length.toLocaleString()} />}
              <HudStat label="built in" value={base.buildMs >= 1000 ? `${Math.round(base.buildMs / 1000)}s` : `${base.buildMs}ms`} />
              {base.capped && (
                <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>The most frequent {base.size.toLocaleString()} only.</p>
              )}
            </div>
          )}
          <HudSegmented size="sm" className="mt-2.5 w-full"
                        value={config.max_nodes ? String(config.max_nodes) : 'all'}
                        onChange={(v) => setConfig({ max_nodes: v === 'all' ? null : Number(v) })}
                        options={BUDGETS} />
        </section>
      )}

      {/* ── Top-centre: the resolver's ticker ───────────────────────────── */}
      {raw && (
        <ResolverTicker
          className={cn('absolute left-1/2 top-3 z-10 -translate-x-1/2 @max-[760px]/network:hidden',
                        drilling && '@min-[1100px]/network:left-[calc(50%-90px)]')}
          state={resolution.state}
          current={resolution.current}
          seeding={resolution.seeding}
          onSet={(patch) => resolution.setResolver(patch)}
          onFocus={focusPair}
          history={(
            <ResolverHistory
              count={Object.entries(resolution.state?.counts ?? {}).reduce((n, [k, v]) => n + (k === 'pending' ? 0 : v), 0)}
              items={resolution.history}
              total={resolution.historyTotal}
              load={(status, more) => { void resolution.loadHistory(status, more); }}
              onRollback={(id) => { void resolution.rollback(id); }}
              onChange={(id, body) => { void resolution.change(id, body); }}
              onFocus={focusPair}
            />
          )}
        />
      )}

      {/* ── Right: the documents behind the selection ─────────────────── */}
      {drill && (
        <DrillColumn
          subject={drill.subject}
          context={drill.context}
          actions={drill.actions}
          pages={pages}
          openAsset={openAsset}
          onOpenAsset={setOpenAsset}
          onClose={() => { if (selection) select(null); else { setWin(null); setPlaying(false); } }}
          infospaceId={infospaceId}
          runId={runId}
          schemas={schemas}
        />
      )}

      {/* ── Bottom-left: legend ────────────────────────────────────────── */}
      {base && legend.length > 0 && (
        <section className={cn(HUD_SURFACE, 'absolute bottom-3 left-3 w-[220px] max-w-[calc(100%-1.5rem)] rounded-lg p-1.5 @max-[900px]/network:hidden')}>
          <div className="max-h-[180px] overflow-y-auto [scrollbar-width:thin]">
            {(legendAll ? legend : legend.slice(0, 6)).map((t) => {
              const off = hidden.has(t.name);
              return (
                <button key={t.name} type="button" onClick={() => toggleType(t.name)}
                        title={off ? `Show ${t.name}` : `Hide ${t.name}`}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-hud-sunken">
                  <span className={cn('size-2 shrink-0 rounded-full', off && 'opacity-25', core === 'groups' && 'bg-hud-line-strong')}
                        style={core === 'groups' ? undefined : { background: resolveEntityColor(t.name) }} />
                  <span className={cn('min-w-0 flex-1 truncate text-[11px]', off ? 'text-hud-dimmer line-through' : 'text-hud-fg')}>
                    {t.name}
                  </span>
                  <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{t.count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 space-y-0.5 border-t border-hud-line px-1.5 pt-1.5">
            <Toggle on={showOccurrences} icon={showOccurrences ? Eye : EyeOff}
                    label={`${counts.occurrences.toLocaleString()} occurrences`}
                    title="The acts and rows that connect entities"
                    onClick={() => setView({ occurrences: !showOccurrences })} />
            <Toggle on={showIsolated} icon={Unlink}
                    label={`${counts.isolated.toLocaleString()} unconnected`}
                    title="Nodes that link to nothing — mentioned, never related"
                    onClick={() => setView({ isolated: !showIsolated })} />
            {legend.length > 6 && (
              <button type="button" onClick={() => setLegendAll((a) => !a)}
                      className={cn(HUD_NUM, 'text-hud-dim hover:text-hud-fg')}>
                {legendAll ? 'fewer types' : `+${legend.length - 6} types`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Bottom: when, in the time view ─────────────────────────────── */}
      {timeline && timeline.bins.length > 0 && (
        <TimeStrip
          className={cn(
            'absolute bottom-3 left-1/2 w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2',
            drilling && '@min-[900px]/network:left-[calc(50%-80px)] @min-[900px]/network:w-[min(520px,calc(100%-760px))]',
          )}
          bins={timeline.bins}
          grain={timeline.grain}
          undated={timeline.undated}
          outside={timeline.outside}
          window={win}
          onWindow={(w) => { setWin(w); setPlaying(false); }}
          unit="nodes"
          actions={(
            <HudButton size="sm" icon={playing ? Pause : Play}
                       title={playing ? 'Stop' : 'Play — step the window through time, naming what is in it'}
                       className="h-5 border-transparent px-1"
                       onClick={() => {
                         if (!playing && !win && cells.length) setWin([cells[0], cells[0]]);
                         setPlaying((p) => !p);
                       }} />
          )}
        />
      )}

      {/* ── Bottom-right: camera and layout ───────────────────────────── */}
      {net && (
        <div className="absolute bottom-3 @max-[640px]/network:hidden"
             style={{ right: drilling ? DRILL_W + 20 : 12 }}>
          <HudGroup size="sm" className="flex-col divide-x-0 divide-y bg-hud-surface backdrop-blur-xl">
            <HudButton icon={Plus} title="Zoom in" onClick={() => plane.current?.zoomBy(1.6)} />
            <HudButton icon={Minus} title="Zoom out" onClick={() => plane.current?.zoomBy(1 / 1.6)} />
            <HudButton icon={Scan} title="Frame everything" onClick={() => plane.current?.fit()} />
            <HudButton icon={running ? Pause : Play} title={running ? 'Hold the layout' : 'Let the layout run'}
                       onClick={toggleLayout} />
            <HudButton icon={Flame} title="Shake the layout up" onClick={() => plane.current?.reheat(0.8)} />
            {core === 'geo' && (
              <HudButton icon={Contrast} active={quiet}
                         title={quiet ? 'Show the whole network at full strength' : 'Quiet the network — fade what has no place, firm up the map'}
                         onClick={() => setView({ quiet: !quiet })} />
            )}
          </HudGroup>
        </div>
      )}

      {/* ── States ─────────────────────────────────────────────────────── */}
      {(!base || stream.error) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn(HUD_SURFACE, 'pointer-events-auto max-w-[340px] rounded-lg px-4 py-3 text-center')}>
            <p className={cn(HUD_PROSE, 'text-hud-dim')}>
              {stream.error ? `The graph could not be built: ${stream.error}`
                : building && stream.frame
                  ? `Building the graph of ${stream.frame.totals.annotations.toLocaleString()} results…${stream.elapsedMs ? ` ${Math.round(stream.elapsedMs / 1000)}s` : ''}`
                  : 'Opening the run…'}
            </p>
            {stream.error && (
              <HudButton size="sm" className="mt-2" onClick={stream.refresh}>Try again</HudButton>
            )}
          </div>
        </div>
      )}
      {base && stream.stale && (
        <div className={cn(HUD_SURFACE, 'pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md px-2.5 py-1')}>
          <span className={cn(HUD_NUM, 'text-hud-dim')}>
            Building{stream.elapsedMs ? ` · ${Math.round(stream.elapsedMs / 1000)}s` : '…'}
          </span>
        </div>
      )}
      {base && base.size === 0 && !stream.stale && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn(HUD_SURFACE, 'max-w-[320px] rounded-lg px-4 py-3 text-center')}>
            <p className={cn(HUD_PROSE, 'text-hud-dim')}>
              {config.q ? 'Nothing in this run matches the query.' : 'No graph yet — first results will appear here as they arrive.'}
            </p>
          </div>
        </div>
      )}
      {geography && geography.placed === 0 && base && base.size > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn(HUD_SURFACE, 'max-w-[320px] rounded-lg px-4 py-3 text-center')}>
            <p className={cn(HUD_PROSE, 'text-hud-dim')}>
              Nothing here has a place under “{RUNG_PRESETS[geoChoice.preset as PlacePreset]?.label}”. Try a wider preset.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  on, icon: Icon, label, title, onClick,
}: { on: boolean; icon: React.ElementType; label: string; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={title}
            className={cn(HUD_NUM, 'flex w-full items-center gap-1.5',
                          on ? 'text-hud-dim hover:text-hud-fg' : 'text-hud-dimmer line-through hover:text-hud-dim')}>
      <Icon className="size-3" />
      {label}
    </button>
  );
}
