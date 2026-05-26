'use client';

import React, { useState, useMemo, useEffect, useCallback, Fragment, startTransition, useRef } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
  createColumnHelper,
  ColumnDef,
  Row,
  SortingState,
  ColumnFiltersState,
  ExpandedState,
  Column,
  CellContext,
  HeaderContext,
  PaginationState,
  TableMeta
} from '@tanstack/react-table';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AnnotationSchemaRead, AnnotationRead, AssetRead } from '@/client';
import type { FilterSet as ClientFilterSet, MergeMap } from '@/client';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import AssetLink from '../assets/Helper/AssetLink';
import { ResultFilter } from './AnnotationFilterControls';
import { getTargetKeysForScheme, getAnnotationFieldValue, getTargetFieldDefinition, getFieldDefinitionFromSchema, formatFieldNameForDisplay as formatFieldNameUtil, getModalityIcon } from '@/lib/annotations/utils';
import { searchInAnnotationValue } from '@/lib/annotations/search';
import { useAnnotationView } from '@/hooks/useAnnotationView';
import type { AnnotationResultRow, AssetSummary, PanelConfig, TableVizConfig } from '@/lib/annotations/types';
import { PanelHeaderSlot } from './panels/PanelHeaderSlot';
import { ValueAliasManager } from './panels/ValueAliasManager';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, ChevronDown, MoreHorizontal, ExternalLink, Eye, Trash2, Filter, X, ChevronRight, ChevronsLeft, ChevronsRight, Settings2, Loader2, RefreshCw, Ban, Search, SlidersHorizontal, Sparkles, Maximize2, Minimize2, Columns3, Columns, ArrowUpToLine, UnfoldVertical, FoldVertical, Wand2, HelpCircle, Download, Image as ImageIcon, FileText, Focus } from 'lucide-react';
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Checkbox } from "@/components/ui/checkbox";
import { 
    DropdownMenu, 
    DropdownMenuCheckboxItem, 
    DropdownMenuContent, 
    DropdownMenuItem, 
    DropdownMenuLabel, 
    DropdownMenuSeparator, 
    DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/collection/tables/data-table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AnnotationResultStatus, FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { AlertCircle } from 'lucide-react';
import { VariableSplittingConfig } from './VariableSplittingControls';
import GuidedRetryModal from './GuidedRetryModal';
import { useFragmentCuration } from '@/hooks/useFragmentCuration';
import AnnotationCurationModal from './AnnotationCurationModal';
import {
  type Density,
  type FieldRangeCache,
  type NumericRange,
  inferFieldRange,
  valueFitsRange,
  writeCachedRange,
  getDensitySpec,
} from './cellRenderers';
import { Rows3, Rows4, AlignJustify } from 'lucide-react';
import { AssetDetailContext } from '@/components/collection/assets/Views/AssetDetailProvider';

// Extend TableMeta type if needed for onRowClick
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends unknown> {
    onRowClick?: (row: any) => void;
    onRowAction?: (action: string, rowData: TData) => void;
    onRowDelete?: (rowData: TData) => void;
  }
}

// Define the structure for a row in the table
type AssetRow = {
  asset: AnnotationRead | undefined; // Using AnnotationRead as a proxy for enriched asset
  results: AnnotationRead[];
};

// Interface for results potentially enriched with Source info
export interface ResultWithSourceInfo extends FormattedAnnotation {
  source_name?: string; 
  source_id?: number;
}

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

interface AnnotationResultsTableProps {
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  panelConfig: PanelConfig;
  onUpdatePanel: (updates: Partial<PanelConfig>) => void;
  // Keep backward-compatible props for features not yet migrated
  sources?: { id: number; name: string }[];
  onResultSelect?: (result: ResultWithSourceInfo) => void;
  onResultDelete?: (resultId: number) => void;
  onResultAction?: (action: string, result: ResultWithSourceInfo) => void;
  onRetrySingleResult?: (resultId: number, customPrompt?: string) => Promise<AnnotationRead | null>;
  retryingResultId?: number | null;
  excludedRecordIds?: Set<number>;
  onToggleRecordExclusion?: (recordId: number) => void;
  onTimestampClick?: (timestamp: Date, fieldKey: string) => void;
  onLocationClick?: (location: string, fieldKey: string) => void;
}

// --- UTILITY FUNCTIONS (Keep existing helpers like getHeaderClassName) --- //

// --- NEW SUB-TABLE COMPONENT --- //
interface SubResultsTableProps {
  results: ResultWithSourceInfo[];
  columns: ColumnDef<ResultWithSourceInfo>[];
  onResultAction?: (action: string, result: ResultWithSourceInfo) => void;
  onResultDelete?: (resultId: number) => void;
  isLoading?: boolean; // Pass loading state if needed
}

const SubResultsTable: React.FC<SubResultsTableProps> = ({
  results,
  columns,
  onResultAction,
  onResultDelete,
  isLoading = false,
}) => {
  // No useReactTable hook needed here as DataTable handles it

  return (
    <div className="p-4 bg-muted/10 border-l-4 border-blue-600">
      <DataTable<ResultWithSourceInfo, unknown>
        data={results} // Pass data directly
        columns={columns} // Pass columns directly
        enableRowSelection={false} // Disable row selection for the sub-table
        // Pass callbacks if DataTable component supports them via props
        // This assumes DataTable has props like onRowAction, onRowDelete
        // Check data-table.tsx for actual prop names
        // onRowAction={onResultAction} 
        // onRowDelete={onResultDelete ? (rowData) => onResultDelete(rowData.id) : undefined}
      />
    </div>
  );
};

// --- Adapter: map /view response rows to the legacy ResultWithSourceInfo shape --- //
function adaptViewRowToResult(row: AnnotationResultRow): ResultWithSourceInfo {
  return {
    id: row.annotation_id,
    asset_id: row.asset_id,
    schema_id: row.schema_id,
    run_id: row.run_id,
    value: row.value,
    timestamp: row.timestamp,
    status: row.status as AnnotationResultStatus,
  };
}

function adaptAssetSummaryToAssetRead(summary: AssetSummary): AssetRead {
  return {
    id: summary.id,
    title: summary.title,
    kind: summary.kind as any,
    parent_asset_id: summary.parent_asset_id,
    uuid: '',
    infospace_id: 0,
    source_id: null,
    created_at: '',
    updated_at: '',
    is_container: false,
    stub: false,
    part_index: null,
  } as AssetRead;
}

// --- MAIN COMPONENT --- //
export function AnnotationResultsTable({
  infospaceId,
  runId,
  schemas,
  panelConfig,
  onUpdatePanel,
  sources = [],
  onResultSelect,
  onResultDelete,
  onResultAction,
  onRetrySingleResult,
  retryingResultId,
  excludedRecordIds = new Set<number>(),
  onToggleRecordExclusion,
  onTimestampClick,
  onLocationClick,
}: AnnotationResultsTableProps) {
  // --- Panel config (new shape) --- //
  const cfg = panelConfig.panel_config as TableVizConfig;
  // Aggregate mode when the formula carries at least one measure.
  const isAggregateMode = (panelConfig.formula?.measures?.length ?? 0) > 0;

  // --- Server-side data fetching via /view endpoint --- //
  const [cursor, setCursor] = useState<number | string | null>(null);
  const pageSize = panelConfig.settings?.tableConfig?.pagination?.pageSize || 100;

  // Value-alias wiring — the table targets the first selected column.
  const [aliasManagerOpen, setAliasManagerOpen] = useState(false);
  const getGlobalVariableSplitting = useAnnotationRunStore(s => s.getGlobalVariableSplitting);
  const setGlobalVariableSplitting = useAnnotationRunStore(s => s.setGlobalVariableSplitting);
  // Focus mode hides the in-panel toolbar (search/columns/export/etc.).
  // Pagination at the footer stays — it's functional, not settings.
  const focusMode = useAnnotationRunStore(s => s.focusMode);
  const gvs = getGlobalVariableSplitting();
  const runWideAliasesByField = gvs?.valueAliasesByField ?? {};

  const { data: viewData, isLoading, error: viewError, refetch } = useAnnotationView({
    infospaceId,
    runId,
    panel: panelConfig,
    schemas,
    fields: isAggregateMode ? undefined : panelConfig.fields,
    incoming_scopes: panelConfig.scopes_in,
    merge_maps: panelConfig.merge_maps,
    ...(isAggregateMode
      ? { aggregate: {} }
      : { rows: { limit: pageSize, cursor: typeof cursor === 'number' ? cursor : undefined } }),
    enabled: !!runId && !!infospaceId,
  });

  // Adapt server response to the formats the rendering code expects
  const results = useMemo<ResultWithSourceInfo[]>(() => {
    if (!viewData?.rows?.items) return [];
    return viewData.rows.items.map(adaptViewRowToResult);
  }, [viewData?.rows?.items]);

  const assets = useMemo<AssetRead[]>(() => {
    if (!viewData?.rows?.assets) return [];
    return Object.values(viewData.rows.assets).map(adaptAssetSummaryToAssetRead);
  }, [viewData?.rows?.assets]);

  const totalRows = viewData?.rows?.total ?? viewData?.aggregate?.total ?? 0;
  const cursorNext = viewData?.rows?.cursor_next ?? viewData?.aggregate?.cursor_next ?? null;

  // Aggregate mode: rows from OutputRelation
  const aggregateRows = useMemo(() => {
    if (!isAggregateMode || !viewData?.aggregate?.rows) return [];
    return viewData.aggregate.rows;
  }, [isAggregateMode, viewData?.aggregate?.rows]);

  const aggregateMeta = useMemo(() => ({
    outputKeys: viewData?.aggregate?.output_keys ?? [],
    measureNames: viewData?.aggregate?.measure_names ?? [],
  }), [viewData?.aggregate?.output_keys, viewData?.aggregate?.measure_names]);

  // Table config from panel settings
  const initialTableConfig = panelConfig.settings?.tableConfig;
  const tableSettingsRef = useRef(panelConfig.settings);
  tableSettingsRef.current = panelConfig.settings;
  const onTableConfigChange = useCallback((config: any) => {
    onUpdatePanel({ settings: { ...tableSettingsRef.current, tableConfig: config } });
  }, [onUpdatePanel]);

  const filters: ResultFilter[] = []; // Legacy filters replaced by server-side FilterSet
  const timeAxisConfig: TimeAxisConfig | null = null; // Time filtering now handled server-side
  // Variable splitting TBD — will be re-enabled via aggregation config
  const [variableSplittingConfig] = useState<VariableSplittingConfig | null>(null);
  const onVariableSplittingChange: ((config: VariableSplittingConfig | null) => void) | undefined = undefined;
  const [sorting, setSorting] = useState<SortingState>(() => {
    // cfg.sort is the new canonical source; legacy tableConfig.sorting is fallback.
    if (cfg?.sort) {
      return [{ id: cfg.sort.column, desc: cfg.sort.direction === 'desc' }];
    }
    if (initialTableConfig?.sorting) {
      return initialTableConfig.sorting.map((s: any) => ({ id: s.id, desc: s.desc }));
    }
    return [];
  });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState(() => {
    if (initialTableConfig?.columnVisibility) {
      return initialTableConfig.columnVisibility;
    }
    // Initially hide timestamp and source name (now integrated into asset column)
    return {
      'resultsMap': false, // Hide timestamp by default
      'sourceName': false, // Hide source name column (shown in asset column)
      'splitValue': false, // Hide split value by default
    };
  });
  const [rowSelection, setRowSelection] = useState({});
  const [pagination, setPagination] = useState<PaginationState>(() => {
    if (initialTableConfig?.pagination) {
      return initialTableConfig.pagination;
    }
    return {
      pageIndex: 0,
      pageSize: 50,
    };
  });
  const [globalFilter, setGlobalFilter] = useState(initialTableConfig?.globalFilter || '');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(initialTableConfig?.expanded || {});
  const [density, setDensity] = useState<Density>(
    (cfg?.density as Density) ?? (initialTableConfig?.density as Density) ?? 'comfortable',
  );
  const [fieldRangeCache, setFieldRangeCache] = useState<FieldRangeCache>(
    initialTableConfig?.fieldRangeCache || {},
  );
  // Failed-row visibility: hidden by default. The toolbar surfaces the count
  // and lets the user opt in (e.g. to use the "…" menu retry).
  const [showFailed, setShowFailed] = useState<boolean>(
    initialTableConfig?.showFailed ?? false,
  );
  // Unfolded by default — the user shouldn't have to click into a row or
  // toggle anything to see annotation fields. Folded mode is still
  // reachable via the toolbar button for dense / multi-schema views.
  const [unfoldFields, setUnfoldFields] = useState(true);
  const [filterArrayItems, setFilterArrayItems] = useState(false); // NEW: Toggle to filter array items to matching ones only
  const { activeInfospace } = useInfospaceStore();
  const { loadSchemas: refreshSchemasFromHook } = useAnnotationSystem(); // Renaming for clarity

  // NEW: Guided retry modal state
  const [guidedRetryModal, setGuidedRetryModal] = useState<{
    isOpen: boolean;
    result: ResultWithSourceInfo | null;
    schema: AnnotationSchemaRead | null;
  }>({
    isOpen: false,
    result: null,
    schema: null,
  });

  // ── Visible-fields derivation — pure, deterministic, no useState ──
  //
  // Rules (one place, no race conditions):
  //   1. ``cfg.columns`` is the user's explicit subset. Empty = "show all".
  //   2. For each schema, intersect ``cfg.columns`` with the schema's
  //      target keys. If the intersection is empty, fall back to that
  //      schema's full key list (no schema renders as blank).
  //   3. When ``cfg.columns`` is empty entirely, every schema shows all
  //      its keys.
  //
  // This replaces the previous useState + two useEffects, all of which
  // could race on schema/cfg changes and leave the table empty. The
  // toggle handler (header popover) writes to ``cfg.columns`` via
  // ``onUpdatePanel`` so this memo stays the single source of truth.
  const selectedFieldsPerScheme = useMemo<Record<number, string[]>>(() => {
    const next: Record<number, string[]> = {};
    const columns: string[] = (cfg?.columns ?? []) as string[];
    schemas.forEach(schema => {
      const allKeys = getTargetKeysForScheme(schema.id, schemas).map(tk => tk.key);
      if (columns.length === 0) {
        next[schema.id] = allKeys;
        return;
      }
      const owned = columns.filter(c => allKeys.includes(c));
      next[schema.id] = owned.length > 0 ? owned : allKeys;
    });
    return next;
  }, [schemas, cfg?.columns]);

  // Toggle handler for the header popover — flips a field on/off in
  // ``cfg.columns``. When all fields are present and the user turns one
  // off, we materialize the explicit list (otherwise we wouldn't know
  // it's a subset). When the toggled list ends up equal to "all", we
  // collapse back to ``[]`` so the panel persists the lean default.
  const handleFieldToggle = useCallback(
    (schemaId: number, fieldKey: string) => {
      const allKeys = getTargetKeysForScheme(schemaId, schemas).map(tk => tk.key);
      const currentColumns: string[] = (cfg?.columns ?? []) as string[];
      // If cfg.columns is empty (= "show all"), materialize all keys
      // first so we can subtract from a known set.
      const base = currentColumns.length > 0
        ? currentColumns.slice()
        : schemas.flatMap(s => getTargetKeysForScheme(s.id, schemas).map(tk => tk.key));
      let next: string[];
      if (base.includes(fieldKey)) {
        next = base.filter(k => k !== fieldKey);
      } else {
        next = [...base, fieldKey];
      }
      // Collapse to [] when next == all-fields-across-all-schemas.
      const allEverywhere = schemas.flatMap(s =>
        getTargetKeysForScheme(s.id, schemas).map(tk => tk.key),
      );
      const isEqualToAll =
        next.length === allEverywhere.length && next.every(k => allEverywhere.includes(k));
      onUpdatePanel({
        panel_config: { ...(cfg as any), columns: isEqualToAll ? [] : next },
      } as any);
    },
    [cfg, schemas, onUpdatePanel],
  );

  // Track if this is the initial render to avoid calling onTableConfigChange on mount
  const isInitialRender = useRef(true);
  const previousConfigRef = useRef<any>(null);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // NEW: Retry handler functions
  const handleQuickRetry = useCallback(async (result: ResultWithSourceInfo) => {
    if (!onRetrySingleResult) return;
    try {
      await onRetrySingleResult(result.id);
    } catch (error) {
      // Error handling is done in the hook
    }
  }, [onRetrySingleResult]);

  const handleGuidedRetry = useCallback((result: ResultWithSourceInfo) => {
    const schema = schemas.find(s => s.id === result.schema_id) || null;
    setGuidedRetryModal({
      isOpen: true,
      result,
      schema,
    });
  }, [schemas]);

  const handleGuidedRetryExecute = useCallback(async (resultId: number, customPrompt: string) => {
    if (!onRetrySingleResult) return;
    await onRetrySingleResult(resultId, customPrompt);
  }, [onRetrySingleResult]);

  const closeGuidedRetryModal = useCallback(() => {
    setGuidedRetryModal({
      isOpen: false,
      result: null,
      schema: null,
    });
  }, []);

  const { curate, isCurationLoading, curationProgress } = useFragmentCuration();
  const [curationState, setCurationState] = useState<{
    isOpen: boolean;
    payloads: { assetId: number; fragmentKey: string; fragmentValue: any; sourceRunId?: number }[];
  }>({
    isOpen: false,
    payloads: [],
  });

  const handleCurationClick = (mode: 'visible' | 'selected' | 'single', record?: EnrichedAssetRecord) => {
    let targetRows: Row<EnrichedAssetRecord>[] = [];
    
    if (mode === 'visible') {
      targetRows = table.getFilteredRowModel().rows;
    } else if (mode === 'selected') {
      targetRows = table.getSelectedRowModel().rows;
    } else if (mode === 'single' && record) {
       const row = table.getRowModel().rowsById[record.id.toString()];
       if (row) targetRows = [row];
    }

    if (targetRows.length === 0) {
      // TODO: Add toast notification
      console.warn("No rows to curate.");
      return;
    }

    const payloads: { assetId: number; fragmentKey: string; fragmentValue: any; sourceRunId?: number }[] = [];
    const assetSet = new Set<number>();

    targetRows.forEach(row => {
      const record = row.original;
      assetSet.add(record.id);

      Object.entries(record.resultsMap).forEach(([schemaIdStr, result]) => {
        const schemaId = parseInt(schemaIdStr, 10);
        const visibleFields = selectedFieldsPerScheme[schemaId] || [];
        
        visibleFields.forEach(fieldKey => {
          const fieldValue = getAnnotationFieldValue(result.value, fieldKey);
          if (fieldValue !== undefined && fieldValue !== null) {
            payloads.push({
              assetId: record.id,
              fragmentKey: fieldKey,
              fragmentValue: fieldValue,
              sourceRunId: result.run_id, // ADDED: Pass original run ID for proper source tracking
            });
          }
        });
      });
    });

    setCurationState({
      isOpen: true,
      payloads,
    });
  };

  const executeCuration = async () => {
    await curate(curationState.payloads);
    setCurationState({ isOpen: false, payloads: [] });
  };

  // CSV Export handler
  const [isExporting, setIsExporting] = useState(false);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    includeJustifications: true,
    includeMetadata: true,
    flattenJson: true,
  });
  
  const handleExportCSV = useCallback(async () => {
    if (!runId || !activeInfospace?.id) {
      console.error('Missing runId or infospace for export');
      return;
    }
    
    setIsExporting(true);
    
    try {
      const params = new URLSearchParams({
        flatten_json: String(exportOptions.flattenJson),
        include_metadata: String(exportOptions.includeMetadata),
        include_justifications: String(exportOptions.includeJustifications),
      });
      const apiUrl = `/api/v1/infospaces/${activeInfospace.id}/runs/${runId}/export/csv?${params}`;
      
      const response = await fetch(
        apiUrl,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `annotations_run_${runId}.csv`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setExportOptionsOpen(false);
    } catch (error) {
      console.error('CSV export failed:', error);
      // TODO: Add toast notification
    } finally {
      setIsExporting(false);
    }
  }, [runId, activeInfospace?.id, exportOptions]);

  // Debounced function to notify parent of config changes
  const debouncedConfigUpdate = useCallback((config: any) => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    
    updateTimeoutRef.current = setTimeout(() => {
      if (onTableConfigChange) {
        onTableConfigChange(config);
      }
    }, 500); // Increased debounce to 500ms to reduce rapid updates
  }, [onTableConfigChange]);

  // Notify parent component when table configuration changes (but not on initial render)
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      console.log('Table config initial render, storing config');
      // Store initial config for comparison
      previousConfigRef.current = {
        columnVisibility,
        sorting: sorting.map(s => ({ id: s.id, desc: s.desc })),
        pagination,
        globalFilter,
        expanded,
        selectedFieldsPerScheme,
      };
      return;
    }

    const config = {
      columnVisibility,
      sorting: sorting.map(s => ({ id: s.id, desc: s.desc })),
      pagination,
      globalFilter,
      expanded,
      selectedFieldsPerScheme,
      density,
      fieldRangeCache,
      showFailed,
    };

    // Only call if config actually changed (more stable comparison)
    const prevConfig = previousConfigRef.current;
    let hasChanged = false;

    if (!prevConfig) {
      hasChanged = true;
    } else {
      // Check each property more carefully
      hasChanged =
        config.globalFilter !== prevConfig.globalFilter ||
        config.pagination.pageIndex !== prevConfig.pagination.pageIndex ||
        config.pagination.pageSize !== prevConfig.pagination.pageSize ||
        config.density !== prevConfig.density ||
        config.showFailed !== prevConfig.showFailed ||
        config.sorting.length !== prevConfig.sorting.length ||
        config.sorting.some((sort, i) =>
          !prevConfig.sorting[i] ||
          sort.id !== prevConfig.sorting[i].id ||
          sort.desc !== prevConfig.sorting[i].desc
        );

      // Only check complex objects if basic properties haven't changed
      if (!hasChanged) {
        try {
          hasChanged =
            JSON.stringify(config.columnVisibility) !== JSON.stringify(prevConfig.columnVisibility) ||
            JSON.stringify(config.expanded) !== JSON.stringify(prevConfig.expanded) ||
            JSON.stringify(config.selectedFieldsPerScheme) !== JSON.stringify(prevConfig.selectedFieldsPerScheme) ||
            JSON.stringify(config.fieldRangeCache) !== JSON.stringify(prevConfig.fieldRangeCache);
        } catch (error) {
          // If JSON.stringify fails, assume changed to be safe
          hasChanged = true;
        }
      }
    }

    if (hasChanged) {
      previousConfigRef.current = { ...config }; // Deep copy to avoid reference issues
      debouncedConfigUpdate(config);
    }
  }, [columnVisibility, sorting, pagination, globalFilter, expanded, selectedFieldsPerScheme, density, fieldRangeCache, showFailed, debouncedConfigUpdate]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeInfospace && schemas.length === 0) {
      // Defer this call to avoid render cycle issues
      queueMicrotask(() => {
        refreshSchemasFromHook();
      });
    }
  }, [activeInfospace, schemas.length, refreshSchemasFromHook]);

  // Register the current row order with the asset-detail provider so the overlay
  // can navigate ↑↓ between rows. Subscription is via context — when no provider
  // is mounted (e.g. table used outside AnnotationRunner) we no-op.
  // The effect itself lives further down, after `flattenedTableData` is declared.
  const detailContext = React.useContext(AssetDetailContext);

  // Numeric range inference for bar rendering.
  // Walks all loaded results once per (results, schemas) change, caches per (schema, field).
  // Re-validates existing cache against new data: any value that breaks the cached range → downgrade.
  useEffect(() => {
    if (results.length === 0 || schemas.length === 0) return;

    setFieldRangeCache((prev) => {
      let next = prev;
      let changed = false;

      for (const schema of schemas) {
        const targetKeys = getTargetKeysForScheme(schema.id, schemas);
        const numericFields = targetKeys.filter((tk) => tk.type === 'number' || tk.type === 'integer');
        if (numericFields.length === 0) continue;

        const schemaResults = results.filter((r) => r.schema_id === schema.id);
        if (schemaResults.length === 0) continue;

        for (const tk of numericFields) {
          const fieldDef = getFieldDefinitionFromSchema(schema, tk.key);
          const field = { key: tk.key, name: tk.name, type: tk.type, definition: fieldDef };
          const existing = prev[String(schema.id)]?.[tk.key];

          if (existing && existing.source === 'declared') continue; // declared bounds are stable

          // Validate existing observed range against new data; downgrade if any value breaks.
          if (existing) {
            let stillValid = true;
            for (const r of schemaResults) {
              const v = getAnnotationFieldValue(r.value, tk.key);
              if (typeof v === 'number' && !valueFitsRange(existing, v)) {
                stillValid = false;
                break;
              }
            }
            if (stillValid) continue;
          }

          // (Re-)infer from observed values.
          const fresh = inferFieldRange(field, schemaResults, getAnnotationFieldValue);
          const before = existing ?? null;
          if (JSON.stringify(before) !== JSON.stringify(fresh)) {
            next = writeCachedRange(next === prev ? { ...prev } : next, schema.id, tk.key, fresh);
            changed = true;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [results, schemas]);

  // Data is now server-filtered — use results directly
  const assetsMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);

  // Failure detection covers two shapes the backend can produce:
  //  1. status === 'failure'  (backend-authoritative)
  //  2. value === {error, details} envelope, even when status='success'
  //     (some providers mark "success" while returning an error blob)
  // Both treated as failed so the toolbar count + filter + sort stay aligned
  // with what the cell actually renders as "errored".
  const isFailedResult = useCallback((r: { status?: string; value?: any }) => {
    if (r.status === 'failure') return true;
    const v = r.value;
    if (!v || typeof v !== 'object') return false;
    if ('error' in v && 'details' in v) {
      const keys = Object.keys(v);
      return keys.every((k) => k === 'error' || k === 'details' || k.startsWith('_'));
    }
    return false;
  }, []);

  const failedCount = useMemo(
    () => results.reduce((n, r) => n + (isFailedResult(r) ? 1 : 0), 0),
    [results, isFailedResult],
  );

  // When failed rows are hidden, drop them. When shown, sort them to the
  // bottom so the valid annotations come first.
  const resultsForTable = useMemo(() => {
    if (!showFailed) return results.filter((r) => !isFailedResult(r));
    return results.slice().sort((a, b) => {
      const af = isFailedResult(a) ? 1 : 0;
      const bf = isFailedResult(b) ? 1 : 0;
      return af - bf;
    });
  }, [results, showFailed, isFailedResult]);

  type EnrichedAssetRecord = AssetRead & {
    sourceName: string | null;
    resultsMap: Record<number, ResultWithSourceInfo>; // Map schema_id to result
    isChildRow?: boolean; // Indicates if this is a CSV row child
    parentAssetId?: number; // Reference to parent asset for child rows
    hasChildren?: boolean; // Indicates if this asset has children
    children?: EnrichedAssetRecord[]; // Child assets for hierarchical display
    splitValue?: string; // NEW: Split value when variable splitting is enabled
    imageSubAssets?: EnrichedAssetRecord[]; // NEW: Image sub-assets to show as thumbnails
    consolidatedResultsMap?: Record<number, { document?: ResultWithSourceInfo; image?: ResultWithSourceInfo }>; // NEW: Separate document and image results per schema
  };

  // Helper component for image thumbnails
  const ImageThumbnail: React.FC<{ asset: EnrichedAssetRecord }> = ({ asset }) => {
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { activeInfospace } = useInfospaceStore();

    useEffect(() => {
      const loadImage = async () => {
        setIsLoading(true);
        try {
          if (asset.source_identifier) {
            setImageSrc(asset.source_identifier);
          } else if (asset.blob_path && activeInfospace?.id) {
            const response = await fetch(`/api/v1/files/stream/${encodeURIComponent(asset.blob_path)}`, {
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
              },
            });
            if (response.ok) {
              const blob = await response.blob();
              const blobUrl = URL.createObjectURL(blob);
              setImageSrc(blobUrl);
            }
          }
        } catch (error) {
          console.error('Error loading image thumbnail:', error);
        } finally {
          setIsLoading(false);
        }
      };
      
      if (asset.kind === 'image' || asset.kind === 'image_region') {
        loadImage();
      }
    }, [asset.blob_path, asset.source_identifier, activeInfospace?.id]);

    if (isLoading) {
      return (
        <div className="h-20 w-20 flex items-center justify-center bg-muted/50 rounded border border-border/50">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (!imageSrc) {
      return (
        <div className="h-20 w-20 flex items-center justify-center bg-muted/50 rounded border border-border/50">
          <ImageIcon className="h-6 w-6 text-muted-foreground opacity-50" />
        </div>
      );
    }

    return (
      <img
        src={imageSrc}
        alt={asset.title || 'Image thumbnail'}
        className="h-20 w-20 object-cover rounded border border-border/50 shadow-sm"
        loading="lazy"
      />
    );
  };

  const tableData = useMemo((): EnrichedAssetRecord[] => {
    if (!assets || !resultsForTable) {
      console.log('[AnnotationResultsTable] tableData: No assets or results', { assets: assets?.length, results: resultsForTable?.length });
      return [];
    }

    console.log('[AnnotationResultsTable] tableData: Processing', resultsForTable.length, 'results for', assets.length, 'assets');

    const sourceInfoMap = new Map<number, { name: string }>();
    sources.forEach(ds => {
      if (typeof ds.id === 'number' && typeof ds.name === 'string') {
        sourceInfoMap.set(ds.id, { name: ds.name });
      }
    });

    const resultsByAssetId = resultsForTable.reduce((acc, result) => {
        const assetId = result.asset_id;
        if (!acc[assetId]) acc[assetId] = [];
        acc[assetId].push(result);
        return acc;
    }, {} as Record<number, ResultWithSourceInfo[]>);
    
    console.log('[AnnotationResultsTable] resultsByAssetId:', resultsByAssetId);

    // Get all assets that have results OR are CSV parents with children that have results
    // OR are document parents with image children that have results
    const assetsWithResults = new Set<number>();
    const csvParentsWithChildren = new Set<number>();
    const documentParentsWithImages = new Set<number>();
    
    // First pass: identify assets with direct results
    assets.forEach(asset => {
      if (resultsByAssetId[asset.id] && resultsByAssetId[asset.id].length > 0) {
        assetsWithResults.add(asset.id);
        
        // If this is a CSV row, also include its parent
        if (asset.kind === 'csv_row' && asset.parent_asset_id) {
          csvParentsWithChildren.add(asset.parent_asset_id);
        }
        
        // If this is an image sub-asset, also include its parent
        if ((asset.kind === 'image' || asset.kind === 'image_region') && asset.parent_asset_id) {
          documentParentsWithImages.add(asset.parent_asset_id);
        }
      }
    });

    // Create enriched records for both parents and children
    const enrichedRecordsMap = new Map<number, EnrichedAssetRecord>();
    
    assets.forEach(asset => {
      const shouldInclude = assetsWithResults.has(asset.id) || 
                           csvParentsWithChildren.has(asset.id) || 
                           documentParentsWithImages.has(asset.id);
      
      if (shouldInclude) {
        const sourceInfo = typeof asset.source_id === 'number'
          ? sourceInfoMap.get(asset.source_id)
          : null;
        const assetResults = resultsByAssetId[asset.id] || [];
        
        // For now, just take the first result per schema
        // TODO: Handle multiple results per schema properly
        const resultsMap: Record<number, ResultWithSourceInfo> = {};
        assetResults.forEach(res => {
          if (!resultsMap[res.schema_id]) {
            resultsMap[res.schema_id] = res;
          }
        });
        
        console.log('[AnnotationResultsTable] Asset', asset.id, 'has', assetResults.length, 'results, resultsMap:', resultsMap);

        const isCSVParent = asset.kind === 'csv' && csvParentsWithChildren.has(asset.id);
        const isCSVChild = asset.kind === 'csv_row';
        const isDocumentParent = documentParentsWithImages.has(asset.id) && 
                                 (asset.kind === 'article' || asset.kind === 'web' || asset.kind === 'text' || asset.kind === 'pdf');
        const isImageSubAsset = (asset.kind === 'image' || asset.kind === 'image_region') && asset.parent_asset_id;

        // NEW: Extract split value from the first result for this asset
        const firstResult = assetResults[0] as ResultWithSourceInfo & { splitValue?: string };
        const splitValue = firstResult?.splitValue;

        const enrichedRecord: EnrichedAssetRecord = {
          ...asset,
          sourceName: sourceInfo ? sourceInfo.name : 'Unknown Source',
          resultsMap: resultsMap,
          isChildRow: isCSVChild,
          parentAssetId: asset.parent_asset_id || undefined,
          hasChildren: isCSVParent,
          children: [],
          splitValue: splitValue,
          imageSubAssets: isDocumentParent ? [] : undefined,
          consolidatedResultsMap: isDocumentParent ? {} : undefined,
        };

        enrichedRecordsMap.set(asset.id, enrichedRecord);
      }
    });

    // Build hierarchy: attach children to parents
    const topLevelRecords: EnrichedAssetRecord[] = [];
    
    enrichedRecordsMap.forEach(record => {
      if (record.isChildRow && record.parentAssetId) {
        // This is a CSV child row, attach to parent
        const parent = enrichedRecordsMap.get(record.parentAssetId);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(record);
        } else {
          // Parent not found, add as top-level
          topLevelRecords.push(record);
        }
      } else if ((record.kind === 'image' || record.kind === 'image_region') && record.parentAssetId) {
        // This is an image sub-asset, attach to document parent and consolidate results
        const parent = enrichedRecordsMap.get(record.parentAssetId);
        if (parent) {
          // Initialize consolidatedResultsMap if it doesn't exist (parent might have been added for other reasons)
          if (!parent.consolidatedResultsMap) {
            parent.consolidatedResultsMap = {};
          }
          
          // Initialize imageSubAssets if it doesn't exist
          if (!parent.imageSubAssets) {
            parent.imageSubAssets = [];
          }
          
          // Add image sub-asset to parent's imageSubAssets array
          parent.imageSubAssets.push(record);
          
          // Consolidate results: merge document and image results per schema
          Object.entries(record.resultsMap).forEach(([schemaIdStr, imageResult]) => {
            const schemaId = parseInt(schemaIdStr, 10);
            if (!parent.consolidatedResultsMap![schemaId]) {
              parent.consolidatedResultsMap![schemaId] = {};
            }
            parent.consolidatedResultsMap![schemaId].image = imageResult;
          });
          
          // Also merge document results from parent
          Object.entries(parent.resultsMap).forEach(([schemaIdStr, docResult]) => {
            const schemaId = parseInt(schemaIdStr, 10);
            if (!parent.consolidatedResultsMap![schemaId]) {
              parent.consolidatedResultsMap![schemaId] = {};
            }
            parent.consolidatedResultsMap![schemaId].document = docResult;
          });
        } else {
          // Parent not found, add as top-level
          topLevelRecords.push(record);
        }
      } else {
        // This is a top-level record
        // If it's a document parent, initialize consolidated results map with its own results
        if (record.consolidatedResultsMap) {
          Object.entries(record.resultsMap).forEach(([schemaIdStr, docResult]) => {
            const schemaId = parseInt(schemaIdStr, 10);
            record.consolidatedResultsMap![schemaId] = { document: docResult };
          });
        }
        topLevelRecords.push(record);
      }
    });

    // Sort children by part_index
    topLevelRecords.forEach(record => {
      if (record.children && record.children.length > 0) {
        record.children.sort((a, b) => (a.part_index || 0) - (b.part_index || 0));
      }
    });

    console.log('[AnnotationResultsTable] topLevelRecords:', topLevelRecords.map(r => ({ id: r.id, title: r.title, resultsMap: Object.keys(r.resultsMap) })));

    // Helper function to check if a result value matches search term
    // When filterArrayItems is true, only check array items; otherwise check all fields
    const resultMatchesSearch = (result: ResultWithSourceInfo, searchTerm: string, checkArrayItemsOnly: boolean): boolean => {
      if (!searchTerm || !result.value) return true;
      
      if (checkArrayItemsOnly) {
        // Only check if search matches within array items
        // Recursively check for arrays in the value structure
        const checkArrayItems = (value: any): boolean => {
          if (Array.isArray(value)) {
            // Check if any array item matches
            return value.some(item => {
              if (typeof item === 'object' && item !== null) {
                // For objects, check all properties recursively
                return Object.values(item).some(v => checkArrayItems(v) || searchInAnnotationValue(v, searchTerm));
              }
              return searchInAnnotationValue(item, searchTerm);
            });
          }
          if (typeof value === 'object' && value !== null) {
            // Recurse into nested objects
            return Object.values(value).some(v => checkArrayItems(v));
          }
          return false;
        };
        return checkArrayItems(result.value);
      } else {
        // Check all fields (current behavior)
        return searchInAnnotationValue(result.value, searchTerm);
      }
    };

    // Helper function to check if record matches search term
    const recordMatchesSearch = (record: EnrichedAssetRecord, searchTerm: string, checkArrayItemsOnly: boolean): boolean => {
      if (!searchTerm) return true;
      
      // Check asset title and source name
      if (record.title?.toLowerCase().includes(searchTerm.toLowerCase())) return true;
      if (record.sourceName?.toLowerCase().includes(searchTerm.toLowerCase())) return true;
      
      // Check results
      if (record.hasChildren && record.children) {
        // For CSV parents, check children
        return record.children.some(child => {
          const childResults = Object.values(child.resultsMap);
          return childResults.some(result => resultMatchesSearch(result, searchTerm, checkArrayItemsOnly));
        });
      }
      
      if (record.consolidatedResultsMap) {
        // For consolidated results, check both document and image
        return Object.values(record.consolidatedResultsMap).some(consolidated => {
          if (consolidated.document && resultMatchesSearch(consolidated.document, searchTerm, checkArrayItemsOnly)) return true;
          if (consolidated.image && resultMatchesSearch(consolidated.image, searchTerm, checkArrayItemsOnly)) return true;
          return false;
        });
      }
      
      // For regular assets, check direct results
      const assetResults = Object.values(record.resultsMap);
      return assetResults.some(result => resultMatchesSearch(result, searchTerm, checkArrayItemsOnly));
    };

    // Apply filters and search to top-level records
    const activeFilters = filters.filter(f => f.isActive);
    const hasSearchTerm = Boolean(globalFilter && globalFilter.trim().length > 0);
    const searchTermString = hasSearchTerm ? globalFilter : '';
    const checkArrayItemsOnly = Boolean(filterArrayItems && hasSearchTerm);
    
    const filteredRecords = topLevelRecords.filter(record => {
      // First check: Must have results
      const hasResults = (() => {
        if (record.hasChildren && record.children) {
          return record.children.some(child => Object.keys(child.resultsMap).length > 0);
        }
        if (record.consolidatedResultsMap) {
          return Object.values(record.consolidatedResultsMap).some(consolidated => 
            consolidated.document || consolidated.image
          );
        }
        return Object.keys(record.resultsMap).length > 0;
      })();
      
      if (!hasResults) return false;

      // Filter matching is now handled server-side via the /view endpoint
      // Legacy client-side filters are no longer applied here

      // Third check: Search term matching
      if (hasSearchTerm) {
        return recordMatchesSearch(record, searchTermString, checkArrayItemsOnly);
      }
      
      return true;
    });

    return filteredRecords;
  }, [
    resultsForTable, 
    filters.map(f => `${f.id}-${f.isActive}-${f.schemaId}-${f.fieldKey}-${f.operator}-${JSON.stringify(f.value)}`).join('|'), // FIXED: Stable filter representation
    schemas.map(s => s.id).sort().join(','), // FIXED: Use stable schema IDs
    assets.map(a => a.id).sort().join(','), // FIXED: Use stable asset IDs
    sources.map(s => `${s.id}-${s.name}`).sort().join(','), // FIXED: Use stable source representation
    globalFilter, // NEW: Include search term for filtering
    filterArrayItems // NEW: Include focus toggle state for filtering
  ]);

  // Create flattened data for table display (including expanded children)
  const flattenedTableData = useMemo((): EnrichedAssetRecord[] => {
    const flattened: EnrichedAssetRecord[] = [];
    
    tableData.forEach(record => {
      // Always add the parent record
      flattened.push(record);
      
      // Add children if expanded
      if (record.hasChildren && record.children && expanded[record.id.toString()]) {
        record.children.forEach(child => {
          flattened.push(child);
        });
      }
    });
    
    return flattened;
  }, [tableData, Object.keys(expanded).sort().join(',')]); // FIXED: Use stable representation of expanded state

  // Sync row order to AssetDetailProvider for overlay ↑↓ navigation.
  // Depend only on the (stable) setter and the row data — NOT on the context
  // object, since the provider re-memos its value when nav state bumps and
  // would otherwise drive a setState loop.
  const setNavAssetIds = detailContext?.setNavAssetIds;
  const lastNavSigRef = useRef<string>('');
  useEffect(() => {
    if (!setNavAssetIds) return;
    const ids = flattenedTableData
      .map((r) => r.id)
      .filter((id): id is number => typeof id === 'number');
    const sig = ids.join(',');
    if (sig === lastNavSigRef.current) return;
    lastNavSigRef.current = sig;
    setNavAssetIds(ids);
  }, [setNavAssetIds, flattenedTableData]);

  // Single-schema folded layout: long-text string fields move under the
  // asset header (checkbox/title/#id), giving them the natural width of the
  // asset column. The schema cell then carries only numerics and lists,
  // which the 3-section grid renders side-by-side without strings competing
  // for horizontal space. Multi-schema views can't redistribute (no clean
  // mapping to "the" asset column), so each schema cell keeps all 3 sections.
  // Single-schema string redistribution. With one schema, free-text strings
  // and booleans flow under the asset title in the asset cell — that's
  // "column 1" of the visual layout (title at top, strings beneath). The
  // schema cell then carries only numerics and lists/tables/nested-objects,
  // which the folded layout renders side-by-side as columns 2 and 3 on
  // wide rows; on narrower rows the schema cell's flex-wrap collapses
  // those two sub-sections into one stacked column. Multi-schema views
  // can't redistribute (no clean mapping to "the" asset column), so each
  // schema cell keeps its own full 3-section layout internally.
  const stringSplit = useMemo(() => {
    if (unfoldFields || schemas.length !== 1) return null;
    const schema = schemas[0];
    const allFields = getTargetKeysForScheme(schema.id, schemas);
    const selectedKeys = selectedFieldsPerScheme[schema.id] || allFields.map((f) => f.key);
    // Asset-cell fields = strings (non-enum) + booleans + entities. Booleans
    // read as flags on the protagonist info and pair naturally with the free-
    // text strings under the title. Entities are protagonist references —
    // EntityCell renders them text-forward (swatch + name + type) so they
    // belong with the strings, not with the badge strip in the lists section.
    // Enums stay on the schema side because they render as chips that pack
    // well with the lists section.
    const isAssetSideField = (f: { key: string; type: string }) => {
      if (f.type === 'boolean') return true;
      const def = getFieldDefinitionFromSchema(schema, f.key);
      const isEntityField =
        def?.['x-entityField'] === true
        || (f.type === 'array' && def?.items?.['x-entityField'] === true);
      if (isEntityField) return true;
      if (f.type !== 'string') return false;
      return !Array.isArray(def?.enum);
    };
    const assetSideKeys = allFields.filter((f) => selectedKeys.includes(f.key) && isAssetSideField(f)).map((f) => f.key);
    const schemaSideKeys = allFields.filter((f) => selectedKeys.includes(f.key) && !isAssetSideField(f)).map((f) => f.key);
    if (assetSideKeys.length === 0) return null;
    return { schema, assetSideKeys, schemaSideKeys };
  }, [unfoldFields, schemas, selectedFieldsPerScheme]);

  // Per-row actions overlay — replaces the old fixed actions column. Rendered
  // as a `<td>` absolute-positioned to the right edge of each row so it
  // costs zero horizontal space when not hovered. Visible on row hover
  // (group-hover) and always visible while the menu is open (the dropdown
  // keeps focus). Closure captures retry handlers + on* prop callbacks
  // declared above; same behavior as the prior column cell.
  const renderRowActionsOverlay = (record: EnrichedAssetRecord) => {
    const firstResult = Object.values(record.resultsMap)[0];
    if (!firstResult) return null;
    const isCurrentlyRetryingThis = retryingResultId === firstResult.id;
    return (
      <td
        className="absolute right-1 top-1 z-10 p-0 border-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity bg-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-7 w-7 p-0 bg-background/90 backdrop-blur-sm shadow-sm border border-border/40" disabled={isCurrentlyRetryingThis}>
              <span className="sr-only">Open menu</span>
              {isCurrentlyRetryingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            {onResultSelect && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultSelect(firstResult); }} disabled={isCurrentlyRetryingThis}>
                <Eye className="mr-2 h-4 w-4" /> View Details
              </DropdownMenuItem>
            )}
            {onResultAction && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultAction('load_in_runner', firstResult); }} disabled={isCurrentlyRetryingThis}>
                <ExternalLink className="mr-2 h-4 w-4" /> Load in Runner
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleCurationClick('single', record)}>
              <ArrowUpToLine className="mr-2 h-4 w-4" /> Curate...
            </DropdownMenuItem>
            {(onResultSelect || onResultAction || onResultDelete) && <DropdownMenuSeparator />}
            {onRetrySingleResult && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    if (firstResult && typeof firstResult.id === 'number') handleQuickRetry(firstResult);
                  }}
                  disabled={isCurrentlyRetryingThis}
                  className="text-orange-600 hover:text-orange-700 focus:bg-orange-100 focus:text-orange-800"
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Quick Retry
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    if (firstResult && typeof firstResult.id === 'number') handleGuidedRetry(firstResult);
                  }}
                  disabled={isCurrentlyRetryingThis}
                  className="text-blue-600 hover:text-blue-700 focus:bg-blue-100 focus:text-blue-800"
                >
                  <Wand2 className="mr-2 h-4 w-4" /> Guided Retry
                </DropdownMenuItem>
              </>
            )}
            {onResultDelete && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultDelete(firstResult.id); }} className="text-red-600 hover:text-red-700" disabled={isCurrentlyRetryingThis}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete Result
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    );
  };

  // --- Display knob write-back helpers ------------------------------------
  // Defined early so useReactTable (below) can reference them without hoisting.

  // Density: persisted to panel_config.density so it survives panel reload.
  const handleSetDensity = useCallback((d: Density) => {
    setDensity(d);
    onUpdatePanel({ panel_config: { ...cfg, density: d } } as any);
  }, [onUpdatePanel, cfg]);

  // Sort: persisted to panel_config.sort; column is either a dim (keys) or
  // measure name depending on aggregate mode.
  const handleSortingChange = useCallback((updater: any) => {
    setSorting((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next.length > 0) {
        onUpdatePanel({
          panel_config: {
            ...cfg,
            sort: { column: next[0].id, direction: next[0].desc ? 'desc' : 'asc' },
          },
        } as any);
      } else {
        onUpdatePanel({ panel_config: { ...cfg, sort: null } } as any);
      }
      return next;
    });
  }, [onUpdatePanel, cfg]);

  // Invisible spacer that lifts a non-asset cell's first field to the same y
  // as column 1's first strings field. Total height equals exactly the asset
  // cell's [outer py-1 top + inner py-1 top + header row + (optional gap-1 +
  // mt-1.5 + pt-1.5 + border-t for the strings separator)]. No bottom padding
  // — the spacer ends where strings starts, so the next sibling sits exactly
  // there. visibility:hidden keeps layout while removing paint/interaction.
  const AssetHeaderAlignmentSpacer: React.FC<{ withSeparator: boolean }> = ({ withSeparator }) => (
    <div className="invisible select-none" aria-hidden>
      {/* pt-2 collapses asset cell's outer-py-1-top (4px) + inner-py-1-top (4px) */}
      <div className="flex flex-col gap-1 pt-2 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-semibold">A</span>
        </div>
        {withSeparator && (
          <div className="mt-1.5 pt-1.5 border-t border-border/40 h-0" />
        )}
      </div>
    </div>
  );

  const columns = useMemo((): ColumnDef<EnrichedAssetRecord>[] => {
    const staticColumns: ColumnDef<EnrichedAssetRecord>[] = [
      {
        id: 'asset',
        header: ({ table }) => (
          <div className="flex items-center gap-2 w-full">
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
              aria-label="Select all for bulk actions"
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-xs font-medium">Asset</span>
          </div>
        ),
        cell: ({ row }) => {
          const record = row.original;
          const isExpanded = expanded[record.id.toString()];
          const hasChildren = record.hasChildren && record.children && record.children.length > 0;

          // Cell content centers vertically so the asset title doesn't float
          // at the top of a row whose height was set by a tall annotation cell.
          return (
            <div className="flex items-center gap-2 min-w-0 py-1">
              {/* Expander (only render when needed) */}
              {hasChildren && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-accent rounded-md flex-shrink-0 mt-1 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    startTransition(() => {
                      setExpanded(prev => {
                        const newExpanded = Object.assign({}, prev);
                        newExpanded[record.id.toString()] = !prev[record.id.toString()];
                        return newExpanded;
                      });
                    });
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </Button>
              )}
              
              {/* Child row indicator */}
              {record.isChildRow && (
                <div className="flex items-center justify-center w-6 flex-shrink-0 mt-1">
                  {/* Indicator for child rows from CSV expansion */}
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center w-6 flex-shrink-0 mt-1">
                          <span className="text-[10px] text-muted-foreground/50">↳</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start">
                        <p className="text-xs">Child Asset of a larger Parent Asset (like a CSV row)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
              
              {/* Asset cell — single header line with checkbox, truncated title, and #id */}
              <div className="flex-1 min-w-0 flex flex-col gap-1 py-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="h-3.5 w-3.5 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <AssetLink
                    assetId={record.id}
                    className="text-xs truncate hover:text-primary font-semibold transition-colors min-w-0 flex-1"
                  >
                    {record.title || <span className="italic text-muted-foreground/70">No Title</span>}
                  </AssetLink>
                  {/* Asset Type */}
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide shrink-0">
                    {record.kind?.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 font-mono shrink-0">
                    #{record.id}
                  </span>
                </div>

                {/* Thumbnail (image sub-assets) */}
                {record.imageSubAssets && record.imageSubAssets.length > 0 && (
                  <div className="flex-shrink-0">
                    {record.imageSubAssets.map((imageAsset) => (
                      <ImageThumbnail key={imageAsset.id} asset={imageAsset} />
                    ))}
                  </div>
                )}

                {/* Single-schema redistribution: strings flow under the asset header,
                    forming column 1 of the cell layout. Columns 2 and 3 (numerics +
                    lists) live in the schema cell. */}
                {stringSplit && (() => {
                  const schemaId = stringSplit.schema.id;
                  const stringResult =
                    record.consolidatedResultsMap?.[schemaId]?.document
                    ?? record.consolidatedResultsMap?.[schemaId]?.image
                    ?? record.resultsMap[schemaId];
                  if (!stringResult) return null;
                  return (
                    <div className="mt-1.5 pt-1.5 border-t border-border/40 min-w-0">
                      <AnnotationResultDisplay
                        result={stringResult}
                        schema={stringSplit.schema}
                        compact={false}
                        selectedFieldKeys={stringSplit.assetSideKeys}
                        renderContext="table"
                        onResultSelect={onResultSelect}
                        forceExpanded={false}
                        onTimestampClick={onTimestampClick}
                        onLocationClick={onLocationClick}
                        filterArrayItems={filterArrayItems}
                        searchTerm={globalFilter}
                        filters={filters}
                        density={density}
                        rangeCache={fieldRangeCache}
                      />
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        },
        // With stringSplit active the asset cell carries column-1 content
        // (title + summary + booleans), so it gets a generous 380px default
        // and can grow to 600px for long summaries. Without stringSplit the
        // asset cell is just title/checkbox/id and can stay slim.
        maxSize: stringSplit ? 600 : 200,
        minSize: stringSplit ? 320 : 100,
        size: stringSplit ? 380 : 140,
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          // Sort by title
          const titleA = rowA.original.title || '';
          const titleB = rowB.original.title || '';
          return titleA.localeCompare(titleB);
        },
        enableHiding: false,
        enableResizing: true,
      },
      {
         accessorKey: 'sourceName',
         header: ({ column }) => (
           <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} className="px-2 h-full w-full justify-start">
             <span className="truncate">Source Name</span>
             <ArrowUpDown className="ml-1 h-4 w-4 flex-shrink-0" />
           </Button>
         ),
         cell: ({ row }) => {
           const record = row.original;
           return (
             <div className={cn("font-medium truncate min-w-0", record.isChildRow && "ml-2 text-sm")}>
               {record.sourceName}
             </div>
           );
         },
         maxSize: 200,
         minSize: 100,
         size: 150,
         enableResizing: true,
         enableHiding: true,
       },
    ];

    // NEW: Add split value column when variable splitting is enabled
    const conditionalColumns: ColumnDef<EnrichedAssetRecord>[] = [];
    
    if (variableSplittingConfig?.enabled) {
      conditionalColumns.push({
        accessorKey: 'splitValue',
        header: ({ column }) => (
          <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} className="px-2 h-full w-full justify-start">
            <span className="truncate">Split Value</span>
            <ArrowUpDown className="ml-1 h-4 w-4 flex-shrink-0" />
          </Button>
        ),
        cell: ({ row }) => {
          const record = row.original;
          // Extract split value from the first result
          const firstResult = Object.values(record.resultsMap)[0] as ResultWithSourceInfo & { splitValue?: string };
          const splitValue = firstResult?.splitValue;
          
          return (
            <div className={cn("font-medium truncate min-w-0", record.isChildRow && "ml-2 text-sm")}>
              {splitValue || 'All'}
            </div>
          );
        },
        maxSize: 150,
        minSize: 80,
        size: 120,
        enableResizing: true,
        enableHiding: true,
      });
    }

    // NEW: Generate unfolded field columns when unfoldFields is true
    const unfoldedFieldColumns: ColumnDef<EnrichedAssetRecord>[] = unfoldFields ? schemas.flatMap((schema, schemaIndex) => {
      const targetKeys = getTargetKeysForScheme(schema.id, schemas);
      const selectedKeys = selectedFieldsPerScheme[schema.id] || [];
      const fieldsToShow = targetKeys.filter(tk => selectedKeys.includes(tk.key));
      
      return fieldsToShow.map((field, fieldIndex) => ({
        id: `field_${schema.id}_${field.key}`,
        meta: {
          displayName: `${schema.name} › ${field.name}`,
          schemaId: schema.id,
          schemaIndex,
          fieldKey: field.key,
          isFirstFieldInSchema: fieldIndex === 0,
        },
        header: ({ column }) => (
          <div className={cn(
            "flex flex-col space-y-1 min-w-0",
            fieldIndex === 0 && schemaIndex > 0 && "border-l-2 border-primary/30 pl-2"
          )}>
            {fieldIndex === 0 && (
              <div className="text-[10px] text-primary/60 uppercase tracking-wider font-semibold truncate">
                {schema.name}
              </div>
            )}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 min-w-0 cursor-help">
                    {/* Show modality icon if applicable */}
                    {(() => {
                      const formatted = formatFieldNameUtil(field.key);
                      if (formatted.modality && formatted.modality !== 'document') {
                        return (
                          <>
                            {getModalityIcon(formatted.modality, 'sm')}
                            <span className="font-medium text-xs truncate">
                              {formatted.displayName}
                            </span>
                          </>
                        );
                      }
                      return (
                        <span className="font-medium text-xs truncate">
                          {field.name}
                        </span>
                      );
                    })()}
                    <HelpCircle className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" align="start" className="max-w-sm">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const formatted = formatFieldNameUtil(field.key);
                        return (
                          <>
                            {formatted.modality && formatted.modality !== 'document' && getModalityIcon(formatted.modality, 'sm')}
                            <span className="font-semibold text-xs">{formatted.displayName}</span>
                          </>
                        );
                      })()}
                      <Badge className="px-1 py-0">
                        {field.type}
                      </Badge>
                    </div>
                    <p className="">
                      Field path: <code className="px-1 rounded">{field.key}</code>
                    </p>
                    <div className="pt-1 border-t">
                      Schema: <span className="font-medium">{schema.name}</span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ),
        cell: ({ row }) => {
          const resultForThisCell = row.original.resultsMap[schema.id];
          
          if (!resultForThisCell) {
            return <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">N/A</div>;
          }
          
          const fieldValue = getAnnotationFieldValue(resultForThisCell.value, field.key);
          const isFailed = resultForThisCell.status === 'failure';
          
          return (
            <div className={cn(
              "relative h-full min-w-0 max-w-full overflow-hidden p-2",
              isFailed && "border-l-2 border-destructive pl-1",
              fieldIndex === 0 && schemaIndex > 0 && "border-l-2 border-primary/20"
            )}>
              {isFailed && fieldIndex === 0 && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertCircle 
                        className="h-3.5 w-3.5 text-destructive absolute top-1 right-1 opacity-75 cursor-help z-10" 
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" align="end">
                      <p className="text-xs max-w-xs break-words">
                        Failed: {(resultForThisCell as any).error_message || 'Unknown error'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              
              <div className="min-w-0 max-w-full">
                <AnnotationResultDisplay
                  result={resultForThisCell}
                  schema={schema}
                  compact={true}
                  targetFieldKey={field.key}
                  renderContext="table"
                  onResultSelect={onResultSelect}
                  forceExpanded={false}
                  onTimestampClick={onTimestampClick}
                  onLocationClick={onLocationClick}
                  filterArrayItems={filterArrayItems}
                  searchTerm={globalFilter}
                  filters={filters}
                  density={density}
                  rangeCache={fieldRangeCache}
                />
              </div>
            </div>
          );
        },
        maxSize: 300,
        minSize: 120,
        size: 180,
        enableResizing: true,
        enableHiding: true,
      }));
    }) : [];

    const dynamicSchemaColumns: ColumnDef<EnrichedAssetRecord>[] = !unfoldFields ? schemas.map((schema, index) => ({
      id: `schema_${schema.id}`,
      meta: {
        displayName: schema.name,
      },
      header: ({ column }) => {
        // Toggle writes straight to cfg.columns via onUpdatePanel — see
        // the outer handleFieldToggle. One source of truth means the
        // visible set always reflects the persisted config.
        const onToggle = (fieldKey: string) => handleFieldToggle(schema.id, fieldKey);
        const currentSelectedFields = selectedFieldsPerScheme[schema.id] || [];
        const availableFields = getTargetKeysForScheme(schema.id, schemas);

        return (
          <div className="flex flex-col space-y-1 min-w-0">
            <div className="flex items-center justify-between min-w-0">
               <span className="font-medium truncate flex-1" title={schema.name}>{schema.name}</span>
               <Popover>
                 <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 ml-1 opacity-60 hover:opacity-100 flex-shrink-0">
                      <Settings2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Configure Fields</span>
                    </Button>
                 </PopoverTrigger>
                 <PopoverContent className="w-56 p-0" align="start">
                    <div className="p-2 font-medium text-xs border-b">Show Fields:</div>
                    <ScrollArea className="max-h-60 overflow-y-auto p-1">
                      {availableFields.map(field => (
                        <div key={field.key} className="flex items-center space-x-2 px-2 py-1.5 text-xs">
                           <Checkbox
                              id={`field-header-toggle-${schema.id}-${field.key}`}
                              checked={currentSelectedFields.includes(field.key)}
                              onCheckedChange={() => onToggle(field.key)}
                              disabled={currentSelectedFields.length === 1 && currentSelectedFields.includes(field.key)}
                           />
                           <Label
                              htmlFor={`field-header-toggle-${schema.id}-${field.key}`}
                              className={cn("font-normal cursor-pointer truncate", (currentSelectedFields.length === 1 && currentSelectedFields.includes(field.key)) && "opacity-50 cursor-not-allowed")}
                           >
                              {field.name} ({field.type})
                           </Label>
                        </div>
                      ))}
                    </ScrollArea>
                 </PopoverContent>
               </Popover>
            </div>
          </div>
        );
      },
      cell: ({ row }) => {
        const record = row.original;
        // When the redistribution is active, the asset cell renders the
        // string fields; the schema cell handles only the structured rest
        // (numerics + lists), which the 3-section grid will collapse to two
        // visible sections.
        const fieldKeysToShow = stringSplit && stringSplit.schema.id === schema.id
          ? stringSplit.schemaSideKeys
          : (selectedFieldsPerScheme[schema.id] || []);

        // Use consolidated results map if available (for document + image consolidation)
        const consolidatedResults = record.consolidatedResultsMap?.[schema.id];
        const hasConsolidatedResults = consolidatedResults && (consolidatedResults.document || consolidatedResults.image);
        
        // Fallback to regular resultsMap if no consolidated results
        const resultForThisCell = hasConsolidatedResults ? null : record.resultsMap[schema.id];

        // Hide cell content when zero fields are selected. Special-case: when
        // single-schema redistribution moved every selected field to the asset
        // cell, leave the schema cell visually empty rather than say "Hidden"
        // (the data isn't hidden, just relocated).
        if (fieldKeysToShow.length === 0) {
          if (stringSplit && stringSplit.schema.id === schema.id) {
            return <div className="h-full" aria-hidden />;
          }
          return <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">Hidden</div>;
        }

        // Handle consolidated results (document + image) - demultiplex fields
        if (hasConsolidatedResults) {
          const docResult = consolidatedResults.document;
          const imgResult = consolidatedResults.image;
          const docFailed = docResult?.status === 'failure';
          const imgFailed = imgResult?.status === 'failure';

          // Get all target keys for this schema to demultiplex fields
          const allTargetKeys = getTargetKeysForScheme(schema.id, schemas);
          const fieldsToDisplay = allTargetKeys.filter(tk => fieldKeysToShow.includes(tk.key));

          // Group fields by modality (document vs image)
          const docFields: Array<{ key: string; name: string; type: string }> = [];
          const imgFields: Array<{ key: string; name: string; type: string }> = [];
          
          fieldsToDisplay.forEach(field => {
            const formatted = formatFieldNameUtil(field.key);
            const baseName = formatted.displayName;
            
            // Determine if this is a document or image field
            const isDocField = field.key.startsWith('document.') || (!field.key.startsWith('per_image.') && !field.key.startsWith('per_audio.') && !field.key.startsWith('per_video.'));
            const isImgField = field.key.startsWith('per_image.');
            
            // Check if this field exists in document or image results
            const hasDocValue = docResult && getAnnotationFieldValue(docResult.value, field.key) !== undefined;
            const hasImgValue = imgResult && getAnnotationFieldValue(imgResult.value, field.key) !== undefined;
            
            // Also check for alternative field names (document.summary vs per_image.summary)
            const docAltKey = isImgField ? field.key.replace('per_image.', 'document.') : field.key;
            const imgAltKey = isDocField ? field.key.replace('document.', 'per_image.') : field.key;
            const hasDocValueAlt = docResult && getAnnotationFieldValue(docResult.value, docAltKey) !== undefined;
            const hasImgValueAlt = imgResult && getAnnotationFieldValue(imgResult.value, imgAltKey) !== undefined;
            
            const finalHasDocValue = Boolean(hasDocValue || hasDocValueAlt);
            const finalHasImgValue = Boolean(hasImgValue || hasImgValueAlt);
            
            if (finalHasDocValue || (isDocField && docResult)) {
              docFields.push({ key: field.key, name: baseName, type: field.type });
            }
            if (finalHasImgValue || (isImgField && imgResult)) {
              imgFields.push({ key: field.key, name: baseName, type: field.type });
            }
          });

          return (
            <div className={cn("relative h-full min-w-0 max-w-full overflow-hidden", (docFailed || imgFailed) && "border-l-2 border-destructive pl-1")}>
              <AssetHeaderAlignmentSpacer withSeparator={Boolean(stringSplit && stringSplit.schema.id === schema.id)} />
              {(docFailed || imgFailed) && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertCircle 
                        className="h-3.5 w-3.5 text-destructive absolute top-1 right-1 opacity-75 cursor-help z-10" 
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" align="end">
                      <p className="text-xs max-w-xs break-words">
                        {docFailed && `Document failed: ${(docResult as any)?.error_message || 'Unknown error'}`}
                        {docFailed && imgFailed && ' | '}
                        {imgFailed && `Image failed: ${(imgResult as any)?.error_message || 'Unknown error'}`}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              
              <div className="space-y-2">
              {/* Document modality section */}
              {docResult && docFields.length > 0 && (
                <div className="space-y-1">
                  {/* Modality header */}
                  <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                    <FileText className="h-3 w-3 text-blue-600" aria-label="Document" />
                    <span>Document</span>
                  </div>
                  {/* Document fields */}
                  {docFields.map((field) => {
                    const hasValue = getAnnotationFieldValue(docResult.value, field.key) !== undefined;
                    return (
                      <div key={field.key} className="flex items-start gap-1.5 text-xs">
                        <div className="flex items-center gap-1 flex-shrink-0 min-w-[100px]">
                          <span className="text-muted-foreground font-medium">{field.name}:</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {hasValue ? (
                            <div className="-mb-1">
                              <AnnotationResultDisplay
                                result={docResult}
                                schema={schema}
                                compact={true}
                                targetFieldKey={field.key}
                                renderContext="table"
                                onResultSelect={onResultSelect}
                                forceExpanded={false}
                                onTimestampClick={onTimestampClick}
                                onLocationClick={onLocationClick}
                                filterArrayItems={filterArrayItems}
                                searchTerm={globalFilter}
                                filters={filters}
                                density={density}
                                rangeCache={fieldRangeCache}
                              />
                            </div>
                          ) : (
                            <div className="text-muted-foreground/50 italic text-xs">N/A</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              
              {/* Separator between modalities */}
              {docResult && docFields.length > 0 && imgResult && imgFields.length > 0 && (
                <div className="h-px bg-border/60 my-1.5" aria-hidden="true" />
              )}
              
              {/* Image modality section */}
              {imgResult && imgFields.length > 0 && (
                <div className="space-y-1">
                  {/* Modality header */}
                  <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                    <ImageIcon className="h-3 w-3 text-green-600" aria-label="Image" />
                    <span>Image</span>
                  </div>
                  {/* Image fields */}
                  {imgFields.map((field) => {
                    const hasValue = getAnnotationFieldValue(imgResult.value, field.key) !== undefined;
                    return (
                      <div key={field.key} className="flex items-start gap-1.5 text-xs">
                        <div className="flex items-center gap-1 flex-shrink-0 min-w-[100px]">
                          <span className="text-muted-foreground font-medium">{field.name}:</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {hasValue ? (
                            <div className="-mb-1">
                              <AnnotationResultDisplay
                                result={imgResult}
                                schema={schema}
                                compact={true}
                                targetFieldKey={field.key}
                                renderContext="table"
                                onResultSelect={onResultSelect}
                                forceExpanded={false}
                                onTimestampClick={onTimestampClick}
                                onLocationClick={onLocationClick}
                                filterArrayItems={filterArrayItems}
                                searchTerm={globalFilter}
                                filters={filters}
                                density={density}
                                rangeCache={fieldRangeCache}
                              />
                            </div>
                          ) : (
                            <div className="text-muted-foreground/50 italic text-xs">N/A</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              
              {(!docResult || docFields.length === 0) && (!imgResult || imgFields.length === 0) && (
                <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">N/A</div>
              )}
              </div>
            </div>
          );
        }

        // Handle regular single result (no consolidation)
        if (!resultForThisCell) {
            return <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">N/A</div>;
        }

        const isFailed = resultForThisCell.status === 'failure';

        return (
          <div className={cn("relative h-full min-w-0 max-w-full overflow-hidden", isFailed && "border-l-2 border-destructive pl-1")}>
            <AssetHeaderAlignmentSpacer withSeparator={Boolean(stringSplit && stringSplit.schema.id === schema.id)} />
            {isFailed && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertCircle 
                      className="h-3.5 w-3.5 text-destructive absolute top-1 right-1 opacity-75 cursor-help z-10" 
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end">
                    <p className="text-xs max-w-xs break-words">
                      Failed: {(resultForThisCell as any).error_message || 'Unknown error'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <div className="min-w-0 max-w-full">
              <AnnotationResultDisplay
                result={resultForThisCell}
                schema={schema}
                compact={false}
                selectedFieldKeys={fieldKeysToShow}
                maxFieldsToShow={undefined}
                renderContext="table"
                onResultSelect={onResultSelect}
                forceExpanded={false}
                onTimestampClick={onTimestampClick}
                onLocationClick={onLocationClick}
                filterArrayItems={filterArrayItems}
                searchTerm={globalFilter}
                filters={filters}
                density={density}
                rangeCache={fieldRangeCache}
              />
            </div>
          </div>
        );
      },
      // Schema column flexes to fill the row's remaining width (the inline
      // `width` is suppressed for non-asset cells in TableCell). minSize is
      // generous (~480px) so the inner 2-section flex-wrap layout (numerics
      // + lists) has room to render side-by-side; if the viewport is too
      // narrow, sections wrap. maxSize is removed so wide screens get the
      // full flex-fill instead of capping at 400px.
      minSize: 480,
      size: 600,
      enableResizing: true,
      enableHiding: true,
    })) : [];

    const staticEndColumns: ColumnDef<EnrichedAssetRecord>[] = [
        {
           accessorKey: 'resultsMap',
           header: ({ column }) => (
             <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} className="px-2 h-full w-full justify-start">
               <span className="truncate">Timestamp</span>
               <ArrowUpDown className="ml-1 h-4 w-4 flex-shrink-0" />
             </Button>
           ),
           cell: ({ row }) => {
             const firstResult = Object.values(row.original.resultsMap)[0];
             const timestamp = firstResult?.timestamp;
             return <div className="text-xs truncate min-w-0">{timestamp ? new Date(timestamp).toLocaleString() : 'N/A'}</div>;
           },
           maxSize: 150,
           minSize: 100,
           size: 120,
           enableResizing: true,
           enableHiding: true,
        },
        // Actions are no longer a fixed column — see `renderRowActionsOverlay`
        // below. We render the per-row 3-dot menu as a hover-revealed overlay
        // pinned to the row's right edge so the table doesn't carry a
        // permanent ~44px dead-space column on the trailing side.
    ];

    // Choose between unfolded field columns or grouped schema columns
    const dataColumns = unfoldFields ? unfoldedFieldColumns : dynamicSchemaColumns;
    
    return [
        ...staticColumns,
        ...conditionalColumns,
        ...dataColumns,
        ...staticEndColumns
    ];
  }, [
      schemas.map(s => s.id).sort().join(','), // FIXED: Use stable schema IDs instead of schemas array
      JSON.stringify(selectedFieldsPerScheme), // FIXED: Use stable JSON representation
      // FIXED: Don't depend on function props - they should be stable from parent or memoized
      // onResultSelect, onResultAction, onResultDelete, onRetrySingleResult,
      retryingResultId,
      // onToggleRecordExclusion,
      Object.keys(expanded).sort().join(','), // FIXED: Use stable representation of expanded state
      variableSplittingConfig?.enabled, // Only track enabled state for column changes
      density, // Track density tier for cell rendering
      JSON.stringify(fieldRangeCache), // Track range cache for bar inference
      unfoldFields, // NEW: Track unfold fields state for column generation
      filterArrayItems, // NEW: Track filter array items state
      globalFilter, // NEW: Track global filter for array filtering
      filters.length, // NEW: Track filters for array filtering
      stringSplit, // single-schema redistribution to asset cell
  ]);
  
  // --- Aggregate mode columns & table data --------------------------------
  // When the formula has measures, each OutputRelation row is one group.
  // Columns come from output_keys (dims → row.keys[name]) and measure_names
  // (measures → row.measures[name]). We build a plain object per row and
  // drive a separate table instance.

  type AggregateRow = Record<string, any>;

  const aggregateTableData = useMemo((): AggregateRow[] => {
    if (!isAggregateMode) return [];
    return aggregateRows.map(row => {
      const flat: AggregateRow = {};
      aggregateMeta.outputKeys.forEach(k => { flat[k] = row.keys?.[k] ?? null; });
      aggregateMeta.measureNames.forEach(m => { flat[m] = row.measures?.[m] ?? null; });
      return flat;
    });
  }, [isAggregateMode, aggregateRows, aggregateMeta]);

  const aggregateColumns = useMemo((): ColumnDef<AggregateRow>[] => {
    if (!isAggregateMode) return [];
    const dimCols: ColumnDef<AggregateRow>[] = aggregateMeta.outputKeys.map(key => ({
      id: `dim_${key}`,
      accessorKey: key,
      header: ({ column }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="px-2 h-full w-full justify-start">
          <span className="truncate text-xs font-medium">{key}</span>
          <ArrowUpDown className="ml-1 h-3.5 w-3.5 flex-shrink-0" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const v = getValue();
        return (
          <div className="text-xs px-2 py-1 truncate min-w-0">
            {v == null ? <span className="text-muted-foreground/50 italic">—</span> : String(v)}
          </div>
        );
      },
      enableSorting: true,
      enableHiding: true,
      minSize: 100,
      size: 160,
    }));
    const measureCols: ColumnDef<AggregateRow>[] = aggregateMeta.measureNames.map(name => ({
      id: `measure_${name}`,
      accessorKey: name,
      header: ({ column }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="px-2 h-full w-full justify-start">
          <span className="truncate text-xs font-medium text-primary/80">{name}</span>
          <ArrowUpDown className="ml-1 h-3.5 w-3.5 flex-shrink-0" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const v = getValue();
        return (
          <div className="text-xs px-2 py-1 font-mono tabular-nums truncate min-w-0 text-right">
            {v == null ? <span className="text-muted-foreground/50 italic">—</span>
              : typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 4 })
              : String(v)}
          </div>
        );
      },
      enableSorting: true,
      enableHiding: true,
      minSize: 80,
      size: 120,
    }));
    return [...dimCols, ...measureCols];
  }, [isAggregateMode, aggregateMeta]);

  const aggregateTable = useReactTable<AggregateRow>({
    data: aggregateTableData,
    columns: aggregateColumns,
    state: { sorting, columnVisibility, pagination },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    autoResetAll: false,
  });

  // Custom global filter function that searches within nested arrays
  const globalFilterFn = useCallback((row: Row<EnrichedAssetRecord>, columnId: string, filterValue: string): boolean => {
    if (!filterValue) return true;
    
    const searchLower = filterValue.toLowerCase();
    const record = row.original;
    
    // Search in asset title
    if (record.title?.toLowerCase().includes(searchLower)) return true;
    
    // Search in source name
    if (record.sourceName?.toLowerCase().includes(searchLower)) return true;
    
    // Search within all result values (including nested arrays)
    for (const result of Object.values(record.resultsMap)) {
      if (result.value && searchInAnnotationValue(result.value, filterValue)) {
        return true;
      }
    }
    
    return false;
  }, []);

  // Optimize table configuration to prevent automatic resets
  const table = useReactTable<EnrichedAssetRecord>({ 
    data: flattenedTableData,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination, 
      globalFilter,
      expanded: expanded as ExpandedState,
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowId: (record) => record.id.toString(),
    globalFilterFn: globalFilterFn, // Add custom filter function
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: (updater) => {
      // Use startTransition for this state update
      startTransition(() => {
        if (typeof updater === 'function') {
          setExpanded(prev => {
            const newState = updater(prev as ExpandedState);
            return newState as Record<string, boolean>;
          });
        } else {
          setExpanded(updater as Record<string, boolean>);
        }
      });
    },
    // Disable automatic pagination reset to prevent setState during render
    autoResetPageIndex: false,
    // Add these options to prevent automatic resets
    autoResetExpanded: false,
    autoResetAll: false,
  });

  // Alias target field — first cfg.columns entry or formula explode path.
  const aliasTargetField = cfg?.columns?.[0] ?? panelConfig.formula?.explosion ?? null;
  const aliasesForField = aliasTargetField ? runWideAliasesByField[aliasTargetField] ?? {} : {};

  return (
    <div className="w-full min-w-0 flex flex-col h-full">
      <PanelHeaderSlot><></></PanelHeaderSlot>
      {aliasTargetField && (
        <ValueAliasManager
          open={aliasManagerOpen}
          onOpenChange={setAliasManagerOpen}
          infospaceId={infospaceId}
          runId={runId}
          fieldPath={aliasTargetField}
          aliases={aliasesForField}
          schemaIds={schemas.length === 1 ? [schemas[0].id] : undefined}
          onSave={(next) => {
            const current = getGlobalVariableSplitting() ?? { enabled: true };
            setGlobalVariableSplitting({
              ...current,
              enabled: true,
              valueAliasesByField: {
                ...(current.valueAliasesByField ?? {}),
                [aliasTargetField]: next,
              },
            });
          }}
        />
      )}
      {!focusMode && (
      <div className="flex items-center justify-between px-2 py-1.5 border-b bg-muted/20 flex-shrink-0 gap-2">
         <div className="relative flex-1 max-w-xs">
           <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
           <Input
             placeholder="Search..."
             value={globalFilter ?? ''}
             onChange={(event) => setGlobalFilter(event.target.value)}
             className="pl-7 pr-7 h-6 text-[11px]"
           />
           {globalFilter && (
             <TooltipProvider delayDuration={100}>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => setFilterArrayItems(!filterArrayItems)}
                     className={cn(
                       "absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0",
                       filterArrayItems && "bg-primary/10 text-primary"
                     )}
                   >
                     <Focus className="h-3 w-3" />
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent>
                   <p className="text-xs">
                     {filterArrayItems 
                       ? "Show only matching array items" 
                       : "Showing all array items"}
                   </p>
                 </TooltipContent>
               </Tooltip>
             </TooltipProvider>
           )}
         </div>
         
         <div className="flex items-center gap-0.5">
           {/* Failed badge: clickable count chip toggling visibility of failed
               rows. Hidden by default; clicking flips it. The "…" row menu's
               Quick/Guided Retry items work on whichever rows are visible. */}
           {failedCount > 0 && (
             <TooltipProvider delayDuration={100}>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => setShowFailed((v) => !v)}
                     className={cn(
                       'h-6 px-2 gap-1 text-[11px] border',
                       showFailed
                         ? 'bg-destructive/15 border-destructive/40 text-destructive hover:bg-destructive/25'
                         : 'bg-destructive/5 border-destructive/30 text-destructive/80 hover:bg-destructive/10',
                     )}
                     aria-pressed={showFailed}
                   >
                     <AlertCircle className="h-3 w-3" />
                     <span className="font-mono tabular-nums">{failedCount}</span>
                     <span>failed</span>
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent side="bottom">
                   <p className="text-xs">
                     {showFailed ? 'Hide failed rows' : 'Show failed rows (use the row menu to retry)'}
                   </p>
                 </TooltipContent>
               </Tooltip>
             </TooltipProvider>
           )}

           {/* CSV Export Button */}
           {runId && (
             <Popover open={exportOptionsOpen} onOpenChange={setExportOptionsOpen}>
               <PopoverTrigger asChild>
                 <Button
                   variant="outline"
                   size="sm"
                   className="h-6 px-2 gap-1 text-[11px]"
                   disabled={isExporting}
                 >
                   {isExporting ? (
                     <Loader2 className="h-3 w-3 animate-spin" />
                   ) : (
                     <Download className="h-3 w-3" />
                   )}
                   <span>CSV</span>
                 </Button>
               </PopoverTrigger>
               <PopoverContent className="w-56 p-0" align="end">
                 <div className="p-2 font-medium text-xs border-b">Export CSV</div>
                 <div className="p-2 space-y-2">
                   <div className="flex items-center space-x-2 px-2 py-1.5 text-xs">
                     <Checkbox
                       id="export-justifications"
                       checked={exportOptions.includeJustifications}
                       onCheckedChange={(checked) => 
                         setExportOptions(prev => ({ ...prev, includeJustifications: !!checked }))
                       }
                     />
                     <Label
                       htmlFor="export-justifications"
                       className="font-normal cursor-pointer text-xs"
                     >
                       Include justifications
                     </Label>
                   </div>
                   <div className="flex items-center space-x-2 px-2 py-1.5 text-xs">
                     <Checkbox
                       id="export-metadata"
                       checked={exportOptions.includeMetadata}
                       onCheckedChange={(checked) => 
                         setExportOptions(prev => ({ ...prev, includeMetadata: !!checked }))
                       }
                     />
                     <Label
                       htmlFor="export-metadata"
                       className="font-normal cursor-pointer text-xs"
                     >
                       Include metadata
                     </Label>
                   </div>
                   <div className="flex items-center space-x-2 px-2 py-1.5 text-xs">
                     <Checkbox
                       id="export-flatten"
                       checked={exportOptions.flattenJson}
                       onCheckedChange={(checked) => 
                         setExportOptions(prev => ({ ...prev, flattenJson: !!checked }))
                       }
                     />
                     <Label
                       htmlFor="export-flatten"
                       className="font-normal cursor-pointer text-xs"
                     >
                       Flatten JSON fields
                     </Label>
                   </div>
                 </div>
                 <div className="p-2 border-t">
                   <Button
                     variant="default"
                     size="sm"
                     className="w-full h-7 text-xs"
                     onClick={handleExportCSV}
                     disabled={isExporting}
                   >
                     {isExporting ? (
                       <>
                         <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                         Exporting...
                       </>
                     ) : (
                       <>
                         <Download className="h-3 w-3 mr-1" />
                         Download
                       </>
                     )}
                   </Button>
                 </div>
               </PopoverContent>
             </Popover>
           )}
           
           {/* Unfold Fields Toggle */}
           <TooltipProvider delayDuration={100}>
             <Tooltip>
               <TooltipTrigger asChild>
                 <Button 
                   variant={unfoldFields ? "default" : "ghost"}
                   size="sm" 
                   className="h-6 w-6 p-0"
                   onClick={() => setUnfoldFields(!unfoldFields)}
                 >
                   {unfoldFields ? (
                     <Columns className="h-3 w-3" />
                   ) : (
                     <Columns3 className="h-3 w-3" />
                   )}
                 </Button>
               </TooltipTrigger>
               <TooltipContent side="bottom">
                 <p className="text-xs">
                   {unfoldFields ? 'Group by schema' : 'Unfold fields'}
                 </p>
               </TooltipContent>
             </Tooltip>
           </TooltipProvider>
           
           {/* Density tier control — Compact / Comfortable / Expanded */}
           <TooltipProvider delayDuration={100}>
             <div className="inline-flex items-center rounded-md border border-border/60 overflow-hidden">
               {([
                 { v: 'compact', icon: AlignJustify, label: 'Compact' },
                 { v: 'comfortable', icon: Rows4, label: 'Comfortable' },
                 { v: 'expanded', icon: Rows3, label: 'Expanded' },
               ] as const).map(({ v, icon: Icon, label }) => (
                 <Tooltip key={v}>
                   <TooltipTrigger asChild>
                     <button
                       type="button"
                       onClick={() => handleSetDensity(v)}
                       className={cn(
                         'h-6 w-7 inline-flex items-center justify-center transition-colors',
                         density === v
                           ? 'bg-primary/10 text-primary'
                           : 'text-muted-foreground hover:bg-muted',
                       )}
                       aria-label={label}
                       aria-pressed={density === v}
                     >
                       <Icon className="h-3 w-3" />
                     </button>
                   </TooltipTrigger>
                   <TooltipContent side="bottom">
                     <p className="text-xs">{label}</p>
                   </TooltipContent>
                 </Tooltip>
               ))}
             </div>
           </TooltipProvider>
           
           {/* Column Visibility Controls */}
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                 <SlidersHorizontal className="h-3 w-3" />
               </Button>
             </DropdownMenuTrigger>
             <DropdownMenuContent align="end" className="w-[200px]">
               <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
               <DropdownMenuSeparator />
               <ScrollArea className="max-h-[300px]">
                {table
                  .getAllColumns()
                  .filter(
                    (column) =>
                      column.getCanHide()
                  )
                  .map((column) => {
                    const getDisplayName = (column: any) => {
                      // Use meta displayName if available
                      if (column.columnDef.meta?.displayName) {
                        return column.columnDef.meta.displayName;
                      }
                      // Format column IDs to be more readable
                      const id = column.id;
                      if (id === 'asset') return 'Asset';
                      if (id === 'sourceName') return 'Source Name';
                      if (id === 'splitValue') return 'Split Value';
                      if (id === 'resultsMap') return 'Timestamp';
                      if (id.startsWith('field_')) {
                        // Parse field column ID: field_<schemaId>_<fieldKey>
                        const parts = id.split('_');
                        if (parts.length >= 3) {
                          const schemaId = parseInt(parts[1]);
                          const fieldKey = parts.slice(2).join('_');
                          const schema = schemas.find(s => s.id === schemaId);
                          return schema ? `${schema.name} › ${fieldKey}` : id;
                        }
                      }
                      if (id.startsWith('schema_')) return schemas.find(s => s.id === parseInt(id.replace('schema_', '')))?.name || id;
                      return id.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    };
                    
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                      >
                        {getDisplayName(column)}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </ScrollArea>
           </DropdownMenuContent>
         </DropdownMenu>

           {/* Curate Button */}
           <TooltipProvider delayDuration={100}>
             <Tooltip>
               <DropdownMenu>
                 <DropdownMenuTrigger asChild>
                   <TooltipTrigger asChild>
                     <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                       <ArrowUpToLine className="h-3 w-3" />
                     </Button>
                   </TooltipTrigger>
                 </DropdownMenuTrigger>
                 <DropdownMenuContent align="end">
                   <DropdownMenuLabel className="text-xs text-muted-foreground">
                     Preserve data to features
                   </DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   <DropdownMenuItem onClick={() => handleCurationClick('visible')} disabled={table.getFilteredRowModel().rows.length === 0}>
                     <ArrowUpToLine className="h-4 w-4 mr-2" />
                     Curate Visible Data...
                   </DropdownMenuItem>
                   <DropdownMenuItem onClick={() => handleCurationClick('selected')} disabled={table.getSelectedRowModel().rows.length === 0}>
                     <ArrowUpToLine className="h-4 w-4 mr-2" />
                     Curate Selected Rows...
                   </DropdownMenuItem>
                 </DropdownMenuContent>
               </DropdownMenu>
               <TooltipContent side="bottom">
                 <p className="text-xs">Curate data</p>
               </TooltipContent>
             </Tooltip>
           </TooltipProvider>
         </div>

      </div>
      )}

      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        {/* Outer padding gives the row content visible breathing room
            from the panel's left/right edges — the row chrome (asset cell
            on the left, lists section on the right) no longer hugs the
            panel border. */}
        <div className="flex-1 overflow-auto min-w-0 px-3">
          {isAggregateMode ? (
            /* ── Aggregate mode ─────────────────────────────────────────── */
            <Table className="min-w-0 w-full">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                {aggregateTable.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap p-1.5 text-xs"
                        style={{
                          minWidth: header.column.columnDef.minSize ? `${header.column.columnDef.minSize}px` : undefined,
                        }}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {aggregateTable.getRowModel().rows.length ? (
                  aggregateTable.getRowModel().rows.map((row) => (
                    <TableRow key={row.id} className="hover:bg-muted/30">
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="align-middle min-w-0 max-w-full px-0 py-0.5"
                          style={{ minWidth: cell.column.columnDef.minSize ? `${cell.column.columnDef.minSize}px` : undefined }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={aggregateColumns.length} className="h-24 text-center text-muted-foreground text-sm">
                      {isLoading ? 'Loading…' : 'No matching data for current filter.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            /* ── List mode ──────────────────────────────────────────────── */
            <Table className="min-w-0 w-full">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="whitespace-nowrap p-1.5 text-xs"
                        style={{
                          // Match the data row's width strategy: asset stays
                          // fixed, schema columns flex to fill remaining space.
                          width: header.column.id === 'asset' && header.getSize() > 0
                            ? `${header.getSize()}px`
                            : undefined,
                          minWidth: header.column.columnDef.minSize ? `${header.column.columnDef.minSize}px` : undefined,
                          maxWidth: header.column.columnDef.maxSize ? `${header.column.columnDef.maxSize}px` : undefined,
                        }}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className={cn(
                        "group relative cursor-pointer hover:bg-muted/30 transition-opacity",
                        row.original.isChildRow && "bg-muted/5",
                        row.original.hasChildren && "font-medium"
                      )}
                      onClick={() => {
                        const record = row.original;

                        if (record.hasChildren && record.children && record.children.length > 0) {
                           // This is a CSV parent - toggle expansion
                           startTransition(() => {
                             setExpanded(prev => {
                               const newExpanded = Object.assign({}, prev);
                               newExpanded[record.id.toString()] = !prev[record.id.toString()];
                               return newExpanded;
                             });
                           });
                         } else {
                          // This is a child row or regular asset - show details if it has results
                          // For consolidated results (document + image), pass both results as an array
                          if (record.consolidatedResultsMap && onResultSelect) {
                            const consolidatedResults = Object.values(record.consolidatedResultsMap)[0];
                            const resultsToShow: ResultWithSourceInfo[] = [];
                            if (consolidatedResults?.document) resultsToShow.push(consolidatedResults.document);
                            if (consolidatedResults?.image) resultsToShow.push(consolidatedResults.image);
                            if (resultsToShow.length > 0) {
                              onResultSelect(resultsToShow.length === 1 ? resultsToShow[0] : resultsToShow as any);
                            }
                          } else {
                            const firstResult = Object.values(record.resultsMap)[0];
                            if (firstResult && onResultSelect) {
                              onResultSelect(firstResult);
                            }
                          }
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "align-top min-w-0 max-w-full",
                            cell.column.id === 'asset' ? 'p-1.5' : 'px-1.5 py-1.5'
                          )}
                          style={{
                            // Asset and other fixed-purpose columns get explicit
                            // widths from their column def. Schema columns leave
                            // `width` unset so they flex to fill the row's
                            // remaining horizontal space — that's what lets the
                            // 3-section folded layout (strings | numerics |
                            // lists) actually have room to render side-by-side
                            // on wide screens, and gracefully wrap to 2 then 1
                            // sections as the viewport narrows. With a fixed
                            // 250px schema width, the sections could never fit
                            // and the layout collapsed to 1 column always.
                            width: cell.column.id === 'asset' && cell.column.getSize() > 0
                              ? `${cell.column.getSize()}px`
                              : undefined,
                            minWidth: cell.column.columnDef.minSize ? `${cell.column.columnDef.minSize}px` : undefined,
                            maxWidth: cell.column.columnDef.maxSize ? `${cell.column.columnDef.maxSize}px` : undefined,
                          }}
                        >
                          <div
                            className={cn(
                              'min-w-0 max-w-full',
                              // Only compact bounds the row — comfortable and expanded
                              // let rows grow naturally so x-scroll inside (e.g. mini-tables)
                              // doesn't sit inside a y-clipped container.
                              density === 'compact' ? 'overflow-auto' : 'overflow-x-auto',
                            )}
                            style={
                              Number.isFinite(getDensitySpec(density).rowMaxHeight)
                                ? { maxHeight: getDensitySpec(density).rowMaxHeight }
                                : undefined
                            }
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        </TableCell>
                      ))}
                      {renderRowActionsOverlay(row.original)}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground text-sm">
                      {isLoading ? 'Loading…' : 'No results yet.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between py-1.5 px-1 flex-shrink-0 border-t text-xs">
        {isAggregateMode ? (
          /* Aggregate mode pagination */
          <>
            <div className="flex items-center gap-1.5">
              <Select
                value={`${aggregateTable.getState().pagination.pageSize}`}
                onValueChange={(value) => aggregateTable.setPageSize(Number(value))}
              >
                <SelectTrigger className="h-6 w-[68px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="top">
                  {[25, 50, 100, 250].map((ps) => (
                    <SelectItem key={ps} value={`${ps}`} className="text-xs">{ps}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                of {aggregateTable.getFilteredRowModel().rows.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => aggregateTable.previousPage()} disabled={!aggregateTable.getCanPreviousPage()}>
                <ChevronDown className="h-3 w-3 rotate-90" />
              </Button>
              <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                {aggregateTable.getState().pagination.pageIndex + 1}/{aggregateTable.getPageCount()}
              </span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => aggregateTable.nextPage()} disabled={!aggregateTable.getCanNextPage()}>
                <ChevronDown className="h-3 w-3 -rotate-90" />
              </Button>
            </div>
          </>
        ) : (
          /* List mode pagination */
          <>
            <div className="flex items-center gap-1.5">
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => { table.setPageSize(Number(value)) }}
              >
                <SelectTrigger className="h-6 w-[68px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="top">
                  {[5, 10, 25, 50, 100, 500].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`} className="text-xs">
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                of {table.getFilteredRowModel().rows.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                <ChevronDown className="h-3 w-3 rotate-90" />
              </Button>
              <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                {table.getState().pagination.pageIndex + 1}/{table.getPageCount()}
              </span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                <ChevronDown className="h-3 w-3 -rotate-90" />
              </Button>
            </div>
          </>
        )}
      </div>
      <GuidedRetryModal
        isOpen={guidedRetryModal.isOpen}
        onClose={closeGuidedRetryModal}
        result={guidedRetryModal.result}
        schema={guidedRetryModal.schema}
        onRetry={handleGuidedRetryExecute}
        isRetrying={!!retryingResultId && retryingResultId === guidedRetryModal.result?.id}
      />
      <AnnotationCurationModal
        isOpen={curationState.isOpen}
        onClose={() => setCurationState({ isOpen: false, payloads: [] })}
        onConfirm={executeCuration}
        isLoading={isCurationLoading}
        fragmentCount={curationState.payloads.length}
        assetCount={new Set(curationState.payloads.map(p => p.assetId)).size}
        progress={curationProgress}
      />
    </div>
  );
}

export default AnnotationResultsTable; 