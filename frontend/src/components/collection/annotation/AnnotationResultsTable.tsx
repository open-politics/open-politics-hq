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
import AnnotationResultDisplay from './AnnotationResultDisplay';
import AssetLink from '../assets/Helper/AssetLink';
import { adaptEnhancedAnnotationToFormattedAnnotation } from '@/lib/annotations/adapters';
import { ResultFilter } from './AnnotationFilterControls';
import { checkFilterMatch, getTargetKeysForScheme, getAnnotationFieldValue, getTargetFieldDefinition } from '@/lib/annotations/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, ChevronDown, MoreHorizontal, ExternalLink, Eye, Trash2, Filter, X, ChevronRight, ChevronsLeft, ChevronsRight, Settings2, Loader2, RefreshCw, Ban, Search, SlidersHorizontal, Sparkles, Maximize2, Minimize2, Columns3, Columns, ArrowUpToLine, UnfoldVertical, FoldVertical, Wand2, HelpCircle } from 'lucide-react';
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
import { VariableSplittingConfig, applySplittingToResults } from './VariableSplittingControls';
import GuidedRetryModal from './GuidedRetryModal';
import { useFragmentCuration } from '@/hooks/useFragmentCuration';
import AnnotationCurationModal from './AnnotationCurationModal';

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
  results: ResultWithSourceInfo[];
  schemas: AnnotationSchemaRead[];
  sources: { id: number; name: string }[];
  assets: AssetRead[];
  filters?: ResultFilter[];
  isLoading?: boolean;
  onResultSelect?: (result: ResultWithSourceInfo) => void;
  onResultDelete?: (resultId: number) => void;
  onResultAction?: (action: string, result: ResultWithSourceInfo) => void;
  onRetrySingleResult?: (resultId: number, customPrompt?: string) => Promise<AnnotationRead | null>;
  retryingResultId?: number | null;
  excludedRecordIds: Set<number>;
  onToggleRecordExclusion: (recordId: number) => void;
  // NEW: Table configuration settings
  initialTableConfig?: {
    columnVisibility?: Record<string, boolean>;
    sorting?: Array<{ id: string; desc: boolean }>;
    pagination?: {
      pageIndex: number;
      pageSize: number;
    };
    globalFilter?: string;
    expanded?: Record<string, boolean>;
    selectedFieldsPerScheme?: Record<number, string[]>;
  };
  onTableConfigChange?: (config: any) => void;
  // NEW: Time frame filtering
  timeAxisConfig?: TimeAxisConfig | null;
  // NEW: Variable splitting
  variableSplittingConfig?: VariableSplittingConfig | null;
  onVariableSplittingChange?: (config: VariableSplittingConfig | null) => void;
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

// --- MAIN COMPONENT --- //
export function AnnotationResultsTable({
  results,
  schemas,
  sources,
  assets,
  filters = [],
  isLoading = false,
  onResultSelect,
  onResultDelete,
  onResultAction,
  onRetrySingleResult,
  retryingResultId,
  excludedRecordIds,
  onToggleRecordExclusion,
  initialTableConfig,
  onTableConfigChange,
  // NEW props
  timeAxisConfig = null,
  variableSplittingConfig = null,
  onVariableSplittingChange,
}: AnnotationResultsTableProps) {
  const [sorting, setSorting] = useState<SortingState>(() => {
    if (initialTableConfig?.sorting) {
      return initialTableConfig.sorting.map(s => ({ id: s.id, desc: s.desc }));
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
      pageSize: 10, // Start with smaller default for better panel performance
    };
  });
  const [globalFilter, setGlobalFilter] = useState(initialTableConfig?.globalFilter || '');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(initialTableConfig?.expanded || {});
  const [expandAllAnnotations, setExpandAllAnnotations] = useState(false); // NEW: Global expand state for annotation cards
  const [unfoldFields, setUnfoldFields] = useState(false); // NEW: Toggle for unfolding schema fields into separate columns
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

  const [selectedFieldsPerScheme, setSelectedFieldsPerScheme] = useState<Record<number, string[]>>(() => {
    if (initialTableConfig?.selectedFieldsPerScheme) {
      return initialTableConfig.selectedFieldsPerScheme;
    }
    const initialState: Record<number, string[]> = {};
    schemas.forEach(schema => {
        const targetKeys = getTargetKeysForScheme(schema.id, schemas);
        initialState[schema.id] = targetKeys.map(tk => tk.key);
    });
    return initialState;
  });

  // Defer state updates to avoid setState during render
  useEffect(() => {
    // Use startTransition to defer this update
    startTransition(() => {
      setSelectedFieldsPerScheme(prev => {
        const newState: Record<number, string[]> = {};
        schemas.forEach(schema => {
          const targetKeys = getTargetKeysForScheme(schema.id, schemas);
          const keys = targetKeys.map(tk => tk.key);
          newState[schema.id] = prev[schema.id] ?? keys;
        });
        console.log('[AnnotationResultsTable] Updated selectedFieldsPerScheme:', newState);
        return newState;
      });
    });
  }, [schemas]);

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
            JSON.stringify(config.selectedFieldsPerScheme) !== JSON.stringify(prevConfig.selectedFieldsPerScheme);
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
  }, [columnVisibility, sorting, pagination, globalFilter, expanded, selectedFieldsPerScheme, debouncedConfigUpdate]);

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

  // NEW: Apply time frame filtering and variable splitting
  const assetsMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  
  const timeFilteredResults = useMemo(() => {
    if (!timeAxisConfig?.timeFrame?.enabled || !timeAxisConfig.timeFrame.startDate || !timeAxisConfig.timeFrame.endDate) {
      return results;
    }

    const { startDate, endDate } = timeAxisConfig.timeFrame;
    
    // Ensure startDate and endDate are Date objects
    const startDateObj = startDate instanceof Date ? startDate : new Date(startDate);
    const endDateObj = endDate instanceof Date ? endDate : new Date(endDate);
    
    // Validate that the dates are valid
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      console.warn('Invalid date range in timeAxisConfig:', { startDate, endDate });
      return results; // Skip time filtering if dates are invalid
    }
    
    // Create assetsMap locally to avoid dependency instability
    const localAssetsMap = new Map(assets.map(asset => [asset.id, asset]));
    
    return results.filter(result => {
      const timestamp = getTimestamp(result, localAssetsMap, timeAxisConfig);
      if (!timestamp) return false;
      
      return timestamp >= startDateObj && timestamp <= endDateObj;
    });
  }, [
    results, 
    timeAxisConfig?.timeFrame?.enabled,
    // Safe handling of date dependencies - convert to timestamps or use string representation
    timeAxisConfig?.timeFrame?.startDate instanceof Date ? timeAxisConfig.timeFrame.startDate.getTime() : String(timeAxisConfig?.timeFrame?.startDate || ''),
    timeAxisConfig?.timeFrame?.endDate instanceof Date ? timeAxisConfig.timeFrame.endDate.getTime() : String(timeAxisConfig?.timeFrame?.endDate || ''),
    timeAxisConfig?.type,
    timeAxisConfig?.schemaId,
    timeAxisConfig?.fieldKey,
    assets.map(a => a.id).sort().join(',') // FIXED: Use stable asset IDs instead of assetsMap
  ]);

  const processedResults = useMemo(() => {
    if (variableSplittingConfig?.enabled) {
      const splitResults = applySplittingToResults(timeFilteredResults, variableSplittingConfig);
      return splitResults;
    }
    
    return { all: timeFilteredResults };
  }, [
    timeFilteredResults, 
    variableSplittingConfig?.enabled,
    variableSplittingConfig?.schemaId,
    variableSplittingConfig?.fieldKey,
    variableSplittingConfig?.visibleSplits ? Array.from(variableSplittingConfig.visibleSplits).sort().join(',') : '',
    variableSplittingConfig?.valueAliases ? JSON.stringify(variableSplittingConfig.valueAliases) : ''
  ]);

  // Use the appropriate results for table display
  const resultsForTable = useMemo(() => {
    if (variableSplittingConfig?.enabled && Object.keys(processedResults).length > 1) {
      // Flatten all split results for table display with split identifiers
      const flattenedResults: ResultWithSourceInfo[] = [];
      Object.entries(processedResults).forEach(([splitValue, splitResults]) => {
        splitResults.forEach(result => {
          flattenedResults.push({
            ...result,
            // Add split value as metadata for display
            splitValue: splitValue !== 'all' ? splitValue : undefined
          } as ResultWithSourceInfo & { splitValue?: string });
        });
      });
      return flattenedResults;
    }
    
    const finalResults = processedResults.all || timeFilteredResults;
    return finalResults;
  }, [
    processedResults, 
    timeFilteredResults, 
    variableSplittingConfig?.enabled
  ]);

  type EnrichedAssetRecord = AssetRead & {
    sourceName: string | null;
    resultsMap: Record<number, ResultWithSourceInfo>; // Map schema_id to result
    isChildRow?: boolean; // Indicates if this is a CSV row child
    parentAssetId?: number; // Reference to parent asset for child rows
    hasChildren?: boolean; // Indicates if this asset has children
    children?: EnrichedAssetRecord[]; // Child assets for hierarchical display
    splitValue?: string; // NEW: Split value when variable splitting is enabled
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
    const assetsWithResults = new Set<number>();
    const csvParentsWithChildren = new Set<number>();
    
    // First pass: identify assets with direct results
    assets.forEach(asset => {
      if (resultsByAssetId[asset.id] && resultsByAssetId[asset.id].length > 0) {
        assetsWithResults.add(asset.id);
        
        // If this is a CSV row, also include its parent
        if (asset.kind === 'csv_row' && asset.parent_asset_id) {
          csvParentsWithChildren.add(asset.parent_asset_id);
        }
      }
    });

    // Create enriched records for both parents and children
    const enrichedRecordsMap = new Map<number, EnrichedAssetRecord>();
    
    assets.forEach(asset => {
      const shouldInclude = assetsWithResults.has(asset.id) || csvParentsWithChildren.has(asset.id);
      
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
          splitValue: splitValue, // NEW: Add split value
        };

        enrichedRecordsMap.set(asset.id, enrichedRecord);
      }
    });

    // Build hierarchy: attach children to parents
    const topLevelRecords: EnrichedAssetRecord[] = [];
    
    enrichedRecordsMap.forEach(record => {
      if (record.isChildRow && record.parentAssetId) {
        // This is a child row, attach to parent
        const parent = enrichedRecordsMap.get(record.parentAssetId);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(record);
        } else {
          // Parent not found, add as top-level
          topLevelRecords.push(record);
        }
      } else {
        // This is a top-level record
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

    // Apply filters to top-level records
    // FIXED: Only apply filter logic if there are ACTIVE filters
    const activeFilters = filters.filter(f => f.isActive);
    const filteredRecords = topLevelRecords.filter(record => {
      // If no active filters, include all records that have results
      if (activeFilters.length === 0) {
        // For CSV parents, check if any children have results
        if (record.hasChildren && record.children) {
          return record.children.some(child => Object.keys(child.resultsMap).length > 0);
        }
        // For regular assets, check if they have direct results
        return Object.keys(record.resultsMap).length > 0;
      }

      // For CSV parents, check if any children match filters
      if (record.hasChildren && record.children) {
        return record.children.some(child => {
          const childResults = Object.values(child.resultsMap);
          return childResults.length > 0 && activeFilters.every(filter => checkFilterMatch(filter, childResults, schemas));
        });
      }
      
      // For regular assets, check direct results
      const assetResults = Object.values(record.resultsMap);
      if (assetResults.length === 0) return false;
      return activeFilters.every(filter => checkFilterMatch(filter, assetResults, schemas));
    });

    return filteredRecords;
  }, [
    resultsForTable, 
    filters.map(f => `${f.id}-${f.isActive}-${f.schemaId}-${f.fieldKey}-${f.operator}-${JSON.stringify(f.value)}`).join('|'), // FIXED: Stable filter representation
    schemas.map(s => s.id).sort().join(','), // FIXED: Use stable schema IDs
    assets.map(a => a.id).sort().join(','), // FIXED: Use stable asset IDs
    sources.map(s => `${s.id}-${s.name}`).sort().join(',') // FIXED: Use stable source representation
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
          
          return (
            <div className="flex items-start gap-2 min-w-0 py-1">
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
                  <div className="w-2 h-2 rounded-full bg-primary/30 border-2 border-primary/50" />
                </div>
              )}
              
              {/* Content: Checkbox, Title, ID, Source */}
              <div className="flex-1 min-w-0 flex gap-2.5 p-2.5 rounded-lg border border-border bg-gradient-to-b from-card to-card/80 hover:border-border/80 hover:shadow-sm transition-all duration-200 group">
                {/* Checkbox */}
                <div className="flex items-start pt-0.5">
                  <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="h-4 w-4 flex-shrink-0 mt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                
                {/* Content area */}
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  {/* Title */}
                  <AssetLink 
                    assetId={record.id} 
                    className="font-medium text-sm truncate hover:text-primary transition-colors block leading-tight group-hover:underline decoration-primary/30"
                  >
                    {record.title || <span className="italic text-muted-foreground/70">No Title</span>}
                  </AssetLink>
                  
                  {/* Metadata */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80 min-w-0">
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground/90">
                      #{record.id}
                    </span>
                    {record.sourceName && (
                      <>
                        <span className="text-muted-foreground/30">•</span>
                        <span className="truncate text-[11px]">{record.sourceName}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        },
        maxSize: 200,
        minSize: 120,
        size: 140,
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
                    <span className="font-medium text-xs truncate">
                      {field.name}
                    </span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" align="start" className="max-w-sm">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs">{field.name}</span>
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
          
          // Check if this field has a justification
          const justificationFieldPath = `${field.key}_justification`;
          const justificationValue = resultForThisCell.value && typeof resultForThisCell.value === 'object'
            ? getAnnotationFieldValue(resultForThisCell.value, justificationFieldPath)
            : undefined;
          
          return (
            <div className={cn(
              "relative h-full min-w-0 p-2",
              isFailed && "border-l-2 border-destructive pl-1",
              fieldIndex === 0 && schemaIndex > 0 && "border-l-2 border-primary/20"
            )}>
              {isFailed && fieldIndex === 0 && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertCircle 
                        className="h-3.5 w-3.5 text-destructive absolute top-1 right-1 opacity-75 cursor-help" 
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
              
              {/* Justification indicator */}
              {justificationValue && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle 
                        className="h-3 w-3 text-primary/60 absolute top-1.5 right-1.5 opacity-70 hover:opacity-100 cursor-help transition-opacity" 
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" align="end" className="max-w-sm z-[1001]">
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold">Justification:</p>
                        </div>
                        {(() => {
                          // Handle structured justification objects
                          if (typeof justificationValue === 'object' && justificationValue !== null) {
                            return (
                              <div className="space-y-1">
                                {justificationValue.reasoning && (
                                  <p className="text-xs">{justificationValue.reasoning}</p>
                                )}
                                {justificationValue.text_spans && justificationValue.text_spans.length > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-xs">
                                      📝 {justificationValue.text_spans.length} text span{justificationValue.text_spans.length > 1 ? 's' : ''}
                                    </p>
                                    <Separator className="my-2" />
                                    <div className="text-xs">
                                      {justificationValue.text_spans.slice(0, 3).map((span: any, idx: number) => (
                                        <div key={idx} className="italic border border-border p-1 rounded text-wrap break-words mb-1">
                                          "{span.text_snippet}"
                                        </div>
                                      ))}
                                      {justificationValue.text_spans.length > 3 && (
                                        <p className="text-muted-foreground">...and {justificationValue.text_spans.length - 3} more</p>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {justificationValue.image_regions && justificationValue.image_regions.length > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    🖼️ {justificationValue.image_regions.length} image region{justificationValue.image_regions.length > 1 ? 's' : ''}
                                  </p>
                                )}
                                {justificationValue.audio_segments && justificationValue.audio_segments.length > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    🎵 {justificationValue.audio_segments.length} audio segment{justificationValue.audio_segments.length > 1 ? 's' : ''}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          // Handle string justifications
                          return <p className="text-xs">{String(justificationValue)}</p>;
                        })()}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              
              <AnnotationResultDisplay
                result={resultForThisCell}
                schema={schema}
                compact={true}
                targetFieldKey={field.key}
                renderContext="table"
                onResultSelect={onResultSelect}
                forceExpanded={false}
              />
            </div>
          );
        },
        maxSize: 250,
        minSize: 100,
        size: 150,
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
        const handleFieldToggle = (fieldKey: string) => {
          // Use startTransition for this state update
          startTransition(() => {
            setSelectedFieldsPerScheme(prev => {
              const currentSelected = prev[schema.id] || [];
              const isSelected = currentSelected.includes(fieldKey);
              const newSelected = isSelected ? currentSelected.filter(key => key !== fieldKey) : [...currentSelected, fieldKey];
              
              // FIXED: Allow zero fields (this hides the schema column)
              return { ...prev, [schema.id]: newSelected };
            });
          });
        };
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
                              onCheckedChange={() => handleFieldToggle(field.key)}
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
        const resultForThisCell = row.original.resultsMap[schema.id];
        const fieldKeysToShow = selectedFieldsPerScheme[schema.id] || [];

        // Debug logging
        if (!resultForThisCell) {
          console.log('[AnnotationResultsTable] No result for schema', schema.id, 'in row', row.original.id, 'resultsMap:', row.original.resultsMap);
        } else {
          console.log('[AnnotationResultsTable] Found result for schema', schema.id, 'with', fieldKeysToShow.length, 'fields to show');
        }

        // FIXED: Hide cell content when zero fields are selected
        if (fieldKeysToShow.length === 0) {
          return <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">Hidden</div>;
        }

        if (!resultForThisCell) {
            return <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">N/A</div>;
        }

        const isFailed = resultForThisCell.status === 'failure';

        return (
          <div className={cn("relative h-full min-w-0", isFailed && "border-l-2 border-destructive pl-1")}>
            {isFailed && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertCircle 
                      className="h-3.5 w-3.5 text-destructive absolute top-1 right-1 opacity-75 cursor-help" 
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
            <div className="min-w-0 w-full">
              <AnnotationResultDisplay
                result={resultForThisCell}
                schema={schema}
                compact={false}
                selectedFieldKeys={fieldKeysToShow}
                maxFieldsToShow={undefined}
                renderContext="table"
                onResultSelect={onResultSelect}
                forceExpanded={expandAllAnnotations}
              />
            </div>
          </div>
        );
      },
      // Make schema columns flexible based on content
      maxSize: 300,
      minSize: 120,
      size: 200,
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
        {
          id: 'actions',
          header: '',
          cell: ({ row }) => {
             const recordContext = row.original;
             const firstResult = Object.values(recordContext.resultsMap)[0];

             if (!firstResult) return null;

             const isCurrentlyRetryingThis = retryingResultId === firstResult.id;

             return (
               <DropdownMenu>
                 <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 p-0" disabled={isCurrentlyRetryingThis}>
                    <span className="sr-only">Open menu</span>
                    {isCurrentlyRetryingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
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
                  <DropdownMenuItem onClick={() => handleCurationClick('single', recordContext)}>
                    <ArrowUpToLine className="mr-2 h-4 w-4" /> Curate...
                  </DropdownMenuItem>
                  {(onResultSelect || onResultAction || onResultDelete) && <DropdownMenuSeparator />}
                   {onRetrySingleResult && (
                     <>
                       <DropdownMenuItem
                         onClick={(e) => {
                           e.stopPropagation();
                           if (firstResult && typeof firstResult.id === 'number') {
                               handleQuickRetry(firstResult);
                           }
                         }}
                         disabled={isCurrentlyRetryingThis}
                         className="text-orange-600 hover:text-orange-700 focus:bg-orange-100 focus:text-orange-800"
                       >
                         <RefreshCw className="mr-2 h-4 w-4" /> Quick Retry
                       </DropdownMenuItem>
                       <DropdownMenuItem
                         onClick={(e) => {
                           e.stopPropagation();
                           if (firstResult && typeof firstResult.id === 'number') {
                               handleGuidedRetry(firstResult);
                           }
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
             );
          },
          maxSize: 50,
          minSize: 50,
          size: 50,
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
        },
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
      expandAllAnnotations, // NEW: Track expand all state for annotation display
      unfoldFields, // NEW: Track unfold fields state for column generation
  ]);
  
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
    onSortingChange: setSorting,
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

  return (
    <div className="w-full min-w-0 flex flex-col h-full">
      <div className="flex items-center justify-between py-2 flex-shrink-0 gap-2">
         <div className="relative flex-1 max-w-xs">
           <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
           <Input
             placeholder="Search assets..."
             value={globalFilter ?? ''}
             onChange={(event) => setGlobalFilter(event.target.value)}
             className="pl-8 h-8 text-sm"
           />
         </div>
         
         <div className="flex items-center gap-1">
           {/* Unfold Fields Toggle */}
           <TooltipProvider delayDuration={100}>
             <Tooltip>
               <TooltipTrigger asChild>
                 <Button 
                   variant={unfoldFields ? "default" : "ghost"}
                   size="sm" 
                   className="h-7 w-7 p-0"
                   onClick={() => setUnfoldFields(!unfoldFields)}
                 >
                   {unfoldFields ? (
                     <Columns className="h-3.5 w-3.5" />
                   ) : (
                     <Columns3 className="h-3.5 w-3.5" />
                   )}
                 </Button>
               </TooltipTrigger>
               <TooltipContent side="bottom">
                 <p className="text-xs">
                   {unfoldFields 
                     ? 'Showing individual field columns. Click to group by schema.' 
                     : 'Showing grouped schemas. Click to unfold into field columns.'}
                 </p>
               </TooltipContent>
             </Tooltip>
           </TooltipProvider>
           
           {/* Expand/Collapse All Annotations - only show when grouped */}
           {!unfoldFields && (
             <TooltipProvider delayDuration={100}>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button 
                     variant="ghost"
                     size="sm" 
                     className="h-7 w-7 p-0"
                     onClick={() => setExpandAllAnnotations(!expandAllAnnotations)}
                   >
                     {expandAllAnnotations ? (
                       <FoldVertical className="h-3.5 w-3.5" />
                     ) : (
                       <UnfoldVertical className="h-3.5 w-3.5" />
                     )}
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent side="bottom">
                   <p className="text-xs">{expandAllAnnotations ? 'Collapse' : 'Expand'} all annotation fields</p>
                 </TooltipContent>
               </Tooltip>
             </TooltipProvider>
           )}
           
           {/* Column Visibility Controls */}
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                 <SlidersHorizontal className="h-3.5 w-3.5" />
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
           <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2">
                <ArrowUpToLine className="h-3.5 w-3.5 mr-1.5" />
                <span className="text-xs">Curate</span>
              </Button>
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
         </div>

      </div>
      
      <div className="rounded-md border min-w-0 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto min-w-0"> 
          <Table className="min-w-0 w-full">
            <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead 
                      key={header.id} 
                      className="whitespace-nowrap p-2"
                      style={{ 
                        width: header.getSize() > 0 ? `${header.getSize()}px` : undefined,
                        minWidth: header.column.columnDef.minSize ? `${header.column.columnDef.minSize}px` : undefined,
                        maxWidth: header.column.columnDef.maxSize ? `${header.column.columnDef.maxSize}px` : undefined
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
                      "cursor-pointer hover:bg-muted/30 transition-opacity", 
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
                        const firstResult = Object.values(record.resultsMap)[0];
                        if (firstResult && onResultSelect) {
                           onResultSelect(firstResult);
                        }
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell 
                        key={cell.id} 
                        className="h-full align-top p-2 min-w-0"
                        style={{ 
                          width: cell.column.getSize() > 0 ? `${cell.column.getSize()}px` : undefined,
                          minWidth: cell.column.columnDef.minSize ? `${cell.column.columnDef.minSize}px` : undefined,
                          maxWidth: cell.column.columnDef.maxSize ? `${cell.column.columnDef.maxSize}px` : undefined
                        }}
                      >
                        <div className="h-full flex flex-col min-w-0">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    {isLoading ? "Loading results..." : "No results found."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between py-2 flex-wrap gap-2 flex-shrink-0 border-t">
         <div className="flex items-center space-x-2">
           <p className="text-xs font-medium text-muted-foreground whitespace-nowrap">Rows</p>
           <Select
             value={`${table.getState().pagination.pageSize}`}
             onValueChange={(value) => { table.setPageSize(Number(value)) }}
           >
             <SelectTrigger className="h-7 w-[60px] text-xs">
               <SelectValue placeholder={table.getState().pagination.pageSize} />
             </SelectTrigger>
             <SelectContent side="top">
               {[5, 10, 25, 50].map((pageSize) => (
                 <SelectItem key={pageSize} value={`${pageSize}`} className="text-xs">
                   {pageSize}
                 </SelectItem>
               ))}
             </SelectContent>
           </Select>
         </div>
        <div className="flex-1 text-xs text-muted-foreground text-center sm:text-left">
          <span>{table.getFilteredRowModel().rows.length} assets · Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
        </div>
        <div className="flex items-center gap-1">
           <Button variant="outline" className="hidden h-7 w-7 p-0 lg:flex" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
             <span className="sr-only">Go to first page</span>
             <ChevronsLeft className="h-3.5 w-3.5" />
           </Button>
           <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Prev
            </Button>
           <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
             Next
           </Button>
           <Button variant="outline" className="hidden h-7 w-7 p-0 lg:flex" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
             <span className="sr-only">Go to last page</span>
             <ChevronsRight className="h-3.5 w-3.5" />
           </Button>
         </div>
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