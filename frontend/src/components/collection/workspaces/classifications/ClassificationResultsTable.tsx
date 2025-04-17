'use client';

import React, { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  createColumnHelper,
  ColumnDef,
  Row,
  getSortedRowModel,
  SortingState
} from '@tanstack/react-table';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClassificationSchemeRead, DocumentRead } from '@/client';
import { FormattedClassificationResult } from '@/lib/classification/types';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import DocumentLink from '../documents/DocumentLink';
import { resultToResultRead } from '@/lib/classification/adapters';
import { ResultFilter } from './ClassificationResultFilters'; // Import ResultFilter if needed for direct filtering
import { checkFilterMatch, getTargetKeysForScheme } from '@/lib/classification/utils'; // Import filter logic & helper
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from '@/components/ui/button'; // Import Button
import { ArrowUpDown } from 'lucide-react'; // Import sorting icon
import { getTargetFieldDefinition } from './ClassificationResultFilters'; // Import helper

// Extend TableMeta type if needed for onRowClick
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends unknown> {
    onRowClick?: (row: any) => void;
  }
}

// Define the structure for a row in the table
type DocumentRow = {
  document: DocumentRead | undefined;
  results: FormattedClassificationResult[];
};

interface ClassificationResultsTableProps {
  results: FormattedClassificationResult[];
  schemes: ClassificationSchemeRead[];
  documents: DocumentRead[];
  filters: ResultFilter[]; // Pass filters down
  onRowClick: (documentId: number) => void;
}

const ClassificationResultsTable: React.FC<ClassificationResultsTableProps> = ({
  results,
  schemes,
  documents,
  filters,
  onRowClick,
}) => {

  // --- State for managing displayed field per scheme column ---
  const [displayFieldKeys, setDisplayFieldKeys] = useState<Map<number, string | null>>(() => {
    // Initialize with the first field key for each scheme
    const initialMap = new Map<number, string | null>();
    schemes.forEach(scheme => {
      const keys = getTargetKeysForScheme(scheme.id, schemes);
      initialMap.set(scheme.id, keys.length > 0 ? keys[0].key : null);
    });
    return initialMap;
  });

  // --- State for sorting ---
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // --- Table Setup ---
  const columnHelper = createColumnHelper<DocumentRow | null>(); // Allow null for filtered out rows

  // Define a sorting function for numerical fields that handles nulls
  const numericSortingFn = (rowA: Row<DocumentRow | null>, rowB: Row<DocumentRow | null>, columnId: string): number => {
    const schemeId = parseInt(columnId.replace('scheme-', ''), 10);
    const fieldKey = displayFieldKeys.get(schemeId);

    const getValue = (row: Row<DocumentRow | null>): number | null => {
      const result = row.original?.results?.find(r => r.scheme_id === schemeId);
      if (!result || !fieldKey) return null;

      let rawValue: any;
      if (typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)) {
        rawValue = result.value[fieldKey];
      } else if (fieldKey === schemes.find(s => s.id === schemeId)?.fields[0]?.name) {
        rawValue = result.value; // Simple value assumption
      } else {
        rawValue = null;
      }

      const num = Number(rawValue);
      return isNaN(num) ? null : num;
    };

    const valueA = getValue(rowA);
    const valueB = getValue(rowB);

    // Handle nulls: place them at the beginning or end depending on sort order?
    // Simple approach: nulls are treated as less than numbers
    if (valueA === null && valueB === null) return 0;
    if (valueA === null) return -1; // A is less than B
    if (valueB === null) return 1;  // A is greater than B

    return valueA - valueB;
  };

  // Define table columns dynamically based on runSchemes
  const tableColumns = useMemo(() => {
    const baseColumns: ColumnDef<DocumentRow | null, any>[] = [
      columnHelper.accessor('document', {
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
              className="h-auto justify-start p-0 hover:bg-transparent"
            >
              Document
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          )
        },
        cell: info => {
          const doc = info.getValue();
          return doc ? (
             <div className="font-medium">
                 <DocumentLink documentId={doc.id}>{doc.title || `ID: ${doc.id}`}</DocumentLink>
             </div>
          ) : 'N/A';
        },
        enableSorting: true,
      }),
      // Add other potential non-scheme columns here (e.g., date)
    ];

    // Add a column for each scheme present in the current run
    const schemeColumns = schemes.map(scheme =>
      columnHelper.accessor(
        (row: DocumentRow | null): FormattedClassificationResult | null => {
          return row?.results?.find(r => r.scheme_id === scheme.id) || null;
        },
        {
          id: `scheme-${scheme.id}`,
          header: ({ column }) => {
            const targetKeys = getTargetKeysForScheme(scheme.id, schemes);
            const currentFieldKey = displayFieldKeys.get(scheme.id) ?? (targetKeys.length > 0 ? targetKeys[0].key : null);

            // Check if sorting is enabled for this column based on selected field type
            const { type: fieldType } = currentFieldKey
              ? getTargetFieldDefinition({ schemeId: scheme.id, fieldKey: currentFieldKey, operator: 'equals', value: '', isActive: true }, schemes)
              : { type: null };
            const isSortable = fieldType === 'int' || fieldType === 'float';

            return (
                <div className="flex flex-col space-y-1">
                    {/* Wrap scheme name in button if sortable */}
                    {isSortable ? (
                        <Button
                            variant="ghost"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="-ml-3 h-auto justify-start p-0 hover:bg-transparent"
                        >
                            <span className="font-medium text-left">{scheme.name}</span>
                            <ArrowUpDown className="ml-2 h-3 w-3" />
                        </Button>
                    ) : (
                        <span className="font-medium text-left">{scheme.name}</span>
                    )}
                    {/* Only show selector if more than one field/key option */}
                    {targetKeys.length > 1 && (
                        <Select
                            value={currentFieldKey ?? ''}
                            onValueChange={(value) => {
                                setDisplayFieldKeys(prev => new Map(prev).set(scheme.id, value || null));
                            }}
                        >
                            <SelectTrigger className="h-7 text-xs w-[150px]">
                                <SelectValue placeholder="Select field..." />
                            </SelectTrigger>
                            <SelectContent>
                                {targetKeys.map(tk => (
                                    <SelectItem key={tk.key} value={tk.key}>
                                        {tk.name} ({tk.type})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    {/* Show single field name if only one option */}
                    {targetKeys.length === 1 && (
                        <span className="text-xs text-muted-foreground">({targetKeys[0].name})</span>
                    )}
                </div>
            );
          },
          cell: info => {
            const result: FormattedClassificationResult | null = info.getValue();
            if (!result) return <span className="text-gray-400 italic">N/A</span>;

            // Get the selected field key for this column
            const selectedFieldKey = displayFieldKeys.get(scheme.id) ?? null;

            // Render using ClassificationResultDisplay in compact mode
            return (
              <ClassificationResultDisplay
                result={resultToResultRead(result)}
                scheme={scheme}
                compact={true}
                renderContext="table"
                targetFieldKey={selectedFieldKey}
              />
            );
          },
          enableSorting: (() => {
            const currentFieldKey = displayFieldKeys.get(scheme.id) ?? getTargetKeysForScheme(scheme.id, schemes)[0]?.key;
            const { type: fieldType } = currentFieldKey
                ? getTargetFieldDefinition({ schemeId: scheme.id, fieldKey: currentFieldKey, operator: 'equals', value: '', isActive: true }, schemes)
                : { type: null };
            return fieldType === 'int' || fieldType === 'float';
          })(),
          sortingFn: (() => {
            const currentFieldKey = displayFieldKeys.get(scheme.id) ?? getTargetKeysForScheme(scheme.id, schemes)[0]?.key;
            const { type: fieldType } = currentFieldKey
                ? getTargetFieldDefinition({ schemeId: scheme.id, fieldKey: currentFieldKey, operator: 'equals', value: '', isActive: true }, schemes)
                : { type: null };
            return (fieldType === 'int' || fieldType === 'float') ? numericSortingFn : undefined;
          })(),
        }
      )
    );

    return [...baseColumns, ...schemeColumns];
  }, [schemes, columnHelper, displayFieldKeys]); // Updated dependencies

  // Prepare data for the table, applying filters
  const tableData = useMemo((): (DocumentRow | null)[] => {
    // Group results by document ID first
    const resultsByDoc = results.reduce((acc, result) => {
      if (!acc[result.document_id]) {
        acc[result.document_id] = [];
      }
      acc[result.document_id].push(result);
      return acc;
    }, {} as Record<number, FormattedClassificationResult[]>);

    let docIdsToProcess = documents.map(doc => doc.id);

    // Apply filters if any are active
    if (filters.length > 0) {
      docIdsToProcess = docIdsToProcess.filter(docId => {
        const docResults = resultsByDoc[docId] || [];
        // Document matches if it satisfies ALL active filters
        return filters.every(filter => checkFilterMatch(filter, docResults, schemes)); // Pass all schemes for definitions
      });
    }

    // Create rows for the documents that passed the filters
    const docsById = new Map(documents.map(doc => [doc.id, doc]));
    const rows = docIdsToProcess.map(docId => {
      const doc = docsById.get(docId);
      if (!doc) return null; // Should not happen if documents are consistent
      return {
        document: doc,
        results: resultsByDoc[docId] || [], // Get results for this doc
      };
    });

    console.log("[TableData] Final table rows after filters:", rows.length);
    return rows.filter(row => row !== null); // Ensure no null rows are passed

  }, [results, documents, schemes, filters]); // Add schemes and filters to dependency array


  // Instantiate the table
  const table = useReactTable({
    data: tableData as DocumentRow[], // Cast because we filtered nulls
    columns: tableColumns as ColumnDef<DocumentRow, any>[],
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(), // Enable sorting model
    onSortingChange: setSorting, // Set state when sorting changes
    state: {
      sorting, // Pass sorting state to table
    },
    // Add meta for row click handler
    meta: {
        onRowClick: (row: Row<DocumentRow>) => {
            const docId = row.original.document?.id;
            if (docId) {
                onRowClick(docId); // Call the passed-in handler
            }
        },
    },
  });

  // --- Render Logic ---
  if (tableData.length === 0) {
    return (
      <div className="text-center p-8 border rounded-lg text-muted-foreground">
        No results match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="w-full text-sm">
        <TableHeader className="sticky top-0 bg-card z-10 border-b">
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <TableHead key={header.id} className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map(row => (
            <TableRow
              key={row.id}
              className="hover:bg-muted/50 cursor-pointer border-b"
              onClick={() => table.options.meta?.onRowClick?.(row)}
            >
              {row.getVisibleCells().map(cell => (
                <TableCell key={cell.id} className="p-1 align-top max-w-[300px]"> {/* Limit width */}
                   <ScrollArea className="max-h-24 whitespace-normal"> {/* Allow wrap, adjust height */}
                     {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </ScrollArea>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default ClassificationResultsTable; 