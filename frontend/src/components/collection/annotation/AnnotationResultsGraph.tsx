'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RefreshCw, AlertCircle, Info, Download, Settings2, Search, X, Eye, EyeOff, Trash2, GitMerge, Database, Fingerprint, Check, Box, Square, Maximize2, Minimize2, Target } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AnnotationSchemaRead, AssetRead, KnowledgeGraphRead, SimilarPairRead } from '@/client';
import type { GraphViewConfig as ClientGraphConfig } from '@/client';
import { FormattedAnnotation, TimeAxisConfig, PanelConfig, ViewGraphPhase } from '@/lib/annotations/types';
import { KnowledgeGraphsService, AnnotationsService, EntitiesService } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';
import { VariableSplittingConfig, applySplittingToResults } from './VariableSplittingControls';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import { mergeFiltersAndScopes } from '@/lib/annotations/scopes';
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
import { ForceGraph, type ForceGraphHandle, GraphNode, GraphEdge, aggregatorResponseToGraphData, GraphViewConfig, defaultGraphViewConfig, GraphSettingsPopover, GraphFilterPanel, edgeFieldRange } from '@/components/collection/graph';
import { useFullscreen } from '@/components/collection/graph/forcegraph/useFullscreen';
import { NodeDetailHUD, type EvidenceItem as HUDEvidenceItem, type DocumentBadge as HUDDocBadge, type AssetFieldRow as HUDAssetFieldRow, type EligibleField as HUDEligibleField } from '@/components/collection/graph/forcegraph/NodeDetailHUD';
import { NodeProjectionDossier } from '@/components/collection/graph/forcegraph/NodeProjectionDossier';
import { EdgeDetailHUD } from '@/components/collection/graph/forcegraph/EdgeDetailHUD';
import { CompareBySubjectButton } from '@/components/collection/graph/forcegraph/CompareBySubjectButton';
import { PanelFormulaBinder } from './formulas/PanelFormulaBinder';
import { PinBoard as PinBoardOverlay } from '@/components/collection/graph/forcegraph/PinBoard';
import { useCanonEntityLookup } from '@/hooks/useCanonEntityLookup';
import { useResolvedProjection } from '@/hooks/useResolvedProjection';
import { resolveEntityColor } from '@/lib/annotations/colors';
import { type RolePickerValue } from './panels/RolePicker';
import { RolePickerPopover } from './panels/RolePickerPopover';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import { EmptyStateCard } from './panels/EmptyStateCard';
import { ValueAliasManager } from './panels/ValueAliasManager';
import { EvidenceDrawer } from './panels/EvidenceDrawer';
import { PANEL_ROLE_SCHEMAS } from '@/lib/annotations/panelRoleSchema';
import { walkOutputContract, flattenFieldPaths } from '@/lib/annotations/fieldPaths';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { effectiveMergeMaps } from '@/lib/annotations/valueAliases';
import { createScopeFromSelection, createCooccursScope, entityPathsFromSchema, focusedEntityNamesFromFilter, pushCooccursToDashboard } from '@/lib/annotations/scopes';
import type { Scope } from '@/lib/annotations/types';

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

  // Resolve the projection: if the panel has a formula_id binding, the
  // projection comes from dashboardConfig.formulas[id]; otherwise the
  // inline panelConfig.projection. Components below read this single source.
  const { projection: resolvedProjection, formulaName: boundFormulaName } =
    useResolvedProjection(panelConfig);

  // Canon entity lookup — graph nodes carry labels/types but not canon ids.
  // The projection dossier and EdgeDetailHUD consume canon entity ids, so we
  // need a (label, type) → id resolver. Empty/loading resolver short-circuits
  // the dossier mounts (they no-op until an id resolves). The entities list
  // is also surfaced to the compare-by-subject picker.
  const { findId: findEntityId, entities: canonEntities } = useCanonEntityLookup(infospaceId);

  // Projection-bound graph mode: when the panel's projection declares at
  // least one entity-typed role, we render the dossier overlays alongside
  // the legacy HUD. Off otherwise — falls back to existing behaviour.
  const projectionHasEntityRoles = useMemo(() => {
    const roles = resolvedProjection?.roles;
    if (!roles) return false;
    return Object.values(roles).some(rb => !!rb?.entity_type);
  }, [resolvedProjection?.roles]);

  // Resolve actor / subject role names from the projection's edges (default
  // to ``actor`` / ``subject`` for the GGL projection). Used by EdgeDetailHUD.
  const { actorRole, subjectRole } = useMemo(() => {
    const e = resolvedProjection?.edges?.[0];
    return {
      actorRole: e?.from_role ?? 'actor',
      subjectRole: e?.to_role ?? 'subject',
    };
  }, [resolvedProjection?.edges]);

  // Server-side graph data fetching
  const mergedFilters = useMemo(
    () => mergeFiltersAndScopes(panelConfig.local_filters, panelConfig.incoming_scopes),
    [panelConfig.local_filters, panelConfig.incoming_scopes],
  );

  // Relationship-as-a-lens dim cascade. Harvest the entity names from every
  // ``relational.cooccurs`` condition in the merged filter; when present,
  // pass them to ForceGraph as the focused sub-network — matching nodes
  // (and edges between them) stay sharp, the rest dims.
  //
  // Default-on: the absence of a cooccurs scope yields an empty set and the
  // renderer no-ops. Behavior is identical to pre-v1.5 in that case. When
  // a cooccurs scope IS active, the setting opts the user *out* of the
  // automatic focus — ``settings.dim_unmatched === false`` keeps the
  // graph fully bright. Memoized as a Set for the renderer's O(1) lookups.
  const dimUnmatched = (panelConfig.settings as any)?.dim_unmatched !== false;
  const focusedEntityNames = useMemo(() => {
    if (!dimUnmatched) return undefined;
    const names = focusedEntityNamesFromFilter(mergedFilters);
    if (names.length === 0) return undefined;
    return new Set(names);
  }, [dimUnmatched, mergedFilters]);

  // Determine triplet field + expanded graph roles from the panel's projection.
  // Legacy panels used `triplet_field` key; new panels use the `triplet` role.
  const fieldMappings = panelConfig.projection?.field_mappings ?? {};
  const tripletField =
    (fieldMappings['triplet'] as string | string[] | undefined) ??
    (fieldMappings['triplet_field'] as string | string[] | undefined) ??
    'relationships';
  const tripletFieldStr = Array.isArray(tripletField) ? tripletField[0] : tripletField;
  const edgeWeightField = (fieldMappings['edge_weight'] as string | string[] | undefined);
  const edgeWeightFieldStr = Array.isArray(edgeWeightField) ? edgeWeightField[0] : edgeWeightField;
  const nodeGroupBy = (fieldMappings['node_group_by'] as string | string[] | undefined);
  const nodeGroupByStr = Array.isArray(nodeGroupBy) ? nodeGroupBy[0] : nodeGroupBy;
  const edgeGroupBy = (fieldMappings['edge_group_by'] as string | string[] | undefined);
  const edgeGroupByStr = Array.isArray(edgeGroupBy) ? edgeGroupBy[0] : edgeGroupBy;
  const edgeWeightMode =
    (panelConfig.settings as any)?.edgeWeightMode ?? 'count';

  const graphQueryConfig = useMemo((): ClientGraphConfig | undefined => {
    return {
      triplet_field: tripletFieldStr,
      dedup: 'normalized',
      edge_weight_field: edgeWeightFieldStr ?? null,
      edge_weight_mode: edgeWeightMode,
      node_group_by: nodeGroupByStr ?? null,
      edge_group_by: edgeGroupByStr ?? null,
    };
  }, [tripletFieldStr, edgeWeightFieldStr, edgeWeightMode, nodeGroupByStr, edgeGroupByStr]);

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

  const { data: viewData, isLoading: isViewLoading, refetch: refetchView } = useAnnotationView({
    infospaceId,
    runId,
    graph: graphQueryConfig,
    filters: mergedFilters,
    merge_maps: effectiveMergeMapsForView,
    enabled: !!runId && !!infospaceId,
  });

  // Separate rows fetch — the graph response carries only ``annotation_ids``
  // per node, not asset ids. To populate the node detail panel's "Appears
  // in documents" chips we need the annotation→asset mapping (and the
  // asset titles for display). Minimal filter so we grab every row in the
  // run; rows payload is compact (id + asset_id + title).
  const { data: rowsViewData } = useAnnotationView({
    infospaceId,
    runId,
    rows: { limit: 500 },
    filters: mergedFilters,
    merge_maps: effectiveMergeMapsForView,
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
  const graphEdits = panelConfig.settings?.graphEdits || null;
  const onGraphEditsChange = useCallback((edits: GraphEdits) => {
    onUpdatePanel({ settings: { ...settingsRef.current, graphEdits: edits } });
  }, [onUpdatePanel]);
  const { activeInfospace } = useInfospaceStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Schema selection - use persisted setting if available
  const persistedSchemaId = initialSettings?.selectedGraphSchemaId;
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>(persistedSchemaId ? persistedSchemaId.toString() : '');
  
  // Graph view config - use persisted setting if available
  const persistedGraphConfig = initialSettings?.graphViewConfig;
  const [graphConfig, setGraphConfig] = useState<GraphViewConfig>(
    persistedGraphConfig ? { ...defaultGraphViewConfig, ...persistedGraphConfig } : defaultGraphViewConfig
  );
  
  // Filter state
  const [hiddenEntityTypes, setHiddenEntityTypes] = useState<Set<string>>(new Set());
  const [hiddenPredicates, setHiddenPredicates] = useState<Set<string>>(new Set());

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
  const { nodes, edges, graphData } = useMemo<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    graphData: GraphData | null;
  }>(() => {
    if (!viewData?.graph) return { nodes: [], edges: [], graphData: null };

    const viewGraph = viewData.graph;
    let graphNodes: GraphNode[] = viewGraph.nodes.map(n => ({
      id: n.id,
      label: n.name,
      type: n.type,
      frequency: n.frequency,
      annotationIds: n.source_annotation_ids,
    }));
    let graphEdges: GraphEdge[] = viewGraph.edges.map((e, i) => ({
      id: `edge-${i}`,
      sourceId: e.source,
      targetId: e.target,
      predicate: e.predicate,
      weight: e.weight,
    }));

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

  // Shallow-clone edges before passing to the renderer. ``react-force-graph``
  // adds ``link.source`` / ``link.target`` (object references) onto each link
  // after first paint. Cloning keeps our authoritative ``edges`` array clean
  // for downstream readers (curate / dedup / export / search). Cheap: one
  // map() per data change.
  const renderEdges = useMemo(() => edges.map(e => ({ ...e })), [edges]);

  // New state for search and highlighting
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeDetail, setSelectedEdgeDetail] = useState<GraphEdge | null>(null);
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

  // Extract schema-level graph config (typeColors, typeIcons, predicateColors)
  const schemaGraphFieldConfig = useMemo(() => {
    if (!selectedSchemaId) return null;
    const schema = [...schemas, ...(allSchemas || [])].find(s => s.id.toString() === selectedSchemaId);
    if (!schema?.output_contract) return null;
    const props = (schema.output_contract as any)?.properties;
    if (!props) return null;
    // Find the graph field (type === 'graph' or has graphConfig)
    const findGraphConfig = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return null;
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') {
          const v = val as any;
          if (v.graphConfig) return v.graphConfig;
          if (v.properties) {
            const nested = findGraphConfig(v.properties);
            if (nested) return nested;
          }
        }
      }
      return null;
    };
    return findGraphConfig(props);
  }, [selectedSchemaId, schemas, allSchemas]);

  const schemaColorOverrides = useMemo(() => {
    if (!schemaGraphFieldConfig) return undefined;
    const colors: Record<string, string> = {};
    let hasAny = false;
    if (schemaGraphFieldConfig.entityTypes?.typeColors) {
      Object.assign(colors, schemaGraphFieldConfig.entityTypes.typeColors);
      hasAny = true;
    }
    return hasAny ? { schemaColors: colors, predicateColors: schemaGraphFieldConfig.relationshipSchema?.predicateColors } : undefined;
  }, [schemaGraphFieldConfig]);

  const schemaTypeIcons = useMemo(() => {
    return schemaGraphFieldConfig?.entityTypes?.typeIcons || undefined;
  }, [schemaGraphFieldConfig]);

  const schemaPredicateArrows = useMemo(() => {
    return schemaGraphFieldConfig?.relationshipSchema?.predicateArrows || undefined;
  }, [schemaGraphFieldConfig]);

  // Handle graph config change
  const handleGraphConfigChange = useCallback((newConfig: GraphViewConfig) => {
    setGraphConfig(newConfig);
    // Persist config
    onSettingsChange?.({ graphViewConfig: newConfig });
  }, [onSettingsChange]);

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
    setSelectedEdgeDetail(null);
    if (showDetailPanel) {
      setSelectedNodeId(node.id);
      return;
    }
    setShowDetailPanel(true);
    setTimeout(() => {
      setSelectedNodeId(node.id);
    }, 300);
  }, [showDetailPanel]);

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
    setSelectedEdgeDetail(null);
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
    if (!showDetailPanel && !selectedNodeId && !selectedEdgeDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDetailPanel, selectedNodeId, selectedEdgeDetail, clearSelection]);

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

  // --- RolePicker wiring --------------------------------------------------
  // Derive the picker value from the panel's projection + aggregation +
  // settings. The triplet role accepts the legacy `triplet_field` mapping
  // for backwards compat with panels that predate the role pivot.
  const rolePickerValue = useMemo<RolePickerValue>(() => {
    const mappings = panelConfig.projection?.field_mappings ?? {};
    const fieldsByRole: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(mappings)) {
      if (Array.isArray(val)) fieldsByRole[key] = val.map(String);
      else if (typeof val === 'string' && val.length > 0) fieldsByRole[key] = [val];
    }
    // Legacy panels stored `triplet_field` — project it onto the `triplet`
    // role so the picker shows the right selection.
    if (!fieldsByRole['triplet'] && typeof mappings['triplet_field'] === 'string') {
      fieldsByRole['triplet'] = [mappings['triplet_field'] as string];
    }
    return {
      schemaId:
        (panelConfig.settings?.selectedGraphSchemaId as number | undefined) ??
        (selectedSchemaId ? Number(selectedSchemaId) : null),
      fieldsByRole,
      explosionByRole: {},
      aggregation: panelConfig.aggregation ?? {},
      edgeWeightMode: ((panelConfig.settings as any)?.edgeWeightMode ?? 'count'),
    };
  }, [
    panelConfig.projection,
    panelConfig.aggregation,
    panelConfig.settings?.selectedGraphSchemaId,
    (panelConfig.settings as any)?.edgeWeightMode,
    selectedSchemaId,
  ]);

  const handleRolePickerChange = useCallback((next: RolePickerValue) => {
    const field_mappings: Record<string, string | string[]> = {};
    for (const [role, paths] of Object.entries(next.fieldsByRole)) {
      if (paths.length === 0) continue;
      field_mappings[role] = paths.length > 1 ? paths : paths[0];
    }
    // Keep the legacy `triplet_field` key in sync for any consumer that
    // still reads it during Phase 2 transition.
    const tripletFromRole = next.fieldsByRole['triplet']?.[0];
    if (tripletFromRole) field_mappings['triplet_field'] = tripletFromRole;

    onUpdatePanel({
      projection: {
        field_mappings,
        explosion:
          Object.values(next.explosionByRole).find((e) => !!e) ?? null,
      },
      aggregation: { ...(panelConfig.aggregation ?? {}), ...(next.aggregation ?? {}) },
      settings: {
        ...(panelConfig.settings ?? {}),
        selectedGraphSchemaId: next.schemaId ?? undefined,
        edgeWeightMode: next.edgeWeightMode ?? 'count',
      },
    });
    if (next.schemaId != null) {
      setSelectedSchemaId(String(next.schemaId));
    }
  }, [onUpdatePanel, panelConfig.aggregation, panelConfig.settings]);

  const needsTripletPick = (rolePickerValue.fieldsByRole['triplet']?.length ?? 0) === 0;

  if (graphSchemas.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeaderSlot>
          <RolePickerPopover
            schema={PANEL_ROLE_SCHEMAS.graph}
            availableSchemas={schemas}
            value={rolePickerValue}
            onChange={handleRolePickerChange}
          />
        </PanelHeaderSlot>
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
  // Maps each rendered edge to the set of assets whose triplets contributed
  // to it. Powers the asset-scoped lens: clicking a badge's network icon
  // lights every edge this document spawned, plus the incident nodes.
  // Built once per (edges × results) pass; matched by (subject, target,
  // predicate) like ``hudEvidence`` but reversed.
  const edgeAssetMap: Map<string, Set<number>> = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (edges.length === 0 || results.length === 0) return map;
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const edgeKey = (s: string, t: string, p: string) =>
      `${s.toLowerCase()}|${t.toLowerCase()}|${p.toLowerCase()}`;
    const edgeIndex = new Map<string, GraphEdge>();
    for (const e of edges) {
      const src = nodeById.get(e.sourceId);
      const tgt = nodeById.get(e.targetId);
      if (!src || !tgt) continue;
      edgeIndex.set(edgeKey(src.label, tgt.label, e.predicate), e);
    }
    for (const r of results) {
      if (!r.value || typeof r.value !== 'object') continue;
      const doc = (r.value as any).document || r.value;
      const triplets = (doc as any)?.triplets;
      if (!Array.isArray(triplets)) continue;
      for (const t of triplets) {
        if (!t || typeof t !== 'object') continue;
        const subj = String(t.subject_name || t.subject || '');
        const obj = String(t.object_name || t.object || '');
        const pred = String(t.predicate || '');
        if (!subj || !obj || !pred) continue;
        const e = edgeIndex.get(edgeKey(subj, obj, pred));
        if (!e) continue;
        let set = map.get(e.id);
        if (!set) { set = new Set(); map.set(e.id, set); }
        set.add(r.asset_id);
      }
    }
    return map;
  }, [edges, nodes, results]);

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
    const ids = activePinPage?.pinnedNodeIds ?? [];
    if (ids.length === 0) return null;
    return new Set(ids);
  }, [pinBoard.showLens, activePinPage]);

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
    if (pinNodeIds && pinNodeIds.size > 0) return Array.from(pinNodeIds);
    if (assetNodeIds && assetNodeIds.size > 0) return Array.from(assetNodeIds);
    if (activePeerId) return [activePeerId];
    return connectedNodeIds;
  }, [pinNodeIds, assetNodeIds, activePeerId, connectedNodeIds]);

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

  // Right-rail "connection details": each item corresponds to a real
  // ``GraphEdge`` involving the focused node, with the triplet's description
  // as the justification. Triplets that don't resolve to a rendered edge
  // (predicate filtered, peer node hidden) are dropped — no point showing
  // rationale for a connection that isn't on screen. Top-level
  // ``*_justification`` fields belong with their document on the left rail
  // (future work) — they don't get mixed in here.
  const hudEvidence: HUDEvidenceItem[] = useMemo(() => {
    if (!selectedNodeDetails?.sourceAssetIds?.length) return [];
    const entityLabel = selectedNodeDetails.label.toLowerCase();
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    // Lookup tables keyed by ``${peerLabel.toLowerCase()}|${predicate.toLowerCase()}``
    // so triplet → edge matching is O(1) per triplet.
    const outKey = (peer: string, pred: string) => `${peer.toLowerCase()}|${pred.toLowerCase()}`;
    const outgoingByPeerPred = new Map<string, GraphEdge>();
    for (const e of selectedNodeDetails.outgoingEdges) {
      const peer = nodeById.get(e.targetId);
      if (peer) outgoingByPeerPred.set(outKey(peer.label, e.predicate), e);
    }
    const incomingByPeerPred = new Map<string, GraphEdge>();
    for (const e of selectedNodeDetails.incomingEdges) {
      const peer = nodeById.get(e.sourceId);
      if (peer) incomingByPeerPred.set(outKey(peer.label, e.predicate), e);
    }
    const out: HUDEvidenceItem[] = [];
    const seenEdgeIds = new Set<string>();
    for (const result of results) {
      if (!selectedNodeDetails.sourceAssetIds!.includes(result.asset_id)) continue;
      if (!result.value || typeof result.value !== 'object') continue;
      const val = result.value as Record<string, any>;
      const doc = val.document || val;
      const triplets = doc?.triplets;
      if (!Array.isArray(triplets)) continue;
      for (const t of triplets) {
        if (!t || typeof t !== 'object') continue;
        const subjRaw = t.subject_name || t.subject || '';
        const objRaw = t.object_name || t.object || '';
        const subj = String(subjRaw).toLowerCase();
        const obj = String(objRaw).toLowerCase();
        const isSubject = subj === entityLabel;
        const isObject = obj === entityLabel;
        if (!isSubject && !isObject) continue;
        const evidence = t.description || t.context || '';
        if (!evidence) continue;
        const peerLabel = String(isSubject ? objRaw : subjRaw);
        const predicate = String(t.predicate || '');
        if (!peerLabel || !predicate) continue;
        const lookup = isSubject ? outgoingByPeerPred : incomingByPeerPred;
        const edge = lookup.get(outKey(peerLabel, predicate));
        if (!edge) continue;
        if (seenEdgeIds.has(edge.id)) continue;
        seenEdgeIds.add(edge.id);
        const peerId = isSubject ? edge.targetId : edge.sourceId;
        // Always populate subject/object labels so cards render as proper
        // ``subj predicate obj`` sentences regardless of mode. ``peerLabel``
        // / ``direction`` stay populated for back-compat hooks.
        out.push({
          assetId: result.asset_id,
          edgeId: edge.id,
          peerId,
          predicate,
          peerLabel,
          direction: isSubject ? 'out' : 'in',
          reasoning: evidence,
          confidence: t.confidence,
          subjectLabel: String(subjRaw),
          objectLabel: String(objRaw),
          subjectId: edge.sourceId,
        });
      }
    }
    return out;
  }, [selectedNodeDetails, results, nodes]);

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

    // Evidence: triplets where BOTH endpoints are pinned. Renders as
    // pair cards (subjectLabel → objectLabel) — direction loses meaning
    // when there's no focal node.
    const evidenceItems: HUDEvidenceItem[] = [];
    if (interPinEdges.length > 0) {
      const edgeKey = (s: string, t: string, p: string) =>
        `${s.toLowerCase()}|${t.toLowerCase()}|${p.toLowerCase()}`;
      const edgeIndex = new Map<string, GraphEdge>();
      for (const e of interPinEdges) {
        const src = nodeById.get(e.sourceId);
        const tgt = nodeById.get(e.targetId);
        if (!src || !tgt) continue;
        edgeIndex.set(edgeKey(src.label, tgt.label, e.predicate), e);
      }
      const seenEdgeIds = new Set<string>();
      for (const result of results) {
        if (!pinSourceAssetIds.has(result.asset_id)) continue;
        if (!result.value || typeof result.value !== 'object') continue;
        const val = result.value as Record<string, any>;
        const doc = val.document || val;
        const triplets = doc?.triplets;
        if (!Array.isArray(triplets)) continue;
        for (const t of triplets) {
          if (!t || typeof t !== 'object') continue;
          const subjRaw = t.subject_name || t.subject || '';
          const objRaw = t.object_name || t.object || '';
          const pred = String(t.predicate || '');
          if (!subjRaw || !objRaw || !pred) continue;
          const reasoning = t.description || t.context || '';
          if (!reasoning) continue;
          const e = edgeIndex.get(edgeKey(String(subjRaw), String(objRaw), pred));
          if (!e) continue;
          if (seenEdgeIds.has(e.id)) continue;
          seenEdgeIds.add(e.id);
          evidenceItems.push({
            assetId: result.asset_id,
            edgeId: e.id,
            peerId: e.targetId,
            predicate: pred,
            peerLabel: String(objRaw),
            direction: 'out',
            reasoning,
            confidence: t.confidence,
            subjectLabel: String(subjRaw),
            objectLabel: String(objRaw),
            subjectId: e.sourceId,
          });
        }
      }
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
    assetEdgeCount, annotationIdToAssetId,
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

  // Alias target: group_by paths are the best default for node labelling.
  const graphAliasTargetField = (
    (rolePickerValue.fieldsByRole['node_group_by']?.[0] as string | undefined) ??
    (rolePickerValue.fieldsByRole['edge_group_by']?.[0] as string | undefined)
  ) ?? null;
  const graphAliasesForField = graphAliasTargetField
    ? runWideAliasesByField[graphAliasTargetField] ?? {}
    : {};

  return (
    <div ref={fullscreenRootRef} className={`h-full flex flex-col ${isFullscreen ? 'bg-background' : ''}`}>
      <PanelHeaderSlot>
        <>
          <PanelFormulaBinder
            formulaId={(panelConfig as any).formula_id ?? (panelConfig as any).observation_id ?? null}
            onBind={(id) => onUpdatePanel({ formula_id: id, observation_id: undefined } as any)}
          />
          <RolePickerPopover
            schema={PANEL_ROLE_SCHEMAS.graph}
            availableSchemas={graphSchemas}
            value={rolePickerValue}
            onChange={handleRolePickerChange}
            onOpenValueAliases={graphAliasTargetField ? () => setAliasManagerOpen(true) : undefined}
            infospaceId={infospaceId}
            runId={runId}
            previewProjection={resolvedProjection}
          />
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
        baseFilters={panelConfig.local_filters}
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
          filters={mergedFilters}
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

      {/* Toolbar */}
      {!focusMode && (
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b bg-muted/20">
        {/* View Mode Toggle (2D / 3D). Persisted via graphViewConfig.viewMode.
            3D is dynamic-imported — Three.js (~600 KB) doesn't ship until
            the user flips this for the first time on the page. */}
        <ToggleGroup
          type="single"
          value={graphConfig.viewMode ?? '2d'}
          onValueChange={(value) => {
            if (value !== '2d' && value !== '3d') return; // ignore deselect
            handleGraphConfigChange({ ...graphConfig, viewMode: value });
          }}
          size="sm"
          className="h-6"
          aria-label="Graph view mode"
        >
          <ToggleGroupItem value="2d" className="h-6 px-2 text-[11px]">
            <Square className="h-3 w-3 mr-1" />
            2D
          </ToggleGroupItem>
          <ToggleGroupItem value="3d" className="h-6 px-2 text-[11px]">
            <Box className="h-3 w-3 mr-1" />
            3D
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Search input lives as a floating bar above the connections strip
            inside the canvas (rendered further below). The toolbar slot is
            kept empty on purpose so the rest of the toolbar's layout
            (filters, settings, fullscreen) flows the same way. */}

        {/* View Controls */}
        <ButtonGroup>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-1.5"
            onClick={() => setShowDetailPanel(!showDetailPanel)}
            disabled={!selectedNodeId}
          >
            {showDetailPanel ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
            Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-1.5"
            onClick={aggregateGraph}
            disabled={isLoading || !selectedSchemaId}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </ButtonGroup>

        {/* Data Actions */}
        <ButtonGroup>
          {graphData && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-1.5"
            onClick={handleExportGraph}
          >
            <Download className="h-3 w-3 mr-1" />
            Export
          </Button>
          )}
          {graphData && curationData.totalTriplets > 0 && (
          <Button
            variant="default"
            size="sm"
            className="h-6 text-[11px] px-1.5"
            onClick={() => setShowCuratePanel(true)}
          >
            <Database className="h-3 w-3 mr-1" />
            Curate ({curationData.totalTriplets})
          </Button>
          )}
          {nodes.length >= 2 && (
          <Button
            variant={activeDedupPairs.length > 0 ? "secondary" : "outline"}
            size="sm"
            className="h-6 text-[11px] px-1.5"
            onClick={() => {
              if (showDedupPanel) { setShowDedupPanel(false); }
              else if (dedupPairs.length > 0) { setShowDedupPanel(true); }
              else { handleFindDuplicates(); }
            }}
            disabled={isDedupLoading}
          >
            {isDedupLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Fingerprint className="h-3 w-3 mr-1" />}
            {activeDedupPairs.length > 0 ? `Dedup (${activeDedupPairs.length})` : 'Dedup'}
          </Button>
          )}
        </ButtonGroup>

        {/* Graph Settings */}
        <GraphSettingsPopover
          config={graphConfig}
          onConfigChange={handleGraphConfigChange}
          defaultConfig={defaultGraphViewConfig}
          availableEdgeFields={Array.from(new Set(edges.flatMap(e => Object.keys(e.properties || {}))))}
          edgeFieldDataRange={edgeFieldRange(edges, graphConfig.edgeWidthField)}
          onReheatSimulation={() => forceGraphRef.current?.reheatSimulation()}
        />

        {/* Filter Panel */}
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

        {/* Stats */}
        {graphData && (
          <div className="text-xs text-muted-foreground">
            {graphData.metadata.total_nodes} nodes {graphData.metadata.total_edges} edges
            {selectedNodeId && selectedNodeDetails && (
              <span className="ml-1.5 text-blue-600">
                • {selectedNodeDetails.totalConnections}c
              </span>
            )}
          </div>
        )}

        {/* Fullscreen toggle — pushed to the right edge of the toolbar so it
            stays out of the way of the primary actions. Detail pane lives
            inside the fullscreen container, so node details remain accessible
            without leaving the view. */}
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[11px] px-1.5 ml-auto"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </Button>
      </div>
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

      {/* Empty-state teacher when triplet role is unfilled */}
      {!isLoading && !error && nodes.length === 0 && needsTripletPick && (
        <div className="flex-1 p-4">
          <EmptyStateCard
            reason={{ kind: 'role_unfilled', roleLabel: 'Triplet field' }}
            className="h-full"
          />
        </div>
      )}

      {/* Main Content Area */}
      {!isLoading && nodes.length > 0 && (
        <div className="flex-1 min-h-0">
          <div className="relative h-full w-full overflow-hidden">
            <ForceGraph
              ref={forceGraphRef}
              nodes={nodes}
              edges={renderEdges}
              highlightedNodeId={selectedNodeId}
              connectedNodeIds={effectiveConnectedNodeIds}
              highlightedEdgeId={activeEdgeId}
              highlightedEdgeIds={assetEdgeIds ?? undefined}
              pinNodeIds={pinNodeIds ?? undefined}
              pinNetworkEdges={pinNetworkEdges ?? undefined}
              mergeSelectedNodeIds={mergeSelectedIds}
              onNodeClick={handleNodeSelect}
              onNodeShiftClick={handleNodeShiftClick}
              onNodeAltClick={(node) => handleTogglePin(node.id)}
              onEdgeClick={(edge) => { setSelectedEdgeDetail(edge); setSelectedNodeId(null); setShowDetailPanel(true); }}
              onBackgroundClick={clearSelection}
              autoResize={true}
              config={graphConfig}
              onConfigChange={handleGraphConfigChange}
              colorOverrides={schemaColorOverrides}
              typeIcons={schemaTypeIcons}
              predicateArrows={schemaPredicateArrows}
              hiddenEntityTypes={hiddenEntityTypes}
              hiddenPredicates={hiddenPredicates}
              onToggleEntityType={(type) => {
                setHiddenEntityTypes(prev => {
                  const next = new Set(prev);
                  if (next.has(type)) next.delete(type);
                  else next.add(type);
                  return next;
                });
              }}
              legendHidden={showDetailPanel && hudOwner !== null}
              focusedEntityNames={focusedEntityNames}
            />

            {/* Pin board — bottom-left overlay. Multi-page persistent
                collection of pinned nodes. The active page's pinned ids
                ARE ``mergeSelectedIds`` so the existing merge bar still
                triggers at 2+ pins; PinBoard adds the network/evidence
                lenses + multi-page management. */}
            <PinBoardOverlay
              pinBoard={pinBoard}
              nodes={nodes}
              onSetActivePage={handleSetActivePage}
              onAddPage={handleAddPinPage}
              onRenamePage={handleRenamePinPage}
              onDeletePage={handleDeletePinPage}
              onUnpin={handleUnpin}
              onClearPage={handleClearPinPage}
              onPeerClick={handleNodeSelect}
              onToggleLens={handleTogglePinLens}
            />

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
                query get highlighted in place. ===== */}
            <div
              className="absolute bottom-[4.5rem] left-1/2 -translate-x-1/2 z-30 !bg-background/90"
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

            {/* ===== Node detail HUD — overlays the canvas without resizing
                it. Sections (top/left/right/bottom) position themselves around
                the centred selected node so the canvas remains the focal
                surface; the HUD container has pointer-events: none so the
                user can pan/zoom the graph in the gaps. ===== */}
            {/* ===== Anchor HUD — fires when a node is the HUD owner. The
                pin-set lens (if active) stays on the canvas as context, but
                this HUD describes the focused node. The swap chip in the
                title pill jumps to the subnet HUD when both are live. ===== */}
            {showDetailPanel && hudOwner === 'anchor' && selectedNodeDetails && (
              <NodeDetailHUD
                focalNode={selectedNodeDetails as any}
                edges={[
                  ...selectedNodeDetails.outgoingEdges,
                  ...selectedNodeDetails.incomingEdges,
                ]}
                nodes={nodes}
                documents={hudDocuments}
                evidence={hudEvidence}
                searchTerm={searchTerm}
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
                isFocusedNodePinned={selectedNodeId
                  ? (activePinPage?.pinnedNodeIds?.includes(selectedNodeId) ?? false)
                  : false}
                onTogglePin={selectedNodeId ? () => handleTogglePin(selectedNodeId) : undefined}
                pinEvidencePeerIds={pinEvidencePeerIds}
                onPeerClick={handleNodeSelect}
                onAssetClick={openDetailOverlay}
                onEdgeHover={(edgeId, peerId) =>
                  setHoveredEvidence(edgeId && peerId ? { edgeId, peerId } : null)
                }
                swapTo={subnetAvailable && pinSubnetScope ? {
                  label: pinSubnetScope.summary.label,
                  meta: `${pinSubnetScope.summary.nodeCount} node${pinSubnetScope.summary.nodeCount === 1 ? '' : 's'}`,
                  kind: 'subnet',
                  onClick: swapHudOwner,
                } : undefined}
                lenses={activeLenses}
                onClose={clearSelection}
              />
            )}

            {/* ===== Projection dossier rail — sibling to the anchor HUD when
                the panel's projection has entity-typed roles. Surfaces
                "AS <role>" buckets ranked by primary × confidence × count.
                Click a bucket → push a cooccurs scope to peer panels. ===== */}
            {showDetailPanel && hudOwner === 'anchor' && selectedNodeDetails && projectionHasEntityRoles && (() => {
              const focalLabel = (selectedNodeDetails as any).label as string | undefined;
              const focalType = (selectedNodeDetails as any).type as string | undefined;
              const focalEntityId = findEntityId(focalLabel, focalType);
              if (!focalEntityId) return null;
              return (
                <NodeProjectionDossier
                  infospaceId={infospaceId}
                  runId={runId}
                  entityId={focalEntityId}
                  entityLabel={focalLabel}
                  projection={resolvedProjection}
                  onBucketClick={(_group, bucket) => {
                    if (!focalLabel || !bucket.label) return;
                    const { pushed } = pushCooccursToDashboard({
                      entities: [focalLabel, bucket.label],
                      reach: 'annotation',
                      panels: dashboardPanels as any,
                      schemas: schemas as any,
                      addScope: broadcastAddScope,
                      sourcePanelId: panelConfig.id,
                      excludePanelId: panelConfig.id,
                      label: `${focalLabel} ↔ ${bucket.label}`,
                    });
                    if (pushed === 0) {
                      toast.warning('No peer panels with Entity-typed schemas to scope.');
                    } else {
                      toast.success(
                        `Scoped ${pushed} peer panel${pushed === 1 ? '' : 's'} to ${focalLabel} ↔ ${bucket.label}`,
                      );
                    }
                  }}
                  onRowClick={(row) => {
                    const assetId = (row.provenance as any)?.asset_id;
                    if (typeof assetId === 'number') openDetailOverlay(assetId);
                  }}
                />
              );
            })()}

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
                searchTerm={searchTerm}
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

            {/* ===== Projection-bound edge HUD — when the panel projection
                declares entity-typed roles, the click on an edge opens the
                richer edge dossier (snippets, predicate mix, scalars). The
                legacy floating card below remains the fallback. ===== */}
            {showDetailPanel && selectedEdgeDetail && !selectedNodeDetails && projectionHasEntityRoles && (() => {
              const subjectLabel = nodes.find(n => n.id === selectedEdgeDetail.sourceId)?.label ?? '';
              const objectLabel = nodes.find(n => n.id === selectedEdgeDetail.targetId)?.label ?? '';
              const subjectType = nodes.find(n => n.id === selectedEdgeDetail.sourceId)?.type;
              const objectType = nodes.find(n => n.id === selectedEdgeDetail.targetId)?.type;
              // Resolve role entity types when present so the lookup narrows
              // to the right canon stratum.
              const actorEntityType = resolvedProjection?.roles?.[actorRole]?.entity_type ?? subjectType;
              const subjectEntityType = resolvedProjection?.roles?.[subjectRole]?.entity_type ?? objectType;
              const actorEntityId = findEntityId(subjectLabel, actorEntityType);
              const subjectEntityId = findEntityId(objectLabel, subjectEntityType);
              if (!actorEntityId || !subjectEntityId) return null;
              return (
                <EdgeDetailHUD
                  infospaceId={infospaceId}
                  runId={runId}
                  projection={resolvedProjection}
                  actorRole={actorRole}
                  subjectRole={subjectRole}
                  actorEntityId={actorEntityId}
                  subjectEntityId={subjectEntityId}
                  actorLabel={subjectLabel}
                  subjectLabel={objectLabel}
                  onClose={() => { setSelectedEdgeDetail(null); setShowDetailPanel(false); }}
                  onRowClick={(row) => {
                    const assetId = (row.provenance as any)?.asset_id;
                    if (typeof assetId === 'number') openDetailOverlay(assetId);
                  }}
                />
              );
            })()}

            {/* ===== Edge detail floating card — small overlay (top-right)
                rather than a full side panel; edges are simpler and don't
                need the HUD treatment. Falls back when the panel has no
                projection-bound entity roles. ===== */}
            {showDetailPanel && selectedEdgeDetail && !selectedNodeDetails && !projectionHasEntityRoles && (() => {
              // Resolve subject/object labels for both display + the cooccurs
              // scope gesture. Computed inline so we have one source of truth.
              const subjectLabel = nodes.find(n => n.id === selectedEdgeDetail.sourceId)?.label ?? '';
              const objectLabel = nodes.find(n => n.id === selectedEdgeDetail.targetId)?.label ?? '';
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
              const canScope = subjectLabel && objectLabel && peerPanelsWithEntityPaths.length > 0;
              const handlePushScope = () => {
                if (!subjectLabel || !objectLabel) return;
                const { pushed } = pushCooccursToDashboard({
                  entities: [subjectLabel, objectLabel],
                  reach: 'annotation',
                  panels: dashboardPanels as any,
                  schemas: schemas as any,
                  addScope: broadcastAddScope,
                  sourcePanelId: panelConfig.id,
                  excludePanelId: panelConfig.id,
                  label: `${subjectLabel} ↔ ${objectLabel}`,
                });
                if (pushed === 0) {
                  toast.warning('No peer panels with Entity-typed schemas. Add an Entity field to a panel\'s schema to enable cross-panel scoping.');
                  return;
                }
                toast.success(
                  `Scoped ${pushed} peer panel${pushed === 1 ? '' : 's'} to ${subjectLabel} ↔ ${objectLabel}` +
                  (dashboardName ? ` in ${dashboardName}` : ''),
                );
              };
              return (
              <div
                className="absolute top-2 right-12 z-30 w-[320px] max-w-[40%] bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3"
                style={{ pointerEvents: 'auto' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold">Edge Details</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => { setSelectedEdgeDetail(null); setShowDetailPanel(false); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="text-sm space-y-1">
                  <p className="font-medium text-foreground">{subjectLabel}</p>
                  <p className="text-muted-foreground italic">{selectedEdgeDetail.predicate}</p>
                  <p className="font-medium text-foreground">{objectLabel}</p>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-2 pt-2 border-t">
                  {selectedEdgeDetail.weight != null && <div><span className="font-medium">Weight:</span> {selectedEdgeDetail.weight}</div>}
                  {selectedEdgeDetail.confidence != null && <div><span className="font-medium">Confidence:</span> {selectedEdgeDetail.confidence}</div>}
                  {selectedEdgeDetail.frequency != null && <div><span className="font-medium">Frequency:</span> {selectedEdgeDetail.frequency}</div>}
                  {selectedEdgeDetail.date && <div><span className="font-medium">Date:</span> {selectedEdgeDetail.date}</div>}
                </div>
                {selectedEdgeDetail.context && (
                  <p className="text-[11px] text-foreground bg-muted/50 p-2 rounded mt-2 leading-relaxed">{selectedEdgeDetail.context}</p>
                )}
                {/* Scope-to-relationship: only relevant when peer panels exist
                   that could actually filter on entity co-occurrence. */}
                <div className="mt-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-xs gap-1.5"
                    onClick={handlePushScope}
                    disabled={!canScope}
                    title={
                      canScope
                        ? `Push a co-occurrence filter for this pair to ${peerPanelsWithEntityPaths.length} peer panel${peerPanelsWithEntityPaths.length === 1 ? '' : 's'}.`
                        : peerPanels.length === 0
                          ? 'No peer panels in this dashboard.'
                          : 'No peer panels read from a schema with Entity fields.'
                    }
                  >
                    <Target className="h-3 w-3" />
                    Scope dashboard to {subjectLabel} ↔ {objectLabel}
                  </Button>
                </div>
              </div>
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
    </div>
  );
}