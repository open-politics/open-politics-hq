'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { format } from "date-fns"
import { Button } from '@/components/ui/button';
import { ClassificationSchemeRead, FieldType, EnhancedClassificationResultRead, CsvRowData, CsvRowsOut } from '@/client/models';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClassificationResultsService, ClassificationSchemesService, ClassificationJobsService } from '@/client/services';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import ClassificationResultDisplay from '../classifications/ClassificationResultDisplay';
import { PlusCircle, Lock, Unlock, ArrowRight, Loader2, Check, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { useClassificationJobsStore, useClassificationJobsActions } from '@/zustand_stores/storeClassificationJobs';
import { DataRecordsService, DataSourcesService } from '@/client/services';
import { DataRecordRead, DataSourceRead, DataSourceType, DataSourceStatus } from '@/client/models';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext } from "@/components/ui/pagination"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

interface DataRecordDetailViewProps {
  onEdit: (item: DataSourceRead) => void;
  schemes: ClassificationSchemeRead[];
  selectedDataSourceId: number | null;
  onLoadIntoRunner?: (jobId: number, jobName: string) => void;
}

const DataRecordDetailView: React.FC<DataRecordDetailViewProps> = ({
  onEdit,
  schemes,
  selectedDataSourceId,
  onLoadIntoRunner
}) => {
  const [dataSource, setDataSource] = useState<DataSourceRead | null>(null);
  const [dataRecords, setDataRecords] = useState<DataRecordRead[]>([]);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [isImageOpen, setIsImageOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [classificationResult, setClassificationResult] = useState<any | null>(null);
  const [selectedResult, setSelectedResult] = useState<EnhancedClassificationResultRead | null>(null);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const { activeWorkspace } = useWorkspaceStore();
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [classificationResults, setClassificationResults] = useState<EnhancedClassificationResultRead[]>([]);
  const [isTextLocked, setIsTextLocked] = useState(true);
  const { classificationJobs: availableJobsFromStore } = useClassificationJobsStore();
  const { fetchClassificationJobs } = useClassificationJobsActions();
  const { toast } = useToast();

  // State for CSV data
  const [csvData, setCsvData] = useState<CsvRowsOut | null>(null);
  const [isLoadingCsv, setIsLoadingCsv] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const csvRowsPerPage = 30; // Configurable number of rows per page
  // Remove selectedCsvRowNumber state, use selectedRowData instead for dialog
  // const [selectedCsvRowNumber, setSelectedCsvRowNumber] = useState<number | null>(null); 

  // State for Row Detail Dialog
  const [selectedRowData, setSelectedRowData] = useState<CsvRowData | null>(null);

  // State for URL List DataRecords
  const [urlListDataRecords, setUrlListDataRecords] = useState<DataRecordRead[]>([]);
  const [isLoadingUrlList, setIsLoadingUrlList] = useState(false);
  const [urlListError, setUrlListError] = useState<string | null>(null);
  const [urlListCurrentPage, setUrlListCurrentPage] = useState(1);
  const [urlListTotalRecords, setUrlListTotalRecords] = useState(0);
  const urlListRecordsPerPage = 5; // Show fewer records for text content

  // NEW: State for classification results specific to the selected CSV row
  const [selectedRowResults, setSelectedRowResults] = useState<EnhancedClassificationResultRead[]>([]);

  const fetchClassificationResults = useCallback(
    async (workspaceId: number, datasourceId: number, jobIdFilter: number | null) => {
      setIsLoadingResults(true);
      setResultsError(null);
      try {
        const filterParams: any = {
          workspaceId: workspaceId,
          datasourceIds: [datasourceId],
          jobId: jobIdFilter ?? undefined,
          limit: 1000
        };
        
        const results = await ClassificationResultsService.listClassificationResults(filterParams);
        
        setClassificationResults(results);

      } catch (error: any) {
        console.error("Error fetching classification results:", error);
        setResultsError("Failed to load classification results.");
      } finally {
        setIsLoadingResults(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchClassificationJobs(activeWorkspace.id);
    }
  }, [activeWorkspace?.id, fetchClassificationJobs]);

  const handleLoadIntoRunner = useCallback((result: EnhancedClassificationResultRead) => {
    const jobId = result.job_id;
    if (jobId === null || jobId === undefined || !onLoadIntoRunner) return;

    const job = availableJobsFromStore[jobId];
    const jobName = job?.name || `Job ${jobId}`;

    if (activeWorkspace?.id) {
      toast({
        title: "Preparing data",
        description: "Gathering all classification results for this data record...",
      });
      
      ClassificationResultsService.getJobResults({
        workspaceId: activeWorkspace.id,
        jobId: jobId,
      }).then(results => {
        const resultsForThisDataRecord = results.filter(r => r.datarecord_id === result.datarecord_id);
        const schemeIds = [...new Set(resultsForThisDataRecord.map(r => r.scheme_id))];
        
        onLoadIntoRunner(jobId, jobName); 
        
        toast({
          title: "Success",
          description: `Loaded job "${jobName}" with ${schemeIds.length} schemes for data record ${result.datarecord_id}`,
        });
      }).catch(error => {
        console.error("Error preparing data for runner:", error);
        toast({
          title: "Error Preparing Data",
          description: "Could not load all results for the job.",
          variant: "destructive",
        });
        onLoadIntoRunner(jobId, jobName); 
      });
    } else {
      onLoadIntoRunner(jobId, jobName); 
    }
  }, [onLoadIntoRunner, activeWorkspace?.id, toast, availableJobsFromStore]);

  const renderJobSelector = () => {
    const jobsWithResultsForDataSource = Object.values(availableJobsFromStore).filter(job => 
      classificationResults.some(result => result.job_id === job.id)
    );

    if (jobsWithResultsForDataSource.length === 0 && !isLoadingResults && !isLoadingSource) {
      return (
        <div className="mb-4 p-3 bg-muted/20 rounded-lg border">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Available Jobs</h4>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            No classification jobs found for this data source.
          </p>
        </div>
      );
    }
    
    return (
      <div className="mb-4 p-3 bg-muted/20 rounded-lg border">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Filter by Job</h4>
          {isLoadingResults && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="mt-2">
          <Select
            value={selectedJobId || "all"}
            onValueChange={(value) => setSelectedJobId(value === "all" ? null : value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a job to filter results" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs for this data source</SelectItem>
              {jobsWithResultsForDataSource.map((job) => (
                <SelectItem key={job.id} value={job.id.toString()}>
                  {job.name || `Job ${job.id}`} ({format(new Date(job.created_at), "PP")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  const renderClassificationSection = () => (
    <div className="p-6 w-full bg-secondary/70 rounded-lg shadow-md relative overflow-hidden border border-border/30">
      {renderJobSelector()}
      
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {isLoadingResults ? (
           <div className="text-center py-4 text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading results...
            </div>
        ) : classificationResults.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No classification results available {selectedJobId && selectedJobId !== 'all' ? 'for the selected job' : ''}.
          </div>
        ) : (
          classificationResults
            .map((result) => {
              const scheme = schemes.find(s => s.id === result.scheme_id);
              if (!scheme) {
                console.warn(`Scheme not found for result ID ${result.id} with scheme ID ${result.scheme_id}`);
                return null;
              }

              const job = result.job_id ? availableJobsFromStore[result.job_id] : null;
              const jobName = job?.name || (result.job_id ? `Job ${result.job_id}` : null);

              return (
                <div 
                  key={result.id} 
                  className="p-4 bg-card rounded-lg shadow-sm border border-border/50 hover:shadow-md hover:border-border/80 transition-all duration-200 cursor-pointer"
                  onClick={() => {
                    setSelectedResult(result);
                    setIsResultDialogOpen(true);
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                       <div className="flex items-center gap-2 mb-1">
                         <span className="font-medium text-sm">{scheme.name}</span>
                         {jobName && (
                           <Badge variant="outline" className="text-xs font-normal">{jobName}</Badge>
                         )}
                       </div>
                       <ClassificationResultDisplay 
                         result={result}
                         scheme={scheme}
                         compact={false}
                       />
                    </div>
                    <div className="flex flex-col items-end gap-2 mt-1 shrink-0">
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {result.timestamp && format(new Date(result.timestamp), "PP · p")}
                      </div>
                      {result.job_id && onLoadIntoRunner && (
                        <Button 
                          variant="ghost"
                          size="sm" 
                          className="text-xs h-7 px-2 text-primary hover:bg-primary/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLoadIntoRunner(result);
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Load Job
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
            .filter(Boolean)
        )}
        {resultsError && (
          <div className="text-center py-4 text-red-600">{resultsError}</div>
        )}
      </div>
    </div>
  );

  // Combined effect for fetching source, its records, and results
  useEffect(() => {
    const fetchAll = async () => {
      if (!selectedDataSourceId || !activeWorkspace?.id) {
        setDataSource(null);
        setDataRecords([]); // Clear records
        setClassificationResults([]); // Clear results
        setCsvData(null); // Clear CSV data
        setCurrentPage(1);
        setSourceError(null);
        setCsvError(null);
        // Clear row detail state on source change
        setSelectedRowData(null);
        return;
      }

      setIsLoadingSource(true);
      setSourceError(null);
      setDataSource(null);
      setDataRecords([]); // Clear records before fetch
      setClassificationResults([]); // Always clear results on source change
      setCsvData(null); // Clear CSV data on source change
      setCurrentPage(1);
      setCsvError(null);
      // Clear row detail state on source change
      setSelectedRowData(null);

      try {
        // 1. Fetch DataSource
        const source = await DataSourcesService.readDatasource({
          workspaceId: activeWorkspace.id,
          datasourceId: selectedDataSourceId,
          includeCounts: true, // Keep counts for general info
        });
        setDataSource(source);

        // 2. Fetch associated DataRecord ONLY if needed for PDF/TEXT content
        // Clear existing records if type is not PDF/TEXT
        if (source.type === 'pdf' || source.type === 'text_block') {
           try {
              const recordsResponse = await DataRecordsService.listDataRecordsForDatasource({
                 workspaceId: activeWorkspace.id,
                 datasourceId: selectedDataSourceId,
                 limit: 1 // Expect only one for these types
              });
              if (recordsResponse && recordsResponse.length > 0) {
                setDataRecords(recordsResponse);
              } else {
                setDataRecords([]);
                console.warn(`No data records found for ${source.type} source ${selectedDataSourceId}, though expected one.`);
                // Set specific error if needed, but avoid overriding general sourceError
                // setSourceError("Could not load text content.");
              }
           } catch (recordFetchError: any) {
              console.error(`Could not fetch the specific data record for ${source.type} source ${selectedDataSourceId}.`, recordFetchError);
              // Set error if content is expected but fails
              setSourceError("Failed to load text content for this source.");
              setDataRecords([]);
           }
        } else {
           // For other types like CSV/URL_LIST, ensure records are cleared
           setDataRecords([]);
        }

        // 3. Fetch Initial Classification Results for this source (using the existing callback)
        // This is triggered independently based on the source being set
        // const jobId = selectedJobId ? parseInt(selectedJobId, 10) : null;
        // await fetchClassificationResults(activeWorkspace.id, source.id, jobId);
        // Let the other useEffect handle this based on selectedJobId change
        // Trigger initial fetch for results when source loads (all jobs initially)
        if (activeWorkspace?.id && source?.id) {
           await fetchClassificationResults(activeWorkspace.id, source.id, null);
        }

      } catch (err: any) {
        console.error("Error fetching data source details:", err);
        const errorDetail = err.body?.detail || err.message || "Unknown error";
        setSourceError(`Failed to load source details: ${errorDetail}`);
        setDataSource(null);
        setDataRecords([]);
        setClassificationResults([]);
        setCsvData(null);
      } finally {
        setIsLoadingSource(false);
      }
    };
    fetchAll();
    // Dependency array: Fetch when selection, workspace changes.
    // Exclude fetchClassificationResults, selectedJobId, currentPage as they trigger fetches themselves.
  }, [selectedDataSourceId, activeWorkspace?.id]);

  // Separate effect for fetching classification results when job filter changes
  useEffect(() => {
    if (dataSource?.id && activeWorkspace?.id) {
       const jobId = selectedJobId ? parseInt(selectedJobId, 10) : null;
       fetchClassificationResults(activeWorkspace.id, dataSource.id, jobId);
    }
    // Intentionally excluding fetchClassificationResults from deps to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, dataSource?.id, activeWorkspace?.id]);


  // NEW: Effect for filtering results when a CSV row is selected
  useEffect(() => {
    if (dataSource?.type === 'csv' && selectedRowData) {
      const filtered = classificationResults.filter(
        result => result.datarecord_id === selectedRowData.row_number
      );
      setSelectedRowResults(filtered);
    } else {
      setSelectedRowResults([]); // Clear if no row selected or not CSV
    }
    // Re-run whenever the base results or selected row changes
  }, [selectedRowData, classificationResults, dataSource?.type]);

  // NEW: Effect for fetching CSV data when source changes or page changes
  useEffect(() => {
    const fetchCsvData = async () => {
        if (!dataSource || dataSource.type !== 'csv' || !activeWorkspace?.id) {
            setCsvData(null); // Ensure CSV data is cleared if not applicable
            return;
        }

        setIsLoadingCsv(true);
        setCsvError(null);
        const skip = (currentPage - 1) * csvRowsPerPage;

        try {
            const result = await DataSourcesService.readDatasourceRows({
                workspaceId: activeWorkspace.id,
                datasourceId: dataSource.id,
                skip: skip,
                limit: csvRowsPerPage
            });
            setCsvData(result);
        } catch (err: any) {
            console.error("Error fetching CSV rows:", err);
            const errorDetail = err.body?.detail || err.message || "Failed to load CSV data.";
            setCsvError(`Failed to load CSV content: ${errorDetail}`);
            setCsvData(null); // Clear data on error
        } finally {
            setIsLoadingCsv(false);
        }
    };

    fetchCsvData();
  }, [dataSource, currentPage, activeWorkspace?.id, csvRowsPerPage]); // Re-fetch when source, page, or workspace changes

  // NEW: Effect for fetching DataRecords for URL_LIST type
  useEffect(() => {
    const fetchUrlListData = async () => {
        if (!dataSource || dataSource.type !== 'url_list' || !activeWorkspace?.id) {
            setUrlListDataRecords([]); // Clear if not applicable
            setUrlListTotalRecords(0);
            return;
        }

        setIsLoadingUrlList(true);
        setUrlListError(null);
        const skip = (urlListCurrentPage - 1) * urlListRecordsPerPage;

        try {
            // Reuse the existing service, but fetch multiple records
            // Note: The backend endpoint might not yet support pagination counts easily.
            // We'll fetch records and rely on source_metadata for total count for now.
            const recordsResponse = await DataRecordsService.listDataRecordsForDatasource({
               workspaceId: activeWorkspace.id,
               datasourceId: selectedDataSourceId!, // dataSource.id should be same
               skip: skip,
               limit: urlListRecordsPerPage
            });

            setUrlListDataRecords(recordsResponse || []);
            // Get total count from the DataSource metadata if available
            const totalCount = Number(dataSource.source_metadata?.record_count_processed ?? 0); // Ensure value is number
            setUrlListTotalRecords(totalCount);

        } catch (err: any) {
             console.error("Error fetching URL List data records:", err);
             const errorDetail = err.body?.detail || err.message || "Failed to load scraped content.";
             setUrlListError(`Failed to load URL List content: ${errorDetail}`);
             setUrlListDataRecords([]);
             setUrlListTotalRecords(0);
        } finally {
             setIsLoadingUrlList(false);
        }
    };

    fetchUrlListData();
  }, [dataSource, urlListCurrentPage, activeWorkspace?.id, urlListRecordsPerPage, selectedDataSourceId]);

  const handleRefreshClassificationResults = async () => {
    if (!dataSource?.id || !activeWorkspace?.id) return;
    const jobId = selectedJobId ? parseInt(selectedJobId, 10) : null;
    await fetchClassificationResults(activeWorkspace.id, dataSource.id, jobId);
  };

  // Filter classifications for a specific data record (used for URL List)
  const getResultsForRecord = (recordId: number): EnhancedClassificationResultRead[] => {
    return classificationResults.filter(r => r.datarecord_id === recordId);
  };

  // Return loading/error/empty states first
  if (isLoadingSource) {
    return (
      <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading Source Details...
      </div>
    );
  }

  if (sourceError) {
    return (
      <div className="p-8 text-center text-red-600">
        {sourceError}
      </div>
    );
  }

  if (!dataSource) {
     return (
        <div className="p-8 text-center text-muted-foreground">
          Select a data source from the list to view its details.
        </div>
     );
  }

  // Define display variables based on DataSource and potentially the first DataRecord
  const displayTitle = dataSource.name || `Source ${dataSource.id}`;
  const displayType = dataSource.type;
  const displayStatus = dataSource.status;
  const displaySourceOrigin = dataSource.origin_details ? JSON.stringify(dataSource.origin_details, null, 2) : 'N/A';
  const displaySourceMeta = dataSource.source_metadata ? JSON.stringify(dataSource.source_metadata, null, 2) : 'N/A';
  const displayInsertionDate = dataSource.created_at;

  // Get text content based on type (for PDF/Text only now)
  let displayTextContent: string | null = null; // Correct type for assignment

  // Use lowercase string literals for comparison based on generated types
  if ((dataSource.type === 'pdf' || dataSource.type === 'text_block')) {
    // Check if records state holds the data
    if (dataRecords.length > 0 && dataRecords[0].text_content) {
        displayTextContent = dataRecords[0].text_content;
    } else if (!sourceError) { // Avoid overriding fetch errors
        // Provide placeholder text if fetch succeeded but no content/records
        displayTextContent = "(No text content extracted or available for this source)";
    } // If sourceError is set, it will be displayed elsewhere

  } 
  // Removed CSV/URL_LIST handling from here, it's handled separately below

  // --- CSV Pagination Logic ---
  const totalPages = csvData ? Math.ceil(csvData.total_rows / csvRowsPerPage) : 0;

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };
  // --- End CSV Pagination Logic ---

  // --- URL List Pagination Logic ---
  const urlListTotalPages = Math.ceil(urlListTotalRecords / urlListRecordsPerPage);

  const handleUrlListPageChange = (page: number) => {
    if (page >= 1 && page <= urlListTotalPages) {
       setUrlListCurrentPage(page);
    }
  };
  // --- End URL List Pagination Logic ---

  // --- Rendering for Selected Row Detail ---
  const renderSelectedRowDetail = () => {
    if (!selectedRowData || dataSource?.type !== 'csv') {
      return null;
    }

    return (
      <div className="mt-4 p-4 rounded-lg bg-muted/20 shadow-sm">
        <h4 className="text-md font-semibold mb-3 flex items-center">
          Details for Row {selectedRowData.row_number}
          <Badge variant="outline" className="ml-2 text-xs">Selected Row</Badge>
        </h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Row Data */}
          <div className="space-y-2 rounded-md p-3 bg-background/50 shadow-sm">
            <h5 className="text-sm font-medium mb-2 pb-1 border-b">Row Data</h5>
            <div className="max-h-[350px] overflow-y-auto pr-1">
              {csvData?.columns.map((column) => (
                <div key={column} className="grid grid-cols-3 gap-2 text-sm border-b py-1 last:border-b-0">
                  <span className="font-medium col-span-1 break-words">{column}</span>
                  <span className="col-span-2 break-words text-muted-foreground">
                    {typeof selectedRowData.row_data[column] === 'object'
                      ? JSON.stringify(selectedRowData.row_data[column])
                      : String(selectedRowData.row_data[column] ?? '(empty)')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Row Classifications */}
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
                      className="p-2 bg-card rounded border text-xs cursor-pointer hover:bg-muted/50"
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
                        result={result}
                        scheme={scheme}
                        compact={true} // Use compact display here
                      />
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground italic">No classification results found for this specific row.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex-none bg-background z-10 border-b">
          <div className="flex items-center justify-between px-4 pl-3 py-0">
            <h1 className="text-xl font-bold">Data Detail View</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(dataSource!)}
              disabled
            >
              Edit (Disabled)
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          <div className="flex items-start gap-4 text-sm">
            <Avatar>
              <AvatarImage alt={displayTitle} />
              <AvatarFallback>
                {displayTitle
                  ?.substring(0, 2)
                  ?.toUpperCase() || 'DS'}
              </AvatarFallback>
            </Avatar>
            <div className="grid gap-1 flex-1">
              <div className="font-semibold flex items-center gap-2 flex-wrap">
                {displayTitle}
                <Badge variant="outline">{displayType}</Badge>
                <Badge variant={
                  dataSource.status === 'complete' ? 'default'
                  : dataSource.status === 'failed' ? 'destructive'
                  : dataSource.status === 'processing' ? 'secondary'
                  : dataSource.status === 'pending' ? 'secondary'
                  : 'outline'
                }>{displayStatus}</Badge>
              </div>
              <div className="text-xs">
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger className="cursor-default text-left">
                      <span className="font-medium">Origin Details:</span> <span className="italic">Hover to see</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md">
                      <pre className="text-xs whitespace-pre-wrap break-all">{displaySourceOrigin}</pre>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="text-xs">
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger className="cursor-default text-left">
                      <span className="font-medium">Source Metadata:</span> <span className="italic">Hover to see</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md">
                      <pre className="text-xs whitespace-pre-wrap break-all">{displaySourceMeta}</pre>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
            {displayInsertionDate && (
              <div className="ml-auto text-xs text-muted-foreground whitespace-nowrap shrink-0">
                Created: {format(new Date(displayInsertionDate), "PPp")}
              </div>
            )}
          </div>

          <Tabs defaultValue="content" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-2">
              <TabsTrigger value="content">Source Content / Summary</TabsTrigger>
              <TabsTrigger value="results">Overall Classification Results</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="mt-2 rounded-md p-1">
               <div className="space-y-4">
                {dataSource.type === 'csv' ? (
                  <div className="space-y-3 h-full flex flex-col">
                    {isLoadingCsv ? (
                       <div className="text-center py-4 text-muted-foreground flex items-center justify-center gap-2">
                         <Loader2 className="h-4 w-4 animate-spin" /> Loading CSV data...
                       </div>
                     ) : csvError ? (
                       <div className="text-center py-4 text-red-600">
                         {csvError}
                       </div>
                     ) : csvData && csvData.columns && csvData.columns.length > 0 && csvData.data && csvData.data.length > 0 ? (
                       <>
                         <div className="border rounded-md overflow-auto relative w-full max-h-[30vh] max-w-[50vw]">
                           <Table className="text-xs max-w-screen-3xl">
                             <TableHeader className="sticky top-0 bg-muted z-10">
                               <TableRow>
                                 <TableHead className="w-[80px] px-2 py-2 font-semibold sticky left-0 bg-muted z-10 border-r shadow-sm">Row</TableHead>
                                 {csvData.columns.map((col) => (
                                   <TableHead key={col} className="px-2 py-2 font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{col}</TableHead>
                                 ))}
                               </TableRow>
                             </TableHeader>
                             <TableBody>
                               {csvData.data.map((row: CsvRowData) => (
                                 <TableRow
                                   key={row.row_number}
                                   onClick={() => {
                                     setSelectedRowData(prev => prev?.row_number === row.row_number ? null : row);
                                   }}
                                   className={cn(
                                     "cursor-pointer hover:bg-muted/50",
                                     selectedRowData?.row_number === row.row_number && "bg-primary/10 hover:bg-primary/20"
                                   )}
                                 >
                                   <TableCell className="px-2 py-1 text-foreground sticky left-0 bg-muted z-10 border-r">{row.row_number}</TableCell>
                                   {csvData.columns.map((col) => (
                                     <TableCell
                                       key={`${row.row_number}-${col}`}
                                       className="px-2 py-1 max-w-[300px] truncate whitespace-nowrap" // Keep truncate for now
                                       title={typeof row.row_data[col] === 'object' ? JSON.stringify(row.row_data[col]) : String(row.row_data[col] ?? '')}
                                     >
                                       {typeof row.row_data[col] === 'object' ? JSON.stringify(row.row_data[col]) : String(row.row_data[col] ?? '')}
                                     </TableCell>
                                   ))}
                                 </TableRow>
                               ))}
                             </TableBody>
                           </Table>
                         </div>

                         {/* Pagination and Row Detail */}
                         {totalPages > 1 && (
                            <div className="flex justify-center items-center pt-2 flex-none">
                               <Pagination>
                                 <PaginationContent>
                                   <PaginationItem>
                                     <PaginationPrevious
                                        href="#"
                                        onClick={(e) => { e.preventDefault(); handlePageChange(currentPage - 1); }}
                                        className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined}
                                     />
                                   </PaginationItem>
                                   <PaginationItem>
                                     <span className="px-4 text-sm">Page {currentPage} of {totalPages}</span>
                                   </PaginationItem>
                                   <PaginationItem>
                                     <PaginationNext
                                       href="#"
                                       onClick={(e) => { e.preventDefault(); handlePageChange(currentPage + 1); }}
                                       className={currentPage === totalPages ? "pointer-events-none opacity-50" : undefined}
                                     />
                                   </PaginationItem>
                                 </PaginationContent>
                               </Pagination>
                            </div>
                         )}
                         {renderSelectedRowDetail()}

                       </>
                     ) : (
                       <div className="text-center py-4 text-muted-foreground italic">
                         No rows found in this CSV file or the data format is unexpected (and not loading/error).
                       </div>
                     )}
                  </div>
                ) : (dataSource.type === 'pdf' || dataSource.type === 'text_block') ? (
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "whitespace-pre-wrap text-sm bg-secondary/30 p-3 rounded-lg relative border border-border/30",
                        displayTextContent && isTextLocked ? "max-h-[350px] overflow-hidden" : "max-h-[65vh] overflow-auto"
                      )}
                    >
                      {displayTextContent ? (
                        displayTextContent
                      ) : sourceError ? (
                        <span className="text-red-500 italic">{sourceError}</span>
                      ) : (
                        <span className="text-muted-foreground italic">Loading text content or none available...</span>
                      )}
                      {displayTextContent && isTextLocked && (
                        <div className="absolute bottom-0 left-0 w-full h-16 bg-gradient-to-t from-secondary/30 via-secondary/30 to-transparent pointer-events-none"></div>
                      )}
                    </div>
                    {displayTextContent && (
                      <div className="flex justify-center mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsTextLocked(!isTextLocked)}
                          className="flex items-center gap-1 rounded-full bg-secondary/50 px-3 h-7 text-xs text-muted-foreground hover:bg-secondary/70 transition-all duration-200"
                        >
                          {isTextLocked ? (
                            <>Show More <ChevronDown className="h-4 w-4" /></>
                          ) : (
                            <>Show Less <ChevronUp className="h-4 w-4" /></>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : dataSource.type === 'url_list' ? (
                  <div className="space-y-3">
                    {isLoadingUrlList ? (
                      <div className="text-center py-4 text-muted-foreground flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading scraped content...
                      </div>
                    ) : urlListError ? (
                      <div className="text-center py-4 text-red-600">
                        {urlListError}
                      </div>
                    ) : urlListDataRecords.length > 0 ? (
                      <>
                        <div className="space-y-4 overflow-y-auto pr-1 max-h-[60vh]">
                          {urlListDataRecords.map((record) => {
                            const recordResults = getResultsForRecord(record.id);
                            return (
                              <div key={record.id} className="p-3 rounded-md bg-card space-y-2 shadow-sm hover:shadow-md transition-shadow">
                                <div className="text-xs font-medium text-muted-foreground">
                                  Record ID: {record.id}
                                  {record.source_metadata && typeof (record.source_metadata as any).url === 'string' &&
                                    <a href={(record.source_metadata as any).url} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary hover:underline inline-flex items-center">
                                      <span className="truncate max-w-[350px]">{(record.source_metadata as any).url}</span>
                                      <ExternalLink className="h-3 w-3 ml-1 shrink-0" />
                                    </a>
                                  }
                                </div>
                                <p className="text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto bg-secondary/30 p-2 rounded border">
                                  {record.text_content || <span className="italic text-muted-foreground/70">No content extracted.</span>}
                                </p>
                                {recordResults.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-dashed">
                                    <h5 className="text-xs font-semibold mb-1">Classifications for this record:</h5>
                                    <div className="space-y-1">
                                      {recordResults.map(result => {
                                        const scheme = schemes.find(s => s.id === result.scheme_id);
                                        if (!scheme) return null;
                                        return (
                                          <div key={result.id} className="p-1.5 bg-background rounded border text-xs">
                                            <ClassificationResultDisplay
                                              result={result}
                                              scheme={scheme}
                                              compact={true}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {urlListTotalPages > 1 && (
                          <div className="flex justify-center items-center pt-2 flex-none">
                             <Pagination>
                               <PaginationContent>
                                 <PaginationItem>
                                   <PaginationPrevious
                                     href="#"
                                     onClick={(e) => { e.preventDefault(); handleUrlListPageChange(urlListCurrentPage - 1); }}
                                     className={urlListCurrentPage === 1 ? "pointer-events-none opacity-50" : undefined}
                                   />
                                 </PaginationItem>
                                 <PaginationItem>
                                   <span className="px-4 text-sm">Page {urlListCurrentPage} of {urlListTotalPages} ({urlListTotalRecords} records)</span>
                                 </PaginationItem>
                                 <PaginationItem>
                                   <PaginationNext
                                     href="#"
                                     onClick={(e) => { e.preventDefault(); handleUrlListPageChange(urlListCurrentPage + 1); }}
                                     className={urlListCurrentPage === urlListTotalPages ? "pointer-events-none opacity-50" : undefined}
                                   />
                                 </PaginationItem>
                               </PaginationContent>
                             </Pagination>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground italic">
                        No scraped content records found for this URL list source.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm bg-secondary/30 p-3 rounded-lg border border-border/30 text-muted-foreground italic">
                    Content view not applicable for this source type.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="results" className="mt-2 border rounded-md p-1">
               <div className="flex items-center justify-between mb-2">
                  <h4 className="text-md font-semibold">Overall Classification Results</h4>
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={handleRefreshClassificationResults}
                     disabled={isLoadingResults || isLoadingSource}
                     className="text-xs h-7 px-2"
                   >
                     <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingResults ? 'animate-spin' : ''}`} />
                     Refresh
                   </Button>
                </div>
              {renderClassificationSection()}
            </TabsContent>
          </Tabs>
        </div>

        <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedResult?.scheme_id && schemes.find(s => s.id === selectedResult.scheme_id)?.name}
                {selectedResult?.job_id && (
                  <Badge variant="outline" className="text-sm font-normal">
                    {availableJobsFromStore[selectedResult.job_id]?.name || `Job ${selectedResult.job_id}`}
                  </Badge>
                )}
              </DialogTitle>
              {selectedResult?.timestamp && (
                <p className="text-xs text-muted-foreground -mt-2">
                  Created: {format(new Date(selectedResult.timestamp), "PPpp")}
                </p>
              )}
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              {selectedResult && (
                <ClassificationResultDisplay 
                  result={selectedResult}
                  scheme={schemes.find(s => s.id === selectedResult.scheme_id)!}
                  renderContext="dialog"
                />
              )}
            </div>
            <DialogFooter className="mt-4 pt-4 border-t flex justify-between sm:justify-between">
               {selectedResult?.job_id && onLoadIntoRunner && (
                 <Button
                   variant="default"
                   size="sm"
                   onClick={() => {
                     if (selectedResult) {
                       handleLoadIntoRunner(selectedResult);
                     }
                     setIsResultDialogOpen(false);
                   }}
                   className="bg-primary text-primary-foreground hover:bg-primary/90"
                 >
                   <ExternalLink className="h-4 w-4 mr-2" />
                   Load Job in Runner
                 </Button>
               )}
               {(!selectedResult?.job_id || !onLoadIntoRunner) && <div />}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsResultDialogOpen(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Toaster />
    </>
  );
}


export default DataRecordDetailView;