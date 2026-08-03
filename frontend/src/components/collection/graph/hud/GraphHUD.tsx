'use client';

/**
 * GraphHUD — the panes overlaid on the graph canvas, in three regions.
 *
 * ```
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  (node info · docs — the panel owns the top-left corner)   │
 *   │                                          ┌──────────────┐ │
 *   │                                          │ Interests    │ │
 *   │                                          ├──────────────┤ │
 *   │                        canvas            │ Observations │ │
 *   │                                          ├──────────────┤ │
 *   │  ┌────────────┐                          │ Evidence     │ │
 *   │  │ Places     │  ← LEFT RAIL             └──────────────┘ │
 *   │  └────────────┘                            RIGHT COLUMN   │
 *   │  (pins — panel)   ┌──── BOTTOM BAND ────┐                 │
 *   └───────────────────┴─────────────────────┴─────────────────┘
 * ```
 *
 * **Why three regions rather than one column.** The panes answer different
 * *shapes* of question and the shape wants a different aspect ratio. What is
 * here and what grounds it are lists — tall and narrow, so they stack on the
 * right. Where things are is a map — squarish, and it belongs beside the
 * canvas it re-frames, not above a list of quotes. When × where is a chart with
 * a shared time axis — it has to be wide, and it has to sit under the canvas so
 * its x-axis lines up with the scrubber's.
 *
 * Everything still derives from the nodes and edges already in memory. No
 * fetch, so no pane can disagree with the canvas about what is on screen —
 * which is the whole reason these overlay rather than sitting in sibling
 * dashboard panels.
 *
 * **The regions dodge what the panel already owns.** `NodeDetailHUD` holds
 * top-left and `PinBoard` holds bottom-left, both of them panel-owned and
 * older than this component. The left rail therefore anchors *above* the pin
 * board, and the bottom band starts clear of both. `pointer-events-none` on
 * each frame with `auto` on the panes keeps the canvas draggable in the gaps.
 */
import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { GraphEdge, GraphNode } from '../graphTypes';
import { EvidencePane } from './EvidencePane';
import { HudPane } from './HudPane';
import { ItemsPane } from './ItemsPane';
import { LanesPane } from './LanesPane';
import { RegionPane } from './RegionPane';
import { InterestPane } from './InterestPane';
import {
  defaultHudConfig,
  selectEvidence,
  selectItems,
  type HudConfig,
  type PaneFollow,
} from './hudChannels';

interface Props {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  config?: Partial<HudConfig>;
  onConfigChange?: (next: HudConfig) => void;
  /** Node ids currently focused — selection, pins, keyboard nav. Panes set to
   *  `follow: 'selection'` narrow to these. */
  focusIds?: ReadonlySet<string>;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  /** Scrubber position, drawn through the lanes so the timeline and the lane
   *  chart read as one instrument rather than two clocks. */
  timeCursor?: string | null;
  /** Region mode: show the place-cluster pane in the left rail. */
  showRegions?: boolean;
  /** The place currently scoped by a `near:` token, so the pane reflects the
   *  query rather than keeping its own selection. */
  activePlace?: string | null;
  onScopeToPlace?: (place: string, radiusKm: number) => void;
  /** Write a `serves:` filter. The `why` axis scoping everything else. */
  onScopeToInterest?: (interest: string) => void;
}

/** Clears `PinBoard` (bottom-2, ~2rem tall) so the rail stacks above it. */
const LEFT_RAIL_BOTTOM = 'bottom-12';
/** Clears the left rail's width plus its inset, so the band starts beside it. */
const BAND_LEFT_WITH_RAIL = 'left-[17rem]';
const BAND_LEFT_BARE = 'left-2';

export function GraphHUD({
  nodes, edges, config: override, onConfigChange,
  focusIds, selectedNodeId, onSelectNode, timeCursor,
  showRegions, activePlace, onScopeToPlace, onScopeToInterest,
}: Props) {
  const config: HudConfig = useMemo(() => ({
    ...defaultHudConfig,
    ...override,
    items: { ...defaultHudConfig.items, ...override?.items },
    evidence: { ...defaultHudConfig.evidence, ...override?.evidence },
    bars: { ...defaultHudConfig.bars, ...override?.bars },
    lanes: { ...defaultHudConfig.lanes, ...override?.lanes },
  }), [override]);

  const items = useMemo(
    () => selectItems(nodes, edges, config.items, focusIds),
    [nodes, edges, config.items, focusIds],
  );
  const evidence = useMemo(
    () => selectEvidence(nodes, edges, config.evidence, focusIds),
    [nodes, edges, config.evidence, focusIds],
  );

  // Occurrence types present, so the filter offers only what exists rather
  // than a fixed vocabulary the system invented.
  const nodeTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const n of nodes) {
      if (n.kind === 'occurrence' && (n.nodeType || n.type)) {
        seen.add((n.nodeType || n.type)!);
      }
    }
    return [...seen].sort();
  }, [nodes]);

  // The pane appears only when the schema actually declares interests —
  // an empty `why` axis should not advertise itself.
  const hasInterests = useMemo(
    () => nodes.some(n => (n.type || '').toLowerCase() === 'interest'),
    [nodes],
  );

  const laneCount = useMemo(
    () => nodes.filter(n => n.kind === 'occurrence').length,
    [nodes],
  );

  const setFollow = (pane: 'items' | 'evidence') => (follow: PaneFollow) =>
    onConfigChange?.({ ...config, [pane]: { ...config[pane], follow } });

  // Each region earns its space independently. A region with nothing in it is
  // not rendered at all, so an unconfigured panel keeps the full canvas rather
  // than being framed by empty chrome.
  const hasRightColumn = nodeTypes.length > 0 || evidence.length > 0 || hasInterests;
  const hasLeftRail = Boolean(showRegions);
  const hasBottomBand = config.lanes.enabled && laneCount > 0;

  if (!hasRightColumn && !hasLeftRail && !hasBottomBand) return null;

  return (
    <>
      {/* ── LEFT RAIL — where. Squarish, beside the canvas it re-frames. ── */}
      {hasLeftRail && (
        <div
          className={cn(
            'pointer-events-none absolute left-2 z-20 flex w-[248px] flex-col gap-2',
            LEFT_RAIL_BOTTOM,
            'max-h-[55%]',
          )}
        >
          <HudPane title="Places" count={0} follow="lens" className="min-h-0 flex-1">
            <RegionPane
              nodes={nodes}
              timeCursor={timeCursor}
              activePlace={activePlace}
              onScopeToPlace={onScopeToPlace}
            />
          </HudPane>
        </div>
      )}

      {/* ── RIGHT COLUMN — what, why, and on whose word. Lists, so tall. ── */}
      {hasRightColumn && (
        <div
          className={cn(
            'pointer-events-none absolute right-2 top-2 z-20 flex w-[300px] flex-col gap-2',
            hasBottomBand ? 'bottom-[9.5rem]' : 'bottom-2',
          )}
        >
          {hasInterests && (
            <HudPane title="Interests" count={0} follow="lens" className="max-h-[30%]">
              <InterestPane
                nodes={nodes}
                edges={edges}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
                onScopeToInterest={onScopeToInterest}
              />
            </HudPane>
          )}

          <HudPane
            title={config.items.nodeType || 'Observations'}
            count={items.length}
            follow={config.items.follow}
            onFollowChange={setFollow('items')}
            className="max-h-[50%]"
            controls={nodeTypes.length > 1 ? (
              <select
                value={config.items.nodeType ?? ''}
                onChange={(e) => onConfigChange?.({
                  ...config,
                  items: { ...config.items, nodeType: e.target.value || null },
                })}
                className="h-6 rounded border border-border/60 bg-transparent px-1 text-[10px]"
              >
                <option value="">all</option>
                {nodeTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : undefined}
          >
            <ItemsPane
              items={items}
              selectedId={selectedNodeId}
              onSelect={onSelectNode}
              onSelectParticipant={onSelectNode}
            />
          </HudPane>

          <HudPane
            title="Evidence"
            count={evidence.length}
            follow={config.evidence.follow}
            onFollowChange={setFollow('evidence')}
            className="min-h-0 flex-1"
          >
            <EvidencePane evidence={evidence} onSelectAbout={onSelectNode} />
          </HudPane>
        </div>
      )}

      {/* ── BOTTOM BAND — when × where. Wide, because it shares the time
           axis with the scrubber directly below it. ── */}
      {hasBottomBand && (
        <div
          className={cn(
            'pointer-events-none absolute bottom-2 right-[19.5rem] z-20 flex h-[8.5rem] flex-col',
            hasLeftRail ? BAND_LEFT_WITH_RAIL : BAND_LEFT_BARE,
            !hasRightColumn && 'right-2',
          )}
        >
          <HudPane
            title={config.lanes.clock === 'activity' ? 'Lanes · period covered' : 'Lanes'}
            count={laneCount}
            follow="lens"
            className="min-h-0 flex-1"
            controls={
              <select
                value={config.lanes.rows}
                onChange={(e) => onConfigChange?.({
                  ...config,
                  lanes: { ...config.lanes, rows: e.target.value as any },
                })}
                className="h-6 rounded border border-border/60 bg-transparent px-1 text-[10px]"
              >
                <option value="place">by place</option>
                <option value="node_type">by kind</option>
                <option value="event">by event</option>
                <option value="group">by cluster</option>
              </select>
            }
          >
            <LanesPane
              nodes={nodes}
              edges={edges}
              rowKey={config.lanes.rows}
              clock={config.lanes.clock}
              cursor={timeCursor}
              selectedId={selectedNodeId}
              onSelect={onSelectNode}
            />
          </HudPane>
        </div>
      )}
    </>
  );
}
