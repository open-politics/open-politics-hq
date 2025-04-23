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
import { PlusCircle, Lock, Unlock, ArrowRight, Loader2, Check, ChevronDown, ChevronUp, ExternalLink, RefreshCw, AlertCircle, Info, Search, ArrowUp, ArrowDown } from "lucide-react"; // Added Search, ArrowUp, ArrowDown
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { useClassificationJobsStore, useClassificationJobsActions, useIsClassificationJobsLoading, useClassificationJobsError } from "@/zustand_stores/storeClassificationJobs";
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ClassificationJobRead } from '@/client';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClassificationTimeAxisControls, TimeAxisConfig } from "../classifications/ClassificationTimeAxisControls";
import ResultsChart from '../classifications/ClassificationResultsChart';
import { formatDistanceToNow } from 'date-fns';
import { FormattedClassificationResult } from '@/lib/classification/types';
import { ResultFilter } from '../classifications/ClassificationResultFilters';
import { adaptEnhancedResultReadToFormattedResult } from '@/lib/classification/adapters';
import { useRecurringTasksStore, RecurringTask, RecurringTaskCreate, RecurringTaskUpdate } from '@/zustand_stores/storeRecurringTasks';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import Cronstrue from 'cronstrue';

// Define Sort Direction type
type SortDirection = 'asc' | 'desc' | null;

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
  const [csvSearchTerm, setCsvSearchTerm] = useState(''); // NEW: State for CSV search
  const [sortColumn, setSortColumn] = useState<string | null>(null); // NEW: State for sort column
  const [sortDirection, setSortDirection] = useState<SortDirection>(null); // NEW: State for sort direction

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

  // NEW State for Scheduling UI
  const [localIngestTask, setLocalIngestTask] = useState<RecurringTask | null>(null);
  const [enableScheduledIngestion, setEnableScheduledIngestion] = useState(false);
  const [ingestionSchedule, setIngestionSchedule] = useState('0 0 * * *'); // Default cron
  const [cronExplanation, setCronExplanation] = useState('');
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const [initialScheduleState, setInitialScheduleState] = useState({ enabled: false, schedule: '' });

  // Get Recurring Task store data and actions
  const { 
      recurringTasks,
      getIngestTaskForDataSource,
      createRecurringTask,
      updateRecurringTask,
      deleteRecurringTask // Maybe needed later?
  } = useRecurringTasksStore();

  // Added handler for chart clicks
  const handleChartPointClick = (point: any) => {
    console.log("Chart point clicked:", point);
    // TODO: Implement logic based on clicked point (e.g., open details)
  };

  // Memoized list of jobs that have results for the current data source (Moved Earlier)
  const jobsWithResultsForDataSource = useMemo(() => {
    return Object.values(availableJobsFromStore).filter(job =>
      classificationResults.some(result => result.job_id === job.id)
    );
  }, [availableJobsFromStore, classificationResults]);

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

  // TEMP: Use all results while filteredResults is commented out
  const filteredResults = classificationResults;
  // TEMP: Use placeholder while jobResultCounts is commented out
  const jobResultCounts: Record<number, number> = {};

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
          {(isLoadingResults || isLoadingSource) && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="mt-2">
          <Select
            value={selectedJobId || "all"}
            onValueChange={handleJobSelect}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a job to filter results" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs for this data source ({classificationResults.length} results)</SelectItem>
              {jobsWithResultsForDataSource.map((job) => (
                <SelectItem key={job.id} value={job.id.toString()}>
                  {job.name || `Job ${job.id}`} ({format(new Date(job.created_at), "PP")}) - {jobResultCounts[job.id] || 0} results
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  const renderClassificationSection = () => (
    <div className="p-4 w-full bg-card rounded-lg shadow-sm border">
      <h3 className="text-lg font-semibold mb-3">Classification Results</h3>
      {/* --- Controls Section --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {renderJobSelector()} {/* Keep job selector */}
        {/* TEMP: Commented out Time Axis Controls */}
        {/* <ClassificationTimeAxisControls
          schemes={schemes}
          initialConfig={timeAxisConfig}
          onTimeAxisConfigChange={handleTimeAxisChange}
        /> */}
        {/* Map controls removed */}
      </div>
      {/* --- End Controls Section --- */}

      {isLoadingResults ? (
            <div className="text-center py-8 text-muted-foreground flex items-center justify-center gap-2">
               <Loader2 className="h-4 w-4 animate-spin" /> Loading results...
             </div>
         ) : resultsError ? (
             <Alert variant="destructive">
                 <AlertCircle className="h-4 w-4" />
                 <AlertTitle>Error Loading Results</AlertTitle>
                 <AlertDescription>{resultsError}</AlertDescription>
             </Alert>
         ) : (
            <Tabs defaultValue="chart" className="mt-2">
                <TabsList className="mb-2">
                    <TabsTrigger value="chart">Time Series Chart</TabsTrigger>
                    {/* <TabsTrigger value="map">Location Map</TabsTrigger> */} {/* Map removed */}
                </TabsList>
                <TabsContent value="chart" className="min-h-[400px]">
                    {filteredResults.length > 0 ? (
                        <>
                            {/* TEMP: Commented out Results Chart */}
                            {/* <ResultsChart
                              results={filteredResults.map(adaptEnhancedResultReadToFormattedResult)} // Use adapter
                              schemes={schemes}
                              dataSources={dataSource ? [dataSource] : []}
                              dataRecords={dataRecords} // Pass dataRecords
                              onDataPointClick={handleChartPointClick} // Pass handler
                              filters={activeFilters} // Pass filter state
                              timeAxisConfig={timeAxisConfig} // Pass time axis config
                            /> */}
                            <div className="text-center p-4 text-muted-foreground italic">
                               Chart temporarily disabled for debugging.
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-8 text-muted-foreground">
                            No classification results available {selectedJobId !== null ? 'for the selected job' : 'for this data source'}.
                        </div>
                    )}
                </TabsContent>
                {/* Map tab removed */}
            </Tabs>
         )
      }
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
        setCsvSearchTerm(''); // Reset search on source change
        setSortColumn(null); // Reset sort on source change
        setSortDirection(null);
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
      setCsvSearchTerm(''); // Reset search on source change
      setSortColumn(null); // Reset sort on source change
      setSortDirection(null);

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
            // Reset search and sort when new page data is loaded
            setCsvSearchTerm('');
            setSortColumn(null);
            setSortDirection(null);
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
    // Re-fetch when source, page, or workspace changes
    // Exclude csvSearchTerm, sortColumn, sortDirection as they are client-side
  }, [dataSource, currentPage, activeWorkspace?.id, csvRowsPerPage]);

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

  // Find the relevant ingest task when data source or tasks change
  useEffect(() => {
      if (dataSource?.type === 'url_list' && dataSource.id) {
          const task = getIngestTaskForDataSource(dataSource.id);
          setLocalIngestTask(task);
          const isActive = task?.status === 'active';
          const currentSchedule = task?.schedule || '0 0 * * *';
          setEnableScheduledIngestion(isActive);
          setIngestionSchedule(currentSchedule);
          // Store initial state to check for changes later
          setInitialScheduleState({ enabled: isActive, schedule: currentSchedule });
          console.log("Found ingest task for source", dataSource.id, task);
      } else {
          // Clear state if source is not url_list or no source selected
          setLocalIngestTask(null);
          setEnableScheduledIngestion(false);
          setIngestionSchedule('0 0 * * *');
          setInitialScheduleState({ enabled: false, schedule: '' });
      }
  }, [dataSource, recurringTasks, getIngestTaskForDataSource]);

  // Update Cron Explanation for schedule input
  useEffect(() => {
    if (dataSource?.type !== 'url_list' || !enableScheduledIngestion) {
        setCronExplanation('');
        return;
    }
    try {
      const explanation = Cronstrue.toString(ingestionSchedule);
      setCronExplanation(explanation);
    } catch (e) {
      setCronExplanation('Invalid cron format.');
    }
  }, [ingestionSchedule, dataSource?.type, enableScheduledIngestion]);

  // NEW: Handler for saving schedule changes
  const handleScheduleUpdate = async () => {
    if (!dataSource || dataSource.type !== 'url_list') return;

    const hasChanged = 
        enableScheduledIngestion !== initialScheduleState.enabled || 
        (enableScheduledIngestion && ingestionSchedule !== initialScheduleState.schedule);

    if (!hasChanged) {
        toast({ title: "No Changes", description: "Schedule settings are already up to date.", variant: "default"});
        return;
    }

    // Validate cron schedule if enabling/changing
    if (enableScheduledIngestion) {
        try { Cronstrue.toString(ingestionSchedule); } 
        catch (e) {
            toast({ title: "Invalid Schedule", description: "Please enter a valid 5-part cron schedule.", variant: "destructive" });
            return;
        }
    }

    setIsUpdatingSchedule(true);
    let success = false;
    let taskName = localIngestTask?.name || `Scheduled Ingest: ${dataSource.name}`;

    try {
        if (enableScheduledIngestion) {
            if (localIngestTask) {
                // Update existing task (status and maybe schedule)
                const updatePayload: RecurringTaskUpdate = {
                    status: 'active',
                    schedule: ingestionSchedule
                };
                console.log("Updating recurring task:", localIngestTask.id, updatePayload);
                const updated = await updateRecurringTask(localIngestTask.id, updatePayload);
                success = !!updated;
                if (success) taskName = updated!.name; // Update name if task was renamed
            } else {
                // Create new task
                const createPayload: RecurringTaskCreate = {
                    name: taskName,
                    description: `Automatically scrapes URLs for DataSource ${dataSource.name} (ID: ${dataSource.id})`,
                    type: 'ingest',
                    schedule: ingestionSchedule,
                    configuration: { 
                        target_datasource_id: dataSource.id,
                        source_urls: dataSource.origin_details?.urls || [], // Get URLs from source details
                        deduplication_strategy: 'url_hash'
                    },
                    status: 'active'
                };
                console.log("Creating recurring task:", createPayload);
                const created = await createRecurringTask(createPayload);
                success = !!created;
                if (success) taskName = created!.name;
            }
            if (success) {
                toast({ title: "Schedule Enabled", description: `Task "${taskName}" is now active with schedule: ${ingestionSchedule}` });
            } else {
                 toast({ title: "Update Failed", description: "Could not enable or update the schedule.", variant: "destructive" });
            }
        } else {
            // Disable: Update existing task to paused
            if (localIngestTask) {
                 const updatePayload: RecurringTaskUpdate = { status: 'paused' };
                 console.log("Pausing recurring task:", localIngestTask.id, updatePayload);
                 const updated = await updateRecurringTask(localIngestTask.id, updatePayload);
                 success = !!updated;
                 if (success) {
                     toast({ title: "Schedule Disabled", description: `Task "${taskName}" is now paused.` });
                 } else {
                      toast({ title: "Update Failed", description: "Could not disable the schedule.", variant: "destructive" });
                 }
            } else {
                 // Nothing to do, was already disabled and didn't exist
                 success = true; 
                 toast({ title: "Schedule Disabled", description: "Scheduled ingestion remains disabled.", variant: "default"});
            }
        }
    } catch (error) {
        console.error("Error updating schedule:", error);
        toast({ title: "Error", description: "An unexpected error occurred saving schedule settings.", variant: "destructive" });
        success = false;
    } finally {
        setIsUpdatingSchedule(false);
        if (success) {
            // Update initial state to reflect successful change
            setInitialScheduleState({ enabled: enableScheduledIngestion, schedule: ingestionSchedule });
             // Note: The useEffect watching recurringTasks will update localIngestTask
        }
    }
  };

  // NEW: Render function for the scheduling card
  const renderScheduledIngestionCard = () => {
     if (!dataSource || dataSource.type !== 'url_list') {
         return null;
     }

     const hasChanged = 
        enableScheduledIngestion !== initialScheduleState.enabled || 
        (enableScheduledIngestion && ingestionSchedule !== initialScheduleState.schedule);

     return (
        <Card className="mt-4">
            <CardHeader>
                <CardTitle className="text-base">Scheduled Ingestion</CardTitle>
                <CardDescription>
                    Configure automatic scraping of the source URLs on a regular schedule.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="flex items-center justify-between space-x-2 pt-2">
                    <Label htmlFor="scheduled-ingestion-switch-detail" className="flex flex-col space-y-1">
                        <span>Enable Scheduled Ingestion</span>
                        <span className="font-normal leading-snug text-muted-foreground text-xs">
                            {enableScheduledIngestion ? "Task is active and will run on schedule." : "Task is currently paused or not created."} 
                        </span>
                    </Label>
                    <Switch
                        id="scheduled-ingestion-switch-detail"
                        checked={enableScheduledIngestion}
                        onCheckedChange={setEnableScheduledIngestion}
                        disabled={isUpdatingSchedule}
                        aria-label="Enable Scheduled Ingestion"
                    />
                </div>
                {enableScheduledIngestion && (
                    <div className="space-y-1 pl-3 ml-1 border-l">
                        <Label htmlFor="ingestion-schedule-detail" className="text-sm">Schedule (Cron Format)</Label>
                        <Input
                            id="ingestion-schedule-detail"
                            value={ingestionSchedule}
                            onChange={(e) => setIngestionSchedule(e.target.value)}
                            placeholder="e.g., 0 0 * * *" 
                            className="h-9 text-sm font-mono"
                            disabled={isUpdatingSchedule}
                        />
                        <p className="text-xs text-muted-foreground">
                             {cronExplanation || 'Enter a 5-part cron schedule.'} (UTC)
                        </p>
                    </div>
                )}
                 {/* Display Last Run Info if task exists */} 
                 {localIngestTask && (
                     <div className="text-xs text-muted-foreground pt-3 border-t space-y-1">
                         <p>Task Name: <span className='font-medium text-foreground'>{localIngestTask.name}</span></p>
                         <p>Last Run: {localIngestTask.last_run_at ? formatDistanceToNow(new Date(localIngestTask.last_run_at), { addSuffix: true }) : 'Never'}</p>
                         <p>Last Status: {localIngestTask.last_run_status ? 
                             <Badge variant={localIngestTask.last_run_status === 'success' ? 'default' : 'destructive'} className='text-xs'>
                                 {localIngestTask.last_run_status}
                             </Badge> : 'N/A'}
                         </p>
                         {localIngestTask.last_run_message && <p>Last Message: {localIngestTask.last_run_message}</p>}
                     </div>
                 )}
            </CardContent>
            <CardFooter>
                 <Button 
                    onClick={handleScheduleUpdate} 
                    disabled={isUpdatingSchedule || !hasChanged}
                    size="sm"
                 >
                     {isUpdatingSchedule && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                     Save Schedule Changes
                 </Button>
            </CardFooter>
        </Card>
     );
  }

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

  // --- CSV Filtering and Sorting Logic ---
  const filteredAndSortedCsvData = useMemo(() => {
    if (!csvData?.data) return [];

    let data = [...csvData.data]; // Create a mutable copy

    // Apply search filter
    if (csvSearchTerm) {
      const lowerCaseSearch = csvSearchTerm.toLowerCase();
      data = data.filter(row =>
        Object.values(row.row_data).some(value =>
          String(value).toLowerCase().includes(lowerCaseSearch)
        )
      );
    }

    // Apply sorting
    if (sortColumn && sortDirection) {
      data.sort((a, b) => {
        const valA = a.row_data[sortColumn];
        const valB = b.row_data[sortColumn];

        // Basic comparison (can be enhanced for different types)
        if (valA !== null && valB !== null && valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA !== null && valB !== null && valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [csvData?.data, csvSearchTerm, sortColumn, sortDirection]);

  // --- CSV Pagination Logic ---
  const totalPages = csvData ? Math.ceil(csvData.total_rows / csvRowsPerPage) : 0;

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      // Reset selection when changing page
      setSelectedRowData(null);
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

  // --- CSV Sort Handler ---
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Cycle through directions: asc -> desc -> null
      setSortDirection(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc');
    } else {
      // New column, start with ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
    // Reset selection when sorting
    setSelectedRowData(null);
  };

  // --- Rendering for Selected Row Detail ---
  const renderSelectedRowDetail = () => {
    if (!selectedRowData || dataSource?.type !== 'csv') {
      return null;
    }

    // FIX: Check if selectedJobId is null
    const jobNameForDialog = selectedJobId !== null ? (availableJobsFromStore[selectedJobId]?.name || `Job ${selectedJobId}`) : 'All Jobs';

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

  // Combined handler for job selection
  const handleJobSelect = (jobIdStr: string | null) => {
    setSelectedJobId(jobIdStr === 'all' ? null : jobIdStr);
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
                }
                  className="capitalize flex items-center gap-1"
                >
                  {dataSource.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
                  {displayStatus}
                </Badge>
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

          {/* NEW: Insert Scheduling Card */}
          {renderScheduledIngestionCard()}

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
                         {/* NEW: Search Bar */}
                         <div className="relative max-w-xs">
                           <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                           <Input
                             placeholder="Search this page..."
                             value={csvSearchTerm}
                             onChange={(e) => {
                               setCsvSearchTerm(e.target.value);
                               setSelectedRowData(null); // Reset selection on search
                             }}
                             className="pl-8 h-8 text-sm"
                           />
                         </div>

                         <div className="border rounded-md overflow-auto relative w-full max-h-[30vh] max-w-[50vw]">
                           <Table className="text-xs max-w-screen-3xl">
                             <TableHeader className="sticky top-0 bg-muted z-10">
                               <TableRow>
                                 <TableHead className="w-[80px] px-2 py-2 font-semibold sticky left-0 bg-muted z-10 border-r shadow-sm">Row</TableHead>
                                 {csvData.columns.map((col) => (
                                   <TableHead
                                     key={col}
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
                                 ))
                               ) : (
                                 <TableRow>
                                   <TableCell colSpan={csvData.columns.length + 1} className="h-24 text-center text-muted-foreground italic">
                                     {csvSearchTerm ? 'No results found for your search.' : 'No data available.'}
                                   </TableCell>
                                 </TableRow>
                               )}
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