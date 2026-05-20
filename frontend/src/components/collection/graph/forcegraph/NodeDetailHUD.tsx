'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { ArrowLeftRight, Pin, PinOff, Settings2, X, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnnotationSchemaRead } from '@/client';
import type { FieldDef, FieldRangeCache } from '@/components/collection/annotation/cellRenderers/types';
import { TypedCell } from '@/components/collection/annotation/cellRenderers';
import type { GraphNode, GraphEdge } from '../graphTypes';

// =============================================================================
// NodeDetailHUD — heads-up display rendered on top of the graph canvas when a
// node is selected. Distinct regions surround the focused (centered) node so
// the canvas and graph remain readable rather than being shrunken by a side
// panel.
//
// Layout:
//   - Top-center            : node name + type pill
//   - Top-left              : "Sources: N" label
//   - Left column           : document badges (asset chips)
//   - Right column          : evidence list (justifications + spans)
//   - Bottom (full width)   : "Connections (N)" label, then two rows
//                              upper = outgoing, lower = incoming
//
// Interactivity contract: the root container is ``pointer-events: none`` so
// the user can pan/zoom the canvas in the gaps. Each interactive child sets
// ``pointer-events: auto`` explicitly. Sections render only when their data
// is present, so a bare node (no badges, no evidence, no connections) shows
// only the title strip.
// =============================================================================

export interface EvidenceItem {
  assetId: number;
  /** Id of the underlying ``GraphEdge`` this evidence belongs to. Lets the
   *  parent drive the same highlight machinery used by keyboard nav (edge
   *  amber + peer-only connected-set) when the user hovers a card. */
  edgeId: string;
  peerId: string;
  predicate: string;
  peerLabel: string;
  /** From the focused node's perspective: ``out`` = focused→peer (focused is
   *  triplet subject), ``in`` = peer→focused (focused is triplet object). */
  direction: 'out' | 'in';
  reasoning?: string;
  confidence?: number;
  /** Subnet-mode only: full endpoint labels so the card can render
   *  ``subjectLabel → objectLabel`` instead of arrow + peer. ``direction``
   *  loses meaning here. When both are present, the card prefers them. */
  subjectLabel?: string;
  objectLabel?: string;
  /** Subnet-mode only: id of the subject endpoint, used as the click target
   *  when the user picks a card. */
  subjectId?: string;
}

/** One annotation field's value for one asset on one schema, paired with
 *  its optional ``*_justification`` block. Rendered via ``TypedCell`` so the
 *  HUD reuses the table's renderer set verbatim — same chips, same
 *  formatting, same date/enum behaviour. */
export interface AssetFieldRow {
  schemaId: number;
  schemaName: string;
  schema: AnnotationSchemaRead;
  field: FieldDef;
  value: any;
  justificationReasoning?: string;
  justificationConfidence?: number;
}

export interface DocumentBadge {
  assetId: number;
  title?: string;
  fields?: AssetFieldRow[];
  /** Number of edges incident to the focused node that this asset's triplets
   *  contributed to. Mirrors what the asset-highlight lens lights up so the
   *  count matches the visible effect. Derived in the parent from the
   *  edge→asset map; defaulting to 0 here would be a lie since the
   *  rationale-evidence list (capped at 8) doesn't carry full coverage. */
  tripletConnectionCount?: number;
}

/** A field the user can toggle on/off in the HUD's field-visibility popover.
 *  ``uid`` is composite (schemaId:fieldKey) so two schemas with the same
 *  field name don't collide. */
export interface EligibleField {
  uid: string;
  schemaId: number;
  schemaName: string;
  key: string;
  name: string;
  type: string;
  cls:
    | 'boolean' | 'number' | 'enum'
    | 'array-text' | 'array-enum' | 'array-number' | 'array-bool'
    | 'timestamp' | 'location';
  defaultOn: boolean;
}

export interface NodeDetailHUDNode extends GraphNode {
  outgoingEdges: GraphEdge[];
  incomingEdges: GraphEdge[];
  totalConnections: number;
}

/** Subnet-scope summary, used when the HUD is anchored to a sub-network
 *  (e.g. pin-set lens) instead of a single focused node. The HUD reads
 *  ``label`` for the title pill and the counts for the meta line. */
export interface SubnetSummary {
  label: string;
  nodeCount: number;
  edgeCount: number;
  /** Optional secondary pill text — e.g. "5 pages · 12 connections". */
  meta?: string;
}

interface NodeDetailHUDProps {
  /** Single-node mode anchor. When present the HUD layout pivots around the
   *  focused node (today's behaviour). When absent and ``subnet`` is set, the
   *  HUD enters subnet mode (pin-set / asset-lens summary). */
  focalNode?: NodeDetailHUDNode;
  /** Subnet-mode summary. Used only when ``focalNode`` is undefined. */
  subnet?: SubnetSummary;
  /** All edges in scope. In single-node mode this is the focused node's
   *  outgoing+incoming union; in subnet mode it's the inter-pin edge set. */
  edges: GraphEdge[];
  nodes: GraphNode[];
  documents?: DocumentBadge[];
  evidence?: EvidenceItem[];
  /** Optional active search term. Connection chips whose peer label matches
   *  get a highlighted ring + bumped opacity; non-matching chips dim so the
   *  query visually surfaces relevant connections without filtering them
   *  out of the row entirely. */
  searchTerm?: string;
  /** Edge currently navigated via the keyboard arrow keys. The matching
   *  chip gets the same amber treatment as a search match (ring + scale)
   *  AND a stronger background to read as the "active cursor". */
  highlightedEdgeId?: string | null;
  onPeerClick?: (peerNode: GraphNode) => void;
  onAssetClick?: (assetId: number) => void;
  /** Hover hook for the right-rail "Connection details" cards AND bottom
   *  connection lists. Parent uses this to drive the same edge-amber +
   *  peer-narrow highlight that keyboard nav produces, so hovering either
   *  surface lights up the two nodes + edge it concerns in the canvas.
   *  ``null`` clears. */
  onEdgeHover?: (edgeId: string | null, peerId: string | null) => void;
  /** All fields the field-picker can offer (across every schema present in
   *  the run). Empty array hides the popover trigger entirely. */
  eligibleFields?: EligibleField[];
  /** uids of fields currently visible under each asset badge. */
  visibleFieldUids?: string[];
  onVisibleFieldUidsChange?: (next: string[]) => void;
  /** When true, every visible field row also shows its ``_justification``
   *  reasoning text below the value. Off by default. */
  showJustifications?: boolean;
  onShowJustificationsChange?: (next: boolean) => void;
  /** Asset-scoped lens: when set, the parent has highlighted every edge +
   *  node from this asset. The badge for this asset gets a ring; others go
   *  muted so the focal asset is unambiguous. */
  highlightedAssetId?: number | null;
  /** Click on a badge's network icon. Caller is responsible for toggle
   *  semantics (clicking the same id again should clear). */
  onAssetHighlightToggle?: (assetId: number) => void;
  /** Numeric range cache for the dotted/segmented bars NumberCell renders.
   *  Without this, numeric values render as plain numerals. */
  rangeCache?: FieldRangeCache;
  /** Pin-board integration. When ``isFocusedNodePinned`` is true, the HUD
   *  shows a "filled pin" icon next to the close button; clicking calls
   *  ``onTogglePin`` to add/remove the focused node from the active pin
   *  board page. ``pinEvidencePeerIds`` (when set) filters the right-rail
   *  evidence cards to triplets where the peer is in the active pin set
   *  — the evidence-side analogue of the pin-network graph lens. */
  isFocusedNodePinned?: boolean;
  onTogglePin?: () => void;
  pinEvidencePeerIds?: Set<string> | null;
  /** When the *other* scope is also active (anchor visible while this HUD
   *  describes the subnet, or vice versa), the parent passes a swap action.
   *  The title pill renders a chip identifying the other scope; clicking it
   *  flips HUD ownership. */
  swapTo?: {
    /** Short label of the other scope — node label or pin page label. */
    label: string;
    /** Optional secondary text (entity type, "n nodes", etc.). */
    meta?: string;
    /** Visual hint — anchor=blue, subnet=amber. */
    kind: 'anchor' | 'subnet';
    onClick: () => void;
  };
  /** Active visual lenses on the canvas. Each chip lets the analyst see
   *  what's contributing to the current highlight, with a × to disable
   *  that lens individually. Sits below the title pill. Pin + asset
   *  compose as intersection on canvas; the chips here just say which
   *  ones are stacked. */
  lenses?: Array<{
    kind: 'pin' | 'asset';
    label: string;
    onClear: () => void;
  }>;
  onClose: () => void;
}

export const NodeDetailHUD: React.FC<NodeDetailHUDProps> = ({
  focalNode, subnet, edges, nodes, documents = [], evidence = [],
  searchTerm = '', highlightedEdgeId = null,
  onPeerClick, onAssetClick, onEdgeHover,
  eligibleFields = [], visibleFieldUids = [], onVisibleFieldUidsChange,
  showJustifications = false, onShowJustificationsChange,
  highlightedAssetId = null, onAssetHighlightToggle,
  rangeCache,
  isFocusedNodePinned = false, onTogglePin,
  pinEvidencePeerIds = null,
  swapTo,
  lenses,
  onClose,
}) => {
  // Mode: focused single-node (today's flow) vs. subnet (pin-set lens).
  // Both surface the same rails — sources, evidence, connections — but the
  // title pill and connection-lane chip shape branch on it.
  const mode: 'focal' | 'subnet' = focalNode ? 'focal' : 'subnet';
  const docCount = focalNode?.sourceAssetCount ?? documents.length;
  const totalConn = edges.length;

  return (
    <div className="absolute inset-0 z-30" style={{ pointerEvents: 'none' }}>
      {/* ===== TOP CENTER: unified pill =====
          Single horizontal container holds three logical sections,
          separated by subtle vertical dividers:
            1. HUD owner — anchor (node label · type · pin toggle) or
               subnet (label · counts).
            2. Active lenses — one chip per visual lens currently amber
               on the canvas (pin, asset). × clears that lens; clicking
               the body of a swap-eligible lens chip also flips HUD
               ownership (pin lens chip ⇒ subnet HUD).
            3. Swap-to-other — a chip jumping to the other HUD scope
               (anchor ↔ subnet). Only present when both are available
               and there's no lens-chip already serving the same swap. */}
      <div
        className="absolute top-12 left-1/2 -translate-x-1/2 max-w-[85%] flex items-center gap-1 px-2 py-1 rounded-full bg-background/90 backdrop-blur-sm border shadow-sm"
        style={{ pointerEvents: 'auto' }}
      >
        {/* --- Section 1: HUD owner --- */}
        <div className="flex items-center gap-2 px-1">
          {mode === 'focal' && focalNode ? (
            <>
              <span className="font-semibold text-sm truncate" title={focalNode.label}>{focalNode.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground border-l pl-2">
                {focalNode.type}
              </span>
              {(focalNode.frequency ?? 0) > 1 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  · freq {focalNode.frequency}
                </span>
              )}
              {onTogglePin && (
                <button
                  type="button"
                  onClick={onTogglePin}
                  className={cn(
                    'shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full border transition-colors',
                    isFocusedNodePinned
                      ? 'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/40'
                      : 'text-muted-foreground border-transparent hover:bg-muted',
                  )}
                  title={isFocusedNodePinned ? 'Unpin from active page' : 'Pin to active page'}
                >
                  {isFocusedNodePinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                </button>
              )}
            </>
          ) : subnet ? (
            <>
              <Pin className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="font-semibold text-sm truncate" title={subnet.label}>{subnet.label}</span>
              <span className="text-[10px] text-muted-foreground border-l pl-2 tabular-nums">
                {subnet.nodeCount} {subnet.nodeCount === 1 ? 'node' : 'nodes'}
                {' · '}
                {subnet.edgeCount} {subnet.edgeCount === 1 ? 'connection' : 'connections'}
              </span>
              {subnet.meta && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  · {subnet.meta}
                </span>
              )}
            </>
          ) : null}
        </div>

        {/* --- Section 2: active lens chips --- */}
        {lenses && lenses.length > 0 && (
          <>
            <div className="h-5 w-px bg-border shrink-0" />
            <div className="flex items-center gap-1 px-1">
              {lenses.map((lens, i) => {
                // Pin lens body click swaps HUD to subnet (only when the
                // current owner is anchor — otherwise we're already there).
                const swapEligible =
                  swapTo?.kind === 'subnet' && lens.kind === 'pin';
                return (
                  <div
                    key={`${lens.kind}-${i}`}
                    className={cn(
                      'flex items-center pl-1.5 pr-0.5 py-0.5 rounded-full border text-[10px]',
                      'bg-amber-50/70 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200',
                    )}
                    title={lens.kind === 'pin' ? `Pin lens: ${lens.label}` : `Document lens: ${lens.label}`}
                  >
                    {lens.kind === 'pin'
                      ? <Pin className="h-2.5 w-2.5 shrink-0 mr-1" />
                      : <Waypoints className="h-2.5 w-2.5 shrink-0 mr-1" />}
                    {swapEligible && swapTo ? (
                      <button
                        type="button"
                        onClick={swapTo.onClick}
                        className="font-medium truncate max-w-[140px] hover:underline"
                        title={`Switch HUD to ${swapTo.label}`}
                      >
                        {lens.label}
                      </button>
                    ) : (
                      <span className="font-medium truncate max-w-[140px]">{lens.label}</span>
                    )}
                    <button
                      type="button"
                      onClick={lens.onClear}
                      className="shrink-0 inline-flex items-center justify-center h-3.5 w-3.5 ml-0.5 rounded-full hover:bg-amber-200/60 dark:hover:bg-amber-900/60 text-muted-foreground hover:text-foreground"
                      title="Clear this lens"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* --- Section 3: swap chip ---
            Only when the swap target is NOT already representable by an
            existing lens chip. (A pin-lens chip in anchor mode already
            offers the swap to subnet inline.) */}
        {swapTo && !(swapTo.kind === 'subnet' && lenses?.some(l => l.kind === 'pin')) && (
          <>
            <div className="h-5 w-px bg-border shrink-0" />
            <button
              type="button"
              onClick={swapTo.onClick}
              className={cn(
                'shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] transition-colors hover:bg-muted',
                swapTo.kind === 'anchor'
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-amber-700 dark:text-amber-300',
              )}
              title={`Switch HUD to ${swapTo.label}`}
            >
              <ArrowLeftRight className="h-3 w-3 shrink-0" />
              <span className="font-medium truncate max-w-[120px]">{swapTo.label}</span>
              {swapTo.meta && (
                <span className="text-muted-foreground truncate max-w-[80px]">{swapTo.meta}</span>
              )}
            </button>
          </>
        )}
      </div>

      {/* ===== TOP-RIGHT: Pin toggle + Close ===== */}
      <div className="absolute top-2 right-2 flex items-center gap-1" style={{ pointerEvents: 'auto' }}>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 bg-background/80 backdrop-blur-sm border"
          onClick={onClose}
          title="Close details"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* ===== LEFT: Sources header + asset badges =====
          Each badge is a small, self-contained card: a clickable title (opens
          the asset overlay), a network icon (toggles the asset-scoped graph
          lens — every edge + node this asset spawned goes amber), and an
          optional column of typed annotation values underneath. The cog in
          the header opens a popover where the analyst picks which fields
          appear on every badge plus a master toggle for inline
          justifications. */}
      {documents.length > 0 && (
        <div
          className="absolute top-12 left-2 w-[260px] max-w-[40%] max-h-[calc(100%-15rem)] overflow-y-auto overflow-x-hidden scrollbar-hide"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-[10px] font-medium text-muted-foreground">
              Sources: {docCount}
            </span>
            {eligibleFields.length > 0 && (
              <FieldPickerPopover
                eligibleFields={eligibleFields}
                visibleFieldUids={visibleFieldUids}
                onVisibleFieldUidsChange={onVisibleFieldUidsChange}
                showJustifications={showJustifications}
                onShowJustificationsChange={onShowJustificationsChange}
              />
            )}
          </div>
          <div className="flex flex-col gap-2 items-stretch">
            {documents.map((doc) => (
              <AssetBadge
                key={doc.assetId}
                doc={doc}
                tripletConnectionCount={doc.tripletConnectionCount ?? 0}
                isHighlighted={highlightedAssetId === doc.assetId}
                isDimmed={highlightedAssetId != null && highlightedAssetId !== doc.assetId}
                showJustifications={showJustifications}
                rangeCache={rangeCache}
                onAssetClick={onAssetClick}
                onHighlightToggle={onAssetHighlightToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* ===== RIGHT COLUMN: Connection details + Connection lanes =====
          Two independent right-anchored surfaces:
            • TOP: connection-detail evidence cards (narrow, ~300px) — one
              card per triplet with rationale text.
            • BOTTOM: predicate-grouped connection lanes (wider, ~480px,
              extends further leftward) — chip strips that need horizontal
              room to read at a glance. Decoupling means the cards stay
              compact while the lanes get the chip-friendly width they
              actually need. */}
      {evidence.length > 0 && (() => {
        // Lens-driven scoping for evidence: asset lens filters to one
        // document's triplets; pin-evidence filter narrows to triplets
        // whose peer is pinned. Both can be on simultaneously (intersection);
        // when both are off, all evidence shows.
        let scoped = evidence;
        if (highlightedAssetId != null) {
          scoped = scoped.filter(j => j.assetId === highlightedAssetId);
        }
        if (pinEvidencePeerIds && pinEvidencePeerIds.size > 0) {
          scoped = scoped.filter(j => pinEvidencePeerIds.has(j.peerId));
        }
        if (scoped.length === 0) return null;
        return (
          <div
            // Top-bound + bottom margin large enough to clear the lanes
            // panel below (which has its own max-h ~9rem ≈ 144px + bottom-2).
            className="absolute top-12 right-2 w-[300px] max-w-[40%] flex flex-col gap-2 overflow-hidden"
            style={{ pointerEvents: 'none', bottom: 'calc(11rem)' }}
          >
            {mode === 'focal' ? (
              <>
                <EvidenceSection
                  title="Outgoing"
                  items={scoped.filter(j => j.direction === 'out')}
                  highlightedEdgeId={highlightedEdgeId}
                  nodes={nodes}
                  onPeerClick={onPeerClick}
                  onEdgeHover={onEdgeHover}
                />
                <EvidenceSection
                  title="Incoming"
                  items={scoped.filter(j => j.direction === 'in')}
                  highlightedEdgeId={highlightedEdgeId}
                  nodes={nodes}
                  onPeerClick={onPeerClick}
                  onEdgeHover={onEdgeHover}
                />
              </>
            ) : (
              <EvidenceSection
                title="Connections"
                items={scoped}
                highlightedEdgeId={highlightedEdgeId}
                nodes={nodes}
                onPeerClick={onPeerClick}
                onEdgeHover={onEdgeHover}
              />
            )}
          </div>
        );
      })()}

      {/* ===== BOTTOM-RIGHT: Connection lanes — independent surface =====
          Wider than the evidence cards (~480px) and anchored to bottom-right
          so the lanes get horizontal room for chip readability without
          competing with the cards above. No backdrop / border / shadow —
          the chips carry their own visual weight; the panel itself is
          transparent so the canvas stays readable behind empty lane gaps. */}
      {edges.length > 0 && (
        <div
          className="absolute bottom-2 right-2 w-[480px] max-w-[55%] max-h-[10rem] flex flex-col gap-1 px-2 py-1"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="text-[10px] font-medium text-muted-foreground px-1">
            Connections ({edges.length})
          </div>
          <ConnectionLanes
            edges={edges}
            nodes={nodes}
            focalId={focalNode?.id}
            searchTerm={searchTerm}
            highlightedEdgeId={highlightedEdgeId}
            onPeerClick={onPeerClick}
            onEdgeHover={onEdgeHover}
          />
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// EvidenceSection — one direction's worth of connection-detail cards. Two of
// these stack in the right rail (Outgoing / Incoming) so the user can
// orient by direction without parsing arrow glyphs on every card.
// -----------------------------------------------------------------------------
const EvidenceSection: React.FC<{
  title: string;
  items: EvidenceItem[];
  highlightedEdgeId: string | null;
  nodes: GraphNode[];
  onPeerClick?: (peerNode: GraphNode) => void;
  onEdgeHover?: (edgeId: string | null, peerId: string | null) => void;
}> = ({ title, items, highlightedEdgeId, nodes, onPeerClick, onEdgeHover }) => {
  if (items.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1 min-h-0 flex-1"
      // Sections inside the right column opt back into pointer events so the
      // empty space between them stays click-through to the canvas.
      style={{ pointerEvents: 'auto' }}
    >
      <div className="text-[10px] font-medium text-muted-foreground px-1 flex items-center justify-between shrink-0">
        <span>{title}</span>
        <span className="tabular-nums">{items.length}</span>
      </div>
      <div className="flex flex-col gap-1.5 overflow-y-auto scrollbar-hide pr-1 min-h-0">
        {items.map((j, i) => {
          const isActive = highlightedEdgeId === j.edgeId;
          // Sentence form: ``subjectLabel predicate objectLabel`` — same shape
          // for focal and subnet modes, no direction arrow. The legacy
          // ``peerLabel + arrow`` form is the back-compat fallback for
          // callers that haven't been migrated.
          const hasSentence = j.subjectLabel != null && j.objectLabel != null;
          // Click target: jumps to the subject endpoint when both labels are
          // present (arbitrary but stable); else to the legacy peer.
          const targetId = hasSentence ? (j.subjectId ?? j.peerId) : j.peerId;
          const targetNode = nodes.find(n => n.id === targetId);
          return (
            <button
              key={`${j.edgeId}-${i}`}
              type="button"
              onMouseEnter={() => onEdgeHover?.(j.edgeId, j.peerId)}
              onMouseLeave={() => onEdgeHover?.(null, null)}
              onClick={() => targetNode && onPeerClick?.(targetNode)}
              className={cn(
                'text-left w-full p-2 bg-amber-50/95 dark:bg-amber-950/60 backdrop-blur-sm rounded text-[11px] border shadow-sm transition-all cursor-pointer hover:bg-amber-100/95 dark:hover:bg-amber-900/60 shrink-0',
                isActive
                  ? 'border-amber-500 ring-0.5 ring-amber-500 dark:ring-amber-400'
                  : 'border-amber-200/80 dark:border-amber-800/70',
              )}
              title={hasSentence
                ? `Focus ${j.subjectLabel} ${j.predicate} ${j.objectLabel}`
                : `Focus ${j.peerLabel}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-baseline gap-1 min-w-0 flex-wrap">
                  {hasSentence ? (
                    <>
                      <span className="font-semibold truncate">{j.subjectLabel}</span>
                      <span className="italic text-muted-foreground truncate">{j.predicate}</span>
                      <span className="font-semibold truncate">{j.objectLabel}</span>
                    </>
                  ) : (
                    <>
                      <span className="italic text-muted-foreground truncate">{j.predicate}</span>
                      <span className="opacity-60 shrink-0">{j.direction === 'out' ? '→' : '←'}</span>
                      <span className="font-semibold truncate">{j.peerLabel}</span>
                    </>
                  )}
                </div>
                {j.confidence != null && (
                  <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">
                    {(j.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {j.reasoning && (
                <p className="text-foreground leading-relaxed mt-1">
                  {j.reasoning.length > 170 ? j.reasoning.slice(0, 170) + '…' : j.reasoning}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// ConnectionLanes — predicate-grouped horizontal lanes. One row per predicate,
// peer chips horizontal inside. Direction lives on the lane label when all
// edges in the predicate share it, on the chip when mixed. Subnet mode (no
// focalId) groups by (source, target) pair and renders pair chips.
//
// Why predicate as the spine: the original two-strip layout repeated the same
// predicate across every chip ("communicated_with → Vance", "communicated_with
// → Bannon", …). Lifting predicate to a lane label kills that repetition;
// peer chips become small and dense.
// -----------------------------------------------------------------------------

interface LaneEntry {
  /** Stable key per chip — duplicates within a predicate get aggregated. */
  key: string;
  /** First contributing edge — used for hover/click dispatch. */
  edge: GraphEdge;
  /** Number of duplicate triplets (same predicate, same endpoints). */
  count: number;
  /** Resolved peer (focal mode) or target endpoint (subnet mode). */
  peer: GraphNode | null;
  /** Subnet-mode only: the source endpoint. */
  source?: GraphNode | null;
  /** Direction relative to focal — undefined in subnet mode. */
  direction?: 'in' | 'out';
}

interface Lane {
  predicate: string;
  entries: LaneEntry[];
  /** ``out`` / ``in`` when every entry shares it; ``mixed`` when both
   *  appear. Subnet-mode lanes leave this undefined. */
  uniformDirection?: 'in' | 'out' | 'mixed';
}

function buildLanes(
  edges: GraphEdge[],
  nodes: GraphNode[],
  focalId: string | undefined,
): Lane[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  // Bucket: predicate → key → LaneEntry. Key in focal mode is "<dir>:<peerId>";
  // in subnet mode it's "<sourceId>→<targetId>".
  const byPred = new Map<string, Map<string, LaneEntry>>();
  for (const edge of edges) {
    const pred = edge.predicate || '(none)';
    let bucket = byPred.get(pred);
    if (!bucket) { bucket = new Map(); byPred.set(pred, bucket); }
    if (focalId != null) {
      const direction: 'in' | 'out' = edge.sourceId === focalId ? 'out' : 'in';
      const peerId = direction === 'out' ? edge.targetId : edge.sourceId;
      const peer = nodeById.get(peerId) ?? null;
      const key = `${direction}:${peerId}`;
      const existing = bucket.get(key);
      if (existing) existing.count += 1;
      else bucket.set(key, { key, edge, count: 1, peer, direction });
    } else {
      const key = `${edge.sourceId}→${edge.targetId}`;
      const source = nodeById.get(edge.sourceId) ?? null;
      const peer = nodeById.get(edge.targetId) ?? null;
      const existing = bucket.get(key);
      if (existing) existing.count += 1;
      else bucket.set(key, { key, edge, count: 1, peer, source });
    }
  }
  const lanes: Lane[] = [];
  for (const [predicate, bucket] of byPred) {
    const entries = Array.from(bucket.values());
    let uniformDirection: Lane['uniformDirection'] = undefined;
    if (focalId != null) {
      const dirs = new Set(entries.map(e => e.direction));
      if (dirs.size === 1) uniformDirection = entries[0].direction;
      else uniformDirection = 'mixed';
    }
    lanes.push({ predicate, entries, uniformDirection });
  }
  // Sort lanes: largest first, then alphabetical predicate.
  lanes.sort((a, b) => b.entries.length - a.entries.length || a.predicate.localeCompare(b.predicate));
  return lanes;
}

const ConnectionLanes: React.FC<{
  edges: GraphEdge[];
  nodes: GraphNode[];
  /** When set, peer + direction are derived from edges relative to this node.
   *  When undefined (subnet mode), chips render as A → B pairs. */
  focalId?: string;
  searchTerm?: string;
  highlightedEdgeId?: string | null;
  onPeerClick?: (peer: GraphNode) => void;
  onEdgeHover?: (edgeId: string | null, peerId: string | null) => void;
}> = ({ edges, nodes, focalId, searchTerm = '', highlightedEdgeId = null, onPeerClick, onEdgeHover }) => {
  const q = searchTerm.trim().toLowerCase();
  const lanes = useMemo(() => buildLanes(edges, nodes, focalId), [edges, nodes, focalId]);

  // Keep the navigated chip on screen as the user arrows across lanes.
  const navChipRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!highlightedEdgeId) return;
    navChipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [highlightedEdgeId]);

  if (lanes.length === 0) {
    return (
      <div className="px-1 py-0.5 text-[10px] text-muted-foreground italic">none</div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto scrollbar-hide flex-1 min-h-0 my-0.5">
      {lanes.map(lane => {
        // Lane-level direction marker: arrow when uniform, ↔ when mixed,
        // nothing in subnet mode.
        const dirGlyph = lane.uniformDirection === 'out' ? '→'
          : lane.uniformDirection === 'in' ? '←'
          : lane.uniformDirection === 'mixed' ? '↔'
          : null;
        return (
          <div key={lane.predicate} className="flex items-center gap-2 min-w-0">
            {/* Predicate label: now anchored at 160px since the lanes panel
                gets its own width. ``min-w-0`` + ``truncate`` lets long
                predicates ellipsize gracefully. */}
            <div className="shrink-0 flex items-center gap-1 basis-[160px] max-w-[180px] min-w-0 justify-end pr-1">
              {dirGlyph && (
                <span className="text-[11px] text-muted-foreground/80 shrink-0 tabular-nums">
                  {dirGlyph}
                </span>
              )}
              <span
                className="text-[10px] italic text-muted-foreground truncate"
                title={lane.predicate}
              >
                {lane.predicate}
              </span>
            </div>
            <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto overflow-y-visible scrollbar-hide py-1.5 -my-1">
              {lane.entries.map(entry => {
                const isNavigated = highlightedEdgeId === entry.edge.id;
                // Subnet-mode chips: "A → B"; focal-mode: peer label only,
                // arrow added inline only if the lane is mixed-direction.
                const isSubnet = focalId == null;
                const sourceLabel = entry.source?.label || entry.source?.id || '';
                const peerLabel = entry.peer?.label || entry.peer?.id || '';
                const matches = q.length > 0 && (
                  peerLabel.toLowerCase().includes(q) ||
                  sourceLabel.toLowerCase().includes(q) ||
                  lane.predicate.toLowerCase().includes(q)
                );
                const dimmed = q.length > 0 && !matches && !isNavigated;
                // Single chip palette across the new design — direction is
                // already encoded on the lane label or via inline glyph, so
                // the colour distinction (blue/emerald) of the legacy strip
                // is no longer carrying information.
                const baseColors = 'bg-muted/60 dark:bg-muted/40 hover:bg-muted border-border/60 text-foreground';
                const navStyles = isNavigated
                  ? 'ring-1 ring-amber-500 shadow-[0_0_0_2px_rgba(245,158,11,0.18)]'
                  : matches
                    ? 'ring-1 ring-amber-400 dark:ring-amber-500'
                    : '';
                const hoverPeer = entry.peer ?? entry.source ?? null;
                return (
                  <button
                    type="button"
                    key={entry.key}
                    ref={isNavigated ? navChipRef : undefined}
                    className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border whitespace-nowrap transition-all backdrop-blur-sm shadow-sm shrink-0',
                      baseColors,
                      navStyles,
                      dimmed && 'opacity-35',
                    )}
                    title={isSubnet
                      ? `${sourceLabel} → ${peerLabel} (${lane.predicate})${entry.count > 1 ? ` ×${entry.count}` : ''}`
                      : `${entry.direction === 'out' ? '→' : '←'} ${peerLabel} (${lane.predicate})${entry.count > 1 ? ` ×${entry.count}` : ''}`}
                    onMouseEnter={() => hoverPeer && onEdgeHover?.(entry.edge.id, hoverPeer.id)}
                    onMouseLeave={() => onEdgeHover?.(null, null)}
                    onClick={() => hoverPeer && onPeerClick?.(hoverPeer)}
                  >
                    {isSubnet ? (
                      <>
                        <span className="font-medium max-w-[120px] truncate">{sourceLabel}</span>
                        <span className="opacity-60">→</span>
                        <span className="font-medium max-w-[120px] truncate">{peerLabel}</span>
                      </>
                    ) : (
                      <>
                        {lane.uniformDirection === 'mixed' && (
                          <span className="opacity-60">{entry.direction === 'out' ? '→' : '←'}</span>
                        )}
                        <span className="font-medium max-w-[180px] truncate">{peerLabel}</span>
                      </>
                    )}
                    {entry.count > 1 && (
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        ×{entry.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// -----------------------------------------------------------------------------
// FieldPickerPopover — small cog-icon trigger that opens a popover where the
// analyst toggles which annotation fields appear under each asset badge,
// plus a master "Show justifications" switch. Mirrors the schema-column
// header pattern in AnnotationResultsTable.tsx so the affordance feels
// familiar across surfaces.
// -----------------------------------------------------------------------------
const FieldPickerPopover: React.FC<{
  eligibleFields: EligibleField[];
  visibleFieldUids: string[];
  onVisibleFieldUidsChange?: (next: string[]) => void;
  showJustifications: boolean;
  onShowJustificationsChange?: (next: boolean) => void;
}> = ({ eligibleFields, visibleFieldUids, onVisibleFieldUidsChange, showJustifications, onShowJustificationsChange }) => {
  const visibleSet = useMemo(() => new Set(visibleFieldUids), [visibleFieldUids]);
  const fieldsBySchema = useMemo(() => {
    const map = new Map<number, { name: string; fields: EligibleField[] }>();
    for (const f of eligibleFields) {
      if (!map.has(f.schemaId)) map.set(f.schemaId, { name: f.schemaName, fields: [] });
      map.get(f.schemaId)!.fields.push(f);
    }
    return Array.from(map.entries()).map(([schemaId, v]) => ({ schemaId, ...v }));
  }, [eligibleFields]);

  const toggle = (uid: string) => {
    const next = visibleSet.has(uid)
      ? visibleFieldUids.filter(u => u !== uid)
      : [...visibleFieldUids, uid];
    onVisibleFieldUidsChange?.(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-5 w-5 opacity-60 hover:opacity-100">
          <Settings2 className="h-3 w-3" />
          <span className="sr-only">Configure source fields</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" side="bottom">
        <div className="p-2 border-b flex items-center justify-between">
          <Label htmlFor="hud-show-justifications" className="text-xs font-medium cursor-pointer">
            Show justifications
          </Label>
          <Switch
            id="hud-show-justifications"
            checked={showJustifications}
            onCheckedChange={(v) => onShowJustificationsChange?.(Boolean(v))}
          />
        </div>
        <div className="p-2 font-medium text-xs border-b">Show fields:</div>
        <ScrollArea className="max-h-[300px] p-1">
          {fieldsBySchema.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground italic">No eligible fields.</div>
          ) : (
            fieldsBySchema.map(({ schemaId, name, fields }) => (
              <div key={schemaId} className="mb-1">
                {fieldsBySchema.length > 1 && (
                  <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {name}
                  </div>
                )}
                {fields.map(f => (
                  <div key={f.uid} className="flex items-center gap-2 px-2 py-1 text-xs">
                    <Checkbox
                      id={`hud-field-${f.uid}`}
                      checked={visibleSet.has(f.uid)}
                      onCheckedChange={() => toggle(f.uid)}
                    />
                    <Label
                      htmlFor={`hud-field-${f.uid}`}
                      className="font-normal cursor-pointer truncate flex-1"
                      title={`${f.name} (${f.cls})`}
                    >
                      {f.name}
                      <span className="text-muted-foreground ml-1">({f.cls})</span>
                    </Label>
                  </div>
                ))}
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

// -----------------------------------------------------------------------------
// AssetBadge — one block per asset on the left rail. Header row: title button
// (opens the asset overlay) + Network icon (toggles the asset-scoped graph
// lens). Fields stack underneath as ``label : <TypedCell>`` pairs at
// ``comfortable`` density so arrays render as proper badges (no count
// prefix) and dates render absolute. No card background — sections are
// separated by a thin border-bottom, matching the table's bare-row aesthetic.
// Active highlight ⇒ amber ring on the row only.
// -----------------------------------------------------------------------------
const prettify = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const AssetBadge: React.FC<{
  doc: DocumentBadge;
  tripletConnectionCount: number;
  isHighlighted: boolean;
  isDimmed: boolean;
  showJustifications: boolean;
  rangeCache?: FieldRangeCache;
  onAssetClick?: (assetId: number) => void;
  onHighlightToggle?: (assetId: number) => void;
}> = ({ doc, tripletConnectionCount, isHighlighted, isDimmed, showJustifications, rangeCache, onAssetClick, onHighlightToggle }) => {
  const { assetId, title, fields = [] } = doc;
  return (
    <div
      className={cn(
        'pb-2 border-b border-border/50 last:border-b-0 transition-opacity min-w-0',
        // ``-mx-*`` would extend past the rail's fixed 260px and trigger
        // horizontal scroll. Inset background only — no negative margin.
        isHighlighted && 'rounded px-1 bg-amber-50/40 dark:bg-amber-950/20',
        isDimmed && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onAssetClick?.(assetId)}
          className="text-[11px] font-medium truncate text-left flex-1 min-w-0 hover:underline cursor-pointer text-foreground"
          title={title || `Open asset ${assetId}`}
        >
          {title || `#${assetId}`}
        </button>
        {onHighlightToggle && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-5 w-5 shrink-0 relative',
              isHighlighted
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground/70 hover:text-foreground',
            )}
            onClick={(e) => { e.stopPropagation(); onHighlightToggle(assetId); }}
            title={isHighlighted ? 'Clear asset highlight' : 'Highlight this asset in the graph'}
          >
            <Waypoints className="h-3 w-3" />
            <span
              className="absolute -bottom-0.5 -right-1 min-w-[0.9rem] h-3 px-0.5 text-xs rounded-full"
              title={`${tripletConnectionCount} triplet connection${tripletConnectionCount === 1 ? '' : 's'}`}
            >
              {tripletConnectionCount}
            </span>
          </Button>
        )}
      </div>
      {fields.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {fields.map((row, i) => (
            <AssetFieldRowDisplay
              key={`${row.schemaId}:${row.field.key}:${i}`}
              row={row}
              showJustifications={showJustifications}
              rangeCache={rangeCache}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const AssetFieldRowDisplay: React.FC<{
  row: AssetFieldRow;
  showJustifications: boolean;
  rangeCache?: FieldRangeCache;
}> = ({ row, showJustifications, rangeCache }) => {
  // ``document.foo_bar`` → ``Foo Bar`` — strip the modality prefix the table
  // also strips, then run the underscore→space + title-case substitution.
  const displayName = useMemo(() => {
    const stripped = row.field.name.replace(/^(?:document|per_image|per_audio|per_video)\./, '');
    return prettify(stripped);
  }, [row.field.name]);

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          className="text-[10px] text-muted-foreground truncate shrink-0 max-w-[45%]"
          title={displayName}
        >
          {displayName}
        </span>
        <div className="text-[11px] min-w-0 flex-1">
          <TypedCell
            field={row.field}
            value={row.value}
            density="comfortable"
            schema={row.schema}
            rangeCache={rangeCache}
          />
        </div>
      </div>
      {showJustifications && row.justificationReasoning && (
        <p className="text-[10px] text-muted-foreground italic leading-snug pl-1 mt-0.5">
          “{row.justificationReasoning.length > 140
            ? row.justificationReasoning.slice(0, 140) + '…'
            : row.justificationReasoning}”
        </p>
      )}
    </div>
  );
};
