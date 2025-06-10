'use client';

import React, { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
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
import { AnnotationSchemaRead, AnnotationRead, SourceRead, AssetRead } from '@/client/models';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import AssetLink from '../assets/Helper/AssetLink';
import { adaptEnhancedAnnotationToFormattedAnnotation } from '@/lib/annotations/adapters';
import { ResultFilter } from './AnnotationResultFilters';
import { checkFilterMatch, getTargetKeysForScheme } from '@/lib/annotations/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ChevronDown, MoreHorizontal, ExternalLink, Eye, Trash2, Filter, X, ChevronRight, ChevronsLeft, ChevronsRight, Settings2, Loader2, RefreshCw, Ban, Search } from 'lucide-react';
import { getTargetFieldDefinition } from './AnnotationResultFilters';
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
import { DataTable } from "@/components/collection/infospaces/tables/data-table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AnnotationResultStatus } from '@/lib/annotations/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle } from 'lucide-react';
import { FormattedAnnotation } from '@/lib/annotations/types';

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
interface ResultWithSourceInfo extends AnnotationRead {
  source_name?: string; 
  source_id?: number;
}

interface AnnotationResultsTableProps {
  results: ResultWithSourceInfo[];
  schemas: AnnotationSchemaRead[];
  sources: SourceRead[];
  assets: AssetRead[];
  filters?: ResultFilter[];
  isLoading?: boolean;
  onResultSelect?: (result: ResultWithSourceInfo) => void;
  onResultDelete?: (resultId: number) => void;
  onResultAction?: (action: string, result: ResultWithSourceInfo) => void;
  onRetrySingleResult?: (resultId: number) => Promise<AnnotationRead | null>;
  retryingResultId?: number | null;
  excludedRecordIds: Set<number>;
  onToggleRecordExclusion: (recordId: number) => void;
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
}: AnnotationResultsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState({});
  const [rowSelection, setRowSelection] = useState({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const [globalFilter, setGlobalFilter] = useState('');
  const { activeInfospace } = useInfospaceStore();
  const { loadRuns: refreshSchemasFromHook } = useAnnotationSystem(); // Renaming for clarity

  const [selectedFieldsPerScheme, setSelectedFieldsPerScheme] = useState<Record<number, string[]>>(() => {
    const initialState: Record<number, string[]> = {};
    schemas.forEach(schema => {
        const properties = (schema.output_contract as any)?.properties;
        initialState[schema.id] = properties ? Object.keys(properties) : [];
    });
    return initialState;
  });

  useEffect(() => {
    setSelectedFieldsPerScheme(prev => {
      const newState: Record<number, string[]> = {};
      schemas.forEach(schema => {
        const properties = (schema.output_contract as any)?.properties;
        const keys = properties ? Object.keys(properties) : [];
        newState[schema.id] = prev[schema.id] ?? keys;
      });
      return newState;
    });
  }, [schemas]);

  useEffect(() => {
    if (activeInfospace && schemas.length === 0) {
      refreshSchemasFromHook();
    }
  }, [activeInfospace, schemas.length, refreshSchemasFromHook]);

  type EnrichedAssetRecord = AssetRead & {
    sourceName: string | null;
    resultsMap: Record<number, ResultWithSourceInfo>; // Map schema_id to result
  };

  const tableData = useMemo((): EnrichedAssetRecord[] => {
    if (!assets || !results) {
      return [];
    }

    const sourceInfoMap = new Map<number, { name: string }>();
    sources.forEach(ds => {
      if (typeof ds.id === 'number' && typeof ds.name === 'string') {
        sourceInfoMap.set(ds.id, { name: ds.name });
      }
    });

    const resultsByAssetId = results.reduce((acc, result) => {
        const assetId = result.asset_id;
        if (!acc[assetId]) acc[assetId] = [];
        acc[assetId].push(result);
        return acc;
    }, {} as Record<number, ResultWithSourceInfo[]>);

    const filteredAssets = assets.filter(asset => {
        const assetResults = resultsByAssetId[asset.id] || [];
        if (assetResults.length === 0 && filters.length > 0) return false;
        return filters.every(filter => checkFilterMatch(filter, assetResults, schemas));
    });

    const enrichedRecords: EnrichedAssetRecord[] = filteredAssets.map(asset => {
        const sourceInfo = typeof asset.source_id === 'number'
            ? sourceInfoMap.get(asset.source_id)
            : null;
        const assetResults = resultsByAssetId[asset.id] || [];
        const resultsMap: Record<number, ResultWithSourceInfo> = {};
        assetResults.forEach(res => {
            resultsMap[res.schema_id] = res;
        });

        return {
            ...asset,
            sourceName: sourceInfo ? sourceInfo.name : 'Unknown Source',
            resultsMap: resultsMap,
        };
    });

    return enrichedRecords;

  }, [results, filters, schemas, assets, sources]);

  const columns = useMemo((): ColumnDef<EnrichedAssetRecord>[] => {
    const staticColumns: ColumnDef<EnrichedAssetRecord>[] = [
      {
        id: 'exclude',
        header: ({ table }) => (
            <TooltipProvider delayDuration={100}>
                <Tooltip>
                    <TooltipTrigger className="flex items-center justify-center w-full h-full cursor-help">
                        <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p className="text-xs">Exclude from Analysis</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={!!excludedRecordIds && excludedRecordIds.has(row.original.id)}
                onCheckedChange={() => onToggleRecordExclusion(row.original.id)}
                aria-label="Exclude this record from analysis"
                className="ml-1 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-700"
                onClick={(e) => e.stopPropagation()}
            />
        ),
        size: 40,
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'id',
        header: ({ column }) => (
          <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')} className="px-1">
            Asset ID
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="pl-1 w-[60px] truncate">
            <AssetLink assetId={row.original.id}>
              <div className="hover:underline cursor-pointer">{row.original.id}</div>
            </AssetLink>
          </div>
        ),
        size: 100,
      },
      {
        accessorKey: 'title',
        header: ({ column }) => (
          <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Title
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <AssetLink assetId={row.original.id}>
            <div className="font-medium max-w-[250px] truncate hover:underline cursor-pointer" title={row.original.title || 'No Title'}>
              {row.original.title || <span className="italic text-muted-foreground">No Title</span>}
            </div>
          </AssetLink>
        ),
        size: 250,
      },
      {
         accessorKey: 'sourceName',
         header: ({ column }) => (
           <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
             Source Name
             <ArrowUpDown className="ml-2 h-4 w-4" />
           </Button>
         ),
         cell: ({ row }) => <div className="font-medium">{row.getValue('sourceName')}</div>,
         size: 150,
       },
    ];

    const dynamicSchemaColumns: ColumnDef<EnrichedAssetRecord>[] = schemas.map(schema => ({
      id: `schema_${schema.id}`,
      header: ({ column }) => {
        const handleFieldToggle = (fieldKey: string) => {
          setSelectedFieldsPerScheme(prev => {
            const currentSelected = prev[schema.id] || [];
            const isSelected = currentSelected.includes(fieldKey);
            const newSelected = isSelected ? currentSelected.filter(key => key !== fieldKey) : [...currentSelected, fieldKey];
            const properties = (schema.output_contract as any)?.properties;
            const keys = properties ? Object.keys(properties) : [];
            if (newSelected.length === 0 && keys.length > 0) {
              return { ...prev, [schema.id]: [keys[0]] };
            }
            return { ...prev, [schema.id]: newSelected };
          });
        };
        const currentSelectedFields = selectedFieldsPerScheme[schema.id] || [];

        return (
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between">
               <span className="font-medium">{schema.name}</span>
               <Popover>
                 <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 ml-1 opacity-60 hover:opacity-100">
                      <Settings2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Configure Fields</span>
                    </Button>
                 </PopoverTrigger>
                 <PopoverContent className="w-56 p-0" align="start">
                    <div className="p-2 font-medium text-xs border-b">Show Fields:</div>
                    <ScrollArea className="max-h-60 p-1">
                      {Object.keys((schema.output_contract as any)?.properties || {}).map(fieldKey => (
                        <div key={fieldKey} className="flex items-center space-x-2 px-2 py-1.5 text-xs">
                           <Checkbox
                              id={`field-header-toggle-${schema.id}-${fieldKey}`}
                              checked={currentSelectedFields.includes(fieldKey)}
                              onCheckedChange={() => handleFieldToggle(fieldKey)}
                              disabled={currentSelectedFields.length === 1 && currentSelectedFields.includes(fieldKey)}
                           />
                           <Label
                              htmlFor={`field-header-toggle-${schema.id}-${fieldKey}`}
                              className={cn("font-normal cursor-pointer", (currentSelectedFields.length === 1 && currentSelectedFields.includes(fieldKey)) && "opacity-50 cursor-not-allowed")}
                           >
                              {fieldKey}
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

        if (!resultForThisCell) {
            return <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">N/A</div>;
        }

        const fieldKeysToShow = selectedFieldsPerScheme[schema.id] || [];
        const isFailed = resultForThisCell.status === 'failed';

        return (
          <div className={cn("relative h-full", isFailed && "border-l-2 border-destructive pl-1")}>
            {isFailed && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertCircle className="h-3.5 w-3.5 text-destructive absolute top-1 right-1 opacity-75 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end">
                    <p className="text-xs max-w-xs break-words">
                      Failed: {(resultForThisCell as any).error_message || 'Unknown error'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <AnnotationResultDisplay
              result={resultForThisCell as FormattedAnnotation}
              schema={schema}
              compact={false}
              selectedFieldKeys={fieldKeysToShow}
              maxFieldsToShow={undefined}
              renderContext="default"
            />
          </div>
        );
      },
    }));

    const staticEndColumns: ColumnDef<EnrichedAssetRecord>[] = [
        {
           accessorKey: 'resultsMap',
           header: 'Timestamp',
           size: 120,
           cell: ({ row }) => {
             const firstResult = Object.values(row.original.resultsMap)[0];
             const timestamp = firstResult?.created_at;
             return <div className="text-xs w-[100px] truncate">{timestamp ? new Date(timestamp).toLocaleString() : 'N/A'}</div>;
           },
        },
        {
          id: 'actions',
          size: 50,
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
                  {(onResultSelect || onResultAction || onResultDelete) && <DropdownMenuSeparator />}
                   {onRetrySingleResult && firstResult.status === 'failed' && (
                     <DropdownMenuItem
                       onClick={(e) => {
                         e.stopPropagation();
                         if (firstResult && typeof firstResult.id === 'number') {
                             onRetrySingleResult(firstResult.id);
                         }
                       }}
                       disabled={isCurrentlyRetryingThis}
                       className="text-orange-600 hover:text-orange-700 focus:bg-orange-100 focus:text-orange-800"
                     >
                       <RefreshCw className="mr-2 h-4 w-4" /> Retry Annotation
                     </DropdownMenuItem>
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
        },
    ];

    return [
        ...staticColumns,
        ...dynamicSchemaColumns,
        ...staticEndColumns
    ];
  }, [
      schemas, 
      selectedFieldsPerScheme, 
      onResultSelect, 
      onResultAction, 
      onResultDelete, 
      onRetrySingleResult, 
      retryingResultId,
      excludedRecordIds,
      onToggleRecordExclusion
  ]);
  
  const table = useReactTable<EnrichedAssetRecord>({ 
    data: tableData,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination, 
      globalFilter,
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (record) => record.id.toString(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
  });

  return (
    <div className="w-full">
      <div className="flex items-center py-3">
         <div className="relative w-full max-w-sm">
           <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
           <Input
             placeholder="Search assets (ID, Title...)"
             value={globalFilter ?? ''}
             onChange={(event) => setGlobalFilter(event.target.value)}
             className="pl-9 h-9"
           />
         </div>
      </div>
      <div className="rounded-md border">
        <div className="overflow-x-auto"> 
          <ScrollArea className="max-h-full"> 
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm whitespace-nowrap">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap" style={{ width: header.getSize() !== 150 ? `${header.getSize()}px` : undefined }}>
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
                      className={cn("cursor-pointer hover:bg-muted/30 transition-opacity", !!excludedRecordIds && excludedRecordIds.has(row.original.id) && "opacity-50 bg-muted/10 hover:bg-muted/20")}
                      onClick={() => {
                        const firstResult = Object.values(row.original.resultsMap)[0];
                        if (firstResult && onResultSelect) {
                           onResultSelect(firstResult);
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} style={{ width: cell.column.getSize() !== 150 ? `${cell.column.getSize()}px` : undefined }} className="h-full align-top">
                          <div className="h-full flex flex-col">
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
          </ScrollArea>
        </div>
      </div>
      <div className="flex items-center justify-between space-x-2 py-4 flex-wrap gap-y-2">
         <div className="flex items-center space-x-2">
           <p className="text-sm font-medium text-muted-foreground whitespace-nowrap">Rows per page</p>
           <Select
             value={`${table.getState().pagination.pageSize}`}
             onValueChange={(value) => { table.setPageSize(Number(value)) }}
           >
             <SelectTrigger className="h-8 w-[70px] text-xs">
               <SelectValue placeholder={table.getState().pagination.pageSize} />
             </SelectTrigger>
             <SelectContent side="top">
               {[10, 25, 50, 100].map((pageSize) => (
                 <SelectItem key={pageSize} value={`${pageSize}`} className="text-xs">
                   {pageSize}
                 </SelectItem>
               ))}
             </SelectContent>
           </Select>
         </div>
        <div className="flex-1 text-sm text-muted-foreground text-center">
          {table.getFilteredRowModel().rows.length} Asset(s) matching filters.
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}.
        </div>
        <div className="flex items-center space-x-2">
           <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
             <span className="sr-only">Go to first page</span>
             <ChevronsLeft className="h-4 w-4" />
           </Button>
           <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </Button>
           <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
             Next
           </Button>
           <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
             <span className="sr-only">Go to last page</span>
             <ChevronsRight className="h-4 w-4" />
           </Button>
         </div>
      </div>
    </div>
  );
}

export default AnnotationResultsTable; 