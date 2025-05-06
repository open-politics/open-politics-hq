// frontend/src/components/collection/workspaces/documents/DocumentDetailViewCsv.tsx
import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext } from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from "@/lib/utils";
import { DataSourceRead as ClientDataSourceRead, CsvRowsOut, CsvRowData, EnhancedClassificationResultRead, ClassificationSchemeRead } from '@/client/models';
import ClassificationResultDisplay from '../classifications/ClassificationResultDisplay'; 
import { adaptEnhancedResultReadToFormattedResult } from '@/lib/classification/adapters';

// Define Sort Direction type if not imported
type SortDirection = 'asc' | 'desc' | null;

interface DocumentDetailViewCsvProps {
  dataSource: ClientDataSourceRead;
  csvData: CsvRowsOut | null;
  isLoadingCsv: boolean;
  csvError: string | null;
  csvSearchTerm: string;
  setCsvSearchTerm: (term: string) => void;
  sortColumn: string | null;
  sortDirection: SortDirection;
  handleSort: (column: string) => void;
  selectedRowData: CsvRowData | null;
  setSelectedRowData: (row: CsvRowData | null) => void;
  filteredAndSortedCsvData: CsvRowData[];
  currentPage: number;
  totalPages: number;
  handlePageChange: (page: number) => void;
  selectedRowResults: EnhancedClassificationResultRead[];
  schemes: ClassificationSchemeRead[];
  availableJobsFromStore: any; // Replace 'any' with actual type: Record<number, ClassificationJobRead>
  selectedJobId: string | null;
  setSelectedResult: (result: EnhancedClassificationResultRead | null) => void;
  setIsResultDialogOpen: (isOpen: boolean) => void;
}

const DocumentDetailViewCsv: React.FC<DocumentDetailViewCsvProps> = ({
  dataSource,
  csvData,
  isLoadingCsv,
  csvError,
  csvSearchTerm,
  setCsvSearchTerm,
  sortColumn,
  sortDirection,
  handleSort,
  selectedRowData,
  setSelectedRowData,
  filteredAndSortedCsvData,
  currentPage,
  totalPages,
  handlePageChange,
  selectedRowResults,
  schemes,
  availableJobsFromStore,
  selectedJobId,
  setSelectedResult,
  setIsResultDialogOpen,
}) => {

  const renderSelectedRowDetail = () => {
    if (!selectedRowData) {
      return null;
    }

    const jobNameForDialog = selectedJobId !== null ? (availableJobsFromStore[selectedJobId]?.name || `Job ${selectedJobId}`) : 'All Jobs';

    return (
      <div className="mt-4 p-4 rounded-lg bg-muted/20 shadow-sm">
        <h4 className="text-md font-semibold mb-3 flex items-center">
          Details for Row {selectedRowData?.row_number}
          <Badge variant="outline" className="ml-2 text-xs">Selected Row</Badge>
        </h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2 rounded-md p-3 bg-background/50 shadow-sm">
            <h5 className="text-sm font-medium mb-2 pb-1 border-b">Row Data</h5>
            <div className="max-h-[350px] overflow-y-auto pr-1">
              {csvData?.columns.map((column, colIndex) => (
                <div key={`${column}-${colIndex}`} className="grid grid-cols-3 gap-2 text-sm border-b py-1 last:border-b-0">
                  <span className="font-medium col-span-1 break-words">{column}</span>
                  <span className="col-span-2 break-words text-muted-foreground">
                    {typeof selectedRowData?.row_data?.[column] === 'object'
                      ? JSON.stringify(selectedRowData?.row_data?.[column])
                      : String(selectedRowData?.row_data?.[column] ?? '(empty)')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-md p-3 bg-background/50 shadow-sm">
            <h5 className="text-sm font-medium mb-2 pb-1 border-b">Classifications for this Row</h5>
            <div className="max-h-[350px] overflow-y-auto pr-1">
              {selectedRowResults.length > 0 ? (
                selectedRowResults.map((result) => {
                  const scheme = schemes.find(s => s.id === result.scheme_id);
                  if (!scheme) return null;
                  const job = result.job_id ? availableJobsFromStore[result.job_id] : null;
                  const jobName = job?.name || (result.job_id ? `Job ${result.job_id}` : 'N/A');
                  return (
                    <div
                      key={result.id}
                      className="p-2 bg-card rounded border text-xs cursor-pointer hover:bg-muted/50 mb-1 last:mb-0"
                       onClick={() => {
                         setSelectedResult(result);
                         setIsResultDialogOpen(true);
                       }}
                    >
                       <div className="flex items-center gap-1 mb-1">
                         <span className="font-semibold">{scheme.name}</span>
                         <Badge variant="outline" className="text-xs font-normal">{jobName}</Badge>
                       </div>
                      <ClassificationResultDisplay
                        result={adaptEnhancedResultReadToFormattedResult(result)}
                        scheme={scheme}
                        compact={true}
                      />
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No classification results found for this row {selectedJobId !== null ? `in ${jobNameForDialog}` : '(across all jobs)'}.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };


  return (
    <div className="space-y-3 h-full flex flex-col">
      {isLoadingCsv ? (
         <div className="text-center py-4 text-muted-foreground flex items-center justify-center gap-2">
           <Loader2 className="h-4 w-4 animate-spin" /> Loading CSV data...
         </div>
       ) : csvError ? (
         <div className="text-center py-4 text-red-600">
           {csvError}
         </div>
       ) : csvData && csvData.columns && csvData.columns.length > 0 && csvData.data ? (
         <>
           <div className="relative max-w-xs flex-none">
             <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
             <Input
               placeholder="Search this page..."
               value={csvSearchTerm}
               onChange={(e) => {
                 setCsvSearchTerm(e.target.value);
                 setSelectedRowData(null);
               }}
               className="pl-8 h-8 text-sm"
             />
           </div>

           <div className="border rounded-md overflow-auto relative w-full flex-grow"> {/* Removed max-h */}
             <Table className="text-xs min-w-max"> {/* Use min-w-max for wide tables */}
               <TableHeader className="sticky top-0 bg-muted z-10">
                 <TableRow>
                   <TableHead className="w-[80px] px-2 py-2 font-semibold sticky left-0 bg-muted z-10 border-r shadow-sm">Row</TableHead>
                   {csvData.columns.map((col, colIndex) => (
                     <TableHead
                       key={`${col}-${colIndex}`}
                       className="px-2 py-2 font-semibold whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer hover:bg-muted-foreground/10"
                       onClick={() => handleSort(col)}
                     >
                       <div className="flex items-center gap-1">
                         {col}
                         {sortColumn === col && sortDirection === 'asc' && <ArrowUp className="h-3 w-3" />}
                         {sortColumn === col && sortDirection === 'desc' && <ArrowDown className="h-3 w-3" />}
                       </div>
                     </TableHead>
                   ))}
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {filteredAndSortedCsvData.length > 0 ? (
                   filteredAndSortedCsvData.map((row: CsvRowData) => (
                     <TableRow
                       key={row.row_number}
                       onClick={() => {
                         const newSelectedRow = prev => prev?.row_number === row.row_number ? null : row;
                         setSelectedRowData(newSelectedRow(selectedRowData)); // Pass previous state to updater
                       }}
                       className={cn(
                         "cursor-pointer hover:bg-muted/50",
                         selectedRowData?.row_number === row.row_number && "bg-primary/10 hover:bg-primary/20"
                       )}
                     >
                       <TableCell className="px-2 py-1 text-foreground sticky left-0 bg-muted z-10 border-r">{row.row_number}</TableCell>
                       {csvData.columns.map((col, colIndex) => (
                         <TableCell
                           key={`${row.row_number}-${col}-${colIndex}`}
                           className="px-2 py-1 max-w-[300px] truncate whitespace-nowrap"
                           title={typeof row.row_data[col] === 'object' ? JSON.stringify(row.row_data[col]) : String(row.row_data[col] ?? '')}
                         >
                           {typeof row.row_data[col] === 'object' ? JSON.stringify(row.row_data[col]) : String(row.row_data[col] ?? '')}
                         </TableCell>
                       ))}
                     </TableRow>
                   ))
                 ) : (
                   <TableRow>
                     <TableCell colSpan={(csvData.columns?.length ?? 0) + 1} className="h-24 text-center text-muted-foreground italic">
                       {csvSearchTerm ? 'No results found for your search.' : 'No data available for the current page.'}
                     </TableCell>
                   </TableRow>
                 )}
               </TableBody>
             </Table>
           </div>

           {totalPages > 0 && (
              <div className="flex justify-center items-center pt-2 flex-none">
                 <Pagination>
                   <PaginationContent>
                     <PaginationItem>
                       <PaginationPrevious
                         href="#"
                         onClick={(e) => { e.preventDefault(); handlePageChange(currentPage - 1); }}
                         className={cn(
                           currentPage === 1 ? "pointer-events-none opacity-50" : "",
                           "h-8 px-2"
                         )}
                       />
                     </PaginationItem>
                     <PaginationItem>
                       <span className="px-3 text-sm">Page {currentPage} of {totalPages}</span>
                     </PaginationItem>
                     <PaginationItem>
                       <PaginationNext
                         href="#"
                         onClick={(e) => { e.preventDefault(); handlePageChange(currentPage + 1); }}
                         className={cn(
                           currentPage === totalPages ? "pointer-events-none opacity-50" : "",
                           "h-8 px-2"
                         )}
                       />
                     </PaginationItem>
                   </PaginationContent>
                 </Pagination>
              </div>
           )}
           {renderSelectedRowDetail()} {/* Show selected row details below table */}
         </>
       ) : (
         <div className="text-center py-4 text-muted-foreground italic">
           No rows found in this CSV file or the data format is unexpected.
         </div>
          )}
       </div>
   );
};

export default DocumentDetailViewCsv;