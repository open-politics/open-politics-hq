'use client';

/**
 * Surface — one router, five pure renderers.
 *
 * The HUD used to have one pane component per finding: `InterestPane`,
 * `ItemsPane`, `LanesPane`, `RegionPane`, `EvidencePane`, with `MethodsPane`
 * and `StancePane` planned. That is the same over-specification the folds had,
 * one level up — every new question wanted a new component, and a component is
 * a thing you have to write, review and keep.
 *
 * The collapse: **a query returns a surface, and the surface's shape picks the
 * renderer.** What was a component becomes a query.
 *
 * ```
 *   today's ask        is                        not
 *   ───────────────    ───────────────────────   ───────────
 *   Interests pane     list BY interest          a component
 *   Methods pane       list BY motif             a component
 *   Stance pane        matrix BY actor, interest a component
 *   Lanes              lanes BY place            a fixed enum
 *   Region pane        map BY place              a component
 *   Evidence pane      list, scoped to selection a component
 *   Node info          detail, WHERE node = X    a component
 *   Activity bar       lanes with arity 0        a component
 * ```
 *
 * **This is a router, not a god component.** The dispatch is a switch; each
 * renderer is a pure function of `(rows, keyNames)` and holds no state, so
 * there is nothing for them to share and nothing to accumulate. The thing that
 * makes a god component is shared mutable state, not a shared entry point.
 *
 * Every value goes through `<Value>`, which is what puts the justification on
 * the number rather than in a pane of its own.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Value } from './Value';
import { inferKind, type Surface as SurfaceData, type SurfaceRow } from './paneTypes';

export interface SurfaceProps {
  surface: SurfaceData;
  /** Rows the current lens or selection marks as in-focus. Others dim rather
   *  than disappear — a pane that empties on selection loses the context that
   *  made the selection interesting. */
  focusIds?: ReadonlySet<string>;
  onPick?: (row: SurfaceRow) => void;
  onPin?: (row: SurfaceRow) => void;
  className?: string;
}

const barTone = 'bg-hud-fg/55';

function useMax(rows: SurfaceRow[]): number {
  return React.useMemo(
    () => Math.max(1, ...rows.map(r => Math.abs(r.value))),
    [rows],
  );
}

/** Always index-qualified.
 *
 *  A node id alone is not unique across rows: an evidence fold emits one row
 *  per justification, so a node with three quotes produced three rows with the
 *  same key and React silently dropped two of them — which reads as "this
 *  claim has one source" when it has three. */
function rowKey(r: SurfaceRow, i: number): string {
  return `${r.nodeId ?? r.edgeId ?? r.keys.join('|')}#${i}`;
}

function dimmed(r: SurfaceRow, focusIds?: ReadonlySet<string>): boolean {
  if (!focusIds || focusIds.size === 0) return false;
  const id = r.nodeId ?? r.edgeId;
  return !!id && !focusIds.has(id);
}

// ─── items — the unfolded set, as things rather than as a chart ──────────────

/** A short date. Full ISO in a list column is noise; the year and month are
 *  what let a reader see a sequence. */
const day = (t?: string | null) => (t ? t.slice(0, 10) : null);

/** Properties worth putting on the row itself. Everything else stays in the
 *  node pane — a list that shows every forwarded field is a table, and a table
 *  in a 300px column is unreadable. */
const HEADLINE_PROPS = ['kind', 'modality', 'stance', 'amount', 'currency', 'status'];

function ItemsSurface({ surface, focusIds, onPick, onPin }: SurfaceProps) {
  return (
    <ul className="divide-y divide-hud-line">
      {surface.rows.map((r, i) => {
        const props = Object.entries(r.properties ?? {})
          .filter(([k, v]) => HEADLINE_PROPS.includes(k) && v != null && v !== '')
          .slice(0, 3);
        return (
          <li
            key={rowKey(r, i)}
            className={cn(
              'group px-2.5 py-1 text-[11px]',
              onPick && 'cursor-pointer hover:bg-hud-sunken',
              dimmed(r, focusIds) && 'opacity-40',
            )}
            onClick={() => onPick?.(r)}
          >
            <div className="flex items-baseline gap-1.5">
              {/* An occurrence and an entity get opposite marks, because they
                  are opposite things: one happened, one persists. */}
              <span className={cn('shrink-0 text-[8px] leading-none',
                r.kind === 'occurrence' ? 'text-amber-500' : 'text-sky-500')}>
                {r.kind === 'occurrence' ? '◆' : '●'}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
              {onPin && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onPin(r); }}
                  className="shrink-0 text-[9px] text-hud-dimmer opacity-0 transition-opacity group-hover:opacity-100"
                  title="Pin — becomes a term of the pin page's query"
                >
                  pin
                </button>
              )}
            </div>
            <div className="ml-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[10px] text-hud-dimmer">
              {r.type && <span className="truncate">{r.type}</span>}
              {day(r.t0) && (
                <span className="tabular-nums">
                  {day(r.t0)}{r.t1 && r.t1 !== r.t0 ? ` → ${day(r.t1)}` : r.t0 && !r.t1 ? ' →' : ''}
                </span>
              )}
              {r.place && <span className="truncate">{r.place}</span>}
              {props.map(([k, v]) => (
                <span key={k} className="truncate">
                  <Value
                    value={String(v)}
                    provenance={{ quote: r.quote, reasoning: r.justification }}
                  />
                </span>
              ))}
              {r.magnitude != null && (
                <Value value={r.magnitude} axisKind="metric" unit={null} />
              )}
              {(r.roles?.length ?? 0) > 0 && (
                <span className="truncate italic">{r.roles!.slice(0, 3).join(' · ')}</span>
              )}
              {(r.docCount ?? 0) > 0 && (
                <span className="ml-auto shrink-0 tabular-nums">
                  {r.docCount} doc{r.docCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── list — a FOLD, where a number is an answer and a bar is honest ──────────

function ListSurface({ surface, focusIds, onPick, onPin }: SurfaceProps) {
  const max = useMax(surface.rows);
  return (
    <ul className="divide-y divide-hud-line">
      {surface.rows.map((r, i) => (
        <li
          key={rowKey(r, i)}
          className={cn(
            'group px-2.5 py-1 text-[11px]',
            onPick && 'cursor-pointer hover:bg-hud-sunken',
            dimmed(r, focusIds) && 'opacity-40',
          )}
          onClick={() => onPick?.(r)}
        >
          <div className="flex items-baseline gap-1">
            <span className="truncate">{r.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-hud-dimmer">
              <Value
                value={r.value}
                provenance={{ quote: r.quote, reasoning: r.justification }}
              />
            </span>
            {onPin && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onPin(r); }}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                title="Pin — becomes a term of the pin page's query"
              >
                <span className="text-[10px] text-hud-dimmer">pin</span>
              </button>
            )}
          </div>
          <div className="mt-px h-1 rounded-sm bg-hud-line">
            <div className={cn('h-full rounded-sm', barTone)}
                 style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── matrix ──────────────────────────────────────────────────────────────────

function MatrixSurface({ surface, onPick }: SurfaceProps) {
  const { rows: cells, keyNames } = surface;
  const rowKeys = Array.from(new Set(cells.map(c => c.keys[0] ?? '')));
  const colKeys = Array.from(new Set(cells.map(c => c.keys[1] ?? '')));
  const byCell = new Map(cells.map(c => [`${c.keys[0]}|${c.keys[1]}`, c]));
  const max = useMax(cells);

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-hud-surface backdrop-blur-xl px-1.5 py-1 text-left font-medium text-hud-dimmer">
              {keyNames[0] ?? ''}
            </th>
            {colKeys.map(c => (
              <th key={c} className="px-1 py-1 text-left font-medium text-hud-dimmer">
                <span className="block max-w-[5rem] truncate" title={c}>{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowKeys.map(rk => (
            <tr key={rk}>
              <td className="sticky left-0 z-10 max-w-[7rem] truncate bg-hud-surface px-1.5 py-0.5 backdrop-blur-xl"
                  title={rk}>
                {rk}
              </td>
              {colKeys.map(ck => {
                const cell = byCell.get(`${rk}|${ck}`);
                if (!cell) return <td key={ck} className="px-1 py-0.5" />;
                // Signed cells diverge from the middle rather than ramping from
                // zero: a polar fold's whole point is which side, and a
                // single-hue ramp makes -3 and +3 look like neighbours.
                const v = cell.value;
                const alpha = Math.min(1, Math.abs(v) / max);
                return (
                  <td
                    key={ck}
                    className={cn('px-1 py-0.5 tabular-nums', onPick && 'cursor-pointer')}
                    style={{
                      backgroundColor: v < 0
                        ? `rgb(244 63 94 / ${alpha * 0.5})`
                        : `rgb(37 99 235 / ${alpha * 0.5})`,
                    }}
                    onClick={() => onPick?.(cell)}
                  >
                    <Value
                      value={v}
                      axisKind={cells.some(c => c.value < 0) ? 'polar' : undefined}
                      provenance={{ quote: cell.quote, reasoning: cell.justification }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── lanes ───────────────────────────────────────────────────────────────────

function LanesSurface({ surface, onPick }: SurfaceProps) {
  const rows = surface.rows;
  const stamps = rows.flatMap(r => [r.t0, r.t1].filter(Boolean) as string[]);
  const lo = stamps.length ? stamps.reduce((a, b) => (a < b ? a : b)) : null;
  const hi = stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null;

  const pos = (t?: string | null) => {
    if (!t || !lo || !hi || lo === hi) return 0;
    const span = Date.parse(hi) - Date.parse(lo);
    return span > 0 ? ((Date.parse(t) - Date.parse(lo)) / span) * 100 : 0;
  };

  const lanes = new Map<string, SurfaceRow[]>();
  for (const r of rows) {
    const k = r.keys[0] ?? '';
    (lanes.get(k) ?? lanes.set(k, []).get(k)!).push(r);
  }

  return (
    <ul className="space-y-0.5 px-2 py-1.5">
      {Array.from(lanes.entries()).map(([lane, items]) => (
        <li key={lane} className="text-[10px]">
          <div className="truncate text-hud-dimmer" title={lane}>{lane}</div>
          <div className="relative h-3 rounded-sm bg-hud-line">
            {items.map((r, i) => {
              const left = pos(r.t0);
              // An open-ended interval runs to the edge rather than rendering
              // as a point: "from here onward" is not the same claim as "at
              // this instant", and drawing them alike loses the difference.
              const right = r.t1 ? pos(r.t1) : 100;
              return (
                <span
                  key={rowKey(r, i)}
                  className={cn('absolute top-0 h-full rounded-sm bg-hud-fg/60',
                                onPick && 'cursor-pointer hover:bg-hud-fg')}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(1.5, right - left)}%`,
                  }}
                  title={`${r.label}${r.t0 ? ` · ${r.t0}` : ''}${r.t1 ? ` → ${r.t1}` : ' →'}`}
                  onClick={() => onPick?.(r)}
                />
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── map ─────────────────────────────────────────────────────────────────────

/**
 * A mini-map, not a ranked list of place names.
 *
 * A list of places sorted by count grows without bound and answers a question
 * nobody asked — the useful thing about places is *where they are relative to
 * each other*, which a picture gives instantly and a list never gives at all.
 * Fixed aspect, so the pane cannot expand to swallow the column.
 *
 * The ungeocoded are counted in a footer rather than plotted. Placing them at
 * 0°,0° would be a claim about where something was; dropping them silently
 * would be a different one.
 */
function MapSurface({ surface, focusIds, onPick }: SurfaceProps) {
  const placed = surface.rows.filter(r => r.lat != null && r.lon != null);
  const missing = surface.rows.length - placed.length;
  const max = useMax(placed.length ? placed : surface.rows);

  // Bounds from the data, so a regional corpus fills the pane instead of
  // sitting as a speck on a world map. The margin is a FRACTION of the spread,
  // not a fixed number of degrees: a constant pad collapses a continent-wide
  // set to the middle and blows a city-wide one off the edges.
  const lats = placed.map(r => r.lat!);
  const lons = placed.map(r => r.lon!);
  const W = 100, H = 62;
  const spanY = Math.max(0.5, Math.max(...lats) - Math.min(...lats));
  const spanX = Math.max(0.5, Math.max(...lons) - Math.min(...lons));
  const padY = spanY * 0.18, padX = spanX * 0.18;
  const [y0, y1] = [Math.min(...lats) - padY, Math.max(...lats) + padY];
  const [x0, x1] = [Math.min(...lons) - padX, Math.max(...lons) + padX];
  const px = (lon: number) => ((lon - x0) / Math.max(1e-6, x1 - x0)) * W;
  // Latitude grows north and SVG y grows south.
  const py = (lat: number) => H - ((lat - y0) / Math.max(1e-6, y1 - y0)) * H;

  return (
    <div className="flex min-h-0 flex-col">
      {placed.length > 0 && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full shrink-0"
          style={{ aspectRatio: `${W} / ${H}` }}
          role="img"
          aria-label={`${placed.length} places`}
        >
          {placed.map((r, i) => {
            const dim = dimmed(r, focusIds);
            // Area ∝ value, so a circle twice the radius reads as four times
            // the quantity rather than twice it. Capped tight against the
            // viewBox: at 100 units wide a radius of 4 is already a tenth of
            // the pane, and three of those read as blobs rather than places.
            const rad = 0.9 + Math.sqrt(Math.abs(r.value) / max) * 1.8;
            return (
              <circle
                key={rowKey(r, i)}
                cx={px(r.lon!)} cy={py(r.lat!)} r={rad}
                className={cn('fill-hud-fg/55 stroke-hud-fg',
                              onPick && 'cursor-pointer hover:fill-hud-fg')}
                strokeWidth={0.3}
                opacity={dim ? 0.25 : 1}
                onClick={() => onPick?.(r)}
              >
                <title>{`${r.label} · ${r.value.toLocaleString()}`}</title>
              </circle>
            );
          })}
        </svg>
      )}
      <p className="shrink-0 px-2 py-1 text-[9px] leading-snug text-hud-dimmer">
        {placed.length} placed
        {missing > 0 && ` · ${missing} without coordinates, not plotted`}
      </p>
    </div>
  );
}

// ─── canvas placeholder ──────────────────────────────────────────────────────

function SetSurface({ surface, onPick }: SurfaceProps) {
  return (
    <ul className="flex flex-wrap gap-1 px-2.5 py-1.5">
      {surface.rows.map((r, i) => (
        <li key={rowKey(r, i)}>
          <button
            type="button"
            onClick={() => onPick?.(r)}
            className="rounded-md border border-hud-line px-2 py-0.5 text-[10px] text-hud-dim transition-colors hover:border-hud-line-strong hover:text-hud-fg"
          >
            {r.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── the router ──────────────────────────────────────────────────────────────

export function Surface(props: SurfaceProps) {
  const { surface, className } = props;
  const kind = surface.kind ?? inferKind(surface.rows, surface.keyNames);

  if (surface.rows.length === 0) {
    return (
      <p className={cn('px-3 py-4 text-[11px] text-hud-dimmer', className)}>
        Nothing in scope. The query is doing what it says — narrow it less, or
        point this pane somewhere else.
      </p>
    );
  }

  const body =
    kind === 'items' ? <ItemsSurface {...props} />
    : kind === 'matrix' ? <MatrixSurface {...props} />
    : kind === 'lanes' ? <LanesSurface {...props} />
    : kind === 'map' ? <MapSurface {...props} />
    : kind === 'canvas' ? <SetSurface {...props} />
    : <ListSurface {...props} />;

  return (
    <div className={cn('min-h-0 overflow-y-auto', className)}>
      {body}
      {/* The legend is not decoration. Every entry is a decision the engine
          made that the query did not spell out — which scale, which
          denominator, over which population — and a size channel whose rules
          are invisible is one that can be made to say anything. */}
      {surface.legend && surface.legend.length > 0 && (
        <p className="px-2.5 py-1 text-[9px] leading-snug text-hud-dimmer">
          {surface.legend.join(' · ')}
        </p>
      )}
    </div>
  );
}
