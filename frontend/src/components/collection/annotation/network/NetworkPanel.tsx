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
 *   top-left      query · Time · Geo · anchor, then the builder — finding a
 *                 node, or gathering a set — then the sets, and the lists:
 *                 groups, places, the window, and the labels — types,
 *                 occurrences and the unconnected as chips over the entities;
 *                 shift-click marks labels to merge by hand, or to gather
 *
 * Sets (`plane/sets`) are the reader's own groups, built in the builder from
 * anything the network knows and from the documents' annotation values. A set
 * can be picked (highlighted, its documents opened), shown alone with the
 * other sets shown alone, lit with its direct links, turned up or down, and
 * placed as an anchor in any view. Light (`plane/light`) is the same for any
 * row — a node, a group, a type — and stays on for as many as the reader
 * wants.
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
  Activity, Anchor as AnchorIcon, Boxes, CircleDot, Clock, Contrast, Expand, Eye, EyeOff, Flame, Focus, Frame, Layers,
  MapPin, Maximize2, Merge, Minimize2, Minus, Pause, Play, Plus, Scan, Spline, Unlink, Waypoints, X,
} from 'lucide-react';
import type { GraphConfig } from '@cosmos.gl/graph';
import { NetworkService, RunsService, type AnnotationSchemaRead } from '@/client';
import { cn } from '@/lib/utils';
import {
  HUD_GLASS, HUD_INPUT, HUD_LABEL, HUD_NUM, HUD_PROSE, HUD_SURFACE, HudButton, HudGain, HudGroup, HudLiveDot,
  HudSegmented, HudStat,
} from '@/components/ui/chrome';
import { resolveEntityColor } from '@/lib/annotations/colors';
import { resolveVarToRgba, useThemeVersion } from '@/lib/theme/cssColor';
import type { NetworkView, NetworkVizConfig, PanelConfig } from '@/lib/annotations/types';
import type { TimeWindow } from '@/lib/overview/derive';
import { useSurfaceCommands } from '@/hooks/useSurfaceCommands';
import { useBarTarget } from '@/lib/commandBar';
import { useNetwork } from '@/hooks/useNetwork';
import { useAssetPages } from '@/hooks/useAssetPages';
import { useResolution } from '@/hooks/useResolution';
import {
  CosmosPlane, DECK_DEFAULTS, GROUP_HUES, PlaneAnchors, PlaneLabels, PlaneLink, PlaneMap, RUNG_PRESETS, SPACE_SIZE,
  TimeDeck, addTerm, anchored, annotationsOf, applyGain, around, byGroups, describeSet, evaluateSets, fromWords,
  gainStops, hexToRgba, joinLight, lightOf, loudest, newSetId, setGain, setHue, spaceOf, toggleLight, unitStops,
  withAnchors,
  type AnchorMark, type DeckApi, type Gain, type GainKind, type Light, type LightKind, type NodeSet, type Pull,
  type Surface, type TermKind,
  byPlace, byTime, cellOf, collapse, degree, expandedKeys, expansionOf, findNodes, groupPath, headsOf,
  groupsAt, groupColors, identity, inheritFrom, keyIndex, linkArrows, linkColors, linkStrength, linkWidths, merge,
  nodeKey,
  linksOf, louvain, membersOf, neighbours, nodeTimes, pointColors, pointSizes, positionsById,
  publishedAt, topLevel, topRanks, typeCounts, visibility,
  annotationsWhen, ownIn, presenceOf, presentIn, sliceSpan,
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
import { StackPicker } from './StackPicker';
import { SetBuilder, type TermPick } from './SetBuilder';
import { RowTools, ToolButton } from './RowTools';
import { fieldsOf, placesOf, type Catalog, type FieldOption } from './suggest';
import { useValueTerms } from './useValueTerms';
import { networkTarget } from './barTarget';

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
/** An anchor pulls its most frequent members firmly, up to this many. */
const PULL_LIMIT = 2000;
/** Among groups, a set shown alone is drawn node by node, up to this many. */
const LOOSE_LIMIT = 5000;

/** Where each panel's nodes last were, by id, for a remount. */
const LAYOUTS = new Map<string, Map<string, [number, number]>>();

type Core = NonNullable<NetworkView['core']>;
type Span = NonNullable<TimeWindow>;
type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'place'; coord: number }
  | { kind: 'set'; id: string }
  | null;
const NO_GAINS: Gain[] = [];
const NO_LIGHTS: Light[] = [];

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

/** How a time cell reads, at the timeline's grain. */
const cellFormat = (grain: Grain) => (grain === 'year' ? 'yyyy'
  : grain === 'day' || grain === 'week' ? 'd MMM yy' : 'MMM yyyy');

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
  const slicing = deep && (config.view?.slicer ?? false);

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

  // A group is named by its head — its most frequent member — wherever the
  // reader keeps it (a set, a gain, a light): community numbers mean nothing
  // once the network is clustered again; the head is found in its new group.
  const groupOfNode = useMemo(() => {
    const out = new Int32Array(base?.size ?? 0).fill(-1);
    groups.forEach((g, k) => { for (const i of g.members) out[i] = k; });
    return out;
  }, [base, groups]);
  const headOf = useCallback((g: { members: number[] }) => base?.id[g.members[0]] ?? '', [base]);
  const groupByHead = useCallback((head: string) => {
    const i = base?.index.get(head);
    return i === undefined ? undefined : groups[groupOfNode[i]];
  }, [base, groups, groupOfNode]);

  // ── Sets: groups the reader makes ─────────────────────────────────────────
  // Built from anything the network knows and the documents' values
  // (`plane/sets`); anchored in a view's space, they gather what they hold.
  const anchorSpace = spaceOf(core, deep);
  const savedSets = useMemo<NodeSet[]>(() => (config.view?.sets as NodeSet[] | undefined)
    ?? (config.view?.anchors ?? []).map(fromWords), [config.view?.sets, config.view?.anchors]);
  const [sets, setSets] = useDraft<NodeSet[]>(savedSets, (sets) => setView({ sets, anchors: undefined }));
  const editSet = (id: string, patch: Partial<NodeSet>) => setSets(sets.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  // What a set holds depends on its terms alone — not where it is anchored,
  // so dragging an anchor does not read the network again.
  const definitionKey = JSON.stringify(sets.map((x) => [x.id, x.terms]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const definitions = useMemo(() => sets.map((x) => ({ id: x.id, terms: x.terms })), [definitionKey]);
  const allTerms = useMemo(() => definitions.flatMap((d) => d.terms), [definitions]);
  const valueTerms = useValueTerms({ infospaceId, runId, terms: allTerms, version: stream.shownKey });
  const setResults = useMemo(() => (base ? evaluateSets(definitions, {
    net: base,
    groupMembers: (head) => groupByHead(head)?.members,
    valueAssets: valueTerms.lookup,
  }) : new Map<string, { members: number[]; pending: boolean }>()), [base, definitions, groupByHead, valueTerms.lookup]);
  const membersOfSet = useCallback((id: string) => setResults.get(id)?.members, [setResults]);
  const hueOf = useCallback((id: string) => setHue(Math.max(0, sets.findIndex((x) => x.id === id))), [sets]);

  // Placed in this view's space: firmly its members, lightly what they link
  // to — of the types that are drawn.
  const reach = useMemo(() => {
    const out = new Map<string, { direct: number[]; related: number[] }>();
    if (!base) return out;
    const off = base.types.map((t) => hidden.has(t || 'unknown'));
    const drawn = (i: number) => !off[base.type[i]];
    for (const x of definitions) {
      const direct = (setResults.get(x.id)?.members ?? []).filter(drawn).slice(0, PULL_LIMIT);
      out.set(x.id, { direct, related: around(base, direct).filter(drawn) });
    }
    return out;
  }, [base, definitions, setResults, hidden]);
  const pulls = useMemo<Pull[]>(() => sets.flatMap((x) => {
    const at = x.at?.[anchorSpace];
    const r = reach.get(x.id);
    return at && r ? [{ space: anchorSpace, x: at[0], y: at[1], gain: x.gain ?? 0, ...r }] : [];
  }), [sets, anchorSpace, reach]);
  // Shown alone: the plane narrows to these sets' members, together.
  const alone = useMemo(() => {
    const ids = sets.filter((x) => x.only).map((x) => x.id);
    if (!ids.length) return null;
    const out = new Set<number>();
    for (const id of ids) for (const i of setResults.get(id)?.members ?? []) out.add(i);
    return out;
  }, [sets, setResults]);
  // Among groups, what an anchor pulls or a set shows alone is drawn as
  // itself, so it can move and be read.
  const loose = useMemo(() => {
    if (core !== 'groups' || (!pulls.length && !alone)) return undefined;
    const out = anchored(pulls);
    if (alone && alone.size <= LOOSE_LIMIT) alone.forEach((i) => out.add(i));
    return out;
  }, [core, pulls, alone]);

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
  // Deep time reads the run as a space-time cube: every time a node is there,
  // not only its first (`plane/presence`). Its cells are the deck's slices and
  // the strip's bars; the flat timeline keeps one time per node.
  const presence = useMemo(
    () => (deep && timeline && net ? presenceOf(net, timeChoice.source, timeline.grain) : null),
    [deep, timeline, net, timeChoice.source]);
  const bins = useMemo(() => presence?.bins ?? timeline?.bins ?? [], [presence, timeline]);
  const cells = useMemo(() => bins.map((b) => b.t), [bins]);

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
    () => (viewArrangement && view ? withAnchors(viewArrangement, view, pulls) : viewArrangement),
    [viewArrangement, view, pulls]);
  /** Drawn units the anchors pull — on the map, brought into the view. */
  const pulledUnits = useMemo(() => {
    if (!view || !pulls.length) return null;
    const out = new Set<number>();
    for (const p of pulls) { p.direct.forEach((i) => out.add(view.unitOf[i])); p.related.forEach((i) => out.add(view.unitOf[i])); }
    return out;
  }, [view, pulls]);

  // ── Gain: types, entities and groups turned up or down ────────────────────
  const [gains, setGains] = useDraft<Gain[]>(
    (config.view?.gains as Gain[] | undefined) ?? NO_GAINS, (gains) => setView({ gains }));
  const gainOf = useCallback(
    (kind: GainKind, key: string) => gains.find((g) => g.kind === kind && g.key === key)?.value ?? 0, [gains]);
  const setGainFor = useCallback(
    (kind: GainKind, key: string, value: number) => setGains(setGain(gains, kind, key, value)), [gains, setGains]);
  const groupKeyOf = useCallback(
    (i: number) => (groupOfNode[i] >= 0 ? headOf(groups[groupOfNode[i]]) : null), [groupOfNode, groups, headOf]);
  const stops = useMemo(
    () => (base && view && gains.length ? unitStops(view, gainStops(base, gains, groupKeyOf, membersOfSet)) : null),
    [base, view, gains, groupKeyOf, membersOfSet]);

  // ── Light: rows kept lit with their direct links ──────────────────────────
  const [lights, setLights] = useDraft<Light[]>(
    (config.view?.lights as Light[] | undefined) ?? NO_LIGHTS, (lights) => setView({ lights }));
  const isLit = (kind: LightKind, key: string) => lights.some((l) => l.kind === kind && l.key === key);
  const light = (kind: LightKind, key: string) => setLights(toggleLight(lights, kind, key));
  const litParts = useMemo(() => {
    if (!view || !base) return [];
    return lights.map((l) => {
      let members: readonly number[] = [];
      if (l.kind === 'node') { const i = base.index.get(l.key); members = i === undefined ? [] : [i]; }
      else if (l.kind === 'group') members = groupByHead(l.key)?.members ?? [];
      else if (l.kind === 'set') members = setResults.get(l.key)?.members ?? [];
      else {
        const t = base.types.findIndex((x) => (x || 'unknown') === l.key);
        const out: number[] = [];
        for (let i = 0; i < base.size; i++) if (base.type[i] === t) out.push(i);
        members = out;
      }
      return { light: l, ...lightOf(view, members) };
    });
  }, [view, base, lights, groupByHead, setResults]);
  const lit = useMemo(() => joinLight(litParts), [litParts]);

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
    // A lit set wears its hue, so two lit at once can be told apart.
    for (const part of litParts) {
      if (part.light.kind !== 'set') continue;
      const [r, g, b] = hexToRgba(hueOf(part.light.key));
      for (const u of part.seeds) { colors[4 * u] = r; colors[4 * u + 1] = g; colors[4 * u + 2] = b; }
    }
    return {
      colors,
      sizes,
      linkColors: links,
      linkWidths: linkWidths(net),
      linkArrows: linkArrows(net),
      linkStrength: linkStrength(net),
    };
  }, [net, palette, core, rankOf, quiet, geography, deep, deepColor, stops, litParts, hueOf]);
  const planeLook = useMemo(() => ({
    ...planeConfig,
    pointGreyoutOpacity: quiet ? 0.03 : 0.12,
    linkGreyoutOpacity: quiet ? 0.005 : 0.04,
  }), [planeConfig, quiet]);

  const onLayout = useCallback((n: Network, positions: ArrayLike<number>) => {
    LAYOUTS.set(panel.id, positionsById(n, positions));
  }, [panel.id]);

  const showOccurrences = config.view?.occurrences !== false;
  // The unconnected are noise among groups — deep time is laid out by groups
  // too — and the point on a map or a flat timeline, so the default follows
  // the view until the reader says.
  const showIsolated = config.view?.isolated ?? (core !== 'groups' && !deep);
  const aloneUnits = useMemo(() => {
    if (!alone || !view) return null;
    const out = new Uint8Array(view.net.size);
    alone.forEach((i) => { out[view.unitOf[i]] = 1; });
    return out;
  }, [alone, view]);
  const visible = useMemo(() => {
    if (!net) return null;
    const v = visibility(net, hidden);
    const include = viewArrangement?.include;
    for (let i = 0; i < net.size; i++) {
      if (!showOccurrences && net.kind[i] === 1) v[i] = 0;
      if (!showIsolated && net.members[i] === 1 && degree(net, i) === 0) v[i] = 0;
      if (include && !include[i] && !pulledUnits?.has(i)) v[i] = 0;
      if (aloneUnits && !aloneUnits[i]) v[i] = 0;
    }
    return v;
  }, [net, hidden, showOccurrences, showIsolated, viewArrangement, pulledUnits, aloneUnits]);

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
    // Deep: whoever is there in the window, loudest there first.
    if (presence) {
      const [from, to] = sliceSpan(cells, win, timeline.grain);
      return from < 0 ? [] : presentIn(presence, from, to, visible);
    }
    const lo = cellOf(win[0], timeline.grain);
    const out: number[] = [];
    for (let i = 0; i < net.size; i++) {
      const c = timeline.cell[i];
      if (c >= lo && c <= win[1] && (!visible || visible[i])) out.push(i);
    }
    return out.sort(byFrequency(net));
  }, [net, timeline, win, visible, presence, cells]);

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
    if (selection?.kind === 'set') {
      const members = setResults.get(selection.id)?.members;
      if (!members || !view) return null;
      // Members are most frequent first, so their units are too.
      const units = [...new Set(members.map((i) => view.unitOf[i]))].filter((u) => !visible || visible[u]);
      const inSet = new Set(units);
      const links: number[] = [];
      for (let j = 0; j < net.links; j++) if (inSet.has(net.source[j]) && inSet.has(net.target[j])) links.push(j);
      const terms = definitions.find((d) => d.id === selection.id)?.terms;
      return {
        key: `set:${selection.id}:${JSON.stringify(terms)}`, nodes: units,
        highlight: { points: units, links }, named: units.slice(0, NAMED),
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
  }, [net, focused, place, windowNodes, win, selection, view, visible, setResults, definitions]);
  /** What is highlighted: the selection, and everything kept lit. */
  const highlight = useMemo(() => joinLight([subject?.highlight, lit]), [subject, lit]);


  // ── The resolver's group, on the network ──────────────────────────────────
  // The head linked to each member, ringed and named while it is judged and
  // for a moment after; a merge then folds a member into the head, and its
  // link has nothing to join.
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
  const stageLinks = useMemo(() => (stage?.decisions ?? []).flatMap((d) => {
    const a = drawnAt(d.a), b = drawnAt(d.b);
    if (a == null || b == null || a === b) return [];
    const tone = d.status === 'pending' ? 'pending' as const : d.status === 'merged' ? 'joined' as const : 'apart' as const;
    return [{ id: d.id, a, b, tone }];
  }), [stage, drawnAt]);
  const stageUnits = useMemo(() => [...new Set(stageLinks.flatMap((l) => [l.a, l.b]))], [stageLinks]);
  /** Select a decision's head and frame every label it weighed. */
  const focusDecisions = useCallback((ds: Array<{ a: { name: string; type: string }; b: { name: string; type: string } }>) => {
    const head = ds[0] ? drawnAt(ds[0].a) : null;
    if (head == null || !net) return;
    select({ kind: 'node', id: net.id[head] });
    const units = ds.flatMap((d) => [drawnAt(d.a), drawnAt(d.b)]).filter((i): i is number => i != null);
    plane.current?.frame([...new Set([head, ...units])]);
  }, [drawnAt, net, select]);

  const markSet = useMemo(() => new Set(marks), [marks]);
  const markUnits = useMemo(() => {
    if (!net) return [];
    return marks.map((id) => net.index.get(id)).filter((i): i is number => i !== undefined);
  }, [net, marks]);
  const pinned = useMemo(() => {
    const named = [...(subject?.named ?? [])];
    const loud = net && stops ? loudest(net, stops) : [];
    const litNames = litParts.flatMap((p) => (net ? [...p.seeds].sort(byFrequency(net)).slice(0, 6) : []));
    for (const i of [hover, ...stageUnits, ...markUnits, ...litNames, ...loud]) {
      if (i != null && !named.includes(i)) named.push(i);
    }
    return named;
  }, [subject, hover, stageUnits, markUnits, net, stops, litParts]);
  const outlined = useMemo(() => {
    const xs = [...markUnits, ...stageUnits];
    return xs.length ? xs : null;
  }, [markUnits, stageUnits]);

  // ── The documents behind it ───────────────────────────────────────────────
  const annotations = useMemo(() => {
    if (!net || !subject) return null;
    // Deep in time a window's actors are there for longer than it: its
    // documents are the ones in it, not every one they appear in.
    if (presence && timeline && win && subject.key.startsWith('window:')) {
      const from = cellOf(win[0], timeline.grain);
      return timeChoice.source === 'published'
        ? annotationsWhen(net, subject.nodes, timeline.grain, from, win[1])
        : annotationsOf(net, subject.nodes.filter((i) => ownIn(net, i, timeline.grain, from, win[1])));
    }
    return annotationsOf(net, subject.nodes);
  }, [net, subject, presence, timeline, win, timeChoice.source]);
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
  // A click on a pile — nodes drawn over one another — asks which one.
  const [stack, setStack] = useState<{ nodes: number[]; at: [number, number] } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setStack(null); }, [net, core, deep]);
  // The pile reads loudest first. A second click on it soon after acts on the
  // node on top, as a double-click would — a group still opens where it is.
  const openStack = (nodes: number[], e: MouseEvent, top: number) => {
    const now = performance.now();
    if (lastClick.current?.i === top && now - lastClick.current.at < DOUBLE_CLICK_MS) {
      setStack(null);
      pickNode(top);
      return;
    }
    lastClick.current = { i: top, at: now };
    const r = root.current?.getBoundingClientRect();
    if (!r || !net) return;
    const loud = [...nodes].sort((a, b) => net.frequency[b] - net.frequency[a]);
    setStack({ nodes: loud, at: [e.clientX - r.left, e.clientY - r.top] });
  };
  const onPointClick = (i: number, e?: MouseEvent) => {
    if (!net || !view) return;
    if (e?.shiftKey) {
      // A label, not a group: groups are the layout's, not the run's.
      if (!view.group[i] && net.kind[i] === 0) toggleMark(net.id[i]);
      return;
    }
    if (e && !deep) {
      const under = (plane.current?.stackAt(e.clientX, e.clientY) ?? []).filter((j) => !visible || visible[j]);
      if (under.length > 1) { openStack(under, e, i); return; }
    }
    pickNode(i);
  };
  const pickNode = (i: number) => {
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

  // ── Deep time: the present ────────────────────────────────────────────────
  // The present is the brushed window when there is one, else a single slice
  // the wheel moves; travelling with a window moves the window.
  const [front, setFront] = useState(0);
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
  /** Deep time's cut, named by its slice's time. */
  const slicer = useMemo(() => {
    if (!slicing || !timeline || !cells.length) return null;
    const fmt = cellFormat(timeline.grain);
    return { label: (k: number) => (cells[k] != null ? format(new Date(cells[k]), fmt) : '') };
  }, [slicing, timeline, cells]);

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
  /** Placing an anchor: a new set (`id` null), or one that exists. */
  const [placing, setPlacing] = useState<{ id: string | null } | null>(null);
  useEffect(() => { setPlacing(null); }, [anchorSpace]);
  const builderInput = useRef<HTMLInputElement>(null);
  const pickSet = useCallback((id: string) => {
    select({ kind: 'set', id });
    setTimeout(() => builderInput.current?.focus(), 0);
  }, [select]);
  const dropAnchor = (x: number, y: number) => {
    if (placing?.id) {
      const id = placing.id;
      setSets(sets.map((t) => (t.id === id ? { ...t, at: { ...t.at, [anchorSpace]: [x, y] } } : t)));
    } else {
      const id = newSetId();
      setSets([...sets, { id, terms: [], at: { [anchorSpace]: [x, y] } }]);
      pickSet(id);
    }
    setPlacing(null);
  };
  const unplace = (id: string) => {
    const t = sets.find((x) => x.id === id);
    if (!t) return;
    const at = { ...t.at };
    delete at[anchorSpace];
    editSet(id, { at });
  };
  /** A set gone — and with it its gain, its light, and every term naming it. */
  const removeSet = (id: string) => {
    setSets(sets.filter((x) => x.id !== id).map((x) => ({
      ...x,
      terms: x.terms
        .map((t) => (t.kind === 'set' ? { ...t, values: t.values.filter((v) => v !== id) } : t))
        .filter((t) => t.values.length),
    })));
    if (gains.some((g) => g.kind === 'set' && g.key === id)) setGains(setGain(gains, 'set', id, 0));
    if (isLit('set', id)) light('set', id);
    if (selection?.kind === 'set' && selection.id === id) select(null);
  };
  // A set with nothing in it lasts only while it is being built.
  useEffect(() => {
    const keep = selection?.kind === 'set' ? selection.id : null;
    if (sets.some((x) => !x.terms.length && x.id !== keep)) setSets(sets.filter((x) => x.terms.length || x.id === keep));
  }, [selection, sets, setSets]);

  // ── The builder: finding, and gathering sets ──────────────────────────────
  const activeSet = selection?.kind === 'set' ? sets.find((x) => x.id === selection.id) ?? null : null;
  const nameOf = useCallback((kind: TermKind, value: string, deeper = true): string => {
    if (kind === 'entity') { const i = base?.index.get(value); return i === undefined ? value : base!.name[i]; }
    if (kind === 'group') return groupByHead(value)?.label ?? value;
    if (kind === 'set') {
      const k = sets.findIndex((x) => x.id === value);
      if (k < 0) return 'a removed set';
      return deeper ? describeSet(sets[k], (kk, v) => nameOf(kk, v, false)) : sets[k].name ?? `set ${k + 1}`;
    }
    return value;
  }, [base, groupByHead, sets]);
  const setLabel = useCallback((x: NodeSet) => describeSet(x, (k, v) => nameOf(k, v)), [nameOf]);
  const newSet = () => {
    const id = newSetId();
    setSets([...sets, { id, terms: [] }]);
    pickSet(id);
  };
  /** Into the set being built — or, with none, a new set of it. */
  const gather = (term: TermPick['term'], apart = false) => {
    if (activeSet) { setSets(sets.map((x) => (x.id === activeSet.id ? addTerm(x, term, apart) : x))); return; }
    const id = newSetId();
    setSets([...sets, { id, terms: [term] }]);
    pickSet(id);
  };
  const onBuilderPick = (pick: TermPick, how: { apart: boolean; shift: boolean }) => {
    if (pick.node != null && base) {
      if (how.shift) { if (base.kind[pick.node] === 0) toggleMark(base.id[pick.node]); return; }
      if (!activeSet) { goToBase(pick.node); return; }
    }
    gather(pick.term, how.apart);
  };
  const fields = useMemo(() => fieldsOf(schemas), [schemas]);
  const placeList = useMemo(() => (base ? placesOf(base) : []), [base]);
  const loadValues = useCallback(async (field: FieldOption, search: string) => {
    const r = await RunsService.distinctValues({
      infospaceId, runId,
      requestBody: { field_path: field.path, search: search || null, limit: 40, merge_maps: (panel.merge_maps as any) ?? [] },
    });
    return r.items ?? [];
  }, [infospaceId, runId, panel.merge_maps]);

  const anchorMarks = useMemo<AnchorMark[]>(() => sets.flatMap((x) => {
    const at = x.at?.[anchorSpace];
    return at ? [{
      id: x.id, label: setLabel(x), hue: hueOf(x.id), count: setResults.get(x.id)?.members.length ?? 0,
      gain: x.gain ?? 0, lit: isLit('set', x.id), space: anchorSpace, x: at[0], y: at[1],
    }] : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sets, anchorSpace, setLabel, hueOf, setResults, lights]);
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
        key: r, name: g.label, count: g.size, color: GROUP_HUES[r], gain: { kind: 'group' as GainKind, key: headOf(g) },
      }));
  }, [deep, deepColor, legend, hidden, groups, headOf]);
  /** Deep: what is drawn at full strength — a focused node and its
   *  neighbours, or a stream singled out in the key. */
  const emphasis = useMemo(() => {
    if (!deep || !net) return null;
    // A window is the present itself, deep — the deck already lights it.
    const picked = focused != null || selection?.kind === 'set' ? subject?.highlight : null;
    const on = joinLight([picked, lit]);
    if (on) {
      const e = new Uint8Array(net.size);
      for (const i of on.points) e[i] = 1;
      return e;
    }
    if (solo == null) return null;
    const e = new Uint8Array(net.size);
    for (let i = 0; i < net.size; i++) e[i] = (deepColor === 'types' ? net.type[i] === solo : rankOf(i) === solo) ? 1 : 0;
    return e;
  }, [deep, net, focused, solo, deepColor, rankOf, selection, subject, lit]);

  const catalog = useMemo<Catalog | null>(() => (base ? {
    base,
    types: legend,
    groups: groups.map((g) => ({ key: headOf(g), label: g.label, size: g.size })),
    places: placeList,
    sets: sets.map((x) => ({ id: x.id, label: setLabel(x), count: setResults.get(x.id)?.members.length ?? 0 }))
      .filter((x) => x.id !== activeSet?.id),
    fields,
  } : null), [base, legend, groups, headOf, placeList, sets, setLabel, setResults, activeSet?.id, fields]);

  // The command bar, aimed here: the builder's search, and the views as
  // commands that take what it finds (`barTarget.ts`).
  useBarTarget(panel.id, networkTarget({
    label: panel.name || 'Network',
    catalog,
    loadValues,
    goTo: goToBase,
    addSet: (set) => { setSets([...sets, set]); select({ kind: 'set', id: set.id }); },
    setView,
    view: config.view,
  }));

  /** Everything picked, marked, brushed, lit or singled out — let go at once. */
  const anything = selection != null || marks.length > 0 || win != null || solo != null || lights.length > 0;
  const clearAll = () => {
    select(null); setMarks([]); setKeeper(null); setWin(null); setPlaying(false); setSolo(null);
    if (lights.length) setLights([]);
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
    if (placing) setPlacing(null);
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
    if (selection?.kind === 'set') {
      const x = sets.find((t) => t.id === selection.id);
      const r = setResults.get(selection.id);
      if (!x || !r) return null;
      return {
        subject: {
          icon: x.at?.[anchorSpace] ? AnchorIcon : Layers, name: setLabel(x),
          caption: `a set of ${r.members.length.toLocaleString()}${r.pending ? ' · reading values…' : ''}`,
          unit: 'annotations',
        },
        context: [x.at?.[anchorSpace] ? (anchorSpace === 'time' ? 'a lane through time' : anchorSpace === 'geo' ? 'anchored on the map' : 'anchored') : 'yours'],
        actions: (
          <HudButton size="sm" icon={Focus} active={!!x.only} className="-mr-1 border-transparent"
                     title={x.only ? 'Show everything again' : 'Show it alone — with any other set shown alone'}
                     onClick={() => editSet(x.id, { only: !x.only })} />
        ),
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
      const fmt = cellFormat(timeline.grain);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, view, subject, focused, place, win, timeline, communities, expanded, expand, fold, select,
      geoChoice.preset, timeChoice.source, selection, sets, setResults, setLabel, anchorSpace]);

  const drilling = drill != null;
  /** The canvas the panel's cards leave open. */
  const openCanvas = { left: 288, top: 8, right: drilling ? DRILL_W + 16 : 8, bottom: timeline ? 52 : 8 };
  const building = stream.status === 'building' || stream.status === 'connecting';

  return (
    <div ref={root} className="@container/network relative h-full min-h-[420px] w-full overflow-hidden bg-background"
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
          highlight={highlight}
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
          {deep && presence ? (
            <TimeDeck
              presence={presence}
              present={present}
              onStep={travel}
              visible={visible}
              colors={buffers.colors}
              sizes={buffers.sizes}
              emphasis={emphasis}
              pinned={pinned}
              featured={hover ?? focused}
              onReady={setDeckApi}
              depth={deckView?.depth}
              ahead={deckView?.ahead}
              vanish={deckView?.vanish}
              onVanish={(vanish) => setDeckView({ ...deckView, vanish })}
              anchors={anchorMarks}
              slicer={slicer}
              onCut={(k) => { if (cells[k] != null) { setWin([cells[k], cells[k]]); setPlaying(false); } }}
              inset={openCanvas}
              onPick={(i, e) => onPointClick(i, e)}
              onStack={openStack}
              onHover={setHover}
              onBackground={() => select(null)}
            />
          ) : (
            <>
              <PlaneLabels pinned={pinned} emphasis={hover ?? focused} />
              {stageLinks.map((l) => <PlaneLink key={l.id} from={l.a} to={l.b} tone={l.tone} />)}
            </>
          )}
        </CosmosPlane>
      )}

      {/* ── Anchors: dropping one, and the ones there are ──────────────── */}
      {surface && anchorMarks.length > 0 && (
        <PlaneAnchors
          surface={surface}
          anchors={anchorMarks}
          selected={selection?.kind === 'set' ? selection.id : null}
          inset={openCanvas}
          onMove={(id, x, y) => {
            const t = sets.find((z) => z.id === id);
            if (t) editSet(id, { at: { ...t.at, [anchorSpace]: [x, y] } });
          }}
          onGain={(id, gain) => editSet(id, { gain })}
          onLight={(id) => light('set', id)}
          onRemove={unplace}
          onPick={(id) => (selection?.kind === 'set' && selection.id === id ? select(null) : pickSet(id))}
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
            {(() => {
              const x = placing?.id ? sets.find((t) => t.id === placing.id) : null;
              return x ? `Click where “${setLabel(x)}” gathers` : 'Click where the anchor goes, then build its set';
            })()} · Esc to cancel
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
            <HudButton size="sm" icon={AnchorIcon} active={placing != null} disabled={!surface}
                       title={anchorSpace === 'time'
                         ? 'Drop an anchor — a lane: the set you build moves to its height, keeping its time'
                         : 'Drop an anchor — build a set in the bar below, and it gathers there'}
                       onClick={() => setPlacing((p) => (p ? null : { id: null }))} />
          </div>
          {draft !== (config.q ?? '') && (
            <p className={cn(HUD_PROSE, 'px-1 text-hud-dimmer')}>Enter to apply · Esc to discard</p>
          )}
          <SetBuilder
            active={activeSet}
            hue={activeSet ? hueOf(activeSet.id) : undefined}
            catalog={catalog}
            nameOf={nameOf}
            loadValues={loadValues}
            onTerms={(terms) => { if (activeSet) editSet(activeSet.id, { terms }); }}
            onPick={onBuilderPick}
            onEscape={() => { if (activeSet) select(null); }}
            inputRef={builderInput}
            disabled={!base}
          />
          {valueTerms.error && <p className={cn(HUD_PROSE, 'px-1 text-rose-600 dark:text-rose-400')}>{valueTerms.error}</p>}
        </div>

        {sets.length > 0 && (
          <section className={cn(HUD_GLASS, 'pointer-events-auto max-h-[30%] shrink-0 overflow-y-auto p-1 [scrollbar-width:thin]')}>
            <div className="flex items-center gap-1 px-1 pb-0.5">
              <span className={cn(HUD_LABEL, 'flex-1 text-hud-dim')}>Sets</span>
              {alone && (
                <button type="button" onClick={() => setSets(sets.map((x) => (x.only ? { ...x, only: false } : x)))}
                        title="Show everything again"
                        className={cn(HUD_NUM, 'inline-flex items-center gap-0.5 text-hud-dim hover:text-hud-fg')}>
                  <X className="size-3" /> alone
                </button>
              )}
              <ToolButton title="A new set — build it in the bar above" onClick={newSet}>
                <Plus className="size-3" />
              </ToolButton>
            </div>
            {sets.map((x) => (
              <SetRow
                key={x.id}
                set={x}
                label={setLabel(x)}
                hue={hueOf(x.id)}
                result={setResults.get(x.id)}
                picked={selection?.kind === 'set' && selection.id === x.id}
                placed={!!x.at?.[anchorSpace]}
                placing={placing?.id === x.id}
                canPlace={!!surface}
                lit={isLit('set', x.id)}
                onPick={() => (selection?.kind === 'set' && selection.id === x.id ? select(null) : pickSet(x.id))}
                onName={(name) => editSet(x.id, { name: name || undefined })}
                onAlone={() => editSet(x.id, { only: !x.only })}
                onPlace={() => (x.at?.[anchorSpace] ? unplace(x.id) : setPlacing({ id: x.id }))}
                onLight={() => light('set', x.id)}
                onGain={(v) => editSet(x.id, { gain: v || undefined })}
                onRemove={() => removeSet(x.id)}
              />
            ))}
          </section>
        )}

        {base && core === 'groups' && (
          <RankCard className="pointer-events-auto max-h-[38%] @max-[640px]/network:hidden" title="Groups"
                    total={groups.length} unit="groups" items={groupItems} onPick={pickGroup}
                    highlighted={focused != null && view?.group[focused] ? view.group[focused] : null}
                    trailing={(item, active) => {
                      const g = groups.find((x) => x.key === item.id);
                      const head = g ? headOf(g) : item.id;
                      return (
                        <RowTools active={active}
                                  onAdd={() => gather({ kind: 'group', op: '=', values: [head] })}
                                  lit={isLit('group', head)} onLight={() => light('group', head)}
                                  gain={gainOf('group', head)} onGain={(v) => setGainFor('group', head, v)} />
                      );
                    }} />
        )}
        {geography && (
          <RankCard className="pointer-events-auto max-h-[38%] @max-[640px]/network:hidden" title="Places"
                    total={geography.places.length} unit="places" items={placeItems} onPick={pickPlace}
                    highlighted={place ? String(place.coord) : null}
                    trailing={(item, active) => (
                      <RowTools active={active} addTitle="Gather what is placed here — into the set being built, or a new one"
                                onAdd={() => gather({ kind: 'place', op: '=', values: [item.name] })} />
                    )} />
        )}
        {timeline && windowNodes && (
          <RankCard className="pointer-events-auto max-h-[38%] @max-[640px]/network:hidden" title="In this window"
                    total={windowNodes.length} unit="nodes" items={windowItems}
                    onPick={(id, e) => (e.shiftKey ? toggleMark(id) : select({ kind: 'node', id }))}
                    marked={markSet}
                    highlighted={selection?.kind === 'node' ? selection.id : null}
                    trailing={(item, active) => (
                      <RowTools active={active}
                                onAdd={() => gather({ kind: 'entity', op: '=', values: [item.id] })}
                                lit={isLit('node', item.id)} onLight={() => light('node', item.id)}
                                gain={gainOf('node', item.id)} onGain={(v) => setGainFor('node', item.id, v)} />
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
              <RowTools active={active}
                        onAdd={() => gather({ kind: 'entity', op: '=', values: [item.id] })}
                        lit={isLit('node', item.id)} onLight={() => light('node', item.id)}
                        gain={gainOf('node', item.id)} onGain={(v) => setGainFor('node', item.id, v)} />
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
                    {!off && (g !== 0 || isLit('type', t.name)) && (
                      <span className="inline-flex items-center gap-px pr-0.5">
                        {isLit('type', t.name) && (
                          <ToolButton title="Let its links go dark" on onClick={() => light('type', t.name)}>
                            <Waypoints className="size-3" />
                          </ToolButton>
                        )}
                        {g !== 0 && <HudGain value={g} onChange={(v) => setGainFor('type', t.name, v)} className="w-8" />}
                      </span>
                    )}
                    {!off && (
                      <span className={cn(HUD_GLASS, 'absolute left-0 top-full z-10 hidden px-1 py-0.5 group-hover/chip:flex group-focus-within/chip:flex')}>
                        <RowTools active addTitle={`Gather every ${t.name} — into the set being built, or a new one`}
                                  onAdd={() => gather({ kind: 'type', op: '=', values: [t.name] })}
                                  lit={isLit('type', t.name)} onLight={() => light('type', t.name)}
                                  gain={g} onGain={(v) => setGainFor('type', t.name, v)} />
                      </span>
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
                  <HudButton size="sm" icon={Layers} className="h-6 px-1.5"
                             title="Gather them as a set — into the set being built, or a new one"
                             onClick={() => { gather({ kind: 'entity', op: '=', values: marks }); setMarks([]); setKeeper(null); }}>
                    Set
                  </HudButton>
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
          onFocus={focusDecisions}
          history={(
            <ResolverHistory
              count={Object.entries(resolution.state?.counts ?? {}).reduce((n, [k, v]) => n + (k === 'pending' ? 0 : v), 0)}
              items={resolution.history}
              total={resolution.historyTotal}
              load={(status, more) => { void resolution.loadHistory(status, more); }}
              onRollback={(id) => { void resolution.rollback(id); }}
              onChange={(id, body) => { void resolution.change(id, body); }}
              onFocus={focusDecisions}
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
                  <RowTools active={solo === t.key}
                            lit={isLit(t.gain.kind as LightKind, t.gain.key)}
                            onLight={() => light(t.gain.kind as LightKind, t.gain.key)}
                            gain={gainOf(t.gain.kind, t.gain.key)} onGain={(v) => setGainFor(t.gain.kind, t.gain.key, v)} />
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
      {timeline && bins.length > 0 && (
        <TimeStrip
          className={cn(
            'absolute bottom-2 left-1/2 w-[min(560px,calc(100%-1rem))] -translate-x-1/2',
            drilling && '@min-[900px]/network:left-[calc(50%-80px)] @min-[900px]/network:w-[min(520px,calc(100%-760px))]',
          )}
          bins={bins}
          total={presence?.present}
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
            {deep && (
              <HudButton icon={Frame} active={slicing}
                         title={slicing ? 'Take the cut away'
                           : 'Cut the deck at one instant — the streams passing through it; ⇧-scroll moves the cut through the window'}
                         onClick={() => setView({ slicer: !slicing })} />
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

      {/* ── A pile, asked about ─────────────────────────────────────────── */}
      {stack && net && buffers && (
        <StackPicker
          net={net}
          nodes={stack.nodes}
          at={stack.at}
          colorOf={(i) => {
            const c = buffers.colors;
            return `rgb(${Math.round(c[4 * i] * 255)} ${Math.round(c[4 * i + 1] * 255)} ${Math.round(c[4 * i + 2] * 255)})`;
          }}
          onPick={(i, { shift }) => {
            setStack(null);
            if (shift) { if (!view?.group[i] && net.kind[i] === 0) toggleMark(net.id[i]); }
            else pickNode(i);
          }}
          onHover={setHover}
          onClose={() => setStack(null)}
        />
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

/**
 * A set in the Sets card: its hue, its terms in a few words (double-click to
 * name it), how many it holds — and what it can do: shown alone, anchored in
 * this view, lit, turned up or down, removed.
 */
function SetRow({
  set, label, hue, result, picked, placed, placing, canPlace, lit,
  onPick, onName, onAlone, onPlace, onLight, onGain, onRemove,
}: {
  set: NodeSet;
  label: string;
  hue: string;
  result?: { members: number[]; pending: boolean };
  picked: boolean;
  placed: boolean;
  placing: boolean;
  canPlace: boolean;
  lit: boolean;
  onPick: () => void;
  onName: (name: string) => void;
  onAlone: () => void;
  onPlace: () => void;
  onLight: () => void;
  onGain: (v: number) => void;
  onRemove: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const reveal = (on: boolean) => (on || picked ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100');
  return (
    <div className={cn('group/row flex items-center gap-0.5 rounded px-1', picked ? 'bg-hud-sunken' : 'hover:bg-hud-sunken')}>
      <span aria-hidden className="h-2.5 w-1 shrink-0 rounded-full" style={{ background: hue }} />
      {naming ? (
        <input
          autoFocus
          defaultValue={set.name ?? ''}
          placeholder={label}
          onBlur={(e) => { onName(e.target.value.trim()); setNaming(false); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setNaming(false);
          }}
          className="h-[18px] min-w-0 flex-1 bg-transparent px-1 text-[11px] text-hud-fg outline-none placeholder:text-hud-dimmer"
        />
      ) : (
        <button type="button" onClick={onPick} onDoubleClick={() => setNaming(true)}
                title={`${label} — click to pick and edit, double-click to name`}
                className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left">
          <span className={cn('min-w-0 flex-1 truncate text-[11px] leading-[18px]', picked ? 'font-medium text-hud-fg' : 'text-hud-fg/85')}>
            {label}
          </span>
          <span className={cn(HUD_NUM, 'text-hud-dimmer')}>
            {result?.pending ? '…' : (result?.members.length ?? 0).toLocaleString()}
          </span>
        </button>
      )}
      <ToolButton title={set.only ? 'Show everything again' : 'Show it alone — with any other set shown alone'}
                  on={!!set.only} onClick={onAlone} className={reveal(!!set.only)}>
        <Focus className="size-3" />
      </ToolButton>
      {canPlace && (
        <ToolButton title={placed ? 'Take its anchor off this view' : placing ? 'Click the canvas to place it' : 'Anchor it in this view — what it holds gathers there'}
                    on={placed || placing} onClick={onPlace} className={reveal(placed || placing)}>
          <AnchorIcon className="size-3" />
        </ToolButton>
      )}
      <RowTools active={picked} lit={lit} onLight={onLight} gain={set.gain ?? 0} onGain={onGain} />
      <ToolButton title="Remove the set" onClick={onRemove} className={reveal(false)}>
        <X className="size-3" />
      </ToolButton>
    </div>
  );
}
