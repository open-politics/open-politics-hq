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
import { EnhancedClassificationResultRead, ClassificationSchemeRead, ClassificationResultRead, DataSourceRead, DataRecordRead } from '@/client';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import DocumentLink from '../documents/DocumentLink';
import { adaptEnhancedResultReadToFormattedResult } from '@/lib/classification/adapters';
import { ResultFilter } from './ClassificationResultFilters';
import { checkFilterMatch, getTargetKeysForScheme } from '@/lib/classification/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ChevronDown, MoreHorizontal, ExternalLink, Eye, Trash2, Filter, X, ChevronRight, ChevronsLeft, ChevronsRight, Settings2 } from 'lucide-react';
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
import { DataTable } from "@/components/collection/workspaces/tables/data-table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Extend TableMeta type if needed for onRowClick
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends unknown> {
    onRowClick?: (row: any) => void;
    onRowAction?: (action: string, rowData: TData) => void;
    onRowDelete?: (rowData: TData) => void;
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
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10, // Default page size
  });
  const { activeWorkspace } = useWorkspaceStore();
  const { loadSchemes } = useClassificationSystem();

  // State for selected fields per scheme (Keep this)
  const [selectedFieldsPerScheme, setSelectedFieldsPerScheme] = useState<Record<number, string[]>>(() => {
    const initialState: Record<number, string[]> = {};
    schemes.forEach(scheme => {
      initialState[scheme.id] = scheme.fields.map(f => f.name);
    });
    return initialState;
  });

  // Effect to update state if schemes prop changes (Keep this)
  useEffect(() => {
    setSelectedFieldsPerScheme(prev => {
      const newState: Record<number, string[]> = {};
      schemes.forEach(scheme => {
        newState[scheme.id] = prev[scheme.id] ?? scheme.fields.map(f => f.name);
      });
      return newState;
    });
  }, [schemes]);

  useEffect(() => {
    if (activeWorkspace && schemes.length === 0) {
      loadSchemes();
    }
  }, [activeWorkspace, schemes.length, loadSchemes]);

  // Define EnrichedDataRecord type (Keep this)
  type EnrichedDataRecord = DataRecordRead & {
    dataSourceName: string | null;
    resultsMap: Record<number, ResultWithSourceInfo>; // Map scheme_id to result
    title?: string | null;
  };

  // *** USE FLAT Data Preparation Logic ***
  const tableData = useMemo((): EnrichedDataRecord[] => {
    if (!dataRecords || !results) {
      console.warn("ClassificationResultsTable: dataRecords or results prop is missing.");
      return [];
    }

    // 1. Create lookup maps
    const sourceInfoMap = new Map<number, { name: string }>();
    dataSources.forEach(ds => {
      if (typeof ds.id === 'number' && typeof ds.name === 'string') {
        sourceInfoMap.set(ds.id, { name: ds.name });
      }
    });

    const resultsByRecordId = results.reduce((acc, result) => {
        const recordId = result.datarecord_id;
        if (!acc[recordId]) acc[recordId] = [];
        acc[recordId].push(result);
        return acc;
    }, {} as Record<number, ResultWithSourceInfo[]>);

    // 2. Filter DataRecords based on global filters
    const filteredDataRecords = dataRecords.filter(record => {
        const recordResults = resultsByRecordId[record.id] || [];
        if (recordResults.length === 0 && filters.length > 0) return false;
        return filters.every(filter => checkFilterMatch(filter, recordResults, schemes));
    });

    // 3. Enrich filtered DataRecords
    const enrichedRecords: EnrichedDataRecord[] = filteredDataRecords.map(record => {
        const sourceInfo = typeof record.datasource_id === 'number'
            ? sourceInfoMap.get(record.datasource_id)
            : null;
        const recordResults = resultsByRecordId[record.id] || [];
        const resultsMap: Record<number, ResultWithSourceInfo> = {};
        recordResults.forEach(res => {
            resultsMap[res.scheme_id] = res;
        });

        return {
            ...record,
            dataSourceName: sourceInfo ? sourceInfo.name : 'Unknown Source',
            resultsMap: resultsMap,
            title: record.title,
        };
    });

    console.log("Final FLAT tableData array:", enrichedRecords);
    return enrichedRecords;

  }, [results, filters, schemes, dataRecords, dataSources]);
  // *** END FLAT Data Preparation Logic ***


  // *** FLAT COLUMNS Definition ***
  const columns = useMemo((): ColumnDef<EnrichedDataRecord>[] => {
    // Static columns first
    const staticColumns: ColumnDef<EnrichedDataRecord>[] = [
      {
        accessorKey: 'id',
        header: 'Record ID',
        size: 80,
        cell: ({ row }) => (
          <div className="pl-1 w-[60px] truncate">
            <DocumentLink documentId={row.original.id}>
              <div className="hover:underline cursor-pointer">{row.original.id}</div>
            </DocumentLink>
          </div>
        ),
      },
      {
        accessorKey: 'title',
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Title
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div 
            className="font-medium max-w-[250px] truncate" 
            title={row.original.title || 'No Title'}
          >
            {row.original.title || <span className="italic text-muted-foreground">No Title</span>}
          </div>
        ),
        size: 250,
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
         size: 150,
       },
    ];

    // Dynamically generate columns for each scheme
    const dynamicSchemeColumns: ColumnDef<EnrichedDataRecord>[] = schemes.map(scheme => ({
      id: `scheme_${scheme.id}`,
      header: ({ column }) => {
        // Header logic remains the same - controls fields for this scheme
        const handleFieldToggle = (fieldKey: string) => {
          setSelectedFieldsPerScheme(prev => {
            const currentSelected = prev[scheme.id] || [];
            const isSelected = currentSelected.includes(fieldKey);
            const newSelected = isSelected
              ? currentSelected.filter(key => key !== fieldKey)
              : [...currentSelected, fieldKey];
            if (newSelected.length === 0 && scheme.fields.length > 0) {
              // Ensure at least one field is always selected
              return { ...prev, [scheme.id]: [scheme.fields[0].name] };
            }
            return { ...prev, [scheme.id]: newSelected };
          });
        };
        const currentSelectedFields = selectedFieldsPerScheme[scheme.id] || [];

        return (
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between">
               <span className="font-medium">{scheme.name}</span>
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
                      {scheme.fields.map(field => (
                        <div key={field.name} className="flex items-center space-x-2 px-2 py-1.5 text-xs">
                           <Checkbox
                              id={`field-header-toggle-${scheme.id}-${field.name}`}
                              checked={currentSelectedFields.includes(field.name)}
                              onCheckedChange={() => handleFieldToggle(field.name)}
                              disabled={currentSelectedFields.length === 1 && currentSelectedFields.includes(field.name)}
                           />
                           <Label
                              htmlFor={`field-header-toggle-${scheme.id}-${field.name}`}
                              className={cn(
                                  "font-normal cursor-pointer",
                                  (currentSelectedFields.length === 1 && currentSelectedFields.includes(field.name)) && "opacity-50 cursor-not-allowed"
                              )}
                           >
                              {field.name}
                           </Label>
                        </div>
                      ))}
                    </ScrollArea>
                 </PopoverContent>
               </Popover>
            </div>
            {/* <div className=" my-1 flex flex-col items-start p-1">
               {currentSelectedFields.map(fieldName => (
                  <span key={fieldName} className="truncate max-w-[100px]" title={fieldName}> - {fieldName}</span>
               ))}
            </div> */}
          </div>
        );
      },
      cell: ({ row }) => {
        // Get the result for this specific record (row) and this specific scheme (column)
        const resultForThisCell = row.original.resultsMap[scheme.id]; // Use the resultsMap

        if (!resultForThisCell) {
            return <div className="text-muted-foreground/50 italic text-xs h-full flex items-center justify-center">N/A</div>;
        }

        const fieldKeysToShow = selectedFieldsPerScheme[scheme.id] || []; // Get keys for THIS scheme

        return (
          <ClassificationResultDisplay
            result={resultForThisCell as unknown as ClassificationResultRead}
            scheme={scheme} // Pass the scheme for this column
            compact={false}
            selectedFieldKeys={fieldKeysToShow}
            maxFieldsToShow={undefined}
            renderContext="default"
          />
        );
      },
    }));

    // Static columns at the end
    const staticEndColumns: ColumnDef<EnrichedDataRecord>[] = [
        {
           accessorKey: 'resultsMap', // Base accessor, specific logic in cell
           header: 'Timestamp',
           size: 120,
           cell: ({ row }) => {
             // Find the timestamp from the *first available* result for this record
             const firstResult = Object.values(row.original.resultsMap)[0];
             const timestamp = firstResult?.timestamp;
             return <div className="text-xs w-[100px] truncate">{timestamp ? new Date(timestamp).toLocaleString() : 'N/A'}</div>;
           },
        },
        {
          id: 'actions',
          size: 50,
          cell: ({ row }) => {
             const firstResult = Object.values(row.original.resultsMap)[0]; // Get first result for context
             if (!firstResult) return null; // No actions if no results for this record
             // Pass the EnrichedDataRecord if needed, or just the first result?
             // Let's assume actions operate on the first result contextually.
             const resultContext = firstResult; 

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
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultSelect(resultContext); }}>
                      <Eye className="mr-2 h-4 w-4" /> View Details
                    </DropdownMenuItem>
                  )}
                  {onResultAction && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultAction('load_in_runner', resultContext); }}>
                       <ExternalLink className="mr-2 h-4 w-4" /> Load Job in Runner
                    </DropdownMenuItem>
                  )}
                  {(onResultSelect || onResultAction) && <DropdownMenuSeparator />} 
                  {onResultDelete && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onResultDelete(resultContext.id); }} className="text-red-600 hover:text-red-700">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Result
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
               </DropdownMenu>
             );
          },
        },
    ];

    // Combine all columns
    return [
        ...staticColumns,
        ...dynamicSchemeColumns,
        ...staticEndColumns
    ];
  // Dependencies for column generation
  }, [schemes, selectedFieldsPerScheme, onResultSelect, onResultAction, onResultDelete]); // Removed 'results' as cell now uses row.original.resultsMap
  // *** END FLAT COLUMNS Definition ***


  // --- Main Table Instance --- (Use EnrichedDataRecord, no expander)
  const table = useReactTable<EnrichedDataRecord>({ 
    data: tableData, // Use flat enriched data
    columns, // Use dynamically generated flat columns
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination, 
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (record) => record.id.toString(), // Use record ID
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
  });

  return (
    <div className="w-full">
      <div className="rounded-md">
        <div className="overflow-x-auto"> 
          <ScrollArea className="max-h-full"> 
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm whitespace-nowrap">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap" style={{ width: header.getSize() !== 150 ? `${header.getSize()}px` : undefined }}>
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
                    // *** RENDER SIMPLE ROW - NO EXPANSION ***
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className="cursor-pointer hover:bg-muted/30"
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
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                    // *** END SIMPLE ROW ***
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
      </div>
      {/* Pagination Footer (Keep using Record count) */}
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="flex-1 text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} Record(s).
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