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
 *                     names stream across the plane — or, deep, as depth: the
 *                     present in front, what follows behind it, scrolled
 *                     through (`plane/TimeDeck`)
 *   Geo               each node at its place, on the overview's map, which
 *                     follows the plane's camera
 *
 *   top-left      query · Time · Geo · find, then the lists: groups, places,
 *                 the window, and the labels — types, occurrences and the
 *                 unconnected as chips over the entities; shift-click marks
 *                 labels to merge by hand
 *   top-right     of how many — or the documents behind what is selected
 *   bottom-left   the colour key, deep in time
 *   bottom        the time strip, in the time view
 *   bottom-right  camera and layout
 *
 * Whatever is selected — a node, a group, a place, a window — opens the same
 * drill column the overview opens: the documents behind it, then one of them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Activity, Anchor as AnchorIcon, Boxes, CircleDot, Clock, Contrast, Expand, Eye, EyeOff, Flame, MapPin, Maximize2,
  Merge, Minimize2, Minus, Pause, Play, Plus, Scan, Search, Spline, Unlink, X,
} from 'lucide-react';
import type { GraphConfig } from '@cosmos.gl/graph';
import { NetworkService, type AnnotationSchemaRead } from '@/client';
import { cn } from '@/lib/utils';
import {
  HUD_GLASS, HUD_INPUT, HUD_LABEL, HUD_NUM, HUD_PROSE, HUD_SURFACE, HudButton, HudGroup, HudLiveDot,
  HudGain, HudOption, HudSegmented, HudStat,
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
  CosmosPlane, DECK_DEFAULTS, GROUP_HUES, PlaneAnchors, PlaneLabels, PlaneLink, PlaneMap, RUNG_PRESETS, SPACE_SIZE,
  TimeDeck, anchorMatches, anchored, annotationsOf, applyGain, byGroups, gainStops, loudest, setGain, spaceOf,
  unitStops, withAnchors,
  type Anchor, type DeckApi, type Gain, type GainKind, type Surface,
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
import { DeepControls } from './DeepControls';

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
type Span = NonNullable<TimeWindow>;
type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'place'; coord: number }
  | { kind: 'anchor'; id: string }
  | null;
const NO_GAINS: Gain[] = [];
const NO_ANCHORS: Anchor[] = [];

/** A config value edited continuously — a slider, a drag — held locally and
 *  saved once the hand rests, so a drag is one write, not sixty a second. */
function useDraft<T>(saved: T, save: (v: T) => void, ms = 350): [T, (v: T) => void] {
  const [draft, setDraft] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => { setDraft(null); }, [saved]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const set = useCallback((v: T) => {
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(v), ms);
  }, [ms]);
  return [draft ?? saved, set];
}

const toUnit = ([r, g, b, a]: [number, number, number, number]): Rgba => [r / 255, g / 255, b / 255, a / 255];
const byFrequency = (net: Network) => (a: number, b: number) => net.frequency[b] - net.frequency[a];
const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** The window `delta` cells later (or earlier), keeping its width in cells;
 *  the same window when it cannot move. */
function shiftWindow(w: Span, delta: number, cells: number[], grain: Grain): Span {
  const from = cells.findIndex((c) => c >= cellOf(w[0], grain));
  if (from < 0) return w;
  const to = cells.findIndex((c) => c > w[1]);
  const width = Math.max(1, (to < 0 ? cells.length : to) - from);
  const next = Math.max(0, Math.min(cells.length - width, from + delta));
  return next === from ? w : [cells[next], cells[next + width - 1]];
}

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
  // Deep time: the plane keeps laying the network out by its groups — a topic
  // is a region — with its own canvas hidden; the deck draws it, time as depth.
  const deep = core === 'time' && timeChoice.mode === 'deep';
  const deepColor = config.view?.color ?? 'groups';
  const spread = config.view?.spread ?? false;

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

  const hidden = useMemo(() => new Set(config.hidden_types ?? []), [config.hidden_types]);

  // ── Anchors: groups the reader makes ──────────────────────────────────────
  // Words dropped on the canvas gather what they name; each view reads the
  // anchors of its own space (`plane/anchoring`).
  const anchorSpace = spaceOf(core, deep);
  const [anchors, setAnchors] = useDraft<Anchor[]>(
    (config.view?.anchors as Anchor[] | undefined) ?? NO_ANCHORS, (anchors) => setView({ anchors }));
  const shown = useMemo(() => anchors.filter((a) => a.space === anchorSpace), [anchors, anchorSpace]);
  const anchorWords = shown.map((a) => a.q).join('\n');
  const matches = useMemo(() => {
    if (!base || !shown.length) return [];
    const off = base.types.map((t) => hidden.has(t || 'unknown'));
    return anchorWords.split('\n').map((q) => (q ? anchorMatches(base, q, (i) => !off[base.type[i]]) : { direct: [], related: [] }));
  }, [base, anchorWords, hidden, shown.length]);
  // Among groups, what an anchor pulls is drawn as itself so it can move.
  const loose = useMemo(() => (core === 'groups' && shown.length ? anchored(matches) : undefined), [core, shown.length, matches]);

  // ── What the plane draws ──────────────────────────────────────────────────
  const view = useMemo(() => {
    if (!base) return null;
    return core === 'groups' && communities && heads
      ? collapse(base, communities, expanded, { minGroup: MIN_GROUP, heads, loose })
      : identity(base);
  }, [base, communities, heads, expanded, core, loose]);
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

  const viewArrangement = useMemo(() => {
    if (!net) return null;
    if (timeline && !deep) return timeline.arrangement;
    if (geography) return geography.arrangement;
    return byGroups(net, rankOf);
  }, [net, timeline, geography, rankOf, deep]);
  const arrangement = useMemo(
    () => (viewArrangement && view ? withAnchors(viewArrangement, view, shown, matches) : viewArrangement),
    [viewArrangement, view, shown, matches]);
  /** Drawn units each anchor pulls — on the map, brought into the view. */
  const anchorUnits = useMemo(() => {
    if (!view) return [] as number[][];
    return matches.map((m) => [...new Set([...m.direct, ...m.related].map((i) => view.unitOf[i]))]);
  }, [view, matches]);

  // ── Gain: types, entities and groups turned up or down ────────────────────
  const [gains, setGains] = useDraft<Gain[]>(
    (config.view?.gains as Gain[] | undefined) ?? NO_GAINS, (gains) => setView({ gains }));
  const gainOf = useCallback(
    (kind: GainKind, key: string) => gains.find((g) => g.kind === kind && g.key === key)?.value ?? 0, [gains]);
  const setGainFor = useCallback(
    (kind: GainKind, key: string, value: number) => setGains(setGain(gains, kind, key, value)), [gains, setGains]);
  const groupKeyOf = useMemo(() => {
    const keys = groups.map((g) => g.key);
    return (i: number) => (ranks && ranks[i] >= 0 ? keys[ranks[i]] ?? null : null);
  }, [groups, ranks]);
  const stops = useMemo(
    () => (base && view && gains.length ? unitStops(view, gainStops(base, gains, groupKeyOf)) : null),
    [base, view, gains, groupKeyOf]);

  // Over the map, the network can bury what it sits on. Quiet: what has no
  // place of its own all but fades, links recede, and the map firms up.
  const quiet = core === 'geo' && (config.view?.quiet ?? true);
  const buffers = useMemo(() => {
    if (!net) return null;
    // Deep, a group's colour is its stream through time — so past the palette
    // a group goes quiet rather than borrowing a hue another stream wears.
    const colors = core === 'groups' ? groupColors(net, rankOf, palette)
      : deep && deepColor === 'groups'
        ? groupColors(net, (u) => { const r = rankOf(u); return r < GROUP_HUES.length ? r : -1; }, palette)
        : pointColors(net, palette);
    const links = linkColors(net, palette);
    if (quiet && geography) {
      for (let i = 0; i < net.size; i++) if (geography.coord[i] < 0) colors[4 * i + 3] *= 0.15;
      for (let j = 0; j < net.links; j++) links[4 * j + 3] *= 0.3;
    }
    const sizes = pointSizes(net);
    if (stops) applyGain(net, stops, { sizes, colors, linkColors: links });
    return {
      colors,
      sizes,
      linkColors: links,
      linkWidths: linkWidths(net),
      linkArrows: linkArrows(net),
      linkStrength: linkStrength(net),
    };
  }, [net, palette, core, rankOf, quiet, geography, deep, deepColor, stops]);
  const planeLook = useMemo(() => ({
    ...planeConfig,
    pointGreyoutOpacity: quiet ? 0.03 : 0.12,
    linkGreyoutOpacity: quiet ? 0.005 : 0.04,
  }), [planeConfig, quiet]);

  const onLayout = useCallback((n: Network, positions: ArrayLike<number>) => {
    LAYOUTS.set(panel.id, positionsById(n, positions));
  }, [panel.id]);

  const showOccurrences = config.view?.occurrences !== false;
  // The unconnected are noise among groups and the point on a map or a
  // timeline, so the default follows the view until the reader says.
  const showIsolated = config.view?.isolated ?? core !== 'groups';
  const visible = useMemo(() => {
    if (!net) return null;
    const v = visibility(net, hidden);
    const include = viewArrangement?.include;
    const pulled = include ? new Set(anchorUnits.flat()) : null;
    for (let i = 0; i < net.size; i++) {
      if (!showOccurrences && net.kind[i] === 1) v[i] = 0;
      if (!showIsolated && net.members[i] === 1 && degree(net, i) === 0) v[i] = 0;
      if (include && !include[i] && !pulled!.has(i)) v[i] = 0;
    }
    return v;
  }, [net, hidden, showOccurrences, showIsolated, viewArrangement, anchorUnits]);

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

  // ── Marks: labels gathered by shift-click, to merge by hand ───────────────
  const [marks, setMarks] = useState<string[]>([]);
  const [keeper, setKeeper] = useState<string | null>(null);
  const toggleMark = useCallback((id: string) => {
    setMarks((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  }, []);
  /** What a merge keeps: the reader's pick, else the most mentioned. */
  const kept = useMemo(() => {
    if (!base || !marks.length) return null;
    if (keeper && marks.includes(keeper)) return keeper;
    return [...marks].sort((a, b) => (base.frequency[base.index.get(b) ?? 0] ?? 0) - (base.frequency[base.index.get(a) ?? 0] ?? 0))[0];
  }, [base, marks, keeper]);
  const label = useCallback((id: string) => {
    const i = base?.index.get(id);
    return i === undefined || !base ? null : { name: base.name[i], type: base.types[base.type[i]] || 'unknown' };
  }, [base]);
  const mergeMarks = async () => {
    const keep = kept ? label(kept) : null;
    const others = marks.filter((m) => m !== kept).map(label).filter((x): x is NonNullable<typeof x> => !!x);
    if (!keep || !others.length) return;
    if (await resolution.merge({ keep, others })) { setMarks([]); setKeeper(null); }
  };
  // Marks name nodes of the network underneath; a merge or a new query can
  // take them away.
  useEffect(() => {
    if (base) setMarks((xs) => { const alive = xs.filter((id) => base.index.has(id)); return alive.length === xs.length ? xs : alive; });
  }, [base]);

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
    if (selection?.kind === 'anchor') {
      const k = shown.findIndex((a) => a.id === selection.id);
      if (k < 0 || !view) return null;
      const units = anchorUnits[k].filter((u) => !visible || visible[u]);
      const inSet = new Set(units);
      const links: number[] = [];
      for (let j = 0; j < net.links; j++) if (inSet.has(net.source[j]) && inSet.has(net.target[j])) links.push(j);
      const named = [...new Set(matches[k].direct.map((i) => view.unitOf[i]))].slice(0, NAMED);
      return { key: `anchor:${selection.id}:${shown[k].q}`, nodes: units, highlight: { points: units, links }, named };
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
  }, [net, focused, place, windowNodes, win, selection, shown, view, anchorUnits, visible, matches]);


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

  const markSet = useMemo(() => new Set(marks), [marks]);
  const markUnits = useMemo(() => {
    if (!net) return [];
    return marks.map((id) => net.index.get(id)).filter((i): i is number => i !== undefined);
  }, [net, marks]);
  const pinned = useMemo(() => {
    const named = [...(subject?.named ?? [])];
    const loud = net && stops ? loudest(net, stops) : [];
    for (const i of [hover, stageUnits?.a, stageUnits?.b, ...markUnits, ...loud]) if (i != null && !named.includes(i)) named.push(i);
    return named;
  }, [subject, hover, stageUnits, markUnits, net, stops]);
  const outlined = useMemo(() => {
    const xs = [...markUnits];
    if (stageUnits) xs.push(stageUnits.a, stageUnits.b);
    return xs.length ? xs : null;
  }, [markUnits, stageUnits]);

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
  const onPointClick = (i: number, e?: MouseEvent) => {
    if (!net || !view) return;
    if (e?.shiftKey) {
      // A label, not a group: groups are the layout's, not the run's.
      if (!view.group[i] && net.kind[i] === 0) toggleMark(net.id[i]);
      return;
    }
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
        const next = w ? shiftWindow(w, 1, cells, timeline.grain) : w;
        if (next === w) setPlaying(false);
        return next;
      });
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, cells, timeline]);
  useEffect(() => { if (core !== 'time') { setPlaying(false); setWin(null); } }, [core]);

  // ── Deep time: each node's slice, and the present ─────────────────────────
  // The present is the brushed window when there is one, else a single slice
  // the wheel moves; travelling with a window moves the window.
  const [front, setFront] = useState(0);
  const slices = useMemo(() => {
    if (!deep || !timeline || !net) return null;
    const at = new Map(cells.map((c, k) => [c, k]));
    const slice = new Int32Array(net.size).fill(-1);
    for (let i = 0; i < net.size; i++) {
      const c = timeline.cell[i];
      if (!Number.isNaN(c)) slice[i] = at.get(c) ?? -1;
    }
    return slice;
  }, [deep, timeline, net, cells]);
  const windowSlices = useCallback((w: Span): [number, number] => {
    if (!timeline) return [0, 0];
    const lo = Math.max(0, cells.findIndex((c) => c >= cellOf(w[0], timeline.grain)));
    let hi = lo;
    while (hi + 1 < cells.length && cells[hi + 1] <= w[1]) hi++;
    return [lo, hi];
  }, [cells, timeline]);
  const present = useMemo<[number, number]>(
    () => (win ? windowSlices(win) : [Math.min(front, Math.max(0, cells.length - 1)), Math.min(front, Math.max(0, cells.length - 1))]),
    [win, windowSlices, front, cells.length]);
  // A window's start is where the wheel picks up once it is cleared.
  useEffect(() => { if (win) setFront(windowSlices(win)[0]); }, [win, windowSlices]);
  const travel = useCallback((delta: number) => {
    if (!timeline || !cells.length) return;
    setPlaying(false);
    if (win) setWin(shiftWindow(win, delta, cells, timeline.grain));
    else setFront((f) => Math.max(0, Math.min(cells.length - 1, f + delta)));
  }, [timeline, cells, win]);
  const [deckApi, setDeckApi] = useState<DeckApi | null>(null);
  const [deckView, setDeckView] = useDraft(config.view?.deep ?? null, (deep) => setView({ deep: deep ?? undefined }));

  // ── Anchors: placing and editing ──────────────────────────────────────────
  /** Where anchors sit: the deck deep in time, else the plane (and its map). */
  const surface = useMemo<Surface | null>(() => {
    if (deep) return deckApi;
    if (!net) return null;
    return {
      project: (p) => plane.current?.view.spaceToScreen(p) ?? [NaN, NaN],
      unproject: (q) => {
        const p = plane.current?.view.graph?.screenToSpacePosition(q);
        return p ? [p[0], p[1]] : [NaN, NaN];
      },
      subscribe: (fn) => plane.current?.view.subscribe(fn) ?? (() => {}),
    };
  }, [deep, deckApi, net]);
  const [placing, setPlacing] = useState(false);
  useEffect(() => { setPlacing(false); }, [anchorSpace]);
  const dropAnchor = (x: number, y: number) => {
    const id = `a${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`;
    setAnchors([...anchors, { id, q: '', space: anchorSpace, x, y }]);
    setPlacing(false);
  };
  const editAnchor = (id: string, patch: Partial<Anchor>) =>
    setAnchors(anchors.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const removeAnchor = (id: string) => {
    setAnchors(anchors.filter((a) => a.id !== id));
    if (selection?.kind === 'anchor' && selection.id === id) select(null);
  };
  const anchorCounts = useMemo(() => {
    const out = new Map<string, number>();
    shown.forEach((a, k) => out.set(a.id, (matches[k]?.direct.length ?? 0) + (matches[k]?.related.length ?? 0)));
    return out;
  }, [shown, matches]);
  // Deep: the legend can single out one stream — a group's rank, or a type.
  const [solo, setSolo] = useState<number | null>(null);
  useEffect(() => { setSolo(null); }, [deep, deepColor]);

  // ── Lists ─────────────────────────────────────────────────────────────────
  const entityItems = useMemo<RankItem[]>(() => {
    if (!base) return [];
    const off = base.types.map((t) => hidden.has(t || 'unknown'));
    const out: number[] = [];
    for (let i = 0; i < base.size; i++) if (base.kind[i] === 0 && !off[base.type[i]]) out.push(i);
    return out.sort(byFrequency(base)).slice(0, LISTED).map((i) => ({
      id: base.id[i], name: base.name[i], count: base.frequency[i],
      hint: base.types[base.type[i]] || undefined,
    }));
  }, [base, hidden]);
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
  const pickEntity = (id: string, e?: React.MouseEvent) => {
    if (e?.shiftKey) { toggleMark(id); return; }
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
      .map((t) => ({ index: t, name: base.types[t] || 'unknown', count: counts[t] }))
      .sort((a, b) => b.count - a.count);
  }, [base]);
  const [legendAll, setLegendAll] = useState(false);
  const toggleType = (name: string) => {
    const next = new Set(hidden);
    if (next.has(name)) next.delete(name); else next.add(name);
    setConfig({ hidden_types: [...next] });
  };
  /** Whether the dots are the colours nodes are drawn in — not under groups. */
  const typeColoured = core !== 'groups' && !(deep && deepColor === 'groups');
  /** One click: every type off — then pick the ones to see — or all back. */
  const allTypesOff = legend.length > 0 && legend.every((t) => hidden.has(t.name));
  const setAllTypes = (on: boolean) => setConfig({ hidden_types: on ? [] : legend.map((t) => t.name) });

  /** Deep's colour key: the streams by group, or the types. */
  const streams = useMemo(() => {
    if (!deep) return [];
    if (deepColor === 'types') {
      return legend.filter((t) => !hidden.has(t.name)).slice(0, 14)
        .map((t) => ({
          key: t.index, name: t.name, count: t.count, color: resolveEntityColor(t.name),
          gain: { kind: 'type' as GainKind, key: t.name },
        }));
    }
    return groups.slice(0, GROUP_HUES.length)
      .map((g, r) => ({
        key: r, name: g.label, count: g.size, color: GROUP_HUES[r], gain: { kind: 'group' as GainKind, key: g.key },
      }));
  }, [deep, deepColor, legend, hidden, groups]);
  /** Deep: what is drawn at full strength — a focused node and its
   *  neighbours, or a stream singled out in the key. */
  const emphasis = useMemo(() => {
    if (!deep || !net) return null;
    if (focused != null) {
      const e = new Uint8Array(net.size);
      e[focused] = 1;
      for (const j of neighbours(net, focused)) e[j] = 1;
      return e;
    }
    if (selection?.kind === 'anchor' && subject) {
      const e = new Uint8Array(net.size);
      for (const i of subject.highlight.points) e[i] = 1;
      return e;
    }
    if (solo == null) return null;
    const e = new Uint8Array(net.size);
    for (let i = 0; i < net.size; i++) e[i] = (deepColor === 'types' ? net.type[i] === solo : rankOf(i) === solo) ? 1 : 0;
    return e;
  }, [deep, net, focused, solo, deepColor, rankOf, selection, subject]);

  /** Everything picked, marked, brushed or singled out — let go at once. */
  const anything = selection != null || marks.length > 0 || win != null || solo != null;
  const clearAll = () => {
    select(null); setMarks([]); setKeeper(null); setWin(null); setPlaying(false); setSolo(null);
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
    if (placing) setPlacing(false);
    else if (openAsset != null) setOpenAsset(null);
    else if (selection) select(null);
    else if (marks.length) { setMarks([]); setKeeper(null); }
    else if (solo != null) setSolo(null);
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
    if (selection?.kind === 'anchor') {
      const k = shown.findIndex((a) => a.id === selection.id);
      if (k < 0) return null;
      return {
        subject: {
          icon: AnchorIcon, name: shown[k].q || 'Anchor',
          caption: `${matches[k].direct.length.toLocaleString()} named · ${matches[k].related.length.toLocaleString()} related`,
          unit: 'annotations',
        },
        context: [anchorSpace === 'time' ? 'a lane through time' : anchorSpace === 'geo' ? 'on the map' : 'an anchor'],
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
      geoChoice.preset, timeChoice.source, selection, shown, matches, anchorSpace]);

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
          outlined={outlined}
          config={planeLook}
          spread={spread ? 3 : 1}
          drawn={!deep}
          backdrop={core === 'geo' ? <PlaneMap contrast={quiet ? 'high' : 'normal'} /> : undefined}
          onPointClick={onPointClick}
          onBackgroundClick={() => select(null)}
          onHover={setHover}
          onLayout={onLayout}
          onRunning={setRunning}
        >
          {deep && slices ? (
            <TimeDeck
              slice={slices}
              slices={cells.length}
              present={present}
              onStep={travel}
              visible={visible}
              colors={buffers.colors}
              sizes={buffers.sizes}
              emphasis={emphasis}
              pinned={pinned}
              onReady={setDeckApi}
              depth={deckView?.depth}
              ahead={deckView?.ahead}
              vanish={deckView?.vanish}
              anchors={shown}
              onPick={(i, e) => onPointClick(i, e)}
              onHover={setHover}
              onBackground={() => select(null)}
            />
          ) : (
            <>
              <PlaneLabels pinned={pinned} emphasis={hover ?? focused} />
              {stage && stageUnits && stageUnits.a !== stageUnits.b && (
                <PlaneLink from={stageUnits.a} to={stageUnits.b}
                           tone={stage.phase === 'judging' ? 'pending' : stage.decision.status === 'merged' ? 'joined' : 'apart'} />
              )}
            </>
          )}
        </CosmosPlane>
      )}

      {/* ── Anchors: dropping one, and the ones there are ──────────────── */}
      {surface && shown.length > 0 && (
        <PlaneAnchors
          surface={surface}
          anchors={shown}
          counts={anchorCounts}
          selected={selection?.kind === 'anchor' ? selection.id : null}
          onMove={(id, x, y) => editAnchor(id, { x, y })}
          onText={(id, q) => (q ? editAnchor(id, { q }) : removeAnchor(id))}
          onGain={(id, gain) => editAnchor(id, { gain })}
          onRemove={removeAnchor}
          onPick={(id) => select(selection?.kind === 'anchor' && selection.id === id ? null : { kind: 'anchor', id })}
        />
      )}
      {placing && surface && (
        <div className="absolute inset-0 z-[5] cursor-crosshair"
             onClick={(e) => {
               const r = e.currentTarget.getBoundingClientRect();
               const [x, y] = surface.unproject([e.clientX - r.left, e.clientY - r.top]);
               if (Number.isFinite(x) && Number.isFinite(y)) dropAnchor(x, y);
             }}>
          <span className={cn(HUD_GLASS, HUD_PROSE, 'pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 px-2 py-1 text-hud-dim')}>
            Click where the anchor goes · Esc to cancel
          </span>
        </div>
      )}

      {/* ── Top-left: what is drawn, how, and finding in it ──────────── */}
      <div className="pointer-events-none absolute inset-y-2 left-2 flex w-[272px] max-w-[calc(100%-1rem)] flex-col gap-1">
        <div className={cn(HUD_GLASS, 'pointer-events-auto space-y-1 p-1')}>
          <div className="flex items-center gap-1">
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
            <HudButton size="sm" icon={AnchorIcon} active={placing} disabled={!surface}
                       title={anchorSpace === 'time'
                         ? 'Drop an anchor — a lane: what its words name moves to its height, keeping its time'
                         : 'Drop an anchor — type a topic or a name, and what it names gathers there'}
                       onClick={() => setPlacing((p) => !p)} />
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
                  onClick={(e) => {
                    if (e.shiftKey && base.kind[i] === 0) toggleMark(base.id[i]);
                    else { goToBase(i); setFind(''); }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {base && core === 'groups' && (
          <RankCard className="pointer-events-auto max-h-[38%] @max-[640px]/network:hidden" title="Groups"
                    total={groups.length} unit="groups" items={groupItems} onPick={pickGroup}
                    highlighted={focused != null && view?.group[focused] ? view.group[focused] : null}
                    trailing={(item, active) => (
                      <GainSlot value={gainOf('group', item.id)} active={active}
                                onChange={(v) => setGainFor('group', item.id, v)} />
                    )} />
        )}
        {geography && (
          <RankCard className="pointer-events-auto max-h-[38%] @max-[640px]/network:hidden" title="Places"
                    total={geography.places.length} unit="places" items={placeItems} onPick={pickPlace}
                    highlighted={place ? String(place.coord) : null} />
        )}
        {timeline && windowNodes && (
          <RankCard className="pointer-events-auto max-h-[38%] @max-[640px]/network:hidden" title="In this window"
                    total={windowNodes.length} unit="nodes" items={windowItems}
                    onPick={(id, e) => (e.shiftKey ? toggleMark(id) : select({ kind: 'node', id }))}
                    marked={markSet}
                    highlighted={selection?.kind === 'node' ? selection.id : null}
                    trailing={(item, active) => (
                      <GainSlot value={gainOf('node', item.id)} active={active}
                                onChange={(v) => setGainFor('node', item.id, v)} />
                    )} />
        )}
        {base && (
          <RankCard
            className="pointer-events-auto min-h-0 flex-1 basis-0 @max-[640px]/network:hidden"
            title="Entities"
            total={base.size - counts.occurrences} unit="named" items={entityItems} onPick={pickEntity}
            marked={markSet}
            highlighted={selection?.kind === 'node' ? selection.id : null}
            trailing={(item, active) => (
              <GainSlot value={gainOf('node', item.id)} active={active}
                        onChange={(v) => setGainFor('node', item.id, v)} />
            )}
            actions={anything ? (
              <button type="button" onClick={clearAll} title="Let go of everything picked, marked or brushed (Esc)"
                      className={cn(HUD_NUM, 'inline-flex items-center gap-0.5 text-hud-dim hover:text-hud-fg')}>
                <X className="size-3" /> clear
              </button>
            ) : undefined}
            head={legend.length > 0 ? (
              <div className="flex flex-wrap items-center gap-0.5 px-1.5 pb-1">
                <button type="button" onClick={() => setAllTypes(allTypesOff)}
                        title={allTypesOff ? 'Every type back' : 'Every type off — then pick the ones to see'}
                        className={cn(HUD_NUM, 'rounded px-1 py-px text-hud-dim hover:bg-hud-sunken hover:text-hud-fg')}>
                  {allTypesOff ? 'all' : 'none'}
                </button>
                {(legendAll ? legend : legend.slice(0, 8)).map((t) => {
                  const off = hidden.has(t.name);
                  const g = gainOf('type', t.name);
                  return (
                    <span key={t.name} className="group/chip relative inline-flex max-w-full items-center">
                    <button type="button" onClick={() => toggleType(t.name)}
                            title={`${off ? 'Show' : 'Hide'} ${t.name} · ${t.count.toLocaleString()}`}
                            className={cn('inline-flex max-w-full items-center gap-1 rounded px-1 py-px text-[10.5px] leading-4',
                                          off ? 'text-hud-dimmer line-through' : 'text-hud-fg/85 hover:bg-hud-sunken')}>
                      <span className={cn('size-1.5 shrink-0 rounded-full', off && 'opacity-30',
                                          !typeColoured && 'bg-hud-line-strong')}
                            style={typeColoured ? { background: resolveEntityColor(t.name) } : undefined} />
                      <span className="truncate">{t.name}</span>
                      <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{compact(t.count)}</span>
                    </button>
                    {!off && (
                      <HudGain value={g} onChange={(v) => setGainFor('type', t.name, v)}
                               title={`Turn ${t.name} up or down`}
                               className={cn('w-8', g === 0 && cn(HUD_GLASS,
                                 'absolute left-1 top-full z-10 hidden px-1 group-hover/chip:inline-flex focus-visible:inline-flex'))} />
                    )}
                    </span>
                  );
                })}
                {legend.length > 8 && (
                  <button type="button" onClick={() => setLegendAll((a) => !a)}
                          className={cn(HUD_NUM, 'rounded px-1 py-px text-hud-dim hover:text-hud-fg')}>
                    {legendAll ? 'fewer' : `+${legend.length - 8}`}
                  </button>
                )}
                <span aria-hidden className="mx-0.5 h-3 w-px bg-hud-line" />
                <Chip on={showOccurrences} icon={showOccurrences ? Eye : EyeOff}
                      label={compact(counts.occurrences)}
                      title={`${counts.occurrences.toLocaleString()} occurrences — the acts and rows that connect entities`}
                      onClick={() => setView({ occurrences: !showOccurrences })} />
                <Chip on={showIsolated} icon={Unlink}
                      label={compact(counts.isolated)}
                      title={`${counts.isolated.toLocaleString()} unconnected — mentioned, never related`}
                      onClick={() => setView({ isolated: !showIsolated })} />
              </div>
            ) : undefined}
            footer={marks.length > 0 ? (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-0.5">
                  {marks.map((id) => {
                    const l = label(id);
                    if (!l) return null;
                    const isKept = id === kept;
                    return (
                      <button key={id} type="button" onClick={() => setKeeper(id)}
                              title={isKept ? 'The merged entity carries this name' : 'Keep this name instead'}
                              className={cn('max-w-full truncate rounded px-1 py-px text-[10.5px]',
                                            isKept ? 'bg-hud-sunken font-medium text-hud-fg' : 'text-hud-dim hover:text-hud-fg')}>
                        {l.name}<span className="ml-1 text-hud-dimmer">{l.type}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <span className={cn(HUD_PROSE, 'min-w-0 flex-1 truncate text-hud-dimmer')}>
                    {marks.length < 2 ? 'Shift-click another to merge with it' : 'Merged into the highlighted name'}
                  </span>
                  <HudButton size="sm" icon={X} title="Unmark all" className="h-6 border-transparent px-1"
                             onClick={() => { setMarks([]); setKeeper(null); }} />
                  <HudButton size="sm" icon={Merge} active disabled={marks.length < 2} className="h-6 px-1.5"
                             title="Merge them — a decision like the resolver's, in its history and undone the same way"
                             onClick={() => { void mergeMarks(); }}>
                    Merge {marks.length > 1 ? marks.length : ''}
                  </HudButton>
                </div>
              </div>
            ) : undefined}
          />
        )}
      </div>

      {/* ── Top-right: of how many ─────────────────────────────────────── */}
      {!drilling && (
        <section className={cn(HUD_GLASS, 'absolute right-2 top-2 w-[176px] px-2.5 py-2 @max-[520px]/network:hidden')}>
          <div className="flex items-baseline justify-between">
            <span className={cn(HUD_LABEL, 'text-hud-dim')}>
              {core === 'time' ? (deep ? 'Deep in time' : 'Over time') : core === 'geo' ? 'On the map' : 'Network'}
            </span>
            <HudLiveDot status={stream.status} live={!!stream.frame?.run.live} />
          </div>
          <div className="mt-1 text-[20px] font-light leading-none tracking-tight text-hud-fg tabular-nums">
            {base ? base.size.toLocaleString() : '—'}
            <span className={cn(HUD_LABEL, 'ml-1.5 align-middle text-hud-dimmer')}>nodes</span>
          </div>
          {base && net && (
            <div className="mt-2 space-y-1">
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
          <HudSegmented size="sm" className="mt-2 w-full"
                        value={config.max_nodes ? String(config.max_nodes) : 'all'}
                        onChange={(v) => setConfig({ max_nodes: v === 'all' ? null : Number(v) })}
                        options={BUDGETS} />
        </section>
      )}

      {/* ── Top-centre: the resolver's ticker ───────────────────────────── */}
      {raw && (
        <ResolverTicker
          className={cn('absolute left-1/2 top-2 z-10 -translate-x-1/2 @max-[760px]/network:hidden',
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

      {/* ── Bottom-left, deep in time: the colour key ──────────────────── */}
      {deep && streams.length > 0 && (
        <section className={cn(HUD_GLASS, 'absolute bottom-2 left-[284px] w-[220px] p-1 @max-[900px]/network:hidden')}>
          <div className="flex items-center gap-1 px-1 pb-0.5">
            <span className={cn(HUD_LABEL, 'flex-1 text-hud-dim')}>{deepColor === 'types' ? 'Types' : 'Streams'}</span>
            <HudSegmented size="sm" value={deepColor}
                          onChange={(color) => setView({ color })}
                          options={[
                            { value: 'groups', label: 'Groups', title: 'Colour by group — each a stream through time' },
                            { value: 'types', label: 'Types', title: 'Colour by type' },
                          ]} />
          </div>
          <div className="max-h-[220px] overflow-y-auto [scrollbar-width:thin]">
            {streams.map((t) => {
              const on = solo == null || solo === t.key;
              return (
                <div key={t.key} className="group/row flex items-center gap-1">
                  <button type="button" onClick={() => setSolo(solo === t.key ? null : t.key)}
                          title={solo === t.key ? 'Show every stream' : `Single out ${t.name}`}
                          className={cn('flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-px text-left hover:bg-hud-sunken',
                                        !on && 'opacity-40')}>
                    <span className="h-2.5 w-1 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="min-w-0 flex-1 truncate text-[11px] leading-[18px] text-hud-fg">{t.name}</span>
                    <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{compact(t.count)}</span>
                  </button>
                  <GainSlot value={gainOf(t.gain.kind, t.gain.key)} active={solo === t.key}
                            onChange={(v) => setGainFor(t.gain.kind, t.gain.key, v)} />
                </div>
              );
            })}
            {deepColor === 'groups' && groups.length > GROUP_HUES.length && (
              <p className={cn(HUD_NUM, 'px-1 pt-0.5 text-hud-dimmer')}>
                {(groups.length - GROUP_HUES.length).toLocaleString()} smaller groups in grey
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Bottom: when, in the time view ─────────────────────────────── */}
      {timeline && timeline.bins.length > 0 && (
        <TimeStrip
          className={cn(
            'absolute bottom-2 left-1/2 w-[min(560px,calc(100%-1rem))] -translate-x-1/2',
            drilling && '@min-[900px]/network:left-[calc(50%-80px)] @min-[900px]/network:w-[min(520px,calc(100%-760px))]',
          )}
          bins={timeline.bins}
          grain={timeline.grain}
          undated={timeline.undated}
          outside={timeline.outside}
          window={win ?? (deep && cells.length ? [cells[present[0]], cells[present[1]]] : null)}
          onWindow={(w) => { setWin(w); setPlaying(false); }}
          unit="nodes"
          actions={(
            <HudButton size="sm" icon={playing ? Pause : Play}
                       title={playing ? 'Stop' : 'Play — step the window through time, naming what is in it'}
                       className="h-5 border-transparent px-1"
                       onClick={() => {
                         if (!playing && !win && cells.length) {
                           const k = deep ? present[0] : 0;
                           setWin([cells[k], cells[k]]);
                         }
                         setPlaying((p) => !p);
                       }} />
          )}
        />
      )}

      {/* ── Bottom-right: camera and layout ───────────────────────────── */}
      {net && (
        <div className="absolute bottom-2 @max-[640px]/network:hidden"
             style={{ right: drilling ? DRILL_W + 12 : 8 }}>
          <HudGroup size="sm" className="flex-col divide-x-0 divide-y bg-hud-surface backdrop-blur-xl">
            <HudButton icon={Plus} title="Zoom in"
                       onClick={() => (deep ? deckApi?.zoomBy(1.6) : plane.current?.zoomBy(1.6))} />
            <HudButton icon={Minus} title="Zoom out"
                       onClick={() => (deep ? deckApi?.zoomBy(1 / 1.6) : plane.current?.zoomBy(1 / 1.6))} />
            <HudButton icon={Scan} title="Frame everything"
                       onClick={() => (deep ? deckApi?.frame() : plane.current?.fit())} />
            {deep && (
              <DeepControls
                value={{ ...DECK_DEFAULTS, ...deckView }}
                onChange={(v) => setDeckView(v)}
                onReset={() => setDeckView(null)}
              />
            )}
            <HudButton icon={Expand} active={spread}
                       title={spread ? 'Let the layout draw back together' : 'Spread — pull nodes and hubs apart so their names can be read'}
                       onClick={() => setView({ spread: !spread })} />
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
        <div className={cn(HUD_GLASS, 'pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1')}>
          <span className={cn(HUD_NUM, 'text-hud-dim')}>
            Building{stream.elapsedMs ? ` · ${Math.round(stream.elapsedMs / 1000)}s` : '…'}
          </span>
        </div>
      )}
      {resolution.error && (
        <div className={cn(HUD_GLASS, 'pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 px-2.5 py-1')}>
          <span className={cn(HUD_PROSE, 'text-rose-600 dark:text-rose-400')}>{resolution.error}</span>
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

/** A toggle among the type chips: on, or struck through. */
function Chip({
  on, icon: Icon, label, title, onClick,
}: { on: boolean; icon: React.ElementType; label: string; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={title}
            className={cn(HUD_NUM, 'inline-flex items-center gap-0.5 rounded px-1 py-px',
                          on ? 'text-hud-dim hover:bg-hud-sunken hover:text-hud-fg' : 'text-hud-dimmer line-through hover:text-hud-dim')}>
      <Icon className="size-3" />
      {label}
    </button>
  );
}

/** A gain beside a list row: out of the way until the row is hovered, picked,
 *  or already turned. */
function GainSlot({ value, active, onChange }: { value: number; active: boolean; onChange: (v: number) => void }) {
  return (
    <HudGain value={value} onChange={onChange}
             className={cn('transition-[width,opacity] duration-150',
                           value !== 0 || active
                             ? 'w-10 opacity-100'
                             : 'w-0 opacity-0 group-hover/row:w-10 group-hover/row:opacity-100 focus-visible:w-10 focus-visible:opacity-100')} />
  );
}
