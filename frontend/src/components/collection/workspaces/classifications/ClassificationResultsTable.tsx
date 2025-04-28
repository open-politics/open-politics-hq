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
  PaginationState
} from '@tanstack/react-table';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EnhancedClassificationResultRead, ClassificationSchemeRead, ClassificationResultRead, DataSourceRead, DataRecordRead } from '@/client';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import DocumentLink from '../documents/DocumentLink';
import { adaptEnhancedResultReadToFormattedResult } from '@/lib/classification/adapters';
import { ResultFilter } from './ClassificationResultFilters';
import { checkFilterMatch, getTargetKeysForScheme } from '@/lib/classification/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ChevronDown, MoreHorizontal, ExternalLink, Eye, Trash2, Filter, X, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { getTargetFieldDefinition } from './ClassificationResultFilters';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
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

// Extend TableMeta type if needed for onRowClick
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends unknown> {
    onRowClick?: (row: any) => void;
  }
}

// Define the structure for a row in the table
type DocumentRow = {
  document: EnhancedClassificationResultRead | undefined;
  results: EnhancedClassificationResultRead[];
};

// Helper Interface for grouped data
interface DataSourceGroup {
  dataSourceId: number;
  dataSourceName: string;
  results: ResultWithSourceInfo[]; // Use the potentially enriched type
}

// Interface for results potentially enriched with DataSource info
interface ResultWithSourceInfo extends EnhancedClassificationResultRead {
  datasource_name?: string; 
  datasource_id?: number; // Added datasource_id here explicitly
}

interface ClassificationResultsTableProps {
  results: ResultWithSourceInfo[];
  schemes: ClassificationSchemeRead[];
  dataSources: DataSourceRead[];
  dataRecords: DataRecordRead[]; // Add dataRecords prop
  filters?: ResultFilter[];
  isLoading?: boolean;
  onResultSelect?: (result: ResultWithSourceInfo) => void;
  onResultDelete?: (resultId: number) => void;
  onResultAction?: (action: string, result: ResultWithSourceInfo) => void;
}

export function ClassificationResultsTable({
  results,
  schemes,
  dataSources,
  dataRecords, // Destructure prop
  filters = [],
  isLoading = false,
  onResultSelect,
  onResultDelete,
  onResultAction,
}: ClassificationResultsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState({});
  const [rowSelection, setRowSelection] = useState({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10, // Default page size
  });
  const { activeWorkspace } = useWorkspaceStore();
  const { loadSchemes } = useClassificationSystem();

  useEffect(() => {
    if (activeWorkspace && schemes.length === 0) {
      loadSchemes();
    }
  }, [activeWorkspace, schemes.length, loadSchemes]);

  const groupedData = useMemo(() => {
    // --- FIX: Add check for dataRecords ---
    if (!dataRecords) {
      console.warn("ClassificationResultsTable: dataRecords prop is missing or undefined.");
      return []; // Return empty array if dataRecords are missing
    }
    // --- END FIX ---

    // 1. Filter results based on global filters first
    const resultsByDataRecord = results.reduce((acc, result) => {
        const key = result.datarecord_id;
        if (!acc[key]) acc[key] = [];
        acc[key].push(result);
        return acc;
    }, {} as Record<number, ResultWithSourceInfo[]>);

    const filteredDataRecordIds = Object.keys(resultsByDataRecord).filter(datarecordId => {
        const recordResults = resultsByDataRecord[Number(datarecordId)];
        // Pass schemes directly to checkFilterMatch
        return filters.every(filter => checkFilterMatch(filter, recordResults, schemes)); 
    }).map(Number);

    const filteredResults = results.filter(result => filteredDataRecordIds.includes(result.datarecord_id));

    // 2. Create lookup maps
    const recordToSourceMap = new Map<number, number>();
    (dataRecords || []).forEach(rec => { 
      // Ensure rec.id and rec.datasource_id are numbers before setting
      if (typeof rec.id === 'number' && typeof rec.datasource_id === 'number') {
        recordToSourceMap.set(rec.id, rec.datasource_id);
      } else {
        console.warn('Skipping data record due to missing id or datasource_id:', rec);
      }
    });

    const sourceInfoMap = new Map<number, { name: string }>();
    dataSources.forEach(ds => {
      // Ensure ds.id is a number and ds.name is a string before setting
      if (typeof ds.id === 'number' && typeof ds.name === 'string') {
        sourceInfoMap.set(ds.id, { name: ds.name });
      } else {
        console.warn('Skipping data source due to missing id or name:', ds);
      }
    });

    // 3. Group the filtered results by DataSource
    const groups: Record<number, DataSourceGroup> = {};
    filteredResults.forEach(result => {
      const datasourceId = recordToSourceMap.get(result.datarecord_id);
      if (datasourceId !== undefined) {
        const sourceInfo = sourceInfoMap.get(datasourceId);
        if (sourceInfo) {
          if (!groups[datasourceId]) {
            groups[datasourceId] = {
              dataSourceId: datasourceId,
              dataSourceName: sourceInfo.name,
              results: [],
            };
          }
          // Enrich result with datasource info if not already present
          const enrichedResult = {
            ...result,
            datasource_id: datasourceId,
            datasource_name: sourceInfo.name
          };
          groups[datasourceId].results.push(enrichedResult);
        }
      }
    });

    return Object.values(groups);
  }, [results, filters, schemes, dataRecords, dataSources]);

  // Effect to expand first 5 rows when data changes
  useEffect(() => {
    if (groupedData.length > 0) {
      const initialExpandedState: ExpandedState = {};
      groupedData.slice(0, 5).forEach((_, index) => {
        initialExpandedState[index] = true; // Expand rows by their index in the initial data
      });
      setExpanded(initialExpandedState);
    }
  }, [groupedData]); // Re-run when grouped data is recalculated

  const columns: ColumnDef<DataSourceGroup>[] = [
    {
      id: 'expander',
      header: () => null, // No header for expander
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={row.getToggleExpandedHandler()}
          disabled={!row.getCanExpand()}
          className="w-6 h-6 p-0"
        >
          {row.getIsExpanded() ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      ),
    },
    {
      accessorKey: 'dataSourceName',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Source Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => <div className="font-medium">{row.getValue('dataSourceName')}</div>,
    },
    {
      id: 'resultCount',
      header: 'Results Count',
      cell: ({ row }) => row.original.results.length,
    },
    // Add more columns for aggregated data if needed
  ];

  // --- Sub-component columns (for expanded rows) ---
  const subColumns: ColumnDef<ResultWithSourceInfo>[] = [
    // Indent cell for visual hierarchy
    {
      id: 'recordLink',
      header: 'Record ID',
      cell: ({ row }) => (
        <div className="pl-4"> {/* Indentation */}
          <DocumentLink documentId={row.original.datarecord_id}>
            <div className="hover:underline cursor-pointer">{row.original.datarecord_id}</div>
          </DocumentLink>
        </div>
      ),
    },
    {
      accessorKey: 'scheme_id',
      header: 'Scheme',
      cell: ({ row }) => {
        const scheme = schemes.find(s => s.id === row.original.scheme_id);
        return scheme?.name || `Scheme ${row.original.scheme_id}`;
      },
    },
    {
      accessorKey: 'value',
      header: 'Value',
      cell: ({ row }) => {
        const result = row.original;
        const scheme = schemes.find(s => s.id === result.scheme_id);
        return scheme ? (
          <ClassificationResultDisplay
            result={result as unknown as ClassificationResultRead} // Cast if necessary
            scheme={scheme}
            compact={true}
          />
        ) : <div className="text-muted-foreground">Scheme N/A</div>;
      },
    },
    {
      accessorKey: 'timestamp',
      header: 'Timestamp',
      cell: ({ row }) => {
        const timestamp = row.original.timestamp;
        return <div className="text-xs">{timestamp ? new Date(timestamp).toLocaleString() : 'N/A'}</div>;
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
         const result = row.original;
         return (
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {onResultSelect && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultSelect(result); }}>
                  <Eye className="mr-2 h-4 w-4" /> View Details
                </DropdownMenuItem>
              )}
              {onResultAction && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultAction('load_in_runner', result); }}> 
                   <ExternalLink className="mr-2 h-4 w-4" /> Load Job in Runner
                </DropdownMenuItem>
              )}
              {(onResultSelect || onResultAction) && <DropdownMenuSeparator />} 
              {onResultDelete && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultDelete(result.id); }} className="text-red-600 hover:text-red-700">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete Result
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
           </DropdownMenu>
         );
      },
    },
  ];

  // --- Sub Component Renderer ---
  const renderSubComponent = ({ row }: { row: Row<DataSourceGroup> }) => {
    // Minimal mock row context needed for cell rendering
    const getRowContext = (originalData: ResultWithSourceInfo) => ({
      original: originalData,
      // Add other minimal row properties if truly required by a specific cell renderer
    });

    return (
      <div className="px-4 py-2 bg-muted/50">
        <Table>
          <TableHeader>
            <TableRow>
              {subColumns.map((column) => (
                <TableHead key={column.id} className="text-xs">
                  {typeof column.header === 'function' 
                    ? flexRender(column.header, { column: column as Column<ResultWithSourceInfo, unknown> } as HeaderContext<ResultWithSourceInfo, unknown>) // Pass column, cast context
                    : column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.original.results.map((result, index) => (
              <TableRow key={result.id || `subrow-${index}`} className="hover:bg-muted/80">
                {subColumns.map((column) => {
                  const cellKey = `${result.id || index}-${column.id}`; 
                  const accessorKey = (column as any).accessorKey;
                  const value = accessorKey ? (result[accessorKey as keyof ResultWithSourceInfo] ?? null) : null;

                  // FIX: Provide a simplified context focusing on what cell renderers likely use
                  const cellContext = {
                    row: getRowContext(result), // Use minimal row context
                    getValue: () => value,      // Provide the cell value
                    column: column,            // Provide the column definition
                    table: table,              // Provide the main table instance
                  } as unknown as CellContext<ResultWithSourceInfo, unknown>; // Cast to satisfy flexRender

                  return (
                    <TableCell key={cellKey} className="text-xs py-1">
                      {flexRender(column.cell!, cellContext)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const table = useReactTable({
    data: groupedData,
    columns,
    state: {
      sorting,
      pagination,
      columnFilters,
      columnVisibility,
      rowSelection,
      expanded,
    },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  });

  return (
    <div className="w-full">
      <div className="rounded-md">
        <ScrollArea>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="whitespace-nowrap">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsSelected() && "selected"}
                      onClick={() => row.toggleExpanded()}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                    {row.getIsExpanded() && (
                      <TableRow>
                        <TableCell colSpan={row.getVisibleCells().length}>
                          {renderSubComponent({ row })}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    {isLoading ? "Loading results..." : "No results found."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="flex-1 text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} Source Group(s).
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}.
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
             Previous
           </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ClassificationResultsTable; 