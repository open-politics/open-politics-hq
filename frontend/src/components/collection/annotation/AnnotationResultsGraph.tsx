'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RefreshCw, AlertCircle, Info, Download, Settings2, Search, X, Eye, EyeOff, Trash2, GitMerge, Database, Fingerprint, Check, Box, Square, Maximize2, Minimize2, Library, ArrowUpToLine } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AnnotationSchemaRead, AssetRead, KnowledgeGraphRead, SimilarPairRead } from '@/client';
import { FormattedAnnotation, TimeAxisConfig, PanelConfig, GraphVizConfig, GraphProjection } from '@/lib/annotations/types';
import { KnowledgeGraphsService, AnnotationsService, EntitiesService } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import { VariableSplittingConfig, applySplittingToResults } from './VariableSplittingControls';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { useAssetDetail } from '@/components/collection/assets/Views/AssetDetailProvider';
import {
  getAnnotationFieldValue,
  applyGraphEdits,
  createEmptyGraphEdits,
  hasGraphEdits,
  getGraphEditsCount,
  getTargetKeysForScheme,
  getFieldDefinitionFromSchema,
} from '@/lib/annotations/utils';
import { isTimestampField, isLocationField, parseTimestampValue } from '@/lib/annotations/fieldDetection';
import { inferFieldRange } from '@/components/collection/annotation/cellRenderers';
import type { GraphEdits } from '@/lib/annotations/types';
import { ForceGraph, type ForceGraphHandle, GraphNode, GraphEdge, type Clock, viewGraphToGraphData, GraphViewConfig, defaultGraphViewConfig, GraphSettingsPopover, GraphFilterPanel, edgeFieldRange, bundleEdges, bundleIdForEdge, bundleIdForPair, type BundledEdge } from '@/components/collection/graph';
import {
  HudBar, HudButton, HudGroup, HudReadout, HudRule, HudSegmented,
} from '@/components/ui/chrome';
import { useFullscreen } from '@/components/collection/graph/forcegraph/useFullscreen';
import { ZoomToolbar } from '@/components/collection/graph/forcegraph/ZoomToolbar';
import { NodeDetailHUD, type EvidenceItem as HUDEvidenceItem, type DocumentBadge as HUDDocBadge, type AssetFieldRow as HUDAssetFieldRow, type EligibleField as HUDEligibleField } from '@/components/collection/graph/forcegraph/NodeDetailHUD';
import { EdgeBundleHUD, type EdgeBundleEvidenceItem, type EdgeBundleDocChip } from '@/components/collection/graph/forcegraph/EdgeBundleHUD';
import { CompareBySubjectButton } from '@/components/collection/graph/forcegraph/CompareBySubjectButton';
import { PinBoard as PinBoardOverlay } from '@/components/collection/graph/forcegraph/PinBoard';
import { useCanonEntityLookup } from '@/hooks/useCanonEntityLookup';
import { resolveEntityColor } from '@/lib/annotations/colors';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import {
  DocsTable, NodeDetail, PaneLayout, QueryBar, RowTable, derivePanes, fold,
  foldEvidence, makePane, paneQuery, reconcileDerived,
  type GraphIndex, type InferredPane, type PaneRegion, type PaneSpec,
  type RegionSize, type SectionRows, type SurfaceData, type SurfaceRow,
} from '@/components/collection/graph/panes';
import { GraphAxesPopover, type FrameCoverage } from './panels/GraphAxesPopover';
import { GraphLayersPopover, type GraphLayer, type LayerShow, type LayerView } from './panels/GraphLayersPopover';
import { Composer } from '@/components/collection/composer/Composer';
import { applyToGql, fromSectionRows } from '@/components/collection/composer/composerModel';
import { Cell as RowCell } from '@/components/collection/graph/panes/RowTable';
import { pageNodeIds, pinDoc, type Pin } from '@/components/collection/graph/panes/pins';
import { budgetToAnchors, defaultAxisBudget, type AxisBudget } from '@/components/collection/graph/forcegraph/axes';
import { TopNodesList } from '@/components/collection/graph/forcegraph/TopNodesList';
import { TimeScrubber, filterByCursor } from '@/components/collection/graph/forcegraph/TimeScrubber';
// `GraphHUD` is gone from here — `PaneLayout` replaced it. The rest of this
// module still holds the bars clock and the region toggles, which have not
// moved yet.
import { RegionToggles, defaultHudConfig, quoteOf, type HudConfig } from '@/components/collection/graph/hud';
import { appendGraphToken, negatedValues, setNegatedValues } from '@/lib/query/graph_query_language';
import { useSurfaceCommands } from '@/hooks/useSurfaceCommands';
import { useGraphAssist } from '@/hooks/useGraphAssist';
import { EmptyStateCard } from './panels/EmptyStateCard';
import { ValueAliasManager } from './panels/ValueAliasManager';
import { EvidenceDrawer } from './panels/EvidenceDrawer';
import { walkOutputContract, flattenFieldPaths } from '@/lib/annotations/fieldPaths';
import { hasGraphStyle, readGraphStyle } from '@/lib/annotations/graphStyle';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { usePromoteRun, useSetResolveIntoCanon } from '@/hooks/useCanons';
import { effectiveMergeMaps } from '@/lib/annotations/valueAliases';
import { createScopeFromSelection, createCooccursScope, entityPathsFromSchema, focusedEntityNamesFromFilter, pushCooccursToDashboard } from '@/lib/annotations/scopes';
import type { Scope } from '@/lib/annotations/types';
import type { FilterSet } from '@/client';
import { REGION_DEFAULT } from '@/components/collection/graph/panes/paneTypes';

/** Radix Select forbids `value=""` on items; use this for “infospace default” instead of clearing the select. */
const CURATE_TARGET_GRAPH_INFOSPACE_DEFAULT = '__infospace_default__';

// Time filtering utility function (copied from AnnotationResultsChart.tsx)
const getTimestamp = (result: FormattedAnnotation, assetsMap: Map<number, AssetRead>, timeAxisConfig: TimeAxisConfig | null): Date | null => {
  if (!timeAxisConfig) return null;

  switch (timeAxisConfig.type) {
    case 'default':
      return new Date(result.timestamp);
    case 'schema':
      if (result.schema_id === timeAxisConfig.schemaId && timeAxisConfig.fieldKey) {
        const fieldValue = getAnnotationFieldValue(result.value, timeAxisConfig.fieldKey);
        if (fieldValue && (typeof fieldValue === 'string' || fieldValue instanceof Date)) {
          try {
            return new Date(fieldValue);
          } catch {
            return null;
          }
        }
      }
      return null;
    case 'event':
      const asset = assetsMap.get(result.asset_id);
      if (asset?.event_timestamp) {
        try {
          return new Date(asset.event_timestamp);
        } catch {
          return null;
        }
      }
      return null;
    default:
      return new Date(result.timestamp);
  }
};

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    total_nodes: number;
    total_edges: number;
    total_fragments_processed: number;
    fragments_with_errors: number;
    processing_stats: {
      nodes_filtered_by_frequency: number;
      nodes_filtered_by_max_limit: number;
      isolated_nodes_included: number;
    };
  };
}

// =============================================================================
// HUD field eligibility — what shows under an asset badge.
//
// The HUD on the left rail can display per-asset annotation values beneath
// each badge. Eligibility is gated structurally so we never render long-form
// text or nested objects inline:
//   ✓ booleans, numbers/integers
//   ✓ enum strings (closed list)
//   ✓ arrays of primitives (string / number / boolean / enum)
//   ✓ strings detected as timestamp / location (via fieldDetection.ts)
//   ✗ plain free-text strings
//   ✗ objects, arrays of objects
//
// Default-on classes: ``boolean``, ``number``, ``enum``, ``array-text``,
// ``array-enum``. Default-off (must be toggled on): timestamp, location,
// array-number, array-bool — present in the picker but tighter by default
// since they tend to be either noisy (locations) or rare (bool arrays).
// =============================================================================

type EligibilityClass =
  | 'boolean'
  | 'number'
  | 'enum'
  | 'array-text'
  | 'array-enum'
  | 'array-number'
  | 'array-bool'
  | 'timestamp'
  | 'location';

const DEFAULT_ON_CLASSES: ReadonlySet<EligibilityClass> = new Set([
  'boolean', 'number', 'enum', 'array-text', 'array-enum', 'location',
]);

/** Composite uid so two schemas with the same field-key don't collide in the
 *  user's visible-fields selection. */
const fieldUid = (schemaId: number, key: string) => `${schemaId}:${key}`;

function classifyField(def: any, fieldKey: string, sampleValue: any): EligibilityClass | null {
  if (!def) return null;
  // Special-typed fields win over declared shape: an ``array<string>`` named
  // ``locations`` is a location field, not a generic text list. Same for
  // timestamps. Detection requires a sample value — without one we fall
  // through to declared-type classification.
  if (sampleValue != null) {
    if (isLocationField(fieldKey, sampleValue)) return 'location';
    if (isTimestampField(fieldKey, sampleValue)) return 'timestamp';
  }
  if (def.type === 'boolean') return 'boolean';
  if (def.type === 'number' || def.type === 'integer') return 'number';
  if (def.type === 'string') {
    if (Array.isArray(def.enum) && def.enum.length > 0) return 'enum';
    return null;
  }
  if (def.type === 'array') {
    if (Array.isArray(def.items?.enum) && def.items.enum.length > 0) return 'array-enum';
    const itemsType = def.items?.type;
    if (itemsType === 'string') return 'array-text';
    if (itemsType === 'number' || itemsType === 'integer') return 'array-number';
    if (itemsType === 'boolean') return 'array-bool';
    return null;
  }
  return null;
}

/** ``not_applicable`` → ``Not Applicable``. Convention used across the
 *  app for display-side prettification of underscored backend tokens. */
const prettifyValue = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Pull the matching ``*_justification`` block for a field. Convention:
 *  ``document.topic`` → ``document.topic_justification``. */
function getJustificationFor(
  resultValue: any, fieldKey: string,
): { reasoning?: string; confidence?: number } | undefined {
  const parts = fieldKey.split('.');
  const last = parts.pop();
  if (!last) return undefined;
  const justKey = [...parts, `${last}_justification`].join('.');
  const j = getAnnotationFieldValue(resultValue, justKey);
  if (j && typeof j === 'object') {
    return { reasoning: (j as any).reasoning, confidence: (j as any).confidence };
  }
  return undefined;
}

// =============================================================================
// Pin board — multi-page persistent collection of pinned nodes. Each page is
// an analysis-scoped grouping ("Pins", "Cluster A", "merge candidates") with
// its own pinned-node set. The active page drives:
//   - the existing merge UI (was the transient ``mergeSelectedIds`` array)
//   - "view network" lens — direct edges between pinned nodes go amber
//   - "view evidence" filter — right-rail evidence scoped to pinned peers
// Persisted to ``panelConfig.settings.pinBoard`` so sets survive reload.
// =============================================================================

interface PinPage {
  id: string;
  label: string;
  pinnedNodeIds: string[];
  /** Term-pins — see `panes/pins.ts`. A pin carrying a GQL fragment, so one
   *  document is one pin whatever it resolves to. Coexists with the node-id
   *  list rather than replacing it: `pageNodeIds` unions both, which is what
   *  lets this land without rewriting every pin site at once. */
  pins?: Pin[];
}

interface PinBoard {
  pages: PinPage[];
  activePageId: string;
  /** When true, both highlight the network *and* filter the right-rail
   *  evidence to triplets touching pinned peers — same combined treatment
   *  the asset-card waypoints icon applies. Single toggle so users don't
   *  have to think about "do I want network or evidence" — it's both. */
  showLens: boolean;
}

const makeDefaultPinBoard = (): PinBoard => ({
  pages: [{ id: 'default', label: 'Pins', pinnedNodeIds: [] }],
  activePageId: 'default',
  showLens: false,
});

const newPinPageId = () => `pin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

interface AnnotationResultsGraphProps {
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  panelConfig: PanelConfig;
  onUpdatePanel: (updates: Partial<PanelConfig>) => void;
  allSchemas?: AnnotationSchemaRead[];
  onResultSelect?: (result: FormattedAnnotation) => void;
}

export default function AnnotationResultsGraph({
  infospaceId,
  runId,
  schemas,
  panelConfig,
  onUpdatePanel,
  allSchemas,
  onResultSelect,
}: AnnotationResultsGraphProps) {
  // Shared asset-detail overlay — "Appears in documents" chips below open
  // the full split content/results view for each asset.
  const { openDetailOverlay } = useAssetDetail();

  // Active dashboard panels — used by the cooccurs scope-to-relationship
  // gesture so a click on an edge can broadcast a filter to peer panels.
  const dashboardPanels = useAnnotationRunStore(s => s.dashboardConfig?.panels ?? []);
  const dashboardName = useAnnotationRunStore(s => s.dashboardConfig?.name ?? null);
  const broadcastAddScope = useAnnotationRunStore(s => s.addScope);

  // Canon entity lookup — graph nodes carry labels/types but not canon ids.
  // CompareBySubjectButton resolves its entity set through this.
  const { entities: canonEntities } = useCanonEntityLookup(infospaceId);

  // Projection-based entity-role overlays are not active: the Panel carries no
  // PanelProjection, so there is nothing to derive roles from. Kept as a
  // constant (rather than removed) because CompareBySubjectButton gates its
  // visibility on it — it turns on when projections reach the panel.
  const projectionHasEntityRoles = false;
  const subjectRole = 'subject';

  // Read the per-type visual config from panel_config.
  const cfg = panelConfig.panel_config as GraphVizConfig;

  // Derive triplet_field: prefer formula.group[0].path if populated (Workspace-
  // authored formulas express the triplet dimension as a group step); fall
  // back to cfg.source; fall back to 'relationships' so legacy panels still
  // render.
  const tripletFieldStr = useMemo((): string => {
    const groupPath = panelConfig.formula?.group?.[0]?.path;
    if (groupPath) return groupPath;
    return cfg?.source ?? 'relationships';
  }, [panelConfig.formula?.group, cfg?.source]);

  const edgeWeightFieldStr = cfg?.edge_weight_field ?? undefined;
  const edgeWeightMode = cfg?.edge_weight_mode ?? 'count';
  const nodeGroupByStr = cfg?.node_group_by ?? undefined;
  const edgeGroupByStr = cfg?.edge_group_by ?? undefined;

  // Relationship-as-a-lens dim cascade. Harvest entity names from every
  // ``relational.cooccurs`` condition present in the panel's formula.filter
  // OR in any incoming scope's filter. When a cooccurs scope is active,
  // matching nodes (and edges between them) stay sharp; the rest dims.
  // ``cfg.dim_unmatched === false`` lets the user opt out of the focus.
  const dimUnmatched = cfg?.dim_unmatched !== false;
  const focusedEntityNames = useMemo(() => {
    if (!dimUnmatched) return undefined;
    // Collect cooccurs entity names from the panel's own filter.
    const names: string[] = [
      ...focusedEntityNamesFromFilter(panelConfig.formula?.filter as FilterSet | undefined),
      // Also scan each incoming scope's filter (the scope is the typical
      // carrier of the cooccurs condition in the new propagation model).
      ...panelConfig.scopes_in.flatMap(s => focusedEntityNamesFromFilter(s.filter as FilterSet)),
    ];
    if (names.length === 0) return undefined;
    return new Set(names);
  }, [dimUnmatched, panelConfig.formula?.filter, panelConfig.scopes_in]);

  // Value-alias wiring for graph panel — target is the triplet subject/object
  // normalization field (most useful for entity canonicalization). The UI
  // opens against `node_group_by` when present, else edge_group_by, else the
  // triplet field's implicit subject_name path.
  const [aliasManagerOpen, setAliasManagerOpen] = useState(false);
  const getGlobalVariableSplitting = useAnnotationRunStore(s => s.getGlobalVariableSplitting);
  const setGlobalVariableSplitting = useAnnotationRunStore(s => s.setGlobalVariableSplitting);
  // Focus mode hides the in-panel toolbar (view mode, settings, search,
  // fullscreen). The graph canvas + node interactions stay live.
  const focusMode = useAnnotationRunStore(s => s.focusMode);
  const gvs = getGlobalVariableSplitting();
  const runWideAliasesByField = gvs?.valueAliasesByField ?? {};

  const effectiveMergeMapsForView = useMemo(
    () => effectiveMergeMaps(panelConfig.merge_maps, runWideAliasesByField),
    [panelConfig.merge_maps, runWideAliasesByField],
  );

  // Graph data fetch — uses the new Formula-based useAnnotationView signature.
  // triplet_field is omitted when the formula already encodes the group path
  // (the backend uses formula.group[0].path as its own default).
  // Projections are authoritative when present; `triplet_field` stays in the
  // request as the legacy fallback so an unconfigured panel is byte-identical
  // to before. The backend resolves node roles from the schema map, so a
  // projection only has to name its array to work.
  const projections = useMemo(
    () => (cfg?.projections ?? []) as GraphProjection[],
    [cfg?.projections],
  );

  const axisBudget: AxisBudget = useMemo(
    () => ({ ...defaultAxisBudget, ...((cfg as any)?.axes ?? {}) }),
    [(cfg as any)?.axes],
  );
  const setAxisBudget = useCallback((next: AxisBudget) => {
    onUpdatePanel({ panel_config: { ...cfg, axes: next } as any });
  }, [onUpdatePanel, cfg]);

  const layerView: LayerView = useMemo(
    () => ((cfg as any)?.layer_view ?? {}) as LayerView,
    [(cfg as any)?.layer_view],
  );
  const setLayerView = useCallback((next: LayerView) => {
    onUpdatePanel({ panel_config: { ...cfg, layer_view: next } as any });
  }, [onUpdatePanel, cfg]);

  // GQL. Persisted on panel_config so a query survives reload, travels with a
  // shared dashboard, and — the point — is writable by the companion.
  const graphQuery: string = cfg?.q ?? '';
  const setGraphQuery = useCallback((q: string) => {
    onUpdatePanel({ panel_config: { ...cfg, q: q || null } as GraphVizConfig });
  }, [onUpdatePanel, cfg]);

  // A query proposed but not applied. Transient by design — it belongs to this
  // reading session, not to the panel, because an unaccepted proposal is not a
  // configuration and should not survive a reload or travel to whoever the
  // dashboard is shared with.
  const [graphDraft, setGraphDraft] = useState<string | null>(null);

  // Prose → a proposed query, and the amber pills for whatever this run cannot
  // answer. Both go into the draft; neither applies anything.
  const { warnings: queryWarnings, validate: validateQuery, ask: askGraph } =
    useGraphAssist(infospaceId, runId);

  // Validate on commit, not per keystroke. `empty_risk` needs the run's own
  // vocabulary, so it is a round-trip — and a query is only worth checking
  // once it is one.
  useEffect(() => { void validateQuery(graphQuery); }, [graphQuery, validateQuery]);

  /** "Show me this node's neighbourhood" — as a query, not as a list.
   *
   *  Replaces the connection list the node HUD used to render along its bottom
   *  edge. A traversal is strictly the better answer: it is visible, editable,
   *  survives reload, travels with a shared dashboard, and composes with every
   *  other token — `from:"X" hops:1 type:Organization after:2016` is one more
   *  keystroke, and was inexpressible in a list of chips.
   *
   *  Replaces any existing `from:`/`hops:` rather than appending, because two
   *  `from:` tokens INTERSECT (the co-presence semantic) and silently turning
   *  "the neighbourhood of X" into "reachable from both X and Y" on a second
   *  click would be the kind of surprise that makes people stop trusting the
   *  bar. Everything else in the query is preserved. */
  const focusSubgraph = useCallback((label: string) => {
    if (!label) return;
    const kept = graphQuery
      .split(/\s+/)
      .filter(t => t && !/^-?(from|hops):/i.test(t));
    setGraphQuery([...kept, `from:"${label}"`, 'hops:1'].join(' '));
  }, [graphQuery, setGraphQuery]);

  const graphQueryConfig = useMemo(() => ({
    projections,
    q: graphQuery || null,
    triplet_field: tripletFieldStr,
    dedup: 'normalized' as const,
    edge_weight_field: edgeWeightFieldStr ?? null,
    edge_weight_mode: edgeWeightMode,
    node_group_by: nodeGroupByStr ?? null,
    edge_group_by: edgeGroupByStr ?? null,
    null_policy: cfg?.null_policy ?? 'skip',
    forward_properties: cfg?.forward_properties ?? [],
    // The document rung — annotation-scoped, so it sits beside the projections
    // rather than inside one. "This filing is about Malta, dated 2014" places
    // and dates everything the filing mentions, weakly.
    doc_place: (cfg as any)?.doc_place ?? null,
    doc_time: (cfg as any)?.doc_time ?? null,
  }), [projections, graphQuery, tripletFieldStr, edgeWeightFieldStr, edgeWeightMode, nodeGroupByStr, edgeGroupByStr, cfg?.null_policy, cfg?.forward_properties, (cfg as any)?.doc_place, (cfg as any)?.doc_time]);

  const { data: viewData, isLoading: isViewLoading, refetch: refetchView } = useAnnotationView({
    infospaceId,
    runId,
    panel: panelConfig,
    schemas,
    incoming_scopes: panelConfig.scopes_in,
    merge_maps: panelConfig.merge_maps,
    graph: graphQueryConfig,
    enabled: !!runId && !!infospaceId,
  });

  // What the ENGINE actually ran — resolved layers and per-frame coverage,
  // returned with the graph phase. Read rather than re-derived: a
  // configuration surface that recomputes what it is configuring drifts from
  // the thing in play, which is exactly how the axis popover ended up writing
  // a field the engine ignores.
  const graphMeta = (viewData?.graph as any)?.meta ?? {};
  const layers: GraphLayer[] = graphMeta.layers ?? [];
  const frameCoverage: FrameCoverage | undefined = graphMeta.frames;
  // What the engine decided that the query did not say: which size scale and
  // denominator, whether a requested scale was refused, how many dimensions
  // were spent and what the vector had to fold into. Shown, always — a size
  // channel whose rules are invisible is one that can be made to say anything.
  const graphLegend: string[] = graphMeta.legend ?? [];
  /** What the engine resolved in a way the writer may not have meant — a
   *  reserved word colliding with a field name, a section this run has never
   *  heard of. Distinct from the legend: the legend says what the engine DID,
   *  a note says what it could not do with what you wrote. Amber, not neutral. */
  const graphNotes: string[] = graphMeta.notes ?? [];
  /** Panes the contract's declarations imply, each with the scope the engine
   *  resolved for it — what an empty bar means. */
  const inferredPanes: InferredPane[] = graphMeta.panes ?? [];
  /** What this run is addressable BY — sections and their columns, plus the
   *  types, roles, predicates and properties actually present. Read off the
   *  assembled graph, so a completion cannot offer something the query has
   *  already excluded. Drives the bar's autocomplete. */
  const graphIndex: GraphIndex | undefined = graphMeta.index;

  /** The rows behind the picture — one section's records, projected by the
   *  same query that drew the canvas. Entity cells carry node ids, which is
   *  what makes selection one thing across both surfaces rather than two
   *  states to reconcile. `graph/rows.py`, `MVP.md` §4. */
  const sectionTables: SectionRows[] = (viewData?.graph as any)?.rows ?? [];

  // ── The Composer, on the GQL path ─────────────────────────────────────
  //
  // Reads the query and writes it back: `SECTION:` is the grain, `SHOW:` the
  // columns. It holds no state of its own, which is what guarantees it cannot
  // drift from the bar — both are renderers of the same string, and anything
  // the wheel can do is by construction expressible as a query (MVP S7).
  const [composePaneId, setComposePaneId] = useState<string | null>(null);

  const composerModel = useMemo(() => {
    if (!composePaneId || sectionTables.length === 0) return null;
    return fromSectionRows(sectionTables, graphQuery, (section) => {
      // Rosters are the projections that are ABOUT nothing — a cast, not an
      // act. `about` is the declaration that decides it, so the split holds
      // for a contract whose sections are called `motives` and `exhibits`.
      const l = layers.find(
        x => x.path.split('.').pop()?.replace('[*]', '') === section,
      );
      return l && l.about === null ? 'body' : null;
    });
  }, [composePaneId, sectionTables, graphQuery, layers]);

  /** Validation warnings and engine notes, as one rail.
   *
   *  A note arrives with the *result*, so it can say things validation cannot
   *  know in advance — that `kind:payment` matched no node kind on a contract
   *  whose acts state their type in a field literally called `kind`. The
   *  backend already phrases each as a sentence with the spellings that do
   *  work, so the token shown is the note's own first clause. */
  const engineNotes = useMemo(() => [
    ...queryWarnings,
    ...graphNotes.map(n => {
      const [head, ...rest] = n.split(' — ');
      return { token: head, why: rest.join(' — ') || head };
    }),
  ], [queryWarnings, graphNotes]);

  // Separate rows fetch — the graph response carries only ``annotation_ids``
  // per node, not asset ids. To populate the node detail panel's "Appears
  // in documents" chips we need the annotation→asset mapping (and the
  // asset titles for display). Rows payload is compact (id + asset_id + title).
  const { data: rowsViewData } = useAnnotationView({
    infospaceId,
    runId,
    panel: panelConfig,
    schemas,
    incoming_scopes: panelConfig.scopes_in,
    merge_maps: panelConfig.merge_maps,
    rows: { limit: 500 },
    enabled: !!runId && !!infospaceId,
  });

  const results = useMemo<FormattedAnnotation[]>(() => {
    if (!rowsViewData?.rows?.items) return [];
    return rowsViewData.rows.items.map((row) => ({
      id: row.annotation_id,
      asset_id: row.asset_id,
      schema_id: row.schema_id,
      run_id: row.run_id,
      value: row.value,
      timestamp: row.timestamp,
      status: row.status as any,
    }));
  }, [rowsViewData?.rows?.items]);

  const assets = useMemo<AssetRead[]>(() => {
    if (!rowsViewData?.rows?.assets) return [];
    return Object.values(rowsViewData.rows.assets).map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      parent_asset_id: s.parent_asset_id,
    } as AssetRead));
  }, [rowsViewData?.rows?.assets]);
  const activeRunId = runId;
  const [timeAxisConfig] = useState<TimeAxisConfig | null>(null);
  const [variableSplittingConfig] = useState<VariableSplittingConfig | null>(null);
  const onVariableSplittingChange: ((config: VariableSplittingConfig | null) => void) | undefined = undefined;
  // Use ref to avoid dependency cycle: onSettingsChange → panelConfig.settings → re-render → loop
  const settingsRef = useRef(panelConfig.settings);
  settingsRef.current = panelConfig.settings;
  const onSettingsChange = useCallback((settings: any) => {
    onUpdatePanel({ settings: { ...settingsRef.current, ...settings } });
  }, [onUpdatePanel]);
  const initialSettings = panelConfig.settings;
  // graphEdits live in cfg.edits (panel_config) in the new shape.
  // Fall back to the legacy settings path so panels that haven't been
  // migrated in the store yet still render their persisted edits.
  const graphEdits: GraphEdits | null = (cfg?.edits as GraphEdits | null | undefined) ?? panelConfig.settings?.graphEdits ?? null;
  const onGraphEditsChange = useCallback((edits: GraphEdits) => {
    onUpdatePanel({ panel_config: { ...cfg, edits } as any });
  }, [onUpdatePanel, cfg]);

  // Projections live on panel_config, so a source set survives reload and
  // travels with a shared dashboard.
  // `linked` and `off` both remove a layer from the canvas; only `off` stops
  // the fetch. Nodes carry `source_paths`, so hiding by layer is a render
  // filter over data that is already there — which is what lets a linked layer
  // keep counting for degree and keep routing a traversal.
  const hiddenLayerPaths = useMemo(() => new Set(
    Object.entries(layerView)
      .filter(([, show]) => show === 'linked' || show === 'pane')
      .map(([path]) => path),
  ), [layerView]);

  const handleProjectionsChange = useCallback((next: GraphProjection[]) => {
    onUpdatePanel({ panel_config: { ...cfg, projections: next } as any });
  }, [onUpdatePanel, cfg]);
  const { activeInfospace } = useInfospaceStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canon-frame actions on the run. The run object lives in the run store; we
  // guard on id so a stale active run (e.g. mid-switch) can't leak into the
  // wrong panel. canon_ids being non-empty is what unlocks Promote + the
  // resolve-into-canon toggle.
  const activeRun = useAnnotationRunStore(s => s.activeRun);
  const patchActiveRun = useAnnotationRunStore(s => s.patchActiveRun);
  const run = activeRun?.id === runId ? activeRun : null;
  const hasCanon = (run?.canon_ids ?? []).length > 0;
  const resolveOn = !!run?.resolve_into_canon;
  const { promote: promoteRun, loading: promoting } = usePromoteRun();
  const { setMode: setResolveMode, loading: settingResolve } = useSetResolveIntoCanon();
  // Dedup leans on embeddings — gate it the same way semantic search does.
  const embeddingsOn = !!(activeInfospace?.enrichment_config as any)?.embedding?.model_name;

  const handlePromote = useCallback(async () => {
    await promoteRun(runId);
  }, [promoteRun, runId]);

  const handleToggleResolve = useCallback(async () => {
    const next = !resolveOn;
    const ok = await setResolveMode(runId, next);
    if (!ok) return;
    patchActiveRun({ resolve_into_canon: next });
    if (next) {
      toast.success('Resolving into canon — settled matches auto-apply, the rest stage as proposals.');
    }
  }, [resolveOn, setResolveMode, runId, patchActiveRun]);
  
  // Schema selection - use persisted setting if available
  const persistedSchemaId = initialSettings?.selectedGraphSchemaId;
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>(persistedSchemaId ? persistedSchemaId.toString() : '');
  
  // Graph view config - use persisted setting if available
  const persistedGraphConfig = initialSettings?.graphViewConfig;
  const [graphConfig, setGraphConfig] = useState<GraphViewConfig>(
    persistedGraphConfig ? { ...defaultGraphViewConfig, ...persistedGraphConfig } : defaultGraphViewConfig
  );
  
  // Time cursor. Deliberately NOT persisted to panel_config: where you happen
  // to be scrubbing is a viewing gesture, unlike a query or a source set.
  const [timeCursor, setTimeCursor] = useState<string | null>(null);

  // ── Filter state IS the query ────────────────────────────────────────────
  //
  // These used to be component `useState` Sets: a second, invisible filter
  // that shadowed the query string. Two sources of truth for "what's shown" —
  // the chips were lost on remount, absent from a shared dashboard, and
  // unreachable by the companion, which can only write GQL.
  //
  // Now a chip click rewrites `q`. Hiding a type and typing `-type:Person`
  // are the same act, and the bar always shows what is actually filtered.
  const hiddenEntityTypes = useMemo(
    () => negatedValues(graphQuery, 'type'), [graphQuery],
  );
  const hiddenPredicates = useMemo(
    () => negatedValues(graphQuery, 'predicate'), [graphQuery],
  );
  const setHiddenEntityTypes = useCallback((next: Set<string>) => {
    setGraphQuery(setNegatedValues(graphQuery, 'type', next));
  }, [graphQuery, setGraphQuery]);
  const setHiddenPredicates = useCallback((next: Set<string>) => {
    setGraphQuery(setNegatedValues(graphQuery, 'predicate', next));
  }, [graphQuery, setGraphQuery]);

  // Imperative ref for the renderer — used by the settings popover's
  // "Re-run layout" button and could be wired to search-zoom in future.
  const forceGraphRef = useRef<ForceGraphHandle>(null);

  // Fullscreen target — wraps the panel root so the toolbar + graph + detail
  // pane all stay inside fullscreen mode. The graph's own ResizeObserver picks
  // up the new dimensions automatically.
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(fullscreenRootRef);

  // Process view data into graph nodes/edges. ``useMemo`` (not ``useEffect`` +
  // ``setState``) is load-bearing for 2D↔3D position carry-over: the
  // ``react-force-graph`` lib mutates ``x``/``y``/``z`` on the node objects
  // it receives. By memoizing on data-shape changes only (``viewData.graph``
  // and ``graphEdits``), the same array identity survives view-mode flips,
  // so the simulation re-mounts in the new mode seeded with existing
  // positions instead of respawning from random.
  const { nodes: rawNodes, edges: rawEdges, graphData } = useMemo<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    graphData: GraphData | null;
  }>(() => {
    if (!viewData?.graph) return { nodes: [], edges: [], graphData: null };

    const viewGraph = viewData.graph;
    // One tested mapper owns the wire contract — see `graphAdapters.ts`.
    let { nodes: graphNodes, edges: graphEdges } = viewGraphToGraphData(viewGraph);

    if (graphEdits) {
      const deletedNodeIds = new Set(graphEdits.deletedNodes.map(n => n.nodeId));
      graphNodes = graphNodes.filter(n => !deletedNodeIds.has(n.id));
      graphEdges = graphEdges.filter(e =>
        !deletedNodeIds.has(e.sourceId) && !deletedNodeIds.has(e.targetId)
      );
      const deletedEdgeIds = new Set(graphEdits.deletedEdges.map(e => e.edgeId));
      graphEdges = graphEdges.filter(e => !deletedEdgeIds.has(e.id));

      for (const merge of graphEdits.mergedNodes) {
        const mergedSet = new Set(merge.mergedNodeIds);
        const targetNode = graphNodes.find(n => n.id === merge.targetNodeId);
        if (targetNode) {
          const absorbed = graphNodes.filter(n => mergedSet.has(n.id));
          targetNode.frequency = (targetNode.frequency || 1) + absorbed.reduce((s, n) => s + (n.frequency || 1), 0);
          targetNode.aliases = [
            ...(targetNode.aliases || []),
            ...absorbed.map(n => n.label),
          ];
        }
        graphNodes = graphNodes.filter(n => !mergedSet.has(n.id));
        graphEdges = graphEdges.map(e => ({
          ...e,
          sourceId: mergedSet.has(e.sourceId) ? merge.targetNodeId : e.sourceId,
          targetId: mergedSet.has(e.targetId) ? merge.targetNodeId : e.targetId,
        }));
        graphEdges = graphEdges.filter(e => e.sourceId !== e.targetId);
      }
    }

    const newGraphData: GraphData = {
      nodes: graphNodes,
      edges: graphEdges,
      metadata: {
        total_nodes: graphNodes.length,
        total_edges: graphEdges.length,
        total_fragments_processed: 0,
        fragments_with_errors: 0,
        processing_stats: {
          nodes_filtered_by_frequency: 0,
          nodes_filtered_by_max_limit: 0,
          isolated_nodes_included: 0,
        },
      },
    };

    return { nodes: graphNodes, edges: graphEdges, graphData: newGraphData };
  }, [viewData?.graph, graphEdits]);

  // Bundle every connection between a node pair into ONE rendered link. The
  // canvas reads bundles; ``edges`` (the individual members) stays
  // authoritative for node-focus, evidence, curate, dedup, and export. Click
  // a bundle → ``EdgeBundleHUD`` unrolls the per-predicate breakdown.
  // Time filtering is applied to the SAME arrays every downstream consumer
  // reads (bundles, HUDs, curate, export), so a scrubbed graph is consistent
  // everywhere rather than only on the canvas.
  // Which clock the scrubber runs on. Read here rather than from
  // `resolvedHudConfig` (declared further down) because the filter and the bars
  // must be handed the SAME value — they used to disagree, the bars preferring
  // `a0`/`a1` per item while the filter read `t0`/`t1` unconditionally.
  const barsClock: Clock = (cfg as any)?.hud?.bars?.clock ?? defaultHudConfig.bars.clock;
  const setBarsClock = useCallback((next: Clock) => {
    const hud = (cfg as any)?.hud ?? {};
    onUpdatePanel({
      panel_config: {
        ...cfg,
        hud: { ...hud, bars: { ...defaultHudConfig.bars, ...hud.bars, clock: next } },
      } as GraphVizConfig,
    });
  }, [cfg, onUpdatePanel]);

  const { nodes, edges } = useMemo(() => {
    const t = filterByCursor(rawNodes, rawEdges, timeCursor, barsClock);
    if (hiddenLayerPaths.size === 0) return t;
    // A node is hidden only when EVERY layer that produced it is hidden — the
    // same entity is usually named by several sections, and dropping it
    // because one of them is in pane mode would delete half the graph.
    // EDGES are what make a layer visible. Each carries exactly one source
    // path, so hiding `observations` drops its role edges and the graph
    // visibly changes. Nodes are named by three or four layers each — filtering
    // only those made the whole control a no-op, because almost nothing is
    // produced by one layer alone.
    const keptEdges = t.edges.filter(e =>
      !(e.sourcePaths ?? []).every(p => hiddenLayerPaths.has(p)));

    const keptNodes = t.nodes.filter(n => {
      const from = n.sourcePaths ?? [];
      return from.length === 0 || from.some(p => !hiddenLayerPaths.has(p));
    });
    const kept = new Set(keptNodes.map(n => n.id));
    return {
      nodes: keptNodes,
      edges: keptEdges.filter(e => kept.has(e.sourceId) && kept.has(e.targetId)),
    };
  }, [rawNodes, rawEdges, timeCursor, barsClock, hiddenLayerPaths]);

  // The budget IS the anchors. `anchors.ts` has resolved three dimensions all
  // along — `AnchorSpec.axis`, `anchorTarget(…, 'z')`, `forceZ` — and the only
  // writer of `config.anchors` never emitted `axis`, so the block was
  // unreachable by clicking. This is the writer that does.
  const graphConfigWithAxes = useMemo<GraphViewConfig>(() => ({
    ...graphConfig,
    anchors: budgetToAnchors(axisBudget, graphConfig.clusterStrength ?? 0.4),
  }), [graphConfig, axisBudget]);

  const bundledEdges = useMemo(() => bundleEdges(edges), [edges]);
  const bundlesById = useMemo(
    () => new Map(bundledEdges.map(b => [b.id, b])),
    [bundledEdges],
  );

  // Member-edge-id → bundle-id translation. Everything that highlights by
  // member edge id (asset lens, keyboard nav, evidence hover, inter-pin
  // edges) must map through this before reaching the renderer, which now
  // keys on bundle ids. Deterministic from endpoints — no side table needed.
  const memberEdgeById = useMemo(() => new Map(edges.map(e => [e.id, e])), [edges]);
  const toBundleEdgeId = useCallback((memberId: string): string => {
    const m = memberEdgeById.get(memberId);
    return m ? bundleIdForEdge(m) : memberId;
  }, [memberEdgeById]);

  // Shallow-clone bundles before passing to the renderer. ``react-force-graph``
  // mutates ``link.source`` / ``link.target`` (object references) onto each
  // link after first paint; cloning keeps the authoritative ``bundledEdges``
  // (and their ``members``) clean. Cheap: one map() per data change.
  const renderEdges = useMemo(() => bundledEdges.map(e => ({ ...e })), [bundledEdges]);

  // New state for search and highlighting
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // A clicked bundled edge → the edge inspector. Mutually exclusive with a
  // focused node: clicking either clears the other.
  const [selectedBundle, setSelectedBundle] = useState<BundledEdge | null>(null);
  // Per-predicate filter inside the open bundle inspector. Empty ⇒ all.
  const [bundlePredFilter, setBundlePredFilter] = useState<Set<string>>(new Set());
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Arrow-key connection navigation state. ``index`` -1 means "no connection
  // currently navigated"; pressing arrow Left/Right (or Shift+arrow for
  // incoming) advances/wraps. Resets whenever the focused node changes or
  // the search filter changes the candidate list.
  const [arrowNav, setArrowNav] = useState<{ direction: 'out' | 'in'; index: number }>({ direction: 'out', index: -1 });

  // Merge selection — transient. Shift+click accumulates here and pops the
  // merge bar at 2+. Kept separate from the pin board: pinning (alt+click)
  // is for persistent collections that should NOT trigger the merge flow.
  const [mergeSelectedIds, setMergeSelectedIds] = useState<string[]>([]);
  const [mergeKeepId, setMergeKeepId] = useState<string | null>(null);
  const [mergeKeepType, setMergeKeepType] = useState<string | null>(null);

  // ---- HUD ownership ----
  // The HUD describes one scope at a time: an *Anchor* (single focused node,
  // blue treatment) or a *Subnet* (pin-set lens, amber treatment). Both can
  // be active on the canvas simultaneously — the analyst can pin a region
  // AND still focus a node. Whichever was *most recently engaged* owns the
  // HUD; the other contributes its visual layer to the canvas only.
  //
  // ``lastEngagedRef`` is updated by the relevant handlers (handleNodeSelect,
  // handleTogglePinLens). The actual ``hudOwner`` is derived inside a memo
  // so it correctly degrades when one scope becomes unavailable (e.g. the
  // user clears the focused node — owner falls back to subnet if pin lens
  // is on, else null).
  const lastEngagedRef = useRef<'anchor' | 'subnet'>('anchor');

  // Pin board (persisted, multi-page). Independent of the merge selection.
  // Pages survive reload via ``panelConfig.settings.pinBoard``.
  const [pinBoard, setPinBoardState] = useState<PinBoard>(() => {
    const persisted = (panelConfig.settings as any)?.pinBoard as PinBoard | undefined;
    if (!persisted || !Array.isArray(persisted.pages) || persisted.pages.length === 0) {
      return makeDefaultPinBoard();
    }
    return persisted;
  });
  const lastPersistedPinBoardRef = useRef<PinBoard | null>(null);
  useEffect(() => {
    if (lastPersistedPinBoardRef.current === pinBoard) return;
    lastPersistedPinBoardRef.current = pinBoard;
    onSettingsChange?.({ pinBoard });
  }, [pinBoard, onSettingsChange]);

  const setPinBoard = useCallback((updater: (prev: PinBoard) => PinBoard) => {
    setPinBoardState(prev => updater(prev));
  }, []);

  const activePinPage = useMemo(
    () => pinBoard.pages.find(p => p.id === pinBoard.activePageId) ?? pinBoard.pages[0],
    [pinBoard],
  );

  // Mutate the active page's pin list. Used by the alt-click handler, the
  // pin icon on NodeDetailHUD, and the unpin / clear actions on PinBoard.
  const updateActivePagePins = useCallback(
    (updater: (prev: string[]) => string[]) => {
      setPinBoard(pb => ({
        ...pb,
        pages: pb.pages.map(p => p.id !== pb.activePageId
          ? p
          : { ...p, pinnedNodeIds: updater(p.pinnedNodeIds) }),
      }));
    },
    [setPinBoard],
  );

  // ---- Pin board action handlers ----
  // All mutations go through ``setPinBoard`` / ``updateActivePagePins`` so
  // persistence stays consistent. Page-level mutations preserve identity
  // for unaffected pages so child memos don't re-run unnecessarily.
  const handleSetActivePage = useCallback((pageId: string) => {
    setPinBoard(pb => ({
      ...pb,
      activePageId: pageId,
      // Clear the lens on page switch — it's scoped to the active set and
      // a stale lens against the new page would surprise.
      showLens: false,
    }));
  }, [setPinBoard]);

  /** Pin a DOCUMENT — one pin, whose subgraph is what its term resolves to. */
  const handlePinDoc = useCallback(
    (assetId: number, title: string | undefined, nodeIds: string[]) => {
      const pin = pinDoc(assetId, title, nodeIds);
      setPinBoard(pb => ({
        ...pb,
        pages: pb.pages.map(p => p.id !== pb.activePageId ? p : {
          ...p,
          // Idempotent: pinning the same document twice is one pin, because
          // the id is the document's.
          pins: [...(p.pins ?? []).filter(x => x.id !== pin.id), pin],
        }),
      }));
    }, [setPinBoard]);

  const handleRemovePin = useCallback((pinId: string) => {
    setPinBoard(pb => ({
      ...pb,
      pages: pb.pages.map(p => p.id !== pb.activePageId ? p : {
        ...p, pins: (p.pins ?? []).filter(x => x.id !== pinId),
      }),
    }));
  }, [setPinBoard]);

  const handleAddPinPage = useCallback((label: string) => {
    const id = newPinPageId();
    setPinBoard(pb => ({
      ...pb,
      pages: [...pb.pages, { id, label, pinnedNodeIds: [] }],
      activePageId: id,
      showLens: false,
    }));
  }, [setPinBoard]);

  const handleRenamePinPage = useCallback((pageId: string, label: string) => {
    setPinBoard(pb => ({
      ...pb,
      pages: pb.pages.map(p => p.id === pageId ? { ...p, label } : p),
    }));
  }, [setPinBoard]);

  const handleDeletePinPage = useCallback((pageId: string) => {
    setPinBoard(pb => {
      if (pb.pages.length <= 1) return pb; // never delete the last page
      const remaining = pb.pages.filter(p => p.id !== pageId);
      const nextActive = pb.activePageId === pageId
        ? remaining[0].id
        : pb.activePageId;
      return {
        ...pb,
        pages: remaining,
        activePageId: nextActive,
        showLens: false,
      };
    });
  }, [setPinBoard]);

  const handleUnpin = useCallback((nodeId: string) => {
    updateActivePagePins(prev => prev.filter(id => id !== nodeId));
  }, [updateActivePagePins]);

  const handleClearPinPage = useCallback(() => {
    updateActivePagePins(() => []);
    setPinBoard(pb => ({ ...pb, showLens: false }));
  }, [updateActivePagePins, setPinBoard]);

  /** Single combined lens — highlights the pin network in the canvas AND
   *  filters the right-rail evidence. Mirrors the asset-card waypoints
   *  icon: one click toggles both effects. Turning the lens on also
   *  surfaces the analysis HUD (subnet mode) so the user immediately sees
   *  the pin set's sources / connections / evidence, AND marks the subnet
   *  scope as the most-recently-engaged HUD owner so it wins over any
   *  active anchor. */
  const handleTogglePinLens = useCallback(() => {
    setPinBoard(pb => {
      const next = { ...pb, showLens: !pb.showLens };
      if (next.showLens) {
        lastEngagedRef.current = 'subnet';
        setShowDetailPanel(true);
      }
      return next;
    });
  }, [setPinBoard]);

  /** Toggle a node in the active page. Used by both the alt-click handler
   *  and the pin icon on the focused-node HUD. */
  const handleTogglePin = useCallback((nodeId: string) => {
    updateActivePagePins(prev => prev.includes(nodeId)
      ? prev.filter(id => id !== nodeId)
      : [...prev, nodeId]);
  }, [updateActivePagePins]);

  // Curation state
  const [showCuratePanel, setShowCuratePanel] = useState(false);
  const [isCurating, setIsCurating] = useState(false);
  const [availableGraphs, setAvailableGraphs] = useState<KnowledgeGraphRead[]>([]);
  const [targetGraphId, setTargetGraphId] = useState<string>(CURATE_TARGET_GRAPH_INFOSPACE_DEFAULT);

  // Dedup suggestions state
  const [dedupPairs, setDedupPairs] = useState<SimilarPairRead[]>([]);
  const [dedupDismissed, setDedupDismissed] = useState<Set<string>>(new Set());
  const [isDedupLoading, setIsDedupLoading] = useState(false);
  const [showDedupPanel, setShowDedupPanel] = useState(false);
  const [dedupError, setDedupError] = useState<string | null>(null);

  // NEW: Apply time frame filtering and variable splitting
  const assetsMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  
  const timeFilteredResults = useMemo(() => {
    if (!timeAxisConfig?.timeFrame?.enabled || !timeAxisConfig.timeFrame.startDate || !timeAxisConfig.timeFrame.endDate) {
      return results;
    }

    const { startDate, endDate } = timeAxisConfig.timeFrame;
    
    return results.filter(result => {
      const timestamp = getTimestamp(result, assetsMap, timeAxisConfig);
      if (!timestamp) return false;
      
      return timestamp >= startDate && timestamp <= endDate;
    });
  }, [results, timeAxisConfig, assetsMap]);

  const processedResults = useMemo(() => {
    if (variableSplittingConfig?.enabled) {
      return applySplittingToResults(timeFilteredResults, variableSplittingConfig);
    }
    return { all: timeFilteredResults };
  }, [timeFilteredResults, variableSplittingConfig]);

  // Use the appropriate results for graph generation
  const resultsForGraph = useMemo(() => {
    // For graph visualization, we typically want to combine all split results
    // as the graph shows relationships across the entire dataset
    const allResults: FormattedAnnotation[] = [];
    Object.values(processedResults).forEach(splitResults => {
      allResults.push(...splitResults);
    });
    return allResults.length > 0 ? allResults : timeFilteredResults;
  }, [processedResults, timeFilteredResults]);

  // Detect a graph-shaped field via the same structural inference the role
  // picker uses. ``inferNodeShape`` flags any array<object> whose item shape
  // carries the SPO keys (subject_name + predicate + object_name) — this
  // catches the canonical `triplets` field, multi-graph-field schemas like
  // GGL's `netzwerk` / `regulatorische_handlungen`, and anything else built
  // from the same picker primitive. No name-based matching: per project
  // policy, only `triplets` is the named exception, and shape inference
  // already includes it.
  const hasGraphFields = useCallback((schema: AnnotationSchemaRead): boolean => {
    return flattenFieldPaths(walkOutputContract(schema))
      .some(fp => fp.shape === 'triplet');
  }, []);

  const graphSchemas = useMemo(() => {
    const runMatches = schemas.filter(hasGraphFields);
    if (runMatches.length > 0) return runMatches;
    return (allSchemas ?? []).filter(hasGraphFields);
  }, [schemas, allSchemas, hasGraphFields]);

  // Auto-select first graph schema if none selected
  useEffect(() => {
    if (graphSchemas.length > 0 && !selectedSchemaId) {
      const firstSchemaId = graphSchemas[0].id.toString();
      setSelectedSchemaId(firstSchemaId);
      // Persist selection
      onSettingsChange?.({ selectedGraphSchemaId: graphSchemas[0].id });
    }
  }, [graphSchemas, selectedSchemaId, onSettingsChange]);

  // Sync the graph's locally selected schema down into the panel's
  // formula.schema_id so the backend's FormulaQuery filters annotations
  // to just that schema. Without this, the request goes out with
  // schema_id=null and graph_stream finds no triplets when the run
  // mixes schemas. (The pie / chart auto-select via PanelConfigPopover
  // only fires for single-schema runs — graph needs its own sync since
  // its selectedSchemaId is independent of the popover's schema slot.)
  useEffect(() => {
    const sid = selectedSchemaId ? parseInt(selectedSchemaId) : null;
    if (!sid) return;
    const current = (panelConfig.formula as any)?.schema_id ?? null;
    if (current === sid) return;
    onUpdatePanel({
      formula: { ...(panelConfig.formula as any), schema_id: sid },
    } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchemaId]);


  // Colours, icons and arrow heads the CONTRACT declares.
  //
  // These were being read from a legacy `graphConfig` key that the current
  // editor no longer writes, so a schema author could pick a palette, watch it
  // round-trip through save and reload intact — there is a test asserting
  // exactly that — and never see it on the canvas. `readGraphStyle` walks for
  // the `x-*` extensions the editor actually emits, and still reads the legacy
  // shape so older contracts keep their appearance.
  const schemaStyle = useMemo(() => {
    if (!selectedSchemaId) return null;
    const schema = [...schemas, ...(allSchemas || [])]
      .find(s => s.id.toString() === selectedSchemaId);
    if (!schema?.output_contract) return null;
    const style = readGraphStyle(schema.output_contract);
    return hasGraphStyle(style) ? style : null;
  }, [selectedSchemaId, schemas, allSchemas]);

  const schemaColorOverrides = useMemo(() => {
    if (!schemaStyle) return undefined;
    return {
      schemaColors: schemaStyle.typeColors,
      predicateColors: schemaStyle.predicateColors,
    };
  }, [schemaStyle]);

  const schemaTypeIcons = useMemo(
    () => (Object.keys(schemaStyle?.typeIcons ?? {}).length
      ? schemaStyle!.typeIcons : undefined),
    [schemaStyle],
  );

  const schemaPredicateArrows = useMemo(
    () => (Object.keys(schemaStyle?.predicateArrows ?? {}).length
      ? schemaStyle!.predicateArrows : undefined),
    [schemaStyle],
  );

  // Handle graph config change (frontend-local GraphViewConfig — unrelated to
  // backend GraphVizConfig; persisted in settings so the force-graph renderer
  // picks it up across remounts).
  const handleGraphConfigChange = useCallback((newConfig: GraphViewConfig) => {
    setGraphConfig(newConfig);
    onSettingsChange?.({ graphViewConfig: newConfig });
  }, [onSettingsChange]);

  // Companion integration. The operator writes a GQL string into the bar
  // rather than mutating hidden state — the user sees exactly what was written
  // and can edit it, same contract as the content explorer's search command.
  // `focus` drills into one node by name so "show me Merkel's neighbourhood"
  // becomes a query the user can then widen or narrow themselves.
  // **The writer proposes; a person commits.** These used to call
  // `setGraphQuery` — the *applied* value — so a model rewrote the panel under
  // the analyst and nothing re-parsed what it wrote. Both halves of that were
  // wrong: a hallucinated token degrades to a free-text name match and comes
  // back with a plausible handful of nodes, and by then the view has already
  // changed. Routing to the draft keeps the proposal visible, checkable and
  // one keystroke from being accepted.
  //
  // `clearQuery` still applies directly: clearing is unambiguous and reversible.
  useSurfaceCommands('graph', {
    query: (p) => setGraphDraft(String(p?.q ?? '')),
    focus: (p) => {
      const name = String(p?.name ?? '').trim();
      if (!name) return;
      const hops = Number(p?.hops ?? 1);
      setGraphDraft(`from:"${name}" hops:${Number.isFinite(hops) ? hops : 1}`);
    },
    clearQuery: () => setGraphQuery(''),
  });

  // Search suggestions based on node labels
  const searchSuggestions = useMemo(() => {
    if (!searchTerm || !nodes.length) return [];
    
    // Create a Map to ensure unique suggestions by ID
    const uniqueSuggestions = new Map();
    
    nodes
      .filter(node => 
        node.label.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .forEach(node => {
        if (!uniqueSuggestions.has(node.id)) {
          uniqueSuggestions.set(node.id, {
            id: node.id,
            label: node.label,
            type: node.type,
            frequency: node.frequency || 1,
          });
        }
      });
    
    return Array.from(uniqueSuggestions.values()).slice(0, 8); // Limit suggestions
  }, [searchTerm, nodes]);

  // Get connected node IDs for a given node
  const getConnectedNodeIds = useCallback((nodeId: string): string[] => {
    const connected = new Set<string>();
    
    edges.forEach(edge => {
      if (edge.sourceId === nodeId) {
        connected.add(edge.targetId);
      }
      if (edge.targetId === nodeId) {
        connected.add(edge.sourceId);
      }
    });
    
    return Array.from(connected);
  }, [edges]);

  // Get detailed information about a node
  // Map annotation_id → asset_id for the rows fetched alongside the graph,
  // so we can derive the node's "appears in documents" set from the graph
  // node's ``annotationIds`` (which the backend returns per-node).
  const annotationIdToAssetId = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of results) m.set(r.id, r.asset_id);
    return m;
  }, [results]);

  /** The asset an edge is attributed to for lens/filter purposes. An edge
   *  aggregated across several documents has several; the asset lens is a
   *  membership test (``edgeAssetMap``) and this is only the card's badge, so
   *  the first is the honest answer rather than a fabricated "primary". */
  const firstAssetIdOf = useCallback((e: GraphEdge): number => {
    for (const aid of e.annotationIds ?? []) {
      const assetId = annotationIdToAssetId.get(aid);
      if (assetId != null) return assetId;
    }
    return -1;
  }, [annotationIdToAssetId]);

  const getNodeDetails = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;

    const connectedNodeIds = getConnectedNodeIds(nodeId);
    const connectedNodes = nodes.filter(n => connectedNodeIds.includes(n.id));

    const outgoingEdges = edges.filter(e => e.sourceId === nodeId);
    const incomingEdges = edges.filter(e => e.targetId === nodeId);

    // Derive unique source asset ids from the node's annotation ids.
    const sourceAssetIdsSet = new Set<number>();
    for (const aid of (node.annotationIds ?? [])) {
      const assetId = annotationIdToAssetId.get(aid);
      if (assetId != null) sourceAssetIdsSet.add(assetId);
    }
    const sourceAssetIds = Array.from(sourceAssetIdsSet);

    return {
      ...node,
      connectedNodes,
      outgoingEdges,
      incomingEdges,
      totalConnections: connectedNodeIds.length,
      sourceAssetIds,
      sourceAssetCount: sourceAssetIds.length,
    };
  }, [nodes, edges, getConnectedNodeIds, annotationIdToAssetId]);

  // Evidence drawer state — double-click a node to drill into its annotations.
  const [evidenceScope, setEvidenceScope] = useState<Scope | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // Node click / search-jump: open the side panel first, then trigger the
  // highlight (and its zoom-to-node effect) after the panel has fully laid
  // out. Doing both in the same batch lets D3ForceGraph's centering math
  // fire against the still-full SVG, so the node lands off to the left once
  // the pane shrinks. A small timeout ensures react-resizable-panels has
  // settled the new pane width before we measure.
  const handleNodeSelect = useCallback((node: GraphNode) => {
    // Engaging a node = anchor becomes most-recently-engaged → owns HUD.
    // The pin-set lens (if active) stays visible on canvas as context.
    lastEngagedRef.current = 'anchor';
    setSelectedBundle(null);
    if (showDetailPanel) {
      setSelectedNodeId(node.id);
      return;
    }
    setShowDetailPanel(true);
    setTimeout(() => {
      setSelectedNodeId(node.id);
    }, 300);
  }, [showDetailPanel]);

  // ── HUD (occurrences + evidence) ────────────────────────────────────────
  //
  // Selecting from a list is the reverse of the usual direction: you fix the
  // items pane, click a row, and the canvas follows. That is the whole reason
  // a pane can be unlinked from the lens.
  const handleNodeSelectById = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) handleNodeSelect(node);
  }, [nodes, handleNodeSelect]);

  const hudConfig = useMemo(
    () => (cfg as any)?.hud ?? undefined,
    [cfg],
  );
  const handleHudConfigChange = useCallback((next: HudConfig) => {
    onUpdatePanel({ panel_config: { ...cfg, hud: next } as GraphVizConfig });
  }, [onUpdatePanel, cfg]);
  // Fully resolved, for the controls. `GraphHUD` merges defaults itself so a
  // panel that has never been configured renders; the toggles need the same
  // merged view to show what is actually on rather than what was persisted.
  const resolvedHudConfig: HudConfig = useMemo(() => ({
    ...defaultHudConfig,
    ...hudConfig,
    items: { ...defaultHudConfig.items, ...hudConfig?.items },
    evidence: { ...defaultHudConfig.evidence, ...hudConfig?.evidence },
    bars: { ...defaultHudConfig.bars, ...hudConfig?.bars },
    lanes: { ...defaultHudConfig.lanes, ...hudConfig?.lanes },
  }), [hudConfig]);

  // ---- Panes -------------------------------------------------------------
  // `n` panes, each a query, replacing four named slots with four bespoke
  // selectors. Persisted on `panel_config.hud.panes` — the same opaque bag the
  // old config used, so nothing needs migrating that has not already been
  // written by a newer panel.
  const panes: PaneSpec[] = useMemo(
    () => (hudConfig?.panes as PaneSpec[] | undefined) ?? [],
    [hudConfig],
  );

  const writePanes = useCallback((next: PaneSpec[]) => {
    onUpdatePanel({
      panel_config: { ...cfg, hud: { ...(hudConfig ?? {}), panes: next } } as GraphVizConfig,
    });
  }, [onUpdatePanel, cfg, hudConfig]);

  const handleUpdatePane = useCallback((id: string, next: Partial<PaneSpec>) => {
    writePanes(panes.map(p => (p.id === id ? { ...p, ...next } : p)));
  }, [panes, writePanes]);

  const handleRemovePane = useCallback((id: string) => {
    writePanes(panes.filter(p => p.id !== id));
  }, [panes, writePanes]);

  // **Region widths: live in state, persisted on release.**
  //
  // A drag emits a move event per frame, and writing `panel_config` sixty times
  // a second would round-trip the whole panel config through the API on every
  // one of them. So the drag drives local state — the column follows the hand —
  // and only the release writes. Reads fall back to the stored value, so a
  // reload keeps the width.
  const [dragSize, setDragSize] = useState<RegionSize | null>(null);
  const regionSize: RegionSize = useMemo(
    () => dragSize ?? ((hudConfig?.regionSize as RegionSize | undefined) ?? {}),
    [dragSize, hudConfig],
  );

  const handleResizeRegion = useCallback((region: PaneRegion, px: number) => {
    setDragSize(prev => ({ ...(prev ?? regionSize), [region]: px }));
  }, [regionSize]);

  const handleCommitRegion = useCallback((region: PaneRegion, px: number) => {
    const next = { ...regionSize, [region]: px };
    setDragSize(null);
    onUpdatePanel({
      panel_config: {
        ...cfg, hud: { ...(hudConfig ?? {}), regionSize: next },
      } as GraphVizConfig,
    });
  }, [regionSize, onUpdatePanel, cfg, hudConfig]);

  const handleAddPane = useCallback((region: PaneRegion) => {
    // Named for the question, not chosen from a list. A name that matches a
    // preset gets its binding; one that does not gets a plain list, which is
    // exactly as legitimate.
    writePanes([...panes, { ...makePane('New pane', panes), region }]);
  }, [panes, writePanes]);

  // A row click drives the canvas. Picking a node selects it; picking a fold
  // bucket scopes the QUERY to that bucket rather than holding a private
  // selection — which is what makes the gesture survive a reload, travel with
  // a shared dashboard and be reachable by the companion.
  // Alt-clicking a bar writes the window into the query. Same reasoning as
  // clicking a place: a temporal gesture is a query edit, not a private
  // viewport state, so it survives reload, travels with a shared dashboard,
  // and narrows every pane at once instead of only the canvas.
  const handleScopeToWindow = useCallback((from: string, to: string) => {
    const cleaned = graphQuery
      .split(/\s+/)
      .filter(t => !/^-?(after|before):/i.test(t))
      .join(' ');
    setGraphQuery(
      `${cleaned} after:${from.slice(0, 10)} before:${to.slice(0, 10)}`.trim(),
    );
  }, [graphQuery, setGraphQuery]);

  /**
   * Which table a pane shows.
   *
   * By name first, because a pane IS named after its section. But a pane
   * persisted before that was true — every panel seeded while the default pane
   * was called `rows` — has a name no section answers, and matching on the name
   * alone rendered "No rows for this query" over a table that was sitting right
   * there in the payload. A stored pane outliving a naming change is normal;
   * losing its contents to one is not.
   *
   * So: the name, then the section its own query names, then the only table
   * there is. Each fallback is narrower than the last and none of them guesses
   * between two candidates.
   */
  const tableForPane = useCallback((name: string): SectionRows | undefined => {
    const want = name.trim().toLowerCase();
    const byName = sectionTables.find(t => t.section.toLowerCase() === want);
    if (byName) return byName;
    const spec = panes.find(p => p.name.trim().toLowerCase() === want);
    const named = /\bSECTION:\s*([A-Za-z0-9_]+)/i.exec(spec?.q ?? '')?.[1];
    if (named) {
      const bySpec = sectionTables.find(
        t => t.section.toLowerCase() === named.toLowerCase(),
      );
      if (bySpec) return bySpec;
    }
    return sectionTables.length === 1 ? sectionTables[0] : undefined;
  }, [sectionTables, panes]);

  const handlePanePick = useCallback((row: SurfaceRow) => {
    if (row.nodeId) {
      const node = nodes.find(n => n.id === row.nodeId);
      if (node) { handleNodeSelect(node); return; }
    }
    if (row.keys.length === 1 && row.keys[0]) {
      setGraphQuery(appendGraphToken(graphQuery, `label=="${row.keys[0]}"`));
    }
  }, [nodes, handleNodeSelect, graphQuery, setGraphQuery]);

  // Derivation, on commit only.
  //
  // **Two kinds of pane, two rules.**
  //
  // A pane the analyst opened (`PANEL:Consignments`, or the ＋ button) is
  // theirs: derivation only ever turns those ON, never off, because editing a
  // query is not a request to close what you were reading.
  //
  // A pane the ENGINE derived is a view of the query — it exists because
  // `SECTION:` named a section, and it has no content the query does not
  // decide. So it follows the query. Protecting it under "never subtract"
  // is what froze a panel showing one pane called `exhibits` reading "No rows
  // for this query" while the engine was returning tables for `observations`
  // and `actors`: seeding was gated on `panes.length === 0`, so once a panel
  // had any pane at all, a new section could never get one.
  useEffect(() => {
    if (!inferredPanes.length) return;
    // **Backfill.** A pane persisted before the engine resolved scopes carries
    // no `q`, so it folds the whole node set under a name promising something
    // narrower. Adopting the inferred scope where the analyst has not written
    // one keeps "the query proposes, configuration disposes" — an explicit `q`
    // is never overwritten.
    const filled = panes.map(p => {
      if (p.q || !p.linked) return p;
      const inf = inferredPanes.find(
        i => i.name.trim().toLowerCase() === p.name.trim().toLowerCase());
      return inf?.q ? { ...p, q: inf.q, kind: p.kind ?? (inf.kind ?? undefined) } : p;
    });
    // A panel that has never been configured has no analyst panes, so every
    // pane it gets is derived — which is exactly what reconciliation produces.
    const next = derivePanes(
      graphQuery, reconcileDerived(filled, inferredPanes), inferredPanes,
    );
    // Compare by content, not length — a backfill changes no count.
    if (JSON.stringify(next) !== JSON.stringify(panes)) writePanes(next);
  }, [graphQuery, panes, inferredPanes, writePanes]);


  // Region mode: a spatial gesture is a query edit, not a private viewport
  // state. Writing `near:` into `q` is what makes clicking a place scope the
  // canvas, the items and the evidence together — and makes the gesture
  // survive reload, travel with a shared dashboard, and be reachable by the
  // companion, none of which a map's own selection would be.
  const activePlace = useMemo(() => {
    const m = /(?:^|\s)near:"?([^"<\s]+)"?/.exec(graphQuery);
    return m ? m[1] : null;
  }, [graphQuery]);

  // Scoping to an interest is the first step of the whole method: narrow to a
  // `why`, and the occurrences, evidence, map and bars all follow.
  const handleScopeToInterest = useCallback((interest: string) => {
    const stripped = graphQuery.replace(/(?:^|\s)serves:"?[^"\s]+"?/gi, '').trim();
    const quoted = /[\s,]/.test(interest) ? `"${interest}"` : interest;
    const already = new RegExp(`serves:"?${interest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, 'i')
      .test(graphQuery);
    setGraphQuery(already ? stripped : `${stripped ? `${stripped} ` : ''}serves:${quoted}`);
  }, [graphQuery, setGraphQuery]);

  const handleScopeToPlace = useCallback((place: string, radiusKm: number) => {
    const stripped = graphQuery.replace(/(?:^|\s)near:"?[^"<\s]+"?(?:<\d+(?:km|mi)?)?/gi, '').trim();
    const quoted = /[\s,]/.test(place) ? `"${place}"` : place;
    // Clicking the active place again clears it — the same toggle semantics as
    // every other chip, so nothing needs a separate "clear" affordance.
    const next = activePlace?.toLowerCase() === place.toLowerCase()
      ? stripped
      : `${stripped ? `${stripped} ` : ''}near:${quoted}<${radiusKm}km`;
    setGraphQuery(next);
  }, [graphQuery, activePlace, setGraphQuery]);

  // Open the edge-bundle inspector for a (focal, peer) pair — fired from the
  // node HUD's peer-grouped connection rows. Closes the node HUD (clears the
  // focal node) so the bundle inspector owns the surface, mirroring a direct
  // edge click on the canvas.
  const openBundleForPeer = useCallback((focalId: string, peerId: string) => {
    const bundle = bundlesById.get(bundleIdForPair(focalId, peerId));
    if (!bundle) return;
    lastEngagedRef.current = 'anchor';
    setSelectedNodeId(null);
    setSelectedBundle(bundle);
    setShowDetailPanel(true);
  }, [bundlesById]);

  // Handle shift+click for merge selection
  const handleNodeShiftClick = useCallback((node: GraphNode) => {
    setMergeSelectedIds(prev => {
      if (prev.includes(node.id)) {
        const next = prev.filter(id => id !== node.id);
        // If we removed the keep target, reset to first remaining
        setMergeKeepId(kid => kid === node.id ? (next[0] || null) : kid);
        return next;
      }
      const next = [...prev, node.id];
      // Auto-select first node as keep target and type
      if (next.length === 1) {
        setMergeKeepId(node.id);
        setMergeKeepType(node.type);
      }
      return next;
    });
  }, []);

  // Execute merge: apply to GraphEdits + persist entity_merges to run's graph_config
  const executeMerge = useCallback(async () => {
    if (mergeSelectedIds.length < 2) return;

    // Find the nodes being merged
    const mergeNodes = nodes.filter(n => mergeSelectedIds.includes(n.id));
    if (mergeNodes.length < 2) return;

    // Keep the user-chosen node (or first if none chosen)
    const keepNode = mergeNodes.find(n => n.id === mergeKeepId) || mergeNodes[0];
    const mergedNodeIds = mergeSelectedIds.filter(id => id !== keepNode.id);

    // 1. Update GraphEdits (client-side visual merge)
    const currentEdits = graphEdits || createEmptyGraphEdits();
    const updatedEdits: GraphEdits = {
      ...currentEdits,
      mergedNodes: [
        ...currentEdits.mergedNodes,
        {
          targetNodeId: keepNode.id,
          mergedNodeIds,
          mergedAt: new Date().toISOString(),
          reason: 'User merge (shift+click)',
        },
      ],
    };
    onGraphEditsChange?.(updatedEdits);

    // 2. Persist entity_merges to run's graph_config for curation
    if (activeRunId) {
      try {
        const mergedNames = mergeNodes.map(n => n.label);
        // Build the merge hint for the backend (include type if user chose one)
        const chosenType = mergeKeepType || keepNode.type;
        const newMergeGroup: Record<string, unknown> = {
          names: mergedNames,
          keep: keepNode.label,
        };
        if (chosenType) {
          newMergeGroup.type = chosenType;
        }

        // PATCH the run's graph_config (use fetch directly since SDK may not have graph_config yet)
        const { OpenAPI } = await import('@/client');
        const base = OpenAPI.BASE || '';

        const getRes = await fetch(`${base}/api/v1/infospaces/${activeInfospace!.id}/runs/${activeRunId}`, {
          credentials: 'include',
        });
        const currentRun = await getRes.json();
        const currentGraphConfig = currentRun.graph_config || {};
        const existingMerges = currentGraphConfig.entity_merges || [];

        await fetch(`${base}/api/v1/infospaces/${activeInfospace!.id}/runs/${activeRunId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            graph_config: {
              ...currentGraphConfig,
              entity_merges: [...existingMerges, newMergeGroup],
            },
          }),
        });
      } catch (e) {
        console.error('Failed to persist merge to run graph_config:', e);
        // Visual merge still applies; persistence failure is non-fatal
      }
    }

    setMergeSelectedIds([]);
    setMergeKeepId(null);
    setMergeKeepType(null);
    toast.success(`Merged ${mergeNodes.length} nodes into "${keepNode.label}"`);
    // Re-aggregate will be triggered by graphEdits change via useEffect
  }, [mergeSelectedIds, mergeKeepId, mergeKeepType, nodes, graphEdits, onGraphEditsChange, activeRunId, activeInfospace]);

  // Handle search selection. Clears the term + blurs the input on commit so
  // the immediate next action (arrow Left/Right to navigate the new node's
  // connections) works without the user having to manually exit the search.
  const handleSearchSelect = useCallback((suggestion: any) => {
    setSearchTerm('');
    setShowSuggestions(false);
    if (searchInputRef.current) searchInputRef.current.blur();
    const node = nodes.find(n => n.id === suggestion.id);
    if (node) {
      handleNodeSelect(node);
    }
  }, [nodes, handleNodeSelect]);

  // Clear selection
  // Clear all HUD-bound state in one place so background click, ESC, and the
  // X button all produce identical results. Lenses (asset, pin) are tied to
  // HUD presence — when there's no HUD, the canvas is "neutral" (legends
  // visible, no amber/blue overlay). Pinned nodes themselves stay pinned in
  // the data; only the visual lens flips off.
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedBundle(null);
    setShowDetailPanel(false);
    setSearchTerm('');
    setShowSuggestions(false);
    setHighlightedAssetId(null);
    setPinBoardState(pb => pb.showLens ? { ...pb, showLens: false } : pb);
  }, []);

  // Esc closes the detail panel (parity with the X button and clicking the
  // graph background). Only acts when something is actually selected so we
  // don't intercept Esc for unrelated UI elsewhere on the page.
  useEffect(() => {
    if (!showDetailPanel && !selectedNodeId && !selectedBundle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDetailPanel, selectedNodeId, selectedBundle, clearSelection]);

  // Reset the bundle's per-predicate filter whenever a different bundle opens.
  useEffect(() => { setBundlePredFilter(new Set()); }, [selectedBundle?.id]);

  // "/" jumps to the search bar (skip when another input already has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!searchInputRef.current) return;
      e.preventDefault();
      searchInputRef.current.focus();
      searchInputRef.current.select();
      setShowSuggestions(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // (Arrow-key connection navigation effect lives further down, after the
  // ``arrowNavCandidates`` / ``navigatedPeerId`` memos that it depends on.)

  // Reset the active suggestion when the suggestion list changes.
  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [searchTerm]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showSuggestions) setShowSuggestions(true);
      setActiveSuggestionIndex(i => Math.min(i + 1, Math.max(0, searchSuggestions.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (searchSuggestions.length === 0) return;
      e.preventDefault();
      const idx = Math.max(0, Math.min(activeSuggestionIndex, searchSuggestions.length - 1));
      handleSearchSelect(searchSuggestions[idx]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      e.currentTarget.blur();
    }
  }, [showSuggestions, searchSuggestions, activeSuggestionIndex, handleSearchSelect]);

  // Graph data now comes from useAnnotationView hook response
  const aggregateGraph = useCallback(() => {
    // Data is fetched automatically by the useAnnotationView hook
    // This function is kept for the refresh button
    refetchView();
  }, [refetchView]);

  const handleExportGraph = () => {
    if (graphData) {
      const dataStr = JSON.stringify(graphData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `graph-export-run-${activeRunId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Graph data exported');
    }
  };

  // Load available knowledge graphs when curate panel opens
  useEffect(() => {
    if (showCuratePanel && activeInfospace?.id) {
      KnowledgeGraphsService.listKnowledgeGraphs({ infospaceId: activeInfospace.id })
        .then(graphs => setAvailableGraphs(graphs as KnowledgeGraphRead[]))
        .catch(() => setAvailableGraphs([]));
    }
  }, [showCuratePanel, activeInfospace?.id]);

  // Build annotation → triplet fragment paths map for curation
  const curationData = useMemo(() => {
    if (!selectedSchemaId) return { annotations: [], totalTriplets: 0 };
    const schemaId = parseInt(selectedSchemaId);
    const annotations: { id: number; paths: string[] }[] = [];
    let totalTriplets = 0;

    for (const result of resultsForGraph) {
      if (result.schema_id !== schemaId) continue;
      const value = result.value;
      if (!value || typeof value !== 'object') continue;

      // Find triplets array (handles document nesting)
      const doc = (value as any).document || value;
      const triplets = doc?.triplets;
      if (!Array.isArray(triplets) || triplets.length === 0) continue;

      const paths = triplets.map((_: any, i: number) => `triplets[${i}]`);
      annotations.push({ id: result.id, paths });
      totalTriplets += paths.length;
    }
    return { annotations, totalTriplets };
  }, [resultsForGraph, selectedSchemaId]);

  // Convert GraphEdits merges to entity_merges format for the curate request
  const buildEntityMerges = useCallback(() => {
    if (!graphEdits?.mergedNodes?.length) return undefined;
    return graphEdits.mergedNodes.map(merge => {
      const keepNode = nodes.find(n => n.id === merge.targetNodeId);
      const mergedNodes = merge.mergedNodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean);
      return {
        keep: keepNode?.label || '',
        names: [keepNode?.label || '', ...mergedNodes.map(n => n!.label)],
        type: keepNode?.type || undefined,
      };
    }).filter(m => m.keep);
  }, [graphEdits, nodes]);

  // Execute curation
  const handleCurate = useCallback(async () => {
    if (!activeInfospace?.id || curationData.annotations.length === 0) return;
    setIsCurating(true);
    const entityMerges = buildEntityMerges();
    const graphId =
      targetGraphId && targetGraphId !== CURATE_TARGET_GRAPH_INFOSPACE_DEFAULT
        ? parseInt(targetGraphId, 10)
        : undefined;
    let totalCurated = 0;
    let totalEdges = 0;
    let failures = 0;

    for (const ann of curationData.annotations) {
      try {
        const res = await AnnotationsService.curateFragments({
          infospaceId: activeInfospace.id,
          annotationId: ann.id,
          requestBody: {
            fragment_paths: ann.paths,
            graph_id: graphId,
            entity_merges: entityMerges,
            status: 'curated',
          } as any,
        });
        totalCurated += (res as any)?.curated || 0;
        totalEdges += (res as any)?.edges_created || 0;
      } catch (e: any) {
        console.error(`Failed to curate annotation ${ann.id}:`, e);
        failures++;
      }
    }

    setIsCurating(false);
    setShowCuratePanel(false);
    if (failures === 0) {
      toast.success(`Curated ${totalCurated} triplets, ${totalEdges} edges created`);
    } else {
      toast.warning(`Curated ${totalCurated} triplets (${failures} annotations failed)`);
    }
  }, [activeInfospace?.id, curationData, buildEntityMerges, targetGraphId]);

  // Get connected node IDs for highlighting
  // Find potential duplicate entities via embedding similarity
  const handleFindDuplicates = useCallback(async () => {
    if (!activeInfospace?.id || nodes.length < 2) return;
    setShowDedupPanel(true);
    setIsDedupLoading(true);
    setDedupError(null);
    try {
      const entityNames = nodes.map(n => n.label);
      const response = await EntitiesService.findEntityDuplicates({
        infospaceId: activeInfospace.id,
        requestBody: { items: entityNames, threshold: 0.85 },
      });
      const pairs = (response as any).pairs || [];
      setDedupPairs(pairs);
      setDedupDismissed(new Set());
    } catch (err: any) {
      setDedupError(err.body?.detail || err.message || 'Failed to find duplicates');
    } finally {
      setIsDedupLoading(false);
    }
  }, [activeInfospace?.id, nodes]);

  // Accept a dedup suggestion → stage as merge
  const handleAcceptDedup = useCallback((pair: SimilarPairRead) => {
    const nodeA = nodes.find(n => n.label === pair.a_item);
    const nodeB = nodes.find(n => n.label === pair.b_item);
    if (!nodeA || !nodeB) return;
    // Pick the higher-frequency node as the keep target
    const keep = (nodeA.frequency || 1) >= (nodeB.frequency || 1) ? nodeA : nodeB;
    const merge = keep.id === nodeA.id ? nodeB : nodeA;
    setMergeSelectedIds([keep.id, merge.id]);
    setMergeKeepId(keep.id);
    setMergeKeepType(keep.type);
    // Dismiss this pair
    const key = `${pair.a_index}-${pair.b_index}`;
    setDedupDismissed(prev => new Set(prev).add(key));
    toast.info(`Staged merge: "${merge.label}" → "${keep.label}". Click Merge to confirm.`);
  }, [nodes]);

  const activeDedupPairs = useMemo(() => {
    return dedupPairs.filter(p => !dedupDismissed.has(`${p.a_index}-${p.b_index}`));
  }, [dedupPairs, dedupDismissed]);

  const connectedNodeIds = useMemo(() => {
    if (!selectedNodeId) return [];
    return getConnectedNodeIds(selectedNodeId);
  }, [selectedNodeId, getConnectedNodeIds]);

  // ``effectiveConnectedNodeIds`` is computed below, after ``navigatedPeerId``
  // is declared. The placement ordering matters because the memo depends on
  // it; pulling the declaration up here would cause a TDZ reference error.

  // An empty graph has two very different causes, and telling the user the
  // wrong one is worse than saying nothing.
  //
  // The old test was "no `source` and no group path" → "pick a triplet field",
  // which on a v2 schema is advice for a control that no longer exists and a
  // field the engine ignores. What actually decides it is whether the ENGINE
  // resolved any layers: none means the schema declares nothing graphable
  // (real, and not fixable from this panel); some-but-empty means the layers
  // ran and the rows were blank, which is a corpus problem.
  const nothingGraphable = layers.length === 0;

  const selectedNodeDetails = selectedNodeId ? getNodeDetails(selectedNodeId) : null;

  // ---- Arrow-nav candidate lists. The search query (``searchTerm``) acts
  // as a *filter* over which connections are arrow-navigable — not a hard
  // visual filter on the chips. With no query, every connection is a
  // candidate. With a query, only connections whose peer label or
  // predicate matches are candidates. ----
  const arrowNavCandidates = useMemo(() => {
    if (!selectedNodeDetails) return { out: [] as GraphEdge[], in: [] as GraphEdge[] };
    const q = searchTerm.trim().toLowerCase();
    const matchEdge = (edge: GraphEdge, peerId: string) => {
      if (!q) return true;
      const peer = nodes.find(n => n.id === peerId);
      const peerLabel = (peer?.label ?? peerId).toLowerCase();
      return peerLabel.includes(q) || edge.predicate.toLowerCase().includes(q);
    };
    return {
      out: selectedNodeDetails.outgoingEdges.filter(e => matchEdge(e, e.targetId)),
      in: selectedNodeDetails.incomingEdges.filter(e => matchEdge(e, e.sourceId)),
    };
  }, [selectedNodeDetails, searchTerm, nodes]);

  const navigatedEdge: GraphEdge | null = useMemo(() => {
    const list = arrowNav.direction === 'out' ? arrowNavCandidates.out : arrowNavCandidates.in;
    if (arrowNav.index < 0 || list.length === 0) return null;
    return list[arrowNav.index % list.length] ?? null;
  }, [arrowNav, arrowNavCandidates]);

  const navigatedPeerId: string | null = useMemo(() => {
    if (!navigatedEdge) return null;
    return arrowNav.direction === 'out' ? navigatedEdge.targetId : navigatedEdge.sourceId;
  }, [navigatedEdge, arrowNav.direction]);

  // Hover state for the right-rail "Connection details" cards. When a card
  // is hovered, we drive the same highlight surface as keyboard arrow-nav:
  // edge in amber, peer node lit, every other neighbour dimmed. Hover wins
  // over keyboard nav so the user's most recent interaction is what's shown.
  const [hoveredEvidence, setHoveredEvidence] = useState<{ edgeId: string; peerId: string } | null>(null);

  // Reset hover when the selection changes — stale hover refs from a
  // previous focused node would point at edges that no longer apply.
  useEffect(() => { setHoveredEvidence(null); }, [selectedNodeId]);

  const activeEdgeId: string | null = hoveredEvidence?.edgeId ?? navigatedEdge?.id ?? null;
  const activePeerId: string | null = hoveredEvidence?.peerId ?? navigatedPeerId;

  // ---- Edge → asset traceability ----------------------------------------
  // Maps each rendered edge to the set of assets that produced it. Powers the
  // asset-scoped lens: clicking a badge's network icon lights every edge this
  // document spawned, plus the incident nodes.
  //
  // The edge carries ``annotationIds`` — the exact set the engine aggregated
  // it from — so this is a lookup, not a reconstruction. It previously
  // re-matched each edge against ``value.document.triplets`` by
  // (subject, predicate, object) LABEL, which only ever described one legacy
  // schema shape: any observation-model run has no ``triplets`` key at all, so
  // the map came back empty and every badge read a confident 0.
  const edgeAssetMap: Map<string, Set<number>> = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const e of edges) {
      const assetIds = new Set<number>();
      for (const aid of e.annotationIds ?? []) {
        const assetId = annotationIdToAssetId.get(aid);
        if (assetId != null) assetIds.add(assetId);
      }
      if (assetIds.size > 0) map.set(e.id, assetIds);
    }
    return map;
  }, [edges, annotationIdToAssetId]);

  // Asset-scoped highlight lens. Click a badge's network icon → all edges
  // this asset spawned go amber, all incident nodes light up, evidence cards
  // from this asset stay bright (others dim). Click again on the same icon,
  // or focus a different node, → clear.
  const [highlightedAssetId, setHighlightedAssetId] = useState<number | null>(null);
  useEffect(() => { setHighlightedAssetId(null); }, [selectedNodeId]);

  // Per-asset edge contribution count — derived from ``edgeAssetMap`` once
  // and reused by both anchor and subnet HUDs as the badge counter.
  // Semantic: the number on each badge equals the number of edges the
  // asset's Waypoints would actually amber on click. Earlier modes
  // restricted this to focal-incident or inter-pin edges, which produced
  // legitimate-looking 0 counters even when the asset clearly contributed
  // to the graph (just outside the current scope) — confusing the analyst.
  const assetEdgeCount: Map<number, number> = useMemo(() => {
    const m = new Map<number, number>();
    for (const [, assetSet] of edgeAssetMap) {
      for (const aid of assetSet) {
        m.set(aid, (m.get(aid) ?? 0) + 1);
      }
    }
    return m;
  }, [edgeAssetMap]);

  const assetEdgeIds: Set<string> | null = useMemo(() => {
    if (highlightedAssetId == null) return null;
    const out = new Set<string>();
    for (const [edgeId, assetSet] of edgeAssetMap) {
      if (assetSet.has(highlightedAssetId)) out.add(edgeId);
    }
    return out;
  }, [highlightedAssetId, edgeAssetMap]);

  const assetNodeIds: Set<string> | null = useMemo(() => {
    if (!assetEdgeIds || assetEdgeIds.size === 0) return null;
    const out = new Set<string>();
    const edgeById = new Map(edges.map(e => [e.id, e]));
    for (const eid of assetEdgeIds) {
      const e = edgeById.get(eid);
      if (e) { out.add(e.sourceId); out.add(e.targetId); }
    }
    return out;
  }, [assetEdgeIds, edges]);

  // Pin-network lens — direct edges where both endpoints are pinned in the
  // active page. Disconnected pinned nodes still light up via ``pinNodeIds``
  // (ring/highlight) but contribute no edges; that disconnect IS the
  // information ("these aren't directly linked"), per design.
  // Combined pin lens — when on, the active page's pinned ids drive both
  // the canvas highlight (direct cross-pin edges go amber) AND the
  // evidence-rail filter. Same data, two surfaces.
  const pinNodeIds: Set<string> | null = useMemo(() => {
    if (!pinBoard.showLens) return null;
    // Both kinds: bare ids, and the hints a term-pin carried. `pageNodeIds`
    // is the one place that union lives.
    const ids = activePinPage ? pageNodeIds(activePinPage as any) : new Set<string>();
    if (ids.size === 0) return null;
    return ids;
  }, [pinBoard.showLens, activePinPage]);

  // What a pane means by "the selection": the focused node, plus anything
  // pinned. Panes set to `follow: 'lens'` ignore this entirely.
  const hudFocusIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNodeId) ids.add(selectedNodeId);
    if (pinNodeIds) for (const id of pinNodeIds) ids.add(id);
    return ids;
  }, [selectedNodeId, pinNodeIds]);

  // One fetch, N folds. Every pane reduces the SAME nodes and edges the canvas
  // holds, so a pane physically cannot disagree with what is on screen — there
  // is one set in memory and a pane is a reduction of it, never a second
  // request that answers the same question later and differently.
  const paneSurfaces = useMemo(() => {
    const out: Record<string, SurfaceData> = {};
    for (const spec of panes) {
      const q = paneQuery(spec, graphQuery);
      const input = {
        nodes,
        edges: renderEdges,
        q,
        focusIds: spec.follow === 'selection' ? hudFocusIds : undefined,
        legend: graphLegend,
        kind: spec.kind,
        // Same cursor the canvas anchors on, so an interval-scoped place
        // resolves to where the node was at that moment in both.
        cursor: timeCursor,
      };
      // Evidence folds justifications rather than nodes — the one pane whose
      // rows are not things but the words behind things.
      out[spec.id] = spec.name.trim().toLowerCase() === 'evidence'
        ? foldEvidence(input)
        : fold(input);
    }
    return out;
  }, [panes, graphQuery, nodes, renderEdges, hudFocusIds, graphLegend]);


  const pinNetworkEdges: Set<string> | null = useMemo(() => {
    if (!pinNodeIds || pinNodeIds.size < 2) return null;
    const out = new Set<string>();
    for (const e of edges) {
      if (pinNodeIds.has(e.sourceId) && pinNodeIds.has(e.targetId)) out.add(e.id);
    }
    return out;
  }, [pinNodeIds, edges]);

  // Same set drives the evidence-rail filter (peers in active pin page).
  const pinEvidencePeerIds: Set<string> | null = pinNodeIds;

  // ---- HUD owner derivation ----
  // Anchor is "available" iff a node is selected; subnet is "available"
  // iff the pin lens is on with at least one pinned node. When both are
  // available, ``lastEngagedRef`` decides the winner.
  const anchorAvailable = !!selectedNodeId;
  const subnetAvailable = !!pinNodeIds && pinNodeIds.size > 0;
  const hudOwner: 'anchor' | 'subnet' | null = useMemo(() => {
    if (!anchorAvailable && !subnetAvailable) return null;
    if (!anchorAvailable) return 'subnet';
    if (!subnetAvailable) return 'anchor';
    return lastEngagedRef.current;
    // ``lastEngagedRef`` is a ref so it doesn't trigger re-renders on its own.
    // The deps here trigger the recompute whenever availability flips, which
    // is the only time we need to revisit the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorAvailable, subnetAvailable]);

  // Swap action — exposed in the HUD title pill when both scopes are live.
  // Flips ``lastEngagedRef`` and forces a re-render via a no-op state nudge.
  const [, setSwapTick] = useState(0);
  const swapHudOwner = useCallback(() => {
    lastEngagedRef.current = lastEngagedRef.current === 'anchor' ? 'subnet' : 'anchor';
    setSwapTick(t => t + 1);
  }, []);

  // While hover or arrow-nav is active, narrow the connected-set to just
  // the active peer so the renderer dims every other neighbour. Without
  // this, the entire neighbourhood stays bright and the active edge gets
  // lost visually. When both are idle, the full set is used. Asset/pin
  // lenses win over hover — the connected set becomes every node touched
  // by the lens so it reads as "everything this scope said".
  const effectiveConnectedNodeIds = useMemo(() => {
    // Bundle selected → the pair's two endpoints are the focus (kept bright
    // while the rest dims via the edge-nav sub-network).
    if (selectedBundle) return [selectedBundle.sourceId, selectedBundle.targetId];
    if (pinNodeIds && pinNodeIds.size > 0) return Array.from(pinNodeIds);
    if (assetNodeIds && assetNodeIds.size > 0) return Array.from(assetNodeIds);
    if (activePeerId) return [activePeerId];
    return connectedNodeIds;
  }, [selectedBundle, pinNodeIds, assetNodeIds, activePeerId, connectedNodeIds]);

  // Reset arrow-nav whenever the focused node or candidate set changes.
  useEffect(() => {
    setArrowNav({ direction: 'out', index: -1 });
  }, [selectedNodeId, searchTerm]);

  // Arrow-key connection navigation. Active whenever a node is focused and
  // the user isn't in an input. Left/Right cycle outgoing connections;
  // Shift+Left/Right cycle incoming. Enter focuses the navigated peer
  // (becomes the new selected node — arrow nav resets). The search field
  // already handles its own Up/Down/Enter; this handler ignores keys when
  // an input is focused so search results work as before.
  useEffect(() => {
    if (!selectedNodeId || !selectedNodeDetails) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && !(e.key === 'Enter')) return;

      if (e.key === 'Enter') {
        if (!navigatedPeerId) return;
        const peer = nodes.find(n => n.id === navigatedPeerId);
        if (!peer) return;
        e.preventDefault();
        handleNodeSelect(peer);
        return;
      }

      // Direction follows shift state per-press; also resets the index when
      // the user changes direction so they don't jump into a stale slot.
      const direction: 'out' | 'in' = e.shiftKey ? 'in' : 'out';
      const list = direction === 'out' ? arrowNavCandidates.out : arrowNavCandidates.in;
      if (list.length === 0) return;
      e.preventDefault();
      setArrowNav(prev => {
        const sameDir = prev.direction === direction;
        const startIdx = sameDir && prev.index >= 0 ? prev.index : (e.key === 'ArrowRight' ? -1 : 0);
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next = ((startIdx + delta) % list.length + list.length) % list.length;
        return { direction, index: next };
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectedNodeDetails, arrowNavCandidates, navigatedPeerId, nodes, handleNodeSelect]);

  // ---- HUD data (documents + evidence). Memoized keyed off the selected
  // node so the HUD doesn't re-extract justifications on every parent
  // re-render. Mirrors the inline computation that used to live in the JSX
  // detail panel; extracted so it can also feed the HUD overlay. ----
  // ---- HUD field eligibility + visibility (left-rail asset badges) -------
  // Eligible fields are computed once per (schemas × results) — sampled
  // values feed timestamp/location detection. Visibility is single-source-
  // of-truth in panelConfig.settings; when unset we synthesise defaults from
  // ``DEFAULT_ON_CLASSES`` so the badges show something useful out of the
  // box without saving a config the user didn't touch.
  // ``allClassified`` keeps timestamp fields too — needed for asset sorting
  // even though we hide them from the picker.
  const allClassified = useMemo(() => {
    const out: Array<HUDEligibleField & { schema: AnnotationSchemaRead; def: any }> = [];
    for (const schema of schemas) {
      const fields = getTargetKeysForScheme(schema.id, schemas);
      for (const f of fields) {
        const def = getFieldDefinitionFromSchema(schema, f.key);
        if (!def) continue;
        // Sample a non-null value from any result of this schema for the
        // string/timestamp/location classifier.
        let sample: any = null;
        for (const r of results) {
          if (r.schema_id !== schema.id) continue;
          const v = getAnnotationFieldValue(r.value, f.key);
          if (v != null) { sample = v; break; }
        }
        const cls = classifyField(def, f.key, sample);
        if (!cls) continue;
        out.push({
          uid: fieldUid(schema.id, f.key),
          schemaId: schema.id,
          schemaName: schema.name,
          key: f.key,
          name: f.name,
          type: f.type,
          cls,
          defaultOn: DEFAULT_ON_CLASSES.has(cls),
          schema,
          def,
        });
      }
    }
    return out;
  }, [schemas, results]);

  // Picker hides timestamps — they're used for sorting assets, not as values
  // displayed under each badge. Calendar relative-time strings ("3 years ago")
  // were noise, not signal.
  const eligibleFields: HUDEligibleField[] = useMemo(
    () => allClassified
      .filter(f => f.cls !== 'timestamp')
      .map(({ schema, def, ...rest }) => rest),
    [allClassified],
  );

  // Numeric range cache: NumberCell needs a range to render the dotted /
  // segmented bar. Same shape the table builds in its inferFieldRange pass —
  // declared min/max wins, then observed sample inference.
  const hudRangeCache = useMemo(() => {
    const cache: Record<string, Record<string, any>> = {};
    for (const ef of allClassified) {
      if (ef.cls !== 'number') continue;
      const range = inferFieldRange(
        { key: ef.key, name: ef.name, type: ef.type, definition: ef.def },
        results.filter(r => r.schema_id === ef.schemaId),
        getAnnotationFieldValue,
      );
      if (!range) continue;
      const sid = String(ef.schemaId);
      if (!cache[sid]) cache[sid] = {};
      cache[sid][ef.key] = range;
    }
    return cache;
  }, [allClassified, results]);

  const persistedHudVisibleFields = (panelConfig.settings as any)?.hudVisibleFields as string[] | undefined;
  const defaultVisibleFieldUids = useMemo(
    () => eligibleFields.filter(f => f.defaultOn).map(f => f.uid),
    [eligibleFields],
  );
  const effectiveHudVisibleFields = Array.isArray(persistedHudVisibleFields)
    ? persistedHudVisibleFields
    : defaultVisibleFieldUids;
  const setHudVisibleFields = useCallback((next: string[]) => {
    onSettingsChange?.({ hudVisibleFields: next });
  }, [onSettingsChange]);

  const hudShowJustifications = Boolean((panelConfig.settings as any)?.hudShowJustifications);
  const setHudShowJustifications = useCallback((next: boolean) => {
    onSettingsChange?.({ hudShowJustifications: next });
  }, [onSettingsChange]);

  const hudDocuments: HUDDocBadge[] = useMemo(() => {
    if (!selectedNodeDetails?.sourceAssetIds?.length) return [];
    const visibleSet = new Set(effectiveHudVisibleFields);
    // Apply ``not_applicable`` → ``Not Applicable`` to displayed string values
    // so badge content matches the prose convention used elsewhere. Scalar
    // enums are special-cased: TypedCell renders enum chips by matching the
    // raw value against ``def.enum`` — pre-prettifying breaks that match and
    // the value falls back to plain-text render. Keep raw for those; arrays
    // bypass enum matching entirely so per-element prettify is safe there.
    const prettifyForDisplay = (v: any, def: any): any => {
      if (typeof v === 'string') {
        if (Array.isArray(def?.enum)) return v;
        return prettifyValue(v);
      }
      if (Array.isArray(v)) {
        return v.map(item => typeof item === 'string' ? prettifyValue(item) : item);
      }
      return v;
    };

    // Counter = total edges this asset's Waypoints would highlight,
    // pulled from the shared ``assetEdgeCount`` map so both anchor and
    // subnet HUDs report the same number for the same asset.

    const docs = selectedNodeDetails.sourceAssetIds.map((assetId) => {
      const fieldRows: HUDAssetFieldRow[] = [];
      // Detect this asset's timestamp (any timestamp-classified field with a
      // value) — used purely for sort ordering, not displayed.
      let assetTimestamp: number | null = null;
      for (const schema of schemas) {
        const result = results.find(r => r.asset_id === assetId && r.schema_id === schema.id);
        if (!result || !result.value) continue;

        // First sweep: capture timestamp for sort ordering, regardless of
        // visibility — we hide timestamps from the picker but still use them.
        if (assetTimestamp == null) {
          for (const ef of allClassified) {
            if (ef.schemaId !== schema.id || ef.cls !== 'timestamp') continue;
            const tv = getAnnotationFieldValue(result.value, ef.key);
            const parsed = parseTimestampValue(tv);
            if (parsed) { assetTimestamp = parsed.getTime(); break; }
          }
        }

        const eligibleForSchema = eligibleFields.filter(ef => ef.schemaId === schema.id);
        for (const ef of eligibleForSchema) {
          if (!visibleSet.has(ef.uid)) continue;
          const rawValue = getAnnotationFieldValue(result.value, ef.key);
          if (rawValue == null) continue;
          const def = getFieldDefinitionFromSchema(schema, ef.key);
          const just = getJustificationFor(result.value, ef.key);
          fieldRows.push({
            schemaId: schema.id,
            schemaName: schema.name,
            schema,
            field: { key: ef.key, name: ef.name, type: ef.type, definition: def },
            value: prettifyForDisplay(rawValue, def),
            justificationReasoning: just?.reasoning,
            justificationConfidence: just?.confidence,
          });
        }
      }
      return {
        assetId,
        title: assetsMap.get(assetId)?.title ?? undefined,
        fields: fieldRows,
        tripletConnectionCount: assetEdgeCount.get(assetId) ?? 0,
        sortKey: assetTimestamp,
      };
    });

    // Sort by detected timestamp descending (newest first). Assets without a
    // timestamp keep document order, sunk after the timestamped ones.
    const hasAnyTs = docs.some(d => d.sortKey != null);
    if (hasAnyTs) {
      docs.sort((a, b) => {
        if (a.sortKey == null && b.sortKey == null) return 0;
        if (a.sortKey == null) return 1;
        if (b.sortKey == null) return -1;
        return b.sortKey - a.sortKey;
      });
    }
    // Strip the sort key — it's not part of the HUD's data contract.
    return docs.map(({ sortKey, ...rest }) => rest);
  }, [selectedNodeDetails, assetsMap, schemas, results, eligibleFields, allClassified, effectiveHudVisibleFields, assetEdgeCount]);

  // Right-rail "connection details": one item per inline justification riding
  // an edge the focused node is an endpoint of. The edge carries its own
  // ``evidence[]`` and ``annotationIds``, so an item is read off the edge
  // rather than reconstructed.
  //
  // This used to walk ``value.document.triplets`` and match each triplet back
  // to an edge by (peer label, predicate). That shape only exists in one
  // legacy contract; on an observation-model run the loop found no triplets
  // and the whole rail rendered empty while the wire was carrying the
  // justifications the entire time.
  const hudEvidence: HUDEvidenceItem[] = useMemo(() => {
    if (!selectedNodeDetails) return [];
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const out: HUDEvidenceItem[] = [];

    const push = (e: GraphEdge, direction: 'out' | 'in') => {
      const subject = nodeById.get(e.sourceId);
      const object = nodeById.get(e.targetId);
      const peerId = direction === 'out' ? e.targetId : e.sourceId;
      const peer = nodeById.get(peerId);
      if (!peer) return;
      // An edge with no inline justification still deserves a card — the
      // connection is on screen and its provenance is knowable. Absent
      // reasoning renders as a bare sentence rather than being dropped, which
      // is what previously made "no justification" and "no data" look alike.
      const items = e.evidence?.length ? e.evidence : [undefined];
      items.forEach((raw, i) => {
        out.push({
          assetId: firstAssetIdOf(e),
          edgeId: e.id,
          peerId,
          predicate: e.predicate,
          peerLabel: peer.label,
          direction,
          reasoning: raw?.reasoning ?? undefined,
          quote: quoteOf(raw),
          confidence: e.confidence ?? undefined,
          subjectLabel: subject?.label,
          objectLabel: object?.label,
          subjectId: e.sourceId,
          key: `${e.id}:${i}`,
        });
      });
    };

    for (const e of selectedNodeDetails.outgoingEdges) push(e, 'out');
    for (const e of selectedNodeDetails.incomingEdges) push(e, 'in');
    return out;
  }, [selectedNodeDetails, nodes, firstAssetIdOf]);

  // ---- Pin-set subnet scope ----
  // When the pin lens is active and no single node is focused, the HUD
  // pivots from "around this node" to "across this pin set". Same rails —
  // sources, evidence, connections — different scope. Only fires in pin
  // mode; focal mode short-circuits via the `selectedNodeDetails` guard at
  // the render site.
  const pinSubnetScope = useMemo(() => {
    if (!pinNodeIds || pinNodeIds.size === 0) return null;

    // Build the inter-pin edge list once. Reused by both connection lanes
    // and evidence filtering.
    const interPinEdges: GraphEdge[] = [];
    for (const e of edges) {
      if (pinNodeIds.has(e.sourceId) && pinNodeIds.has(e.targetId)) {
        interPinEdges.push(e);
      }
    }

    // Sources: union of assets across every pinned node. Disconnected pin
    // sets still get sources here — the disconnect is only about edges,
    // not the per-node provenance. Same prettify + field-row construction
    // as `hudDocuments`, factored inline rather than DRY-ing it because
    // the focal version pivots on `selectedNodeDetails` which we don't have.
    const visibleSet = new Set(effectiveHudVisibleFields);
    const prettifyForDisplay = (v: any, def: any): any => {
      if (typeof v === 'string') {
        if (Array.isArray(def?.enum)) return v;
        return prettifyValue(v);
      }
      if (Array.isArray(v)) {
        return v.map(item => typeof item === 'string' ? prettifyValue(item) : item);
      }
      return v;
    };

    // Resolve pinned node ids → asset ids (deduped). Pinned nodes that
    // aren't in the current `nodes` set drop out silently.
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const pinSourceAssetIds = new Set<number>();
    for (const nid of pinNodeIds) {
      const n = nodeById.get(nid);
      if (!n?.annotationIds) continue;
      for (const aid of n.annotationIds) {
        const assetId = annotationIdToAssetId.get(aid);
        if (assetId != null) pinSourceAssetIds.add(assetId);
      }
    }

    // Counter = total edges this asset's Waypoints would highlight. Same
    // ``assetEdgeCount`` map drives the anchor HUD too, so an asset's
    // badge number is identical regardless of which mode you view it from.
    const docs: HUDDocBadge[] = Array.from(pinSourceAssetIds).map((assetId) => {
      const fieldRows: HUDAssetFieldRow[] = [];
      let assetTimestamp: number | null = null;
      for (const schema of schemas) {
        const result = results.find(r => r.asset_id === assetId && r.schema_id === schema.id);
        if (!result || !result.value) continue;
        if (assetTimestamp == null) {
          for (const ef of allClassified) {
            if (ef.schemaId !== schema.id || ef.cls !== 'timestamp') continue;
            const tv = getAnnotationFieldValue(result.value, ef.key);
            const parsed = parseTimestampValue(tv);
            if (parsed) { assetTimestamp = parsed.getTime(); break; }
          }
        }
        const eligibleForSchema = eligibleFields.filter(ef => ef.schemaId === schema.id);
        for (const ef of eligibleForSchema) {
          if (!visibleSet.has(ef.uid)) continue;
          const rawValue = getAnnotationFieldValue(result.value, ef.key);
          if (rawValue == null) continue;
          const def = getFieldDefinitionFromSchema(schema, ef.key);
          const just = getJustificationFor(result.value, ef.key);
          fieldRows.push({
            schemaId: schema.id,
            schemaName: schema.name,
            schema,
            field: { key: ef.key, name: ef.name, type: ef.type, definition: def },
            value: prettifyForDisplay(rawValue, def),
            justificationReasoning: just?.reasoning,
            justificationConfidence: just?.confidence,
          });
        }
      }
      return {
        assetId,
        title: assetsMap.get(assetId)?.title ?? undefined,
        fields: fieldRows,
        tripletConnectionCount: assetEdgeCount.get(assetId) ?? 0,
        sortKey: assetTimestamp,
      } as HUDDocBadge & { sortKey: number | null };
    });
    const hasAnyTs = docs.some((d: any) => d.sortKey != null);
    if (hasAnyTs) {
      docs.sort((a: any, b: any) => {
        if (a.sortKey == null && b.sortKey == null) return 0;
        if (a.sortKey == null) return 1;
        if (b.sortKey == null) return -1;
        return b.sortKey - a.sortKey;
      });
    }
    const finalDocs = docs.map(({ sortKey, ...rest }: any) => rest as HUDDocBadge);

    // Evidence: the justifications riding the edges where BOTH endpoints are
    // pinned. Renders as pair cards (subjectLabel → objectLabel) — direction
    // loses meaning when there's no focal node.
    //
    // Read off the edge, same as ``hudEvidence``. The previous version
    // re-matched ``value.document.triplets`` by label triple and so returned
    // nothing for any run that does not use that one legacy contract.
    const evidenceItems: HUDEvidenceItem[] = [];
    for (const e of interPinEdges) {
      const subject = nodeById.get(e.sourceId);
      const object = nodeById.get(e.targetId);
      if (!subject || !object) continue;
      const items = e.evidence?.length ? e.evidence : [undefined];
      items.forEach((raw, i) => {
        evidenceItems.push({
          assetId: firstAssetIdOf(e),
          edgeId: e.id,
          peerId: e.targetId,
          predicate: e.predicate,
          peerLabel: object.label,
          direction: 'out',
          reasoning: raw?.reasoning ?? undefined,
          quote: quoteOf(raw),
          confidence: e.confidence ?? undefined,
          subjectLabel: subject.label,
          objectLabel: object.label,
          subjectId: e.sourceId,
          key: `${e.id}:${i}`,
        });
      });
    }

    const label = activePinPage?.label ?? 'Pins';
    return {
      summary: {
        label,
        nodeCount: pinNodeIds.size,
        edgeCount: interPinEdges.length,
      },
      edges: interPinEdges,
      documents: finalDocs,
      evidence: evidenceItems,
    };
  }, [
    pinNodeIds, activePinPage, edges, nodes, results, schemas,
    assetsMap, eligibleFields, allClassified, effectiveHudVisibleFields,
    assetEdgeCount, annotationIdToAssetId, firstAssetIdOf,
  ]);

  // ---- Active-lens summary ----
  // Reported to the HUD as a list of chips so the analyst can see what's
  // contributing to the current canvas highlight (and clear individual
  // lenses without dismantling the whole HUD). Pin and asset compose as
  // intersection on the canvas; here they're just listed.
  const activeLenses = useMemo(() => {
    const out: Array<{ kind: 'pin' | 'asset'; label: string; onClear: () => void }> = [];
    if (pinNodeIds && pinNodeIds.size > 0) {
      out.push({
        kind: 'pin',
        label: activePinPage?.label ?? 'Pins',
        onClear: () => setPinBoard(pb => pb.showLens ? { ...pb, showLens: false } : pb),
      });
    }
    if (highlightedAssetId != null) {
      const title = assetsMap.get(highlightedAssetId)?.title ?? `#${highlightedAssetId}`;
      out.push({
        kind: 'asset',
        label: title,
        onClear: () => setHighlightedAssetId(null),
      });
    }
    return out;
  }, [pinNodeIds, activePinPage, highlightedAssetId, assetsMap, setPinBoard]);

  // Alias target: node_group_by / edge_group_by from panel_config.
  const graphAliasTargetField = nodeGroupByStr ?? edgeGroupByStr ?? null;
  const graphAliasesForField = graphAliasTargetField
    ? runWideAliasesByField[graphAliasTargetField] ?? {}
    : {};

  // ---- Canvas highlight ids → bundle ids -------------------------------
  // The renderer keys on bundle ids. A selected bundle highlights itself; a
  // hover / keyboard-nav member edge maps to its bundle. Asset-lens and
  // inter-pin member sets map the same way so amber lenses still land.
  const highlightedBundleEdgeId: string | null =
    selectedBundle?.id ?? (activeEdgeId ? toBundleEdgeId(activeEdgeId) : null);
  const assetBundleEdgeIds = useMemo(
    () => (assetEdgeIds ? new Set(Array.from(assetEdgeIds, toBundleEdgeId)) : null),
    [assetEdgeIds, toBundleEdgeId],
  );
  const pinNetworkBundleEdges = useMemo(
    () => (pinNetworkEdges ? new Set(Array.from(pinNetworkEdges, toBundleEdgeId)) : null),
    [pinNetworkEdges, toBundleEdgeId],
  );

  // ---- Bundle inspector data -------------------------------------------
  // Pair labels + per-predicate evidence + source documents for the open
  // bundle. A bundle already holds its ``members`` — the exact edges it was
  // folded from — so this reads them rather than re-deriving the pair from
  // raw annotation rows by label, which is what it used to do and which found
  // nothing outside one legacy contract.
  const bundleDetail = useMemo(() => {
    if (!selectedBundle) return null;
    const srcNode = nodes.find(n => n.id === selectedBundle.sourceId);
    const tgtNode = nodes.find(n => n.id === selectedBundle.targetId);
    const srcLabel = srcNode?.label ?? selectedBundle.sourceId;
    const tgtLabel = tgtNode?.label ?? selectedBundle.targetId;

    const evidence: EdgeBundleEvidenceItem[] = [];
    const docCount = new Map<number, number>();
    for (const m of selectedBundle.members) {
      const direction: 'forward' | 'backward' =
        m.sourceId === selectedBundle.sourceId ? 'forward' : 'backward';
      for (const aid of m.annotationIds ?? []) {
        const assetId = annotationIdToAssetId.get(aid);
        if (assetId != null) docCount.set(assetId, (docCount.get(assetId) ?? 0) + 1);
      }
      for (const raw of m.evidence ?? []) {
        const reasoning = raw?.reasoning ?? '';
        const quote = quoteOf(raw);
        if (!reasoning && !quote) continue;
        evidence.push({
          predicate: m.predicate,
          reasoning,
          quote,
          confidence: typeof m.confidence === 'number' ? m.confidence : undefined,
          assetId: firstAssetIdOf(m),
          direction,
        });
      }
    }
    const documents: EdgeBundleDocChip[] = Array.from(docCount.entries())
      .map(([assetId, count]) => ({ assetId, title: assetsMap.get(assetId)?.title, count }))
      .sort((a, b) => b.count - a.count);

    return {
      srcLabel,
      tgtLabel,
      srcType: srcNode?.type,
      tgtType: tgtNode?.type,
      evidence,
      documents,
    };
  }, [selectedBundle, nodes, assetsMap, annotationIdToAssetId, firstAssetIdOf]);

  // Empty state lives *below* every hook. An early return above them would
  // change the hook count between renders (the run's schemas arrive async),
  // which React rejects outright.
  if (graphSchemas.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeaderSlot>{null}</PanelHeaderSlot>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-md">
            <Info className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No graph-shaped fields in this run</h3>
            <p className="text-sm">
              Graph panels render schemas whose output contract carries a
              triplet field (subject / predicate / object). Add such a field to
              an existing schema or pick a different run.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={fullscreenRootRef} className={`h-full flex flex-col ${isFullscreen ? 'bg-background' : ''}`}>
      <PanelHeaderSlot>
        <>
          <CompareBySubjectButton
            sourcePanel={panelConfig}
            schema={schemas.find(s => s.id.toString() === selectedSchemaId) ?? null}
            entities={canonEntities}
            subjectRole={subjectRole}
            visible={projectionHasEntityRoles}
          />
        </>
      </PanelHeaderSlot>
      <EvidenceDrawer
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        infospaceId={infospaceId}
        runId={runId}
        scope={evidenceScope}
        baseFilters={panelConfig.formula?.filter as any ?? null}
        mergeMaps={effectiveMergeMapsForView}
        schemas={schemas}
      />

      {graphAliasTargetField && (
        <ValueAliasManager
          open={aliasManagerOpen}
          onOpenChange={setAliasManagerOpen}
          infospaceId={infospaceId}
          runId={runId}
          fieldPath={graphAliasTargetField}
          aliases={graphAliasesForField}
          schemaIds={selectedSchemaId ? [Number(selectedSchemaId)] : undefined}
          filters={panelConfig.formula?.filter as any ?? null}
          onSave={(next) => {
            const current = getGlobalVariableSplitting() ?? { enabled: true };
            setGlobalVariableSplitting({
              ...current,
              enabled: true,
              valueAliasesByField: {
                ...(current.valueAliasesByField ?? {}),
                [graphAliasTargetField]: next,
              },
            });
          }}
        />
      )}

      {/* Toolbar.
       *
       *  Was fourteen outline buttons in one flat wrap, every one at the same
       *  weight — `Refresh` looked exactly as consequential as `Resolve into
       *  canon`, and which of them you got on a given line depended on the
       *  panel width. Styling alone would not have fixed that, because the
       *  problem was that nothing said what belonged with what.
       *
       *  Three groups, separated by hairlines, in the order the questions
       *  actually arrive:
       *
       *    WHAT IS ON SCREEN   axes · layers · filter · top
       *    WHAT I DO TO IT     refresh · curate · dedup · promote · resolve · export
       *    HOW I LOOK AT IT    2D/3D · details · settings · fullscreen
       */}
      {!focusMode && (
      <HudBar>
        {/* ── what is on screen ───────────────────────────────────────── */}

        {/* WHERE things sit — three axes across four frames. The panel's
            primary control; "which field is the source" was never the
            question an investigator has. */}
        <GraphAxesPopover
          budget={axisBudget}
          onChange={setAxisBudget}
          coverage={frameCoverage}
          viewMode={graphConfig.viewMode}
          onViewModeChange={(v) => handleGraphConfigChange({ ...graphConfig, viewMode: v })}
        />

        {/* WHAT the graph is made of — the resolved layers, in the model's own
            four tiers. Read off the wire, never re-derived. */}
        <GraphLayersPopover
          layers={layers}
          view={layerView}
          onViewChange={setLayerView}
          legacyField={tripletFieldStr}
        />

        {nodes.length > 0 && (
          <GraphFilterPanel
            entityTypes={Array.from(new Map(nodes.map(n => [n.type.toUpperCase(), n])).entries()).map(([type]) => {
              const count = nodes.filter(n => n.type.toUpperCase() === type).length;
              return { type, color: resolveEntityColor(type), count };
            }).sort((a, b) => b.count - a.count)}
            hiddenEntityTypes={hiddenEntityTypes}
            onHiddenEntityTypesChange={setHiddenEntityTypes}
            predicateTypes={Array.from(edges.reduce((m, e) => m.set(e.predicate, (m.get(e.predicate) ?? 0) + 1), new Map<string, number>()).entries())
              .sort((a, b) => b[1] - a[1])
              .map(([predicate, count]) => ({ predicate, count }))}
            hiddenPredicates={hiddenPredicates}
            onHiddenPredicatesChange={setHiddenPredicates}
          />
        )}

        {/* Best-connected nodes. Was a strip floating over the middle of the
            canvas; it is the same data, out of the graph's way. */}
        {nodes.length > 0 && (
          <TopNodesList
            nodes={nodes}
            edges={edges}
            onNodeClick={handleNodeSelect}
          />
        )}

        <HudRule vertical />

        {/* ── what I do to it ─────────────────────────────────────────── */}

        <HudGroup>
          <HudButton
            icon={RefreshCw}
            onClick={aggregateGraph}
            disabled={isLoading || !selectedSchemaId}
            title="Re-run the projection"
            className={isLoading ? '[&_svg]:animate-spin' : undefined}
          >
            Refresh
          </HudButton>
          {graphData && curationData.totalTriplets > 0 && (
            <HudButton
              icon={Database}
              count={curationData.totalTriplets}
              onClick={() => setShowCuratePanel(true)}
              title="Review and edit the extracted triplets"
            >
              Curate
            </HudButton>
          )}
          {/* The "no embeddings" case is a plain `title` rather than a
              `Tooltip`. A tooltip wrapper here would become the group's direct
              child, so the button inside would never be told it is in a run
              and would draw its own box mid-row. A one-line explanation does
              not need a portal. */}
          {nodes.length >= 2 && (
            <HudButton
              icon={isDedupLoading ? Loader2 : Fingerprint}
              active={activeDedupPairs.length > 0}
              count={activeDedupPairs.length > 0 ? activeDedupPairs.length : undefined}
              onClick={() => {
                if (showDedupPanel) { setShowDedupPanel(false); }
                else if (dedupPairs.length > 0) { setShowDedupPanel(true); }
                else { handleFindDuplicates(); }
              }}
              disabled={isDedupLoading || !embeddingsOn}
              title={embeddingsOn
                ? 'Suggest duplicate nodes'
                : 'Configure an embedding provider to suggest duplicates.'}
              className={isDedupLoading ? '[&_svg]:animate-spin' : undefined}
            >
              Dedup
            </HudButton>
          )}
          {hasCanon && (
            <HudButton
              icon={promoting ? Loader2 : ArrowUpToLine}
              onClick={handlePromote}
              disabled={promoting}
              title="Promote this run's authored merges into its canon"
              className={promoting ? '[&_svg]:animate-spin' : undefined}
            >
              Promote
            </HudButton>
          )}
          {hasCanon && (
            <HudButton
              icon={settingResolve ? Loader2 : Library}
              active={resolveOn}
              onClick={handleToggleResolve}
              disabled={settingResolve}
              title={resolveOn
                ? 'Resolving into canon — settled matches auto-apply, the rest stage as proposals. Click to turn off.'
                : 'Resolve into canon — settled-only curation + staged proposals'}
              className={settingResolve ? '[&_svg]:animate-spin' : undefined}
            >
              Resolve
            </HudButton>
          )}
          {graphData && (
            <HudButton icon={Download} onClick={handleExportGraph} title="Export the graph" />
          )}
        </HudGroup>

        {/* ── how I look at it ────────────────────────────────────────── */}

        <div className="ml-auto flex items-center gap-1.5">
          {/* The graph's own numbers, as a readout rather than a control —
              nothing here is clickable, and it should not look like it is. */}
          {graphData && (
            <HudReadout className="mr-0.5">
              {graphData.metadata.total_nodes}n · {graphData.metadata.total_edges}e
              {selectedNodeId && selectedNodeDetails && (
                <span className="text-hud-fg"> · {selectedNodeDetails.totalConnections}c</span>
              )}
            </HudReadout>
          )}

          {/* 2D / 3D. 3D is dynamic-imported — Three.js (~600 KB) doesn't
              ship until the user flips this for the first time on the page. */}
          <HudSegmented
            value={graphConfig.viewMode ?? '2d'}
            onChange={(v) => handleGraphConfigChange({ ...graphConfig, viewMode: v })}
            options={[
              { value: '2d', label: '2D', icon: Square },
              { value: '3d', label: '3D', icon: Box },
            ]}
          />

          <HudGroup>
            <HudButton
              icon={showDetailPanel ? EyeOff : Eye}
              active={showDetailPanel && !!selectedNodeId}
              onClick={() => setShowDetailPanel(!showDetailPanel)}
              disabled={!selectedNodeId}
              title="Node detail panel"
            />
            <GraphSettingsPopover
              config={graphConfig}
              onConfigChange={handleGraphConfigChange}
              defaultConfig={defaultGraphViewConfig}
              availableEdgeFields={Array.from(new Set(edges.flatMap(e => Object.keys(e.properties || {}))))}
              edgeFieldDataRange={edgeFieldRange(edges, graphConfig.edgeWidthField)}
              onReheatSimulation={() => forceGraphRef.current?.reheatSimulation()}
            />
            <HudButton
              icon={isFullscreen ? Minimize2 : Maximize2}
              active={isFullscreen}
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
            />
          </HudGroup>
        </div>
      </HudBar>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Aggregating graph data...</p>
          </div>
        </div>
      )}

      {/* Empty graph — and which emptiness it is. */}
      {!isLoading && !error && nodes.length === 0 && (
        <div className="flex-1 p-4">
          {nothingGraphable ? (
            <EmptyStateCard
              reason={{ kind: 'role_unfilled', roleLabel: 'Graph-capable field' }}
              className="h-full"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="text-sm font-medium">Nothing to draw</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {layers.length} layer{layers.length === 1 ? '' : 's'} ran and
                produced no nodes — the sections are declared and the rows are
                empty. Open Layers to see which.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Graph query — filtering, shape predicates, traversal. Above the
          canvas because it governs what the canvas contains. */}
      {!focusMode && (
        <div className="px-2 pb-1">
          {/* Query and view controls share one row. The canvas's top-left is
              the corner node info, docs and pins all want; zoom and randomise
              are the least contextual things that were competing for it. */}
          <div className="flex items-start gap-1.5">
            <QueryBar
              value={graphQuery}
              onChange={setGraphQuery}
              proposed={graphDraft}
              nodeCount={nodes.length}
              edgeCount={edges.length}
              nodeCap={panelConfig.formula ? 1000 : null}
              // Two sources, one rail. `queryWarnings` is what validation could
              // not resolve *before* the query ran; `graphNotes` is what the
              // engine resolved in a way the writer may not have meant while
              // running it — `kind:payment` hitting a reserved word on a
              // contract whose acts state their type in a field called `kind`.
              // A reader has no use for the distinction: both mean "this did
              // not do what you probably meant", and both must be amber rather
              // than silent. S1/S2.
              warnings={engineNotes}
              onAsk={askGraph}
              index={graphIndex}
              className="min-w-0 flex-1"
            />
            <RegionToggles
              viewConfig={graphConfig}
              onViewConfigChange={handleGraphConfigChange}
              hudConfig={resolvedHudConfig}
              onHudConfigChange={handleHudConfigChange}
            />
            <ZoomToolbar
              placement="inline"
              handle={{
                current: {
                  setZoom: (s, d) => forceGraphRef.current?.setZoom(s, d),
                  zoomToFit: (d, p) => forceGraphRef.current?.zoomToFit(d, p),
                  resetView: (d) => forceGraphRef.current?.resetView(d),
                  getZoom: () => forceGraphRef.current?.getZoom() ?? 1,
                },
              }}
              hideStepButtons={graphConfig.viewMode === '3d'}
              config={graphConfig}
              onConfigChange={handleGraphConfigChange}
              onReheatSimulation={() => forceGraphRef.current?.reheatSimulation()}
            />
          </div>
          {/* Timeline. Reads the intervals already on the payload, so scrubbing
              is a client-side predicate with no refetch. */}
          <TimeScrubber
            nodes={rawNodes}
            edges={rawEdges}
            cursor={timeCursor}
            onCursorChange={setTimeCursor}
            onScopeToWindow={handleScopeToWindow}
            clock={barsClock}
            onClockChange={setBarsClock}
            placement={hudConfig?.bars?.placement ?? 'inline'}
            className="mt-1"
          />
        </div>
      )}

      {/* Main Content Area */}
      {!isLoading && nodes.length > 0 && (
        <div className="flex-1 min-h-0">
          <div
            className="@container/graph relative h-full w-full overflow-hidden"
            style={{
              // The pin board sits at the bottom-left of the canvas, which is
              // also where a pane in the `bottom` region lives — so a bottom
              // pane simply covered it. The canvas publishes how much of its
              // floor is already spoken for and the pin board rides above it,
              // the same contract `--app-rail` and `--graph-right-rail` use.
              ['--graph-bottom-rail' as any]: panes.some(p => p.region === 'bottom')
                ? `calc(${(regionSize.bottom ?? REGION_DEFAULT.bottom)}px + 0.75rem)`
                : '0px',
            }}
          >
            <ForceGraph
              ref={forceGraphRef}
              viewControls="external"
              nodes={nodes}
              // The committed query, not the draft — layout follows what was
              // run, never what is being typed.
              query={graphQuery}
              edges={renderEdges}
              timeCursor={timeCursor}
              highlightedNodeId={selectedNodeId}
              connectedNodeIds={effectiveConnectedNodeIds}
              highlightedEdgeId={highlightedBundleEdgeId}
              highlightedEdgeIds={assetBundleEdgeIds ?? undefined}
              pinNodeIds={pinNodeIds ?? undefined}
              pinNetworkEdges={pinNetworkBundleEdges ?? undefined}
              mergeSelectedNodeIds={mergeSelectedIds}
              onNodeClick={handleNodeSelect}
              onNodeShiftClick={handleNodeShiftClick}
              onNodeAltClick={(node) => handleTogglePin(node.id)}
              onEdgeClick={(edge) => {
                const bundle = bundlesById.get(edge.id) ?? (edge as BundledEdge);
                lastEngagedRef.current = 'anchor';
                setSelectedNodeId(null);
                setSelectedBundle(bundle);
                setShowDetailPanel(true);
              }}
              onBackgroundClick={clearSelection}
              autoResize={true}
              chrome={focusMode ? 'minimal' : 'full'}
              config={graphConfigWithAxes}
              onConfigChange={handleGraphConfigChange}
              colorOverrides={schemaColorOverrides}
              typeIcons={schemaTypeIcons}
              predicateArrows={schemaPredicateArrows}
              hiddenEntityTypes={hiddenEntityTypes}
              hiddenPredicates={hiddenPredicates}
              onToggleEntityType={(type) => {
                // No functional setter: the truth is the query string, not a
                // Set, so there is no previous state to fold over.
                const next = new Set(hiddenEntityTypes);
                if (next.has(type)) next.delete(type);
                else next.add(type);
                setHiddenEntityTypes(next);
              }}
              focusedEntityNames={focusedEntityNames}
            />

            {/* The HUD — occurrences and their evidence, over the canvas.
                Two readings of the SAME graph, so they overlay rather than
                sitting in sibling dashboard panels: separate panels would
                invite them to drift out of sync, which is the one thing they
                must never do. Derived entirely from nodes/edges already in
                memory — no fetch, so the list cannot disagree with the canvas.
                Hidden in focus mode along with the rest of the chrome. */}
            {!focusMode && (
              <PaneLayout
                panes={panes}
                surfaces={paneSurfaces}
                onUpdatePane={handleUpdatePane}
                onRemovePane={handleRemovePane}
                onComposePane={setComposePaneId}
                inheritedQ={graphQuery}
                onAddPane={handleAddPane}
                regionSize={regionSize}
                onResizeRegion={handleResizeRegion}
                onCommitRegion={handleCommitRegion}
                onPick={handlePanePick}
                focusIds={hudFocusIds}
                warnings={queryWarnings}
                onAsk={askGraph}
                // One table per named section, keyed by the pane's own name —
                // a pane called "interests" renders the interests table and a
                // pane called "observations" renders that one, with no
                // ordering assumption between panes and tables.
                // Source → graph. Every table regrouped by the document that
                // produced it, reusing the asset lens the canvas already has
                // and the pin board it already persists — a new surface, not a
                // new mechanism.
                docs={
                  <DocsTable
                    tables={sectionTables}
                    titleOf={(id) => assetsMap.get(id)?.title ?? undefined}
                    highlightedAssetId={highlightedAssetId}
                    onHighlight={setHighlightedAssetId}
                    onOpenAsset={openDetailOverlay}
                    onPinDoc={handlePinDoc}
                    onSelectNode={handleNodeSelectById}
                  />
                }
                tableFor={(name) => {
                  const t = tableForPane(name);
                  return t ? (
                    <RowTable
                      rows={t}
                      // The table narrows to the selection rather than
                      // reordering under it: a reader who clicked a node is
                      // asking "what did this do", not "where is this in the
                      // list".
                      selectedIds={selectedNodeId
                        ? new Set([selectedNodeId]) : undefined}
                      onSelectNode={handleNodeSelectById}
                    />
                  ) : undefined;
                }}
                detail={selectedNodeDetails ? (
                  <NodeDetail
                    node={selectedNodeDetails}
                    edges={renderEdges}
                    degree={selectedNodeDetails.totalConnections}
                    documents={(selectedNodeDetails.sourceAssetIds ?? []).map(id => ({
                      assetId: id, title: assetsMap.get(id)?.title,
                    }))}
                    onOpenAsset={openDetailOverlay}
                  />
                ) : undefined}
              />
            )}

            {/* Pin board — bottom-left overlay. Multi-page persistent
                collection of pinned nodes. The active page's pinned ids
                ARE ``mergeSelectedIds`` so the existing merge bar still
                triggers at 2+ pins; PinBoard adds the network/evidence
                lenses + multi-page management. Interactive chrome — hidden in
                focus mode, leaving a clean canvas. */}
            {!focusMode && (
              <PinBoardOverlay
                pinBoard={pinBoard}
                nodes={nodes}
                onSetActivePage={handleSetActivePage}
                onAddPage={handleAddPinPage}
                onRenamePage={handleRenamePinPage}
                onDeletePage={handleDeletePinPage}
                onUnpin={handleUnpin}
                onRemovePin={handleRemovePin}
                onClearPage={handleClearPinPage}
                onPeerClick={handleNodeSelect}
                onToggleLens={handleTogglePinLens}
              />
            )}

            {/* Merge Selection Bar */}
            {mergeSelectedIds.length > 0 && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-amber-50/95 dark:bg-amber-950/95 px-4 py-3 rounded-lg shadow-lg border border-amber-300 dark:border-amber-700 z-20 max-w-lg">
                <div className="flex items-center gap-2 mb-2">
                  <GitMerge className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800">
                    Merge {mergeSelectedIds.length} nodes
                  </span>
                </div>
                {/* Name selection */}
                <div className="text-[10px] text-amber-700 font-medium mb-1">Keep name:</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {mergeSelectedIds.map(id => {
                    const node = nodes.find(n => n.id === id);
                    if (!node) return null;
                    const isKeep = mergeKeepId === id;
                    return (
                      <label
                        key={id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer text-xs transition-colors ${
                          isKeep
                            ? 'bg-amber-200 dark:bg-amber-800 border-amber-400 dark:border-amber-600 font-semibold'
                            : 'bg-background border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900'
                        }`}
                      >
                        <input
                          type="radio"
                          name="merge-keep"
                          checked={isKeep}
                          onChange={() => setMergeKeepId(id)}
                          className="accent-amber-600"
                        />
                        {node.label}
                      </label>
                    );
                  })}
                </div>
                {/* Type selection */}
                {(() => {
                  const selectedNodes = mergeSelectedIds.map(id => nodes.find(n => n.id === id)).filter(Boolean) as GraphNode[];
                  const uniqueTypes = Array.from(new Set(selectedNodes.map(n => n.type)));
                  if (uniqueTypes.length <= 1) return null;
                  return (
                    <>
                      <div className="text-[10px] text-amber-700 font-medium mb-1">Keep type:</div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {uniqueTypes.map(t => (
                          <label
                            key={t}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer text-xs transition-colors ${
                              mergeKeepType === t
                                ? 'bg-amber-200 dark:bg-amber-800 border-amber-400 dark:border-amber-600 font-semibold'
                                : 'bg-background border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900'
                            }`}
                          >
                            <input
                              type="radio"
                              name="merge-keep-type"
                              checked={mergeKeepType === t}
                              onChange={() => setMergeKeepType(t)}
                              className="accent-amber-600"
                            />
                            {t}
                          </label>
                        ))}
                      </div>
                    </>
                  );
                })()}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs"
                    disabled={mergeSelectedIds.length < 2 || !mergeKeepId}
                    onClick={executeMerge}
                  >
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-amber-700"
                    onClick={() => { setMergeSelectedIds([]); setMergeKeepId(null); setMergeKeepType(null); }}
                  >
                    Cancel
                  </Button>
                  <span className="text-[10px] text-amber-600 ml-auto">
                    Shift+click to add/remove
                  </span>
                </div>
              </div>
            )}

            {/* Graph Editing Controls — bottom-left, sits just above the
                connections strip so it's near the node-detail context but
                doesn't compete with the top-row controls (zoom, name pill,
                help, close). */}
            {selectedNodeId && onGraphEditsChange && (
              <Button
                size="sm"
                variant="ghost"
                className="absolute bottom-24 left-2 z-20 h-7 w-7 p-0 bg-background/80 backdrop-blur-sm border hover:bg-destructive hover:text-destructive-foreground"
                title="Delete node and its connected edges"
                onClick={() => {
                  const currentEdits = graphEdits || createEmptyGraphEdits();
                  const updatedEdits: GraphEdits = {
                    ...currentEdits,
                    deletedNodes: [
                      ...currentEdits.deletedNodes,
                      {
                        nodeId: selectedNodeId,
                        deletedAt: new Date().toISOString(),
                        reason: 'User deleted'
                      }
                    ]
                  };
                  onGraphEditsChange(updatedEdits);
                  setSelectedNodeId(null);
                  setShowDetailPanel(false);
                  toast.success('Node deleted');
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            
            {/* Graph Edit Status */}
            {hasGraphEdits(graphEdits) && (
              <div className="absolute bottom-2 right-2 bg-blue-50/95 dark:bg-blue-950/95 px-3 py-2 rounded-lg shadow border border-blue-200 dark:border-blue-800 z-10">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-3 w-3 text-blue-600" />
                  <span className="text-xs font-medium text-blue-700">
                    {getGraphEditsCount(graphEdits)} edits applied
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 text-blue-600 hover:text-blue-700"
                    onClick={() => {
                      if (confirm('Clear all graph edits? This cannot be undone.')) {
                        onGraphEditsChange?.(createEmptyGraphEdits());
                        toast.success('Graph edits cleared');
                      }
                    }}
                    title="Clear all edits"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {/* Dedup Suggestions Panel — anchored below the top-row controls
                (close ✕, 3D help) so it doesn't collide with the HUD chrome.
                Uses the same backdrop-blur + soft border treatment as the
                other floating overlays. */}
            {showDedupPanel && (
              <div className="absolute top-12 right-2 z-20 w-64 bg-background/85 backdrop-blur-sm border rounded-lg shadow-sm">
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b">
                  <div className="flex items-center gap-1.5">
                    <Fingerprint className="h-3 w-3 text-amber-500" />
                    <span className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">Duplicates</span>
                    {activeDedupPairs.length > 0 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">({activeDedupPairs.length})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={handleFindDuplicates}
                      disabled={isDedupLoading}
                      title="Re-scan"
                    >
                      <RefreshCw className={`h-2.5 w-2.5 ${isDedupLoading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setShowDedupPanel(false)} title="Close">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto p-1 scrollbar-hide">
                  {isDedupLoading && (
                    <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Finding duplicates...
                    </div>
                  )}
                  {dedupError && !isDedupLoading && (
                    <div className="text-xs text-destructive py-3 px-2">
                      {dedupError}
                    </div>
                  )}
                  {!isDedupLoading && !dedupError && activeDedupPairs.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      No duplicates found
                    </div>
                  )}
                  {!isDedupLoading && activeDedupPairs.length > 0 && (
                    <div className="space-y-1">
                      {activeDedupPairs.map((pair) => (
                        <div key={`${pair.a_index}-${pair.b_index}`} className="flex items-center gap-1.5 p-1.5 rounded border bg-card/60 hover:bg-card text-xs transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="truncate overflow-x-auto scrollbar-hide font-medium">{pair.a_item}</div>
                            <div className="truncate overflow-x-auto scrollbar-hide text-muted-foreground">≈ {pair.b_item}</div>
                            <div className="text-[10px] text-muted-foreground">{(pair.similarity * 100).toFixed(0)}%</div>
                          </div>
                          <div className="flex flex-col gap-0.5 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                              onClick={() => handleAcceptDedup(pair)}
                              title="Stage merge"
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => setDedupDismissed(prev => new Set(prev).add(`${pair.a_index}-${pair.b_index}`))}
                              title="Dismiss"
                            >
                              <X className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== Floating search bar — sits just above the connections
                strip (bottom-center). Suggestions panel opens *upward* so
                it doesn't cover the connections row. Solid background so
                node labels behind don't bleed through. The same searchTerm
                is passed to the HUD below so connection chips matching the
                query get highlighted in place. Interactive chrome — hidden in
                focus mode. ===== */}
            {!focusMode && (
            <div
              className="absolute bottom-1/5 left-1/2 -translate-x-1/2 z-30 !bg-background/90 rounded-full"
              style={{ pointerEvents: 'auto' }}
            >
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search nodes (/)"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  onKeyDown={handleSearchKeyDown}
                  // 16 px font on mobile prevents iOS Safari's automatic
                  // page-zoom on focus (it zooms any input whose computed
                  // font-size is below 16 px). Drops back to 11 px on
                  // ``md`` screens so the desktop chrome stays compact.
                  className="h-7 text-[16px] md:text-[11px] pl-7 pr-7 w-[320px] bg-background/50 border shadow-sm rounded-full"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => { setSearchTerm(''); setShowSuggestions(false); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                {/* Suggestions opening UP — avoids covering the connections
                    strip below. Capped to 5 items + own scroll for longer
                    matches; no duplication of HUD chip highlights. */}
                {showSuggestions && searchSuggestions.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover/95 backdrop-blur-sm text-popover-foreground border rounded-md shadow-lg z-50 max-h-48 overflow-y-auto scrollbar-hide">
                    {searchSuggestions.map((suggestion, i) => (
                      <div
                        key={suggestion.id}
                        className={`px-2 py-1 cursor-pointer border-b last:border-b-0 ${i === activeSuggestionIndex ? 'bg-accent' : 'hover:bg-accent'}`}
                        onMouseEnter={() => setActiveSuggestionIndex(i)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSearchSelect(suggestion);
                        }}
                      >
                        <div className="font-medium text-[11px]">{suggestion.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {suggestion.type} · {suggestion.frequency}×
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ===== Node detail HUD — overlays the canvas without resizing
                it. Sections (top/left/right/bottom) position themselves around
                the centred selected node so the canvas remains the focal
                surface; the HUD container has pointer-events: none so the
                user can pan/zoom the graph in the gaps. ===== */}
            {/* ===== The anchor HUD lived here — a `pointer-events: none`
                overlay that positioned a sources rail, an evidence column and
                a title pill around the centred node.

                Replaced by the `node` PANE, which says the same things and
                more: it renders EVERY non-empty field the wire carries rather
                than the four the overlay knew about, and it sits in a region
                the analyst can move, rename, unlink and point somewhere else.

                Removing it was not cosmetic. Both surfaces drew at once, so a
                selected node put the overlay's document rail directly on top
                of the Places pane and its evidence cards on top of the
                Observations pane — two answers to the same question, stacked,
                neither readable. ===== */}

            {/* ===== Subnet HUD — fires when the pin-set is the HUD owner.
                A focused node (if any) keeps its blue ring on the canvas as
                context. ===== */}
            {showDetailPanel && hudOwner === 'subnet' && pinSubnetScope && (
              <NodeDetailHUD
                subnet={pinSubnetScope.summary}
                edges={pinSubnetScope.edges}
                nodes={nodes}
                documents={pinSubnetScope.documents}
                evidence={pinSubnetScope.evidence}
                highlightedEdgeId={activeEdgeId}
                eligibleFields={eligibleFields}
                visibleFieldUids={effectiveHudVisibleFields}
                onVisibleFieldUidsChange={setHudVisibleFields}
                showJustifications={hudShowJustifications}
                onShowJustificationsChange={setHudShowJustifications}
                highlightedAssetId={highlightedAssetId}
                onAssetHighlightToggle={(aid) =>
                  setHighlightedAssetId(prev => prev === aid ? null : aid)
                }
                rangeCache={hudRangeCache}
                onPeerClick={handleNodeSelect}
                onAssetClick={openDetailOverlay}
                onEdgeHover={(edgeId, peerId) =>
                  setHoveredEvidence(edgeId && peerId ? { edgeId, peerId } : null)
                }
                swapTo={anchorAvailable && selectedNodeDetails ? {
                  label: (selectedNodeDetails as any).label,
                  meta: (selectedNodeDetails as any).type,
                  kind: 'anchor',
                  onClick: swapHudOwner,
                } : undefined}
                lenses={activeLenses}
                onClose={clearSelection}
              />
            )}

            {/* ===== Edge bundle inspector — every connection between the
                pair, collapsed into one line on the canvas and unrolled
                here. Per-predicate breakdown (filterable) → evidence →
                source documents, plus the cross-panel cooccurs scope
                gesture. Replaces the old single-edge detail card. ===== */}
            {showDetailPanel && selectedBundle && bundleDetail && !selectedNodeDetails && (() => {
              const { srcLabel, tgtLabel, srcType, tgtType, evidence, documents } = bundleDetail;
              // Peer panels that could receive the cooccurs scope (everyone
              // except this panel — it's already showing the relationship).
              const peerPanels = dashboardPanels.filter(p => p.id !== panelConfig.id);
              const peerPanelsWithEntityPaths = peerPanels.filter(p => {
                const sid = (p.settings?.selectedSchemaId as number | undefined)
                  ?? ((p.settings?.selectedSchemaIds as number[] | undefined)?.[0]);
                if (!sid) return false;
                const s = schemas.find(x => x.id === sid);
                return s && entityPathsFromSchema(s as AnnotationSchemaRead).length > 0;
              });
              const canScope = !!srcLabel && !!tgtLabel && peerPanelsWithEntityPaths.length > 0;
              const handlePushScope = () => {
                if (!srcLabel || !tgtLabel) return;
                const { pushed } = pushCooccursToDashboard({
                  entities: [srcLabel, tgtLabel],
                  reach: 'annotation',
                  panels: dashboardPanels as any,
                  schemas: schemas as any,
                  addScope: broadcastAddScope,
                  sourcePanelId: panelConfig.id,
                  excludePanelId: panelConfig.id,
                  label: `${srcLabel} ↔ ${tgtLabel}`,
                });
                if (pushed === 0) {
                  toast.warning('No peer panels with Entity-typed schemas. Add an Entity field to a panel\'s schema to enable cross-panel scoping.');
                  return;
                }
                toast.success(
                  `Scoped ${pushed} peer panel${pushed === 1 ? '' : 's'} to ${srcLabel} ↔ ${tgtLabel}` +
                  (dashboardName ? ` in ${dashboardName}` : ''),
                );
              };
              return (
                <EdgeBundleHUD
                  sourceLabel={srcLabel}
                  targetLabel={tgtLabel}
                  sourceType={srcType}
                  targetType={tgtType}
                  directionMix={selectedBundle.directionMix}
                  totalWeight={selectedBundle.totalWeight}
                  memberCount={selectedBundle.memberCount}
                  predicateRows={selectedBundle.predicateCounts}
                  evidence={evidence}
                  documents={documents}
                  colorOverrides={schemaColorOverrides}
                  activePredicates={bundlePredFilter}
                  onTogglePredicate={(p) => setBundlePredFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p); else next.add(p);
                    return next;
                  })}
                  onClearPredicateFilter={() => setBundlePredFilter(new Set())}
                  onClose={clearSelection}
                  onAssetClick={openDetailOverlay}
                  onFocusSubgraph={() => forceGraphRef.current?.centerNode(selectedBundle.sourceId)}
                  onScopeDashboard={handlePushScope}
                  canScopeDashboard={canScope}
                  scopeHint={
                    canScope
                      ? `Push a co-occurrence filter for this pair to ${peerPanelsWithEntityPaths.length} peer panel${peerPanelsWithEntityPaths.length === 1 ? '' : 's'}.`
                      : peerPanels.length === 0
                        ? 'No peer panels in this dashboard.'
                        : 'No peer panels read from a schema with Entity fields.'
                  }
                />
              );
            })()}
          </div>
        </div>
      )}

      {/* Curate to Graph Panel */}
      {showCuratePanel && (
        <div className="absolute inset-0 bg-black/30 z-30 flex items-center justify-center">
          <Card className="w-[420px] shadow-xl bg-background">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                Curate to Knowledge Graph
                <Button variant="ghost" size="sm" onClick={() => setShowCuratePanel(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {curationData.totalTriplets} triplets from {curationData.annotations.length} annotations
                {graphEdits?.mergedNodes?.length ? (
                  <span className="block text-blue-600 mt-1">
                    {graphEdits.mergedNodes.length} merge(s) will be applied during resolution
                  </span>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Target Graph (optional)</Label>
                <Select value={targetGraphId} onValueChange={setTargetGraphId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Infospace default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CURATE_TARGET_GRAPH_INFOSPACE_DEFAULT}>Infospace default</SelectItem>
                    {availableGraphs.map(g => (
                      <SelectItem key={g.id} value={g.id.toString()}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  disabled={isCurating || curationData.totalTriplets === 0}
                  onClick={handleCurate}
                >
                  {isCurating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Curating...</>
                  ) : (
                    <><Database className="h-4 w-4 mr-2" />Curate All</>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setShowCuratePanel(false)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && nodes.length === 0 && selectedSchemaId && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-md">
            <Info className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No Graph Data Found</h3>
            <p className="text-sm">
              No graph fragments were found for this run and schema combination. 
              {schemas.find(s => s.id.toString() === selectedSchemaId) 
                ? "Make sure the annotation run has completed successfully and produced graph results."
                : "Please create a new annotation run that includes the selected schema to generate graph data."
              }
            </p>
          </div>
        </div>
      )}

      {composerModel && (
        <Composer
          open={composePaneId != null}
          onClose={() => setComposePaneId(null)}
          model={composerModel}
          onChange={next => setGraphQuery(applyToGql(graphQuery, next))}
          title="Datapoints"
          queryPreview={d => applyToGql(graphQuery, d)}
          // The graph's OWN cell renderer — the one `RowTable` uses — so the
          // exemplar row is the table it previews, not a lookalike.
          renderCell={(field, value) => (
            <RowCell
              col={{
                key: field.id,
                label: field.label,
                kind: (field.kind === 'entity' ? 'nominal' : field.kind) as any,
                ref: field.kind === 'entity' ? 'entity' : undefined,
                entityType: field.entityType ?? undefined,
                unit: field.unit ?? undefined,
                source: field.source,
              }}
              raw={value}
              item={{ id: 'exemplar', annotationId: -1, cells: {} } as any}
              onSelectNode={handleNodeSelectById}
            />
          )}
        />
      )}
    </div>
  );
}