'use client';

import React, { useMemo } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  createColumnHelper,
  ColumnDef,
  Row
} from '@tanstack/react-table';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClassificationSchemeRead, DocumentRead } from '@/client';
import { FormattedClassificationResult } from '@/lib/classification/types';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import DocumentLink from '../documents/DocumentLink';
import { resultToResultRead } from '@/lib/classification/adapters';
import { ResultFilter } from './ClassificationResultFilters'; // Import ResultFilter if needed for direct filtering
import { checkFilterMatch } from '@/lib/classification/utils'; // Import filter logic

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

  // --- Table Setup ---
  const columnHelper = createColumnHelper<DocumentRow | null>(); // Allow null for filtered out rows

  // Define table columns dynamically based on runSchemes
  const tableColumns = useMemo(() => {
    const baseColumns: ColumnDef<DocumentRow | null, any>[] = [
      columnHelper.accessor('document', {
        header: 'Document',
        cell: info => {
          const doc = info.getValue();
          return doc ? (
             <div className="font-medium">
                 <DocumentLink documentId={doc.id}>{doc.title || `ID: ${doc.id}`}</DocumentLink>
             </div>
          ) : 'N/A';
        },
        enableSorting: false,
      }),
      // Add other potential non-scheme columns here (e.g., date)
    ];

    // Add a column for each scheme present in the current run
    const schemeColumns = schemes.map(scheme =>
      columnHelper.accessor(
        row => {
          // Find the result for this specific scheme and document
          const result = row?.results?.find(r => r.scheme_id === scheme.id);
          return result || null; // Return null if no result found or row is null
        },
        {
          id: `scheme-${scheme.id}`,
          header: () => (
              <div className="flex flex-col">
                  <span>{scheme.name}</span>
              </div>
          ),
          cell: info => {
            const result = info.getValue();
            if (!result) return <span className="text-gray-400 italic">N/A</span>;

            // Render using ClassificationResultDisplay in compact mode
            return (
              <ClassificationResultDisplay
                result={resultToResultRead(result)} // Adapt FormattedClassificationResult if needed
                scheme={scheme}
                compact={true} // Use compact display in table cells
                renderContext="table"
              />
            );
          },
          enableSorting: false, // Sorting might be complex
        }
      )
    );

    return [...baseColumns, ...schemeColumns];
  }, [schemes, columnHelper]);

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