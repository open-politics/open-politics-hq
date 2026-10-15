'use client';

/**
 * The overview — a run's front door.
 *
 * A map at the centre and the analytics around it, on glass: who the run is
 * about, where, when, and of how many. It draws buckets, never rows, so it
 * opens fast on any size of run, and it keeps listening while the run fills.
 *
 *   ┌ mode · sections · reading ─────────────────────── assets · rows ┐
 *   │ ENTITIES                                         placed · dated │
 *   │ PLACES                     ◉   ○                                │
 *   │                         ○    ◉◉                          + −    │
 *   │                 ▁▂▅▇▅▂▁  when  ▁▂                                │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Three readings of the same buckets — Assets, Rows, Sections — switch on the
 * client with no fetch. How each section is placed and dated is inferred
 * (`annotation/bindings.py`) and can be overridden in the Reading popover;
 * that override, the mode and the chosen sections persist on the panel.
 *
 * **Opening a count.** A place (marker or list) or an entity opens the assets
 * behind it top-right, in the stats card's corner; an asset opens beneath it
 * as the asset manager's detail view. An entity also narrows the whole
 * reading (`within`) — the map shows where it is spoken of, the lists who and
 * what appear beside it — until its chip is cleared. `Esc` closes from the
 * top down: the asset, the list, the narrowing.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { MapPin, Minus, Plus, Scan, UserRound, X } from 'lucide-react';
import type { AnnotationSchemaRead } from '@/client';
import type { PickingInfo } from '@deck.gl/core';
import { cn } from '@/lib/utils';
import {
  HUD_LABEL, HUD_NUM, HUD_PROSE, HUD_SURFACE, HudButton, HudChip, HudGroup, HudLiveDot, HudSegmented,
  HudStat,
} from '@/components/ui/chrome';
import { GeoCanvas, type GeoCanvasHandle } from '@/components/collection/geo/GeoCanvas';
import { useOverview } from '@/hooks/useOverview';
import { useOverviewAssets, type OverviewFocus } from '@/hooks/useOverviewAssets';
import {
  activeSections, boundsOf, cellTimes, clampBins, histogram, isDocumentSection, markers,
  sectionLabel, sectionTotals, unlocatedCount, type Marker, type TimeWindow,
} from '@/lib/overview/derive';
import type { BindingPick, OverviewMode } from '@/lib/overview/types';
import type { OverviewVizConfig, PanelConfig } from '@/lib/annotations/types';
import { resolveVarToRgba, useThemeVersion } from '@/lib/theme/cssColor';
import { overviewLayers, type OverviewInk } from './layers';
import { RankCard, type RankItem } from './RankCard';
import { TimeStrip } from './TimeStrip';
import { ReadingPopover } from './ReadingPopover';
import { DRILL_W, DrillColumn } from '../drill/DrillColumn';

const DEFAULT_CONFIG: OverviewVizConfig = {
  kind: 'overview', mode: 'assets', sections: [], bindings: {},
};

const MODES: Array<{ value: OverviewMode; label: string; title: string }> = [
  { value: 'assets', label: 'Assets', title: 'Documents, by the places they speak of' },
  { value: 'rows', label: 'Rows', title: 'Every extracted row, across all sections' },
  { value: 'sections', label: 'Sections', title: 'Rows of the sections you choose' },
];

/** Room the HUD takes on each side, so framing keeps data out from under it. */
const PAD = { top: 64, right: 200, bottom: 104, left: 300 };
/** The drill column's width — the list, and the asset beneath it. */

function useInk(): OverviewInk {
  const version = useThemeVersion();
  return useMemo(() => ({
    fg: resolveVarToRgba('--hud-fg', [40, 40, 40, 255]),
    dim: resolveVarToRgba('--hud-dim', [40, 40, 40, 150]),
    halo: resolveVarToRgba('--background', [255, 255, 255, 255]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [version]);
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function OverviewPanel({
  panel, infospaceId, runId, schemas, onUpdatePanel,
}: {
  panel: PanelConfig;
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  onUpdatePanel: (updates: Partial<PanelConfig>) => void;
}) {
  const config: OverviewVizConfig = {
    ...DEFAULT_CONFIG,
    ...((panel.panel_config as OverviewVizConfig | undefined) ?? {}),
  };
  const setConfig = useCallback((patch: Partial<OverviewVizConfig>) => {
    onUpdatePanel({ panel_config: { ...config, ...patch } as any });
  }, [config, onUpdatePanel]);

  // What is open: the entity the reading is narrowed to, the place or entity
  // whose assets are listed, the asset opened from that list. Identities, not
  // indices — a narrowed reading renumbers every place.
  const [within, setWithin] = useState<{ id: string; name: string } | null>(null);
  const [focus, setFocusState] = useState<OverviewFocus | null>(null);
  const [openAsset, setOpenAsset] = useState<number | null>(null);
  const setFocus = useCallback((f: OverviewFocus | null) => {
    setFocusState(f);
    setOpenAsset(null);
  }, []);

  const ov = useOverview({
    infospaceId, runId,
    bindings: config.bindings,
    mergeMaps: panel.merge_maps as any,
    within: within?.id ?? null,
  });
  const { frame, plan, buckets, entities } = ov;

  const [win, setWin] = useState<TimeWindow>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; m: Marker } | null>(null);
  const [unlocatedOpen, setUnlocatedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const canvas = useRef<GeoCanvasHandle>(null);
  const ink = useInk();

  // ── Readings ───────────────────────────────────────────────────────────
  const times = useMemo(() => (buckets ? cellTimes(buckets) : []), [buckets]);
  const chosen = useMemo(() => new Set(config.sections), [config.sections]);
  const sections = useMemo(
    () => (buckets ? activeSections(buckets, config.mode, chosen) : new Set<number>()),
    [buckets, config.mode, chosen],
  );
  const ms = useMemo(
    () => (buckets ? markers(buckets, config.mode, sections, win, times) : []),
    [buckets, config.mode, sections, win, times],
  );
  const notLocated = useMemo(
    () => (buckets ? unlocatedCount(buckets, config.mode, sections, win, times) : 0),
    [buckets, config.mode, sections, win, times],
  );
  const strip = useMemo(() => {
    if (!buckets) return { bins: [], undated: 0, outside: 0 };
    const h = histogram(buckets, config.mode, sections, times);
    const c = clampBins(h.bins, buckets.extent);
    return { bins: c.bins, undated: h.undated, outside: c.outside };
  }, [buckets, config.mode, sections, times]);
  const totals = useMemo(
    () => (buckets ? sectionTotals(buckets, sections) : { rows: 0, placed: 0, dated: 0 }),
    [buckets, sections],
  );
  // GeoCanvas frames these once per `fitKey` (run + reading) — never again
  // because data moved underneath a reader.
  const fit = useMemo(() => boundsOf(ms), [ms]);

  const unit = config.mode === 'assets' ? 'assets' : 'rows';

  const placeIndex = useMemo(
    () => new Map((buckets?.places.id ?? []).map((id, i) => [id, i])),
    [buckets],
  );
  const selected = focus?.kind === 'place' ? placeIndex.get(focus.id) ?? null : null;

  // ── The list behind what was clicked — cut from this very reading ──────
  const drill = useOverviewAssets({
    infospaceId, runId, focus,
    bindings: config.bindings as Record<string, BindingPick>,
    mergeMaps: panel.merge_maps as any,
    within: within?.id ?? null,
    sections: config.mode === 'assets' || !buckets
      ? null : [...sections].map((i) => buckets.sections[i].key),
    window: win && buckets
      ? { start: new Date(win[0]).toISOString(), end: new Date(win[1]).toISOString(), grain: buckets.grain }
      : null,
  });
  const drillContext = useMemo(() => {
    const out: string[] = [];
    if (within && !(focus?.kind === 'entity' && focus.id === within.id)) out.push(`with ${within.name}`);
    if (win) {
      const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
      out.push(win[0] === win[1] ? fmt(win[0]) : `${fmt(win[0])} – ${fmt(win[1])}`);
    }
    return out;
  }, [within, focus, win]);

  // ── Interaction ────────────────────────────────────────────────────────
  const onHover = useCallback((info: PickingInfo<Marker>) => {
    setHovered(info.object ? info.object.p : null);
    setTip(info.object ? { x: info.x, y: info.y, m: info.object } : null);
  }, []);
  const onClick = useCallback((info: PickingInfo<Marker>) => {
    const m = info.object;
    if (!m || !buckets) return;
    const id = buckets.places.id[m.p];
    setFocus(focus?.kind === 'place' && focus.id === id ? null : { kind: 'place', id, name: m.name });
  }, [buckets, focus, setFocus]);

  const layers = useMemo(() => overviewLayers({
    markers: ms, ink, hovered, selected, labels: 10, onHover, onClick,
  }), [ms, ink, hovered, selected, onHover, onClick]);

  const placeItems: RankItem[] = useMemo(() => ms.slice(0, 60).map((m) => ({
    id: buckets!.places.id[m.p],
    name: m.name,
    count: m.total,
    canon: buckets?.places.entry[m.p] != null,
    hint: [
      m.row ? `${m.row.toLocaleString()} stated here` : null,
      m.doc ? `${m.doc.toLocaleString()} by their document` : null,
      buckets?.spellings[String(m.p)] ? `also: ${buckets.spellings[String(m.p)].join(', ')}` : null,
    ].filter(Boolean).join(' · '),
  })), [ms, buckets]);

  const entityItems: RankItem[] = useMemo(() => (entities?.items ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    count: e.assets,
    canon: e.entry_id != null,
    hint: [e.type, `${e.mentions.toLocaleString()} mentions`,
           e.spellings ? `also: ${e.spellings.join(', ')}` : null].filter(Boolean).join(' · '),
  })), [entities]);

  const pickPlace = (id: string) => {
    const p = placeIndex.get(id);
    const m = ms.find((x) => x.p === p);
    if (focus?.kind === 'place' && focus.id === id) { setFocus(null); return; }
    setFocus({ kind: 'place', id, name: m?.name ?? id });
    if (m) canvas.current?.flyTo(m.lon, m.lat);
  };

  // An entity is a question about the whole run: where is it spoken of, and
  // beside whom. So it narrows the reading as well as opening its list.
  const pickEntity = (id: string) => {
    const e = entities?.items.find((x) => x.id === id);
    if (!e) return;
    if (within?.id === id) {
      setWithin(null);
      if (focus?.kind === 'entity') setFocus(null);
      return;
    }
    setWithin({ id, name: e.name });
    setFocus({ kind: 'entity', id, name: e.name });
  };
  const clearWithin = () => {
    if (focus?.kind === 'entity' && focus.id === within?.id) setFocus(null);
    setWithin(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (openAsset != null) setOpenAsset(null);
    else if (focus) setFocus(null);
    else if (within) setWithin(null);
    else return;
    e.stopPropagation();
  };

  const sectionChips = (buckets?.sections ?? []).filter((s) => !isDocumentSection(s.key) || buckets!.sections.length === 1);
  const toggleSection = (key: string) => {
    const next = new Set(config.sections);
    if (next.has(key)) next.delete(key); else next.add(key);
    setConfig({ sections: [...next] });
  };

  // Narrowed, the run's own total would be the wrong denominator: each asset
  // sits in exactly one asset-time cell, so the narrowed total is their sum.
  const assetTotal = within && buckets
    ? buckets.asset_time.reduce((n, [, c]) => n + c, 0)
    : frame?.totals.assets ?? null;
  const drilling = focus != null;

  const loading = !buckets;
  const empty = buckets && frame && frame.totals.annotations === 0;
  const unplaceable = buckets && !empty && buckets.places.id.length === 0 && buckets.unlocated.total === 0;

  return (
    <div className="@container/overview relative h-full min-h-[420px] w-full overflow-hidden bg-background"
         onKeyDown={onKeyDown}>
      <GeoCanvas
        ref={canvas}
        layers={layers}
        fitBounds={fit}
        fitKey={fit ? `${runId}:${config.mode}:${JSON.stringify(config.bindings)}` : null}
        padding={PAD}
        className={cn('absolute inset-0 transition-opacity duration-300', ov.stale && 'opacity-60')}
      />

      {/* ── Top-left: how we read, then who and where ─────────────────── */}
      <div className="pointer-events-none absolute inset-y-3 left-3 flex w-[272px] max-w-[calc(100%-1.5rem)] flex-col gap-2">
        <div className={cn(HUD_SURFACE, 'pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-lg p-1.5')}>
          <HudSegmented size="sm" value={config.mode} onChange={(mode) => setConfig({ mode })}
                        options={MODES} />
          <ReadingPopover plan={plan} picks={config.bindings as Record<string, BindingPick>}
                          onChange={(bindings) => setConfig({ bindings })} />
          {within && (
            <HudChip active onClick={clearWithin} title={`Showing only assets that name ${within.name} — clear`}
                     className="max-w-full normal-case tracking-normal">
              <UserRound className="size-3 shrink-0" />
              <span className="truncate">{within.name}</span>
              <X className="size-3 shrink-0 opacity-60" />
            </HudChip>
          )}
          {config.mode === 'sections' && sectionChips.length > 0 && (
            <div className="flex w-full flex-wrap gap-1 pt-0.5">
              {sectionChips.map((s) => (
                <HudChip key={s.key} active={chosen.has(s.key)} onClick={() => toggleSection(s.key)}
                         title={`${s.rows.toLocaleString()} rows · ${pct(s.placed, s.rows)}% placed`}>
                  {sectionLabel(plan, s.key)}
                </HudChip>
              ))}
            </div>
          )}
        </div>

        <RankCard
          className="pointer-events-auto max-h-[38%] @max-[640px]/overview:hidden"
          title="Entities"
          total={entities?.total ?? null}
          unit="named"
          items={entityItems}
          highlighted={within?.id ?? null}
          onPick={pickEntity}
          collapsed={collapsed.entities}
          onToggle={() => setCollapsed((c) => ({ ...c, entities: !c.entities }))}
        />
        <RankCard
          className="pointer-events-auto min-h-0 flex-1 basis-0"
          title="Places"
          total={buckets ? buckets.places.id.length + buckets.unlocated.total : null}
          unit="places"
          items={unlocatedOpen
            ? (buckets?.unlocated.items ?? []).map((u) => ({
                id: u.id, name: u.name, count: u.rows, muted: true, canon: u.entry != null,
                hint: u.geo ? 'in the geo canon, not located yet' : 'not located',
              }))
            : placeItems}
          highlighted={focus?.kind === 'place' ? focus.id
            : hovered != null ? buckets?.places.id[hovered] ?? null : null}
          onHover={unlocatedOpen ? undefined : (id) => setHovered(id == null ? null : placeIndex.get(id) ?? null)}
          onPick={unlocatedOpen ? undefined : pickPlace}
          collapsed={collapsed.places}
          onToggle={() => setCollapsed((c) => ({ ...c, places: !c.places }))}
          footer={buckets && buckets.unlocated.total > 0 && (
            <button type="button" onClick={() => setUnlocatedOpen((o) => !o)}
                    className={cn(HUD_NUM, 'flex w-full items-center justify-between text-hud-dim hover:text-hud-fg')}>
              <span>
                {unlocatedOpen ? 'Back to located places'
                  : `${buckets.unlocated.total.toLocaleString()} not located · ${notLocated.toLocaleString()} ${unit}`}
              </span>
              <span aria-hidden>{unlocatedOpen ? '←' : '→'}</span>
            </button>
          )}
        />
      </div>

      {/* ── Top-right: of how many ─────────────────────────────────────── */}
      {!drilling && (
      <section className={cn(HUD_SURFACE, 'absolute right-3 top-3 w-[176px] rounded-lg px-3 py-2.5 @max-[520px]/overview:hidden')}>
        <div className="flex items-baseline justify-between">
          <span className={cn(HUD_LABEL, 'text-hud-dim')}>Run</span>
          <HudLiveDot status={ov.status} live={!!frame?.run.live} />
        </div>
        <div className="mt-1 text-[22px] font-light leading-none tracking-tight text-hud-fg tabular-nums">
          {assetTotal != null ? assetTotal.toLocaleString() : '—'}
          <span className={cn(HUD_LABEL, 'ml-1.5 align-middle text-hud-dimmer')}>assets</span>
        </div>
        <div className="mt-2.5 space-y-1.5">
          <HudStat label="rows" value={totals.rows.toLocaleString()} />
          <HudStat label="placed" value={`${pct(totals.placed, totals.rows)}%`} meter={totals.placed / (totals.rows || 1)} />
          <HudStat label="dated" value={`${pct(totals.dated, totals.rows)}%`} meter={totals.dated / (totals.rows || 1)} />
          {frame && frame.totals.failed > 0 && !within && (
            <HudStat label="failed" value={frame.totals.failed.toLocaleString()} />
          )}
        </div>
      </section>
      )}

      {/* ── Right: the assets behind what was clicked, then one of them ── */}
      {focus && (
        <DrillColumn
          subject={focus.kind === 'place'
            ? { icon: MapPin, name: focus.name, caption: 'assets placed here', unit: 'rows placing it here' }
            : { icon: UserRound, name: focus.name, caption: 'assets naming them', unit: 'mentions' }}
          context={drillContext}
          pages={drill}
          openAsset={openAsset}
          onOpenAsset={setOpenAsset}
          onClose={() => setFocus(null)}
          infospaceId={infospaceId}
          runId={runId}
          schemas={schemas}
        />
      )}

      {/* ── Bottom: when ───────────────────────────────────────────────── */}
      {buckets && (
        <TimeStrip
          className={cn(
            'absolute bottom-3 left-1/2 w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2 @min-[900px]/overview:left-[calc(50%+136px)]',
            // Centred in what the drill column leaves, not under it.
            drilling && '@min-[900px]/overview:left-[calc(50%-64px)] @min-[900px]/overview:w-[min(560px,calc(100%-760px))]',
          )}
          bins={strip.bins}
          grain={buckets.grain}
          undated={strip.undated}
          outside={strip.outside}
          window={win}
          onWindow={setWin}
          unit={unit}
        />
      )}

      {/* ── Bottom-right: camera ───────────────────────────────────────── */}
      <div className="absolute bottom-3 @max-[640px]/overview:hidden"
           style={{ right: drilling ? DRILL_W + 20 : 12 }}>
        <HudGroup size="sm" className="flex-col divide-x-0 divide-y bg-hud-surface backdrop-blur-xl">
          <HudButton icon={Plus} title="Zoom in" onClick={() => canvas.current?.zoomBy(1)} />
          <HudButton icon={Minus} title="Zoom out" onClick={() => canvas.current?.zoomBy(-1)} />
          <HudButton icon={Scan} title="Frame everything"
                     onClick={() => { const b = boundsOf(ms); if (b) canvas.current?.fit(b); }} />
        </HudGroup>
      </div>

      {/* ── Hover ──────────────────────────────────────────────────────── */}
      {tip && (
        <div
          className={cn(HUD_SURFACE, 'pointer-events-none absolute z-10 rounded-md px-2.5 py-1.5')}
          style={{ left: tip.x + 14, top: tip.y + 10 }}
        >
          <div className="text-[12px] font-medium text-hud-fg">{tip.m.name}</div>
          <div className={cn(HUD_NUM, 'text-hud-dim')}>
            {tip.m.total.toLocaleString()} {unit}
            {tip.m.row > 0 && tip.m.doc > 0 && ` · ${tip.m.row.toLocaleString()} stated here`}
            {tip.m.row === 0 && ' · by their document'}
          </div>
        </div>
      )}

      {/* ── States ─────────────────────────────────────────────────────── */}
      {(loading || empty || unplaceable || ov.error) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn(HUD_SURFACE, 'pointer-events-auto max-w-[320px] rounded-lg px-4 py-3 text-center')}>
            <p className={cn(HUD_PROSE, 'text-hud-dim')}>
              {ov.error ? `The overview could not be read: ${ov.error}`
                : loading ? (frame
                  ? `Reading ${frame.totals.annotations.toLocaleString()} results…`
                  : 'Opening the run…')
                : empty ? 'First results will appear here as they arrive.'
                : 'No places found in these results. Pick the field that holds them under Reading.'}
            </p>
            {ov.error && (
              <HudButton size="sm" className="mt-2" onClick={ov.refresh}>Try again</HudButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
