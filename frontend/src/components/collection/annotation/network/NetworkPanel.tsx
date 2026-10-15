'use client';

/**
 * NetworkPanel — a run's whole graph, laid out and drawn on the GPU.
 *
 * The knowledge-graph panel's graph (same engine, same query language) for
 * runs too large for a canvas renderer: tens of thousands of nodes, every one
 * of them on screen, laid out by cosmos.gl's GPU simulation. The data arrives
 * as columns over the network stream (`hooks/useNetwork`) and stays live while
 * the run can change.
 *
 *   top-left      the query, and finding a node in what it returned
 *   top-right     of how many — or, once a node is open, the assets behind it
 *   bottom-left   the legend: types, and whether occurrences are drawn
 *   bottom-right  the camera and the layout
 *
 * Clicking a node opens the documents that produced it — the same drill
 * column the overview opens for a place — and lights up its neighbourhood.
 * Everything a node *is* beyond its name and links (its evidence, its places,
 * its properties) is read there, from the assets, not shipped up front.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleDot, Eye, EyeOff, Flame, Minus, Pause, Play, Plus, Scan, Search, Spline,
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
import type { NetworkVizConfig, PanelConfig } from '@/lib/annotations/types';
import { useSurfaceCommands } from '@/hooks/useSurfaceCommands';
import { useNetwork } from '@/hooks/useNetwork';
import { useAssetPages } from '@/hooks/useAssetPages';
import {
  CosmosPlane, PlaneLabels, annotationsOf, degree, findNodes, linkArrows, linkColors,
  linkStrength, linkWidths, linksOf, neighbours, pointColors, pointSizes, positionsById,
  typeCounts, visibility, type Network, type Palette, type PlaneHandle, type Rgba,
} from '@/components/collection/graph/plane';
import { DRILL_W, DrillColumn } from '../drill/DrillColumn';

const DEFAULT_CONFIG: NetworkVizConfig = {
  kind: 'network', q: null, max_nodes: null, hidden_types: [], view: { occurrences: true },
};

const BUDGETS: Array<{ value: string; label: string; title: string }> = [
  { value: 'all', label: 'All', title: 'Every node the query returns' },
  { value: '20000', label: '20k', title: 'The 20,000 most frequent nodes' },
  { value: '5000', label: '5k', title: 'The 5,000 most frequent nodes' },
];

/** Neighbours named around an open node — beyond these, the highlight says it. */
const NAMED_NEIGHBOURS = 24;

/** Where each panel's nodes last were, by node id — so a reopened panel, or a
 *  query that keeps most of the graph, keeps its shape. Per panel, per session. */
const LAYOUTS = new Map<string, Map<string, [number, number]>>();

const toUnit = ([r, g, b, a]: [number, number, number, number]): Rgba => [r / 255, g / 255, b / 255, a / 255];

function useTheme() {
  const version = useThemeVersion();
  return useMemo(() => {
    const fg = toUnit(resolveVarToRgba('--hud-fg', [40, 40, 40, 255]));
    const palette: Palette = {
      edge: toUnit(resolveVarToRgba('--graph-edge-stroke', [153, 153, 153, 255])),
      occurrence: toUnit(resolveVarToRgba('--hud-dim', [120, 120, 120, 200])),
    };
    const config: GraphConfig = {
      hoveredPointRingColor: fg,
      focusedPointRingColor: fg,
    };
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

  const stream = useNetwork({
    infospaceId, runId,
    q: config.q,
    maxNodes: config.max_nodes,
    mergeMaps: panel.merge_maps as any,
  });
  const network = stream.network;
  const plane = useRef<PlaneHandle>(null);
  const { palette, config: planeConfig } = useTheme();

  // ── What the GPU reads ────────────────────────────────────────────────────
  const buffers = useMemo(() => network && {
    colors: pointColors(network, palette),
    sizes: pointSizes(network),
    linkColors: linkColors(network, palette),
    linkWidths: linkWidths(network),
    linkArrows: linkArrows(network),
    linkStrength: linkStrength(network),
  }, [network, palette]);

  // Where this panel's nodes last were, so a remounted panel keeps its shape.
  // (A live replacement keeps it on its own — the plane seeds from the layout
  // it is replacing.)
  const onLayout = useCallback((net: Network, positions: ArrayLike<number>) => {
    LAYOUTS.set(panel.id, positionsById(net, positions));
  }, [panel.id]);

  const hidden = useMemo(() => new Set(config.hidden_types ?? []), [config.hidden_types]);
  const showOccurrences = config.view?.occurrences !== false;
  const visible = useMemo(() => {
    if (!network) return null;
    const v = visibility(network, hidden);
    if (!showOccurrences) for (let i = 0; i < network.size; i++) if (network.kind[i] === 1) v[i] = 0;
    return v;
  }, [network, hidden, showOccurrences]);

  // ── What is open ──────────────────────────────────────────────────────────
  // By id, not index: a live run replaces the network and renumbers it.
  const [focus, setFocusState] = useState<string | null>(null);
  const [openAsset, setOpenAsset] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const setFocus = useCallback((id: string | null) => {
    setFocusState(id);
    setOpenAsset(null);
  }, []);
  const focused = network && focus != null ? network.index.get(focus) ?? null : null;

  const around = useMemo(() => {
    if (!network || focused == null) return null;
    const near = neighbours(network, focused);
    return {
      near,
      highlight: { points: [focused, ...near], links: linksOf(network, [focused]) },
      named: [focused, ...[...near].sort((a, b) => network.frequency[b] - network.frequency[a]).slice(0, NAMED_NEIGHBOURS)],
    };
  }, [network, focused]);
  const pinned = useMemo(
    () => (hover != null && !around?.named.includes(hover) ? [...(around?.named ?? []), hover] : around?.named ?? []),
    [around, hover],
  );

  /** Open a node and bring it, with its neighbourhood, into view. */
  const goTo = useCallback((i: number) => {
    if (!network) return;
    setFocus(network.id[i]);
    plane.current?.frame([i, ...neighbours(network, i)]);
  }, [network, setFocus]);

  // ── The assets behind the open node ───────────────────────────────────────
  const annotations = useMemo(
    () => (network && focused != null ? annotationsOf(network, [focused]) : null),
    [network, focused],
  );
  const pages = useAssetPages(
    annotations && focus ? `network:${infospaceId}:${runId}:${stream.shownKey}:${focus}` : null,
    (offset, limit) => NetworkService.networkAssets({
      infospaceId, runId, requestBody: { annotations: annotations!, offset, limit },
    }),
  );

  // ── The query ─────────────────────────────────────────────────────────────
  // A proposal (the companion's, or "show in graph" from a list) lands in the
  // field and waits for Enter — the writer proposes, a person commits.
  const [draft, setDraft] = useState(config.q ?? '');
  useEffect(() => { setDraft(config.q ?? ''); }, [config.q]);
  const commit = () => {
    const q = draft.trim() || null;
    if (q !== (config.q ?? null)) setConfig({ q });
  };

  const [find, setFind] = useState('');
  const found = useMemo(() => (network ? findNodes(network, find) : []), [network, find]);

  useSurfaceCommands('graph', {
    query: (p) => setDraft(String(p?.q ?? '')),
    focus: (p) => {
      const name = String(p?.name ?? '').trim();
      const hit = network && name ? findNodes(network, name, 1)[0] : undefined;
      if (hit != null) goTo(hit);
    },
    clearQuery: () => setConfig({ q: null }),
  });

  // ── Legend ────────────────────────────────────────────────────────────────
  const legend = useMemo(() => {
    if (!network) return [];
    const counts = typeCounts(network);
    // Occurrence types are drawn in the tissue tone, whatever their type —
    // the legend lists the nouns.
    const entityTypes = new Set<number>();
    for (let i = 0; i < network.size; i++) if (network.kind[i] === 0) entityTypes.add(network.type[i]);
    return [...entityTypes]
      .map((t) => ({ name: network.types[t] || 'unknown', count: counts[t] }))
      .sort((a, b) => b.count - a.count);
  }, [network]);
  const [legendAll, setLegendAll] = useState(false);
  const toggleType = (name: string) => {
    const next = new Set(hidden);
    if (next.has(name)) next.delete(name); else next.add(name);
    setConfig({ hidden_types: [...next] });
  };
  const occurrenceCount = useMemo(() => {
    if (!network) return 0;
    let n = 0;
    for (let i = 0; i < network.size; i++) n += network.kind[i];
    return n;
  }, [network]);

  // ── Camera & layout ───────────────────────────────────────────────────────
  const [running, setRunning] = useState(true);
  const toggleLayout = () => {
    if (running) plane.current?.pause();
    else plane.current?.reheat(0.3);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (openAsset != null) setOpenAsset(null);
    else if (focus) setFocus(null);
    else return;
    e.stopPropagation();
  };

  const drilling = focused != null;
  const building = stream.status === 'building' || stream.status === 'connecting';

  return (
    <div className="@container/network relative h-full min-h-[420px] w-full overflow-hidden bg-background"
         onKeyDown={onKeyDown}>
      {network && buffers && (
        <CosmosPlane
          ref={plane}
          className={cn('absolute inset-0 transition-opacity duration-300', stream.stale && 'opacity-60')}
          network={network}
          layout={LAYOUTS.get(panel.id)}
          buffers={buffers}
          visible={visible}
          highlight={around?.highlight ?? null}
          focused={focused}
          config={planeConfig}
          onPointClick={(i) => setFocus(focus === network.id[i] ? null : network.id[i])}
          onBackgroundClick={() => setFocus(null)}
          onHover={setHover}
          onLayout={onLayout}
          onRunning={setRunning}
        >
          <PlaneLabels pinned={pinned} emphasis={hover ?? focused} />
        </CosmosPlane>
      )}

      {/* ── Top-left: what is drawn, and finding a node in it ─────────── */}
      <div className="pointer-events-none absolute left-3 top-3 flex w-[300px] max-w-[calc(100%-1.5rem)] flex-col gap-2">
        <div className={cn(HUD_SURFACE, 'pointer-events-auto space-y-1.5 rounded-lg p-1.5')}>
          <label className="relative block">
            <Spline className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-hud-dimmer" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(config.q ?? ''); }}
              placeholder='Query — type:Person after:2024 from:"…"'
              spellCheck={false}
              className={cn(HUD_INPUT, 'h-7 w-full border pl-6 pr-2 font-mono text-[11px] outline-none',
                            draft !== (config.q ?? '') && 'border-hud-line-strong')}
            />
          </label>
          {draft !== (config.q ?? '') && (
            <p className={cn(HUD_PROSE, 'px-1 text-hud-dimmer')}>Enter to apply · Esc to discard</p>
          )}
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-hud-dimmer" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && found[0] != null) { goTo(found[0]); setFind(''); }
                if (e.key === 'Escape') setFind('');
              }}
              placeholder="Find a node"
              disabled={!network}
              className={cn(HUD_INPUT, 'h-7 w-full border pl-6 pr-2 text-[11px] outline-none')}
            />
          </label>
          {find && network && (
            <div className="max-h-56 overflow-y-auto">
              {found.length === 0 && <p className={cn(HUD_PROSE, 'px-2 py-1 text-hud-dimmer')}>No node by that name.</p>}
              {found.map((i) => (
                <HudOption
                  key={i}
                  label={network.name[i]}
                  hint={`${network.types[network.type[i]] || 'unknown'} · ${degree(network, i).toLocaleString()} links`}
                  trailing={<span className={cn(HUD_NUM, 'text-hud-dimmer')}>{network.frequency[i].toLocaleString()}</span>}
                  onClick={() => { goTo(i); setFind(''); }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Top-right: of how many ─────────────────────────────────────── */}
      {!drilling && (
        <section className={cn(HUD_SURFACE, 'absolute right-3 top-3 w-[188px] rounded-lg px-3 py-2.5 @max-[520px]/network:hidden')}>
          <div className="flex items-baseline justify-between">
            <span className={cn(HUD_LABEL, 'text-hud-dim')}>Network</span>
            <HudLiveDot status={stream.status} live={!!stream.frame?.run.live} />
          </div>
          <div className="mt-1 text-[22px] font-light leading-none tracking-tight text-hud-fg tabular-nums">
            {network ? network.size.toLocaleString() : '—'}
            <span className={cn(HUD_LABEL, 'ml-1.5 align-middle text-hud-dimmer')}>nodes</span>
          </div>
          {network && (
            <div className="mt-2.5 space-y-1.5">
              <HudStat label="links" value={network.links.toLocaleString()} />
              <HudStat label="entities" value={(network.size - occurrenceCount).toLocaleString()} />
              <HudStat label="occurrences" value={occurrenceCount.toLocaleString()} />
              <HudStat label="built in" value={network.buildMs >= 1000 ? `${Math.round(network.buildMs / 1000)}s` : `${network.buildMs}ms`} />
              {network.capped && (
                <p className={cn(HUD_PROSE, 'text-hud-dimmer')}>The most frequent {network.size.toLocaleString()} only.</p>
              )}
            </div>
          )}
          <HudSegmented
            size="sm"
            className="mt-2.5 w-full"
            value={config.max_nodes ? String(config.max_nodes) : 'all'}
            onChange={(v) => setConfig({ max_nodes: v === 'all' ? null : Number(v) })}
            options={BUDGETS}
          />
        </section>
      )}

      {/* ── Right: the assets behind the open node, then one of them ──── */}
      {drilling && network && (
        <DrillColumn
          subject={{
            icon: CircleDot,
            name: network.name[focused],
            caption: network.types[network.type[focused]] || 'node',
            unit: 'annotations',
          }}
          context={[`${degree(network, focused).toLocaleString()} links`, `${around?.near.length.toLocaleString() ?? 0} neighbours`]}
          pages={pages}
          openAsset={openAsset}
          onOpenAsset={setOpenAsset}
          onClose={() => setFocus(null)}
          infospaceId={infospaceId}
          runId={runId}
          schemas={schemas}
        />
      )}

      {/* ── Bottom-left: legend ────────────────────────────────────────── */}
      {network && legend.length > 0 && (
        <section className={cn(HUD_SURFACE, 'absolute bottom-3 left-3 w-[220px] max-w-[calc(100%-1.5rem)] rounded-lg p-1.5 @max-[640px]/network:hidden')}>
          <div className={cn('max-h-[220px] overflow-y-auto [scrollbar-width:thin]')}>
            {(legendAll ? legend : legend.slice(0, 8)).map((t) => {
              const off = hidden.has(t.name);
              return (
                <button key={t.name} type="button" onClick={() => toggleType(t.name)}
                        title={off ? `Show ${t.name}` : `Hide ${t.name}`}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-hud-sunken">
                  <span className={cn('size-2 shrink-0 rounded-full', off && 'opacity-25')}
                        style={{ background: resolveEntityColor(t.name) }} />
                  <span className={cn('min-w-0 flex-1 truncate text-[11px]', off ? 'text-hud-dimmer line-through' : 'text-hud-fg')}>
                    {t.name}
                  </span>
                  <span className={cn(HUD_NUM, 'text-hud-dimmer')}>{t.count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-hud-line px-1.5 pt-1.5">
            <button type="button" onClick={() => setConfig({ view: { ...config.view, occurrences: !showOccurrences } })}
                    className={cn(HUD_NUM, 'flex items-center gap-1.5 text-hud-dim hover:text-hud-fg')}
                    title="Occurrences are the acts and rows that connect entities">
              {showOccurrences ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              {occurrenceCount.toLocaleString()} occurrences
            </button>
            {legend.length > 8 && (
              <button type="button" onClick={() => setLegendAll((a) => !a)}
                      className={cn(HUD_NUM, 'text-hud-dim hover:text-hud-fg')}>
                {legendAll ? 'fewer' : `+${legend.length - 8} types`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Bottom-right: camera and layout ───────────────────────────── */}
      {network && (
        <div className="absolute bottom-3 @max-[640px]/network:hidden"
             style={{ right: drilling ? DRILL_W + 20 : 12 }}>
          <HudGroup size="sm" className="flex-col divide-x-0 divide-y bg-hud-surface backdrop-blur-xl">
            <HudButton icon={Plus} title="Zoom in" onClick={() => plane.current?.zoomBy(1.6)} />
            <HudButton icon={Minus} title="Zoom out" onClick={() => plane.current?.zoomBy(1 / 1.6)} />
            <HudButton icon={Scan} title="Frame everything" onClick={() => plane.current?.fit()} />
            <HudButton icon={running ? Pause : Play} title={running ? 'Hold the layout' : 'Let the layout run'}
                       onClick={toggleLayout} />
            <HudButton icon={Flame} title="Shake the layout up" onClick={() => plane.current?.reheat(0.8)} />
          </HudGroup>
        </div>
      )}

      {/* ── States ─────────────────────────────────────────────────────── */}
      {(!network || stream.error) && (
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
      {network && stream.stale && (
        <div className={cn(HUD_SURFACE, 'pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md px-2.5 py-1')}>
          <span className={cn(HUD_NUM, 'text-hud-dim')}>
            Building{stream.elapsedMs ? ` · ${Math.round(stream.elapsedMs / 1000)}s` : '…'}
          </span>
        </div>
      )}
      {network && network.size === 0 && !stream.stale && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn(HUD_SURFACE, 'max-w-[320px] rounded-lg px-4 py-3 text-center')}>
            <p className={cn(HUD_PROSE, 'text-hud-dim')}>
              {config.q ? 'Nothing in this run matches the query.' : 'No graph yet — first results will appear here as they arrive.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
