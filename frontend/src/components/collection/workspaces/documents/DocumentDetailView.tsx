'use client';

import React, { useState, useEffect, useCallback, useMemo, ChangeEvent } from 'react';
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { format } from "date-fns"
import { Button } from '@/components/ui/button';
import { ClassificationSchemeRead, FieldType, EnhancedClassificationResultRead, CsvRowData, CsvRowsOut, DataSourceRead as ClientDataSourceRead, DataSourceRead } from '@/client/models'; // Renamed DataSourceRead to avoid conflict
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClassificationResultsService, ClassificationSchemesService, ClassificationJobsService } from '@/client/services';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import ClassificationResultDisplay from '../classifications/ClassificationResultDisplay';
import { PlusCircle, Lock, Unlock, ArrowRight, Loader2, Check, ChevronDown, ChevronUp, ExternalLink, RefreshCw, AlertCircle, Info, Search, ArrowUp, ArrowDown, Download, Eye, X, Save, Trash2, Pencil, AlertTriangle } from "lucide-react"; // Added Search, ArrowUp, ArrowDown, Download, Eye, X, Save, Trash2, Pencil, AlertTriangle
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { useClassificationJobsStore, useClassificationJobsActions, useIsClassificationJobsLoading, useClassificationJobsError } from "@/zustand_stores/storeClassificationJobs";
import { DatarecordsService, DatasourcesService } from '@/client/services';
import { DataRecordRead, DataSourceRead as ClientDataSourceReadAlias, DataSourceType, DataSourceStatus, DataSourceUpdate } from '@/client/models'; // Use Alias, import DataSourceUpdate
import { useDataSourceStore } from '@/zustand_stores/storeDataSources'; // Import DataSource store
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
import useAuth from '@/hooks/useAuth';
import { Textarea } from "@/components/ui/textarea"
import Link from 'next/link';
import { useDatasetStore } from '@/zustand_stores/storeDatasets';
import DatasetCreateDialog from '../datasets/DatasetCreateDialog';

// Define Sort Direction type
type SortDirection = 'asc' | 'desc' | null;

interface DataRecordDetailViewProps {
  onEdit: (item: ClientDataSourceReadAlias) => void; // Use Alias
  schemes: ClassificationSchemeRead[];
  selectedDataSourceId: number | null;
  onLoadIntoRunner?: (jobId: number, jobName: string) => void;
}

const DataRecordDetailView = ({
  onEdit,
  schemes,
  selectedDataSourceId,
  onLoadIntoRunner
}) => {
  // --- State Hooks ---
  const [dataSource, setDataSource] = useState<ClientDataSourceReadAlias | null>(null);
  const [dataRecords, setDataRecords] = useState<DataRecordRead[]>([]);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<EnhancedClassificationResultRead | null>(null);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [classificationResults, setClassificationResults] = useState<EnhancedClassificationResultRead[]>([]);
  const { toast } = useToast();
  const { activeWorkspace } = useWorkspaceStore();

  // State for CSV data
  const [csvData, setCsvData] = useState<CsvRowsOut | null>(null);
  const [isLoadingCsv, setIsLoadingCsv] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const csvRowsPerPage = 30;
  const [csvSearchTerm, setCsvSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // State for Row Detail Dialog
  const [selectedRowData, setSelectedRowData] = useState<CsvRowData | null>(null);

  // State for URL List DataRecords
  const [urlListDataRecords, setUrlListDataRecords] = useState<DataRecordRead[]>([]);
  const [isLoadingUrlList, setIsLoadingUrlList] = useState(false);
  const [urlListError, setUrlListError] = useState<string | null>(null);
  const [urlListCurrentPage, setUrlListCurrentPage] = useState(1);
  const [urlListTotalRecords, setUrlListTotalRecords] = useState(0);
  const urlListRecordsPerPage = 10;

  // ---> ADDED: State for scraped content view mode
  type ScrapedContentViewMode = 'flat' | 'grouped';
  const [scrapedContentViewMode, setScrapedContentViewMode] = useState<ScrapedContentViewMode>('flat');
  // <--- END ADDED

  // ---> ADDED: State for highlighted record ID
  const [highlightedRecordId, setHighlightedRecordId] = useState<number | null>(null);
  // <--- END ADDED

  // State for URL List editing
  const [editableUrls, setEditableUrls] = useState<string[]>([]);
  const [newUrlInput, setNewUrlInput] = useState<string>('');
  const [isSavingUrls, setIsSavingUrls] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);

  // State for classification results specific to the selected CSV row
  const [selectedRowResults, setSelectedRowResults] = useState<EnhancedClassificationResultRead[]>([]);

  // State for Scheduling UI
  const [localIngestTask, setLocalIngestTask] = useState<RecurringTask | null>(null);
  const [enableScheduledIngestion, setEnableScheduledIngestion] = useState(false);
  const [ingestionSchedule, setIngestionSchedule] = useState('0 0 * * *');
  const [cronExplanation, setCronExplanation] = useState('');
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const [initialScheduleState, setInitialScheduleState] = useState({ enabled: false, schedule: '' });

  // --- State for Inline PDF Viewer ---
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [isFetchingPdfForView, setIsFetchingPdfForView] = useState(false);

  // --- Custom Hook Calls --- (Should come after state)
  const { classificationJobs: availableJobsFromStore } = useClassificationJobsStore();
  const { fetchClassificationJobs } = useClassificationJobsActions();
  const {
      recurringTasks,
      getIngestTaskForDataSource,
      createRecurringTask,
      updateRecurringTask,
      deleteRecurringTask // Maybe needed later?
  } = useRecurringTasksStore();
  const { updateDataSource, refetchDataSource } = useDataSourceStore();

  // Get necessary functions from store
  const { 
    addUrlToDataSource, 
    updateDataSourceUrls, 
    getDataSourceUrls 
  } = useDataSourceStore();

  const { createDataset } = useDatasetStore();

  const [isDatasetCreateDialogOpen, setIsDatasetCreateDialogOpen] = useState(false);

  // First, add state for time axis configuration
  const [timeAxisConfig, setTimeAxisConfig] = useState<TimeAxisConfig>({
    selectedField: null,
    selectedScheme: null,
    timeRange: null
  });

  // --- Callbacks (useCallback) --- (Define fetchAll, fetchUrls etc. here)

  const fetchClassificationResults = useCallback(
    async (workspaceId: number, datasourceId: number, jobIdFilter: number | null) => {
      setIsLoadingResults(true);
      setResultsError(null);
      try {
        const filterParams: any = {
          workspaceId: workspaceId,
          datasourceId: datasourceId,
          jobId: jobIdFilter ?? undefined,
          limit: 1000
        };

        console.log("Fetching classification results with params:", filterParams);
        const results = await ClassificationResultsService.listClassificationResults(filterParams);
        setClassificationResults(results);
      } catch (error: any) {
        console.error("Error fetching classification results:", error);
        setResultsError("Failed to load classification results.");
      } finally {
        setIsLoadingResults(false);
      }
    },
    [] // Keep dependency array minimal, setters are stable
  );

  const fetchCsvData = useCallback(async (workspaceId: number, datasourceId: number, pageToFetch: number) => {
    if (!datasourceId || !workspaceId) {
        setCsvData(null);
        return;
    }

    setIsLoadingCsv(true);
    setCsvError(null);
    const skip = (pageToFetch - 1) * csvRowsPerPage;

    try {
        const result = await DatasourcesService.readDatasourceRows({
            workspaceId: workspaceId,
            datasourceId: datasourceId,
            skip: skip,
            limit: csvRowsPerPage
        });
        setCsvData(result);
        setCsvSearchTerm('');
        setSortColumn(null);
        setSortDirection(null);
    } catch (err: any) {
        console.error("Error fetching CSV rows:", err);
        const errorDetail = err.body?.detail || err.message || "Failed to load CSV data.";
        setCsvError(`Failed to load CSV content: ${errorDetail}`);
        setCsvData(null);
    } finally {
        setIsLoadingCsv(false);
    }
  }, [csvRowsPerPage]);

  const fetchUrlListData = useCallback(async (workspaceId: number, datasourceId: number, pageToFetch: number, totalRecordsEstimate: number) => {
    if (!workspaceId || !datasourceId) {
        setUrlListDataRecords([]);
        setUrlListTotalRecords(0);
        return;
    }

    setIsLoadingUrlList(true);
    setUrlListError(null);
    const skip = (pageToFetch - 1) * urlListRecordsPerPage;

    try {
        // Use the passed estimate
        setUrlListTotalRecords(totalRecordsEstimate);

        const recordsResponse = await DatarecordsService.listDatarecords({
           workspaceId: workspaceId,
           datasourceId: datasourceId,
           skip: skip,
           limit: urlListRecordsPerPage
        });
        setUrlListDataRecords(recordsResponse || []);

    } catch (err: any) {
         console.error("Error fetching URL List data records:", err);
         const errorDetail = err.body?.detail || err.message || "Failed to load scraped content.";
         setUrlListError(`Failed to load URL List content: ${errorDetail}`);
         setUrlListDataRecords([]);
         setUrlListTotalRecords(0);
    } finally {
         setIsLoadingUrlList(false);
    }
    // Removed dataSource dependency
  }, [urlListRecordsPerPage]);

  const fetchAll = useCallback(async () => {
    if (!selectedDataSourceId || !activeWorkspace?.id) {
        // Reset logic copied from user merge
        setDataSource(null); setDataRecords([]); setClassificationResults([]); setCsvData(null); setCurrentPage(1); setSourceError(null); setCsvError(null);
        setSelectedRowData(null); setCsvSearchTerm(''); setSortColumn(null); setSortDirection(null); setUrlListDataRecords([]); setUrlListCurrentPage(1);
        setUrlListTotalRecords(0); setUrlListError(null); setLocalIngestTask(null); setIsPdfViewerOpen(false);
        if (pdfBlobUrl) { window.URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); }
        setEditableUrls([]); setNewUrlInput(''); setIsSavingUrls(false); setIsRefetching(false);
        return;
    }
    console.log(`fetchAll triggered for DataSource ID: ${selectedDataSourceId}`);
    setIsLoadingSource(true); setSourceError(null); setCsvData(null); setCsvError(null); setCurrentPage(1); setCsvSearchTerm(''); setSortColumn(null); setSortDirection(null);
    setUrlListDataRecords([]); setUrlListError(null); setLocalIngestTask(null);
    setEditableUrls([]); setNewUrlInput(''); setIsSavingUrls(false); setIsRefetching(false);

    try {
        const source = await DatasourcesService.getDatasource({
            workspaceId: activeWorkspace.id,
            datasourceId: selectedDataSourceId,
        });
        console.log("Fetched DataSource:", source);
        setDataSource(source); // This triggers the useEffect below

        // Fetch results immediately, others triggered by useEffect
        await fetchClassificationResults(activeWorkspace.id, source.id, null);

    } catch (err: any) {
        console.error("Error in fetchAll:", err);
        const errorDetail = err.body?.detail || err.message || "Unknown error";
        setSourceError(`Failed to load source details: ${errorDetail}`);
        setDataSource(null); // Clear DS on error
        setDataRecords([]);
        setClassificationResults([]);
        setCsvData(null);
        setUrlListDataRecords([]);
        setEditableUrls([]); // Clear URLs on error too
    } finally {
        setIsLoadingSource(false);
    }
  }, [selectedDataSourceId, activeWorkspace?.id, fetchClassificationResults, pdfBlobUrl]);

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
        if (result.datarecord_id !== null && result.datarecord_id !== undefined) {
        const resultsForThisDataRecord = results.filter(r => r.datarecord_id === result.datarecord_id);
        const schemeIds = [...new Set(resultsForThisDataRecord.map(r => r.scheme_id))];

        onLoadIntoRunner(jobId, jobName);

        toast({
          title: "Success",
             description: `Loaded job "${jobName}" with ${schemeIds.length} schemes for data record ${result.datarecord_id}`,
           });
        } else {
           console.warn("Cannot prepare data for runner: result is missing datarecord_id", result);
           onLoadIntoRunner(jobId, jobName);
        }
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

  const handleChartPointClick = useCallback((point: any) => {
    console.log("Chart point clicked:", point);
  }, []);

  const handleRefreshClassificationResults = useCallback(async () => {
    if (!dataSource?.id || !activeWorkspace?.id) return;
    const jobId = selectedJobId ? parseInt(selectedJobId, 10) : null;
    await fetchClassificationResults(activeWorkspace.id, dataSource.id, jobId);
  }, [dataSource?.id, activeWorkspace?.id, selectedJobId, fetchClassificationResults]);

  const getResultsForRecord = useCallback((recordId: number): EnhancedClassificationResultRead[] => {
    if (!Array.isArray(classificationResults)) return [];
    return classificationResults.filter(r => r.datarecord_id === recordId);
  }, [classificationResults]);

  const handleJobSelect = useCallback((jobIdStr: string | null) => {
    setSelectedJobId(jobIdStr === 'all' ? null : jobIdStr);
    setSelectedRowData(null);
    if (dataSource && activeWorkspace?.id) {
        const jobIdNum = jobIdStr && jobIdStr !== 'all' ? parseInt(jobIdStr, 10) : null;
        fetchClassificationResults(activeWorkspace.id, dataSource.id, jobIdNum);
    }
  }, [dataSource, activeWorkspace?.id, fetchClassificationResults]);

  const handlePageChange = useCallback((page: number) => {
    if (!dataSource || !activeWorkspace?.id || dataSource.type !== 'csv') return;
    fetchCsvData(activeWorkspace.id, dataSource.id, page);
    setCurrentPage(page);
    setSelectedRowData(null);
  }, [fetchCsvData, dataSource, activeWorkspace?.id]);

  const handleUrlListPageChange = useCallback((page: number) => {
    if (!dataSource || !activeWorkspace?.id || dataSource.type !== 'url_list') return;
    // Pass the current total records state when changing page
    fetchUrlListData(activeWorkspace.id, dataSource.id, page, urlListTotalRecords);
    setUrlListCurrentPage(page);
    // Dependencies: fetchUrlListData, dataSource, activeWorkspace.id, urlListTotalRecords
  }, [fetchUrlListData, dataSource, activeWorkspace?.id, urlListTotalRecords]);

  const handleSort = useCallback((column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setSelectedRowData(null);
  }, [sortColumn]);

  const handleScheduleUpdate = useCallback(async () => {
    if (!dataSource || dataSource.type !== 'url_list' || !activeWorkspace?.id) return;

    const hasChanged =
        enableScheduledIngestion !== initialScheduleState.enabled ||
        (enableScheduledIngestion && ingestionSchedule !== initialScheduleState.schedule);

    if (!hasChanged) {
        toast({ title: "No Changes", description: "Schedule settings are already up to date.", variant: "default"});
        return;
    }

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
                const updatePayload: RecurringTaskUpdate = { status: 'active', schedule: ingestionSchedule };
                const updated = await updateRecurringTask(localIngestTask.id, updatePayload);
                success = !!updated;
                if (success) taskName = updated!.name;
            } else {
                // Use the *current* editableUrls when creating a new task
                const createPayload: RecurringTaskCreate = {
                    name: taskName,
                    description: `Automatically scrapes URLs for DataSource ${dataSource.name} (ID: ${dataSource.id})`,
                    type: 'ingest',
                    schedule: ingestionSchedule,
                    configuration: {
                        target_datasource_id: dataSource.id,
                        source_urls: editableUrls, // Use current state
                        deduplication_strategy: 'url_hash'
                    },
                    status: 'active'
                };
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
            if (localIngestTask) {
                 const updatePayload: RecurringTaskUpdate = { status: 'paused' };
                 const updated = await updateRecurringTask(localIngestTask.id, updatePayload);
                 success = !!updated;
                 if (success) {
                     toast({ title: "Schedule Disabled", description: `Task "${taskName}" is now paused.` });
                 } else {
                      toast({ title: "Update Failed", description: "Could not disable the schedule.", variant: "destructive" });
                 }
            } else {
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
            setInitialScheduleState({ enabled: enableScheduledIngestion, schedule: ingestionSchedule });
        }
    }
  }, [dataSource, activeWorkspace?.id, editableUrls, enableScheduledIngestion, initialScheduleState, ingestionSchedule, localIngestTask, updateRecurringTask, createRecurringTask, toast]);

  // Revert handleDownloadPdf to use authenticated fetch and trigger download
  // This time, get the token directly from localStorage
  const handleDownloadPdf = useCallback(async () => {
    if (dataSource?.type === 'pdf' && activeWorkspace?.id && dataSource.id) {
      // Construct the download endpoint URL
      const downloadUrl = `/api/v1/workspaces/${activeWorkspace.id}/datasources/${dataSource.id}/pdf_download`;
      toast({ title: "Starting Download", description: "Preparing PDF file..." });

      // Retrieve token directly from localStorage
      const token = typeof window !== 'undefined' ? localStorage.getItem("access_token") : null;

      if (!token) {
        console.error("Cannot download PDF: Authentication token not found.");
        toast({
          title: "Authentication Error",
          description: "Could not find authentication token. Please log in again.",
          variant: "destructive",
        });
        return; // Stop if no token
      }

      try {
        const response = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            // Set the Authorization header using the retrieved token
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          let errorDetail = `HTTP error! Status: ${response.status}`;
          try {
            // Try to get more specific error detail from the response body
            const errorData = await response.json();
            errorDetail = errorData.detail || errorDetail;
          } catch (e) { /* Ignore if response is not JSON */ }
          throw new Error(errorDetail);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        // Extract filename from Content-Disposition header
        const disposition = response.headers.get('content-disposition');
        let filename = `datasource_${dataSource.id}.pdf`; // Default filename
        if (disposition && disposition.includes('attachment')) {
            // Regex to extract filename, handling quotes correctly
            const filenameRegex = /filename[^;=\n]*=((['"])(.*?)\2|([^;\n]*))/;
            const matches = filenameRegex.exec(disposition);
            if (matches?.[3]) { 
              filename = matches[3].replace(/^"|"$/g, ''); // Filename in quotes
            } else if (matches?.[4]) {
              filename = matches[4]; // Filename without quotes
            }
        }

        // Create temporary link and trigger download
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        
        // Clean up the temporary link and blob URL
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        toast({ title: "Download Started", description: `Downloading ${filename}.` });

      } catch (error: any) {
        console.error("Failed to download PDF:", error);
        toast({
          title: "Download Failed",
          description: error.message || "Could not download the PDF file.",
          variant: "destructive",
        });
      }
    } else {
      // Log if the initial conditions aren't met
      console.error("Cannot initiate PDF download: Missing workspace, datasource ID, or incorrect type.");
      toast({
        title: "Download Error",
        description: "Could not initiate PDF download. Check source details.",
        variant: "destructive",
      });
    }
  // Dependency array remains the same as token is retrieved inside the callback
  }, [dataSource, activeWorkspace?.id, toast]);

  // --- NEW: Callback to handle viewing PDF inline ---
  const handleViewPdf = useCallback(async () => {
    // If viewer is already open, close it and revoke URL
    if (isPdfViewerOpen && pdfBlobUrl) {
      setIsPdfViewerOpen(false);
      window.URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
      return;
    }

    // If viewer is closed, fetch PDF and open it
    if (dataSource?.type === 'pdf' && activeWorkspace?.id && dataSource.id) {
      setIsFetchingPdfForView(true); // Start loading indicator

      // Check metadata first
      const storagePath = dataSource.source_metadata?.storage_path;
      if (!storagePath) {
        toast({ 
          title: "Error", 
          description: "PDF file location not found. The file might not be properly uploaded.", 
          variant: "destructive" 
        });
        setIsFetchingPdfForView(false);
        return;
      }

      const viewUrl = `/api/v1/workspaces/${activeWorkspace.id}/datasources/${dataSource.id}/content`;

      const token = typeof window !== 'undefined' ? localStorage.getItem("access_token") : null;

      if (!token) {
        toast({ 
          title: "Authentication Error", 
          description: "Could not find authentication token.", 
          variant: "destructive" 
        });
        setIsFetchingPdfForView(false);
        return;
      }

      try {
        const response = await fetch(viewUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!response.ok) {
          let errorDetail = `HTTP error! Status: ${response.status}`;
          try { 
            const errorData = await response.json(); 
            errorDetail = errorData.detail || errorDetail; 
          } catch (e) { /* Ignore */ }
          throw new Error(errorDetail);
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error("Received empty PDF file");
        }

        const objectUrl = window.URL.createObjectURL(blob);
        setPdfBlobUrl(objectUrl);
        setIsPdfViewerOpen(true);

      } catch (error: any) {
        console.error("Failed to fetch PDF for viewing:", error);
        toast({ 
          title: "View Failed", 
          description: error.message || "Could not load PDF for viewing.", 
          variant: "destructive" 
        });
        setIsPdfViewerOpen(false);
        setPdfBlobUrl(null);
      } finally {
        setIsFetchingPdfForView(false);
      }
    } else {
      toast({ 
        title: "View Error", 
        description: "Not a valid PDF source.", 
        variant: "destructive" 
      });
    }
  }, [dataSource, activeWorkspace?.id, toast, isPdfViewerOpen, pdfBlobUrl]);

  // --- Memoized Values (useMemo) --- (Define after callbacks)

  const jobsWithResultsForDataSource = useMemo(() => {
     if (!availableJobsFromStore || typeof availableJobsFromStore !== 'object') return [];
     if (!Array.isArray(classificationResults)) return [];

     return Object.values(availableJobsFromStore).filter(job =>
       job && job.id !== undefined && classificationResults.some(result => result && result.job_id === job.id)
     );
  }, [availableJobsFromStore, classificationResults]);

  const filteredResults = useMemo(() => {
    if (!Array.isArray(classificationResults)) return [];
    return classificationResults;
  }, [classificationResults]);

  const jobResultCounts: Record<number, number> = useMemo(() => {
    const counts: Record<number, number> = {};
    if (!Array.isArray(classificationResults)) return counts;

    for (const result of classificationResults) {
      if (result && result.job_id !== null && result.job_id !== undefined) {
        counts[result.job_id] = (counts[result.job_id] || 0) + 1;
      }
    }
    return counts;
  }, [classificationResults]);

  const filteredAndSortedCsvData: CsvRowData[] = useMemo(() => {
    if (!csvData?.data) return [];

    let data = [...csvData.data];

    if (csvSearchTerm) {
      const lowerCaseSearch = csvSearchTerm.toLowerCase();
      data = data.filter(row =>
        row && row.row_data &&
        Object.values(row.row_data).some(value =>
          value !== null && value !== undefined &&
          String(value).toLowerCase().includes(lowerCaseSearch)
        )
      );
    }

    if (sortColumn && sortDirection) {
      data.sort((a, b) => {
        const valA = a?.row_data?.[sortColumn];
        const valB = b?.row_data?.[sortColumn];

        if (valA === null || valA === undefined) return sortDirection === 'asc' ? 1 : -1;
        if (valB === null || valB === undefined) return sortDirection === 'asc' ? -1 : 1;

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [csvData?.data, csvSearchTerm, sortColumn, sortDirection]);

  const totalPages = useMemo(() => csvData ? Math.ceil(csvData.total_rows / csvRowsPerPage) : 0, [csvData, csvRowsPerPage]);

  const urlListTotalPages = useMemo(() => urlListTotalRecords > 0 ? Math.ceil(urlListTotalRecords / urlListRecordsPerPage) : 0, [urlListTotalRecords, urlListRecordsPerPage]);

  // ---> ADDED: Memoized sorting and grouping for URL list records ---
  const { sortedFlatList, groupedRecords } = useMemo(() => {
      // Sort flat list by time (newest first)
      const sortedRecords = [...urlListDataRecords].sort((a, b) => {
          const timeA = a.event_timestamp ? new Date(a.event_timestamp).getTime() : 0;
          const timeB = b.event_timestamp ? new Date(b.event_timestamp).getTime() : 0;
          return timeB - timeA; // Descending order
      });

      // Group records by URL and sort within groups by time
      const groups = sortedRecords.reduce<Record<string, DataRecordRead[]>>((acc, record) => {
          const url = (record.source_metadata as any)?.original_url || 'Unknown URL';
          if (!acc[url]) {
              acc[url] = [];
          }
          acc[url].push(record);
          // Records are already sorted by time due to using sortedRecords
          return acc;
      }, {});

      return { sortedFlatList: sortedRecords, groupedRecords: groups };
  }, [urlListDataRecords]); // Recalculate when records change
  // <--- END ADDED ---

  // --- Effects Section (Keep effects after hooks and callbacks) ---

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchClassificationJobs(activeWorkspace.id);
    }
  }, [activeWorkspace?.id, fetchClassificationJobs]);

  useEffect(() => {
      console.log(`Selected DataSource ID changed to: ${selectedDataSourceId}. Triggering fetchAll.`);
      fetchAll();
  }, [selectedDataSourceId, fetchAll]);

  // Effect: Fetch records, URLs, or PDF metadata when the dataSource state changes
  useEffect(() => {
    if (!dataSource || !activeWorkspace?.id) return;

    console.log(`DataSource state updated. Type: ${dataSource.type}. Triggering type-specific actions.`);

    // Clear states for other types initially
    setEditableUrls([]);
    setPdfBlobUrl(null);
    setDataRecords([]); // Clear general records
    setSelectedRowData(null); // Clear CSV selection
    setCsvData(null); // Clear raw CSV data
    setSelectedRowResults([]); // Clear results for selected row

    // Trigger actions based on type
    if (dataSource.type === 'csv') {
      fetchCsvData(activeWorkspace.id, dataSource.id, 1);
    } else if (dataSource.type === 'url_list') {
      // Initialize editableUrls from the fetched dataSource
      const initialUrls = (dataSource.origin_details as any)?.urls || [];
      setEditableUrls(initialUrls);
      // Fetch associated data records (scraped content)
      fetchUrlListData(activeWorkspace.id, dataSource.id, 1, dataSource.data_record_count ?? 0);
    } else if (dataSource.type === 'pdf') {
      // Fetch the single data record associated with the PDF
      DatarecordsService.listDatarecords({
          workspaceId: activeWorkspace.id,
          datasourceId: dataSource.id,
          limit: 1
      }).then(recordsResponse => {
          setDataRecords(recordsResponse || []);
          console.log("Fetched single record for PDF source:", recordsResponse);
      }).catch(err => {
          console.error("Failed to fetch record for PDF source:", err);
          setDataRecords([]);
      });
    } else if (dataSource.type === 'text_block') {
      // Fetch the single data record for the text block
      DatarecordsService.listDatarecords({
          workspaceId: activeWorkspace.id,
          datasourceId: dataSource.id,
          limit: 1
      }).then(recordsResponse => {
          setDataRecords(recordsResponse || []);
      }).catch(err => {
          console.error("Failed to fetch record for text_block source:", err);
          setDataRecords([]);
      });
    } else {
      console.warn(`Unsupported or unknown dataSource type: ${dataSource.type}. Resetting.`);
    }

  }, [dataSource, activeWorkspace?.id, fetchCsvData, fetchUrlListData]); // Removed fetchUrls dependency

  useEffect(() => {
    if (dataSource?.type === 'csv' && selectedRowData) {
      toast({ title: "Duplicate URL", description: "This URL is already in the list.", variant: "default"});
    }
  }, [newUrlInput, editableUrls, toast]);

  const handleAddUrl = useCallback(() => {
    const urlToAdd = newUrlInput.trim();
    if (!urlToAdd) return; // Ignore empty input

    // Basic URL validation (can be enhanced)
    try {
      new URL(urlToAdd); // Throws error if invalid
    } catch (_) {
      toast({ title: "Invalid URL", description: "Please enter a valid URL starting with http:// or https://", variant: "destructive"});
      return;
    }

    if (editableUrls.includes(urlToAdd)) {
      toast({ title: "Duplicate URL", description: "This URL is already in the list.", variant: "default"});
    } else {
      setEditableUrls(prev => [...prev, urlToAdd]);
      setNewUrlInput(''); // Clear input after adding
    }
  }, [newUrlInput, editableUrls, toast]);

  const handleRemoveUrl = useCallback((urlToRemove: string) => {
      setEditableUrls(prev => prev.filter(url => url !== urlToRemove));
  }, []);

  const handleSaveUrls = useCallback(async () => {
      if (!dataSource || !activeWorkspace?.id) return;
      // Check if URLs actually changed
      const originalUrls = (dataSource.origin_details as any)?.urls || [];
      if (JSON.stringify([...editableUrls].sort()) === JSON.stringify([...originalUrls].sort())) {
          toast({ title: "No Changes", description: "URL list has not been modified.", variant: "default" });
          return;
      }

      setIsSavingUrls(true);
      const updatePayload: DataSourceUpdate = {
          // Include existing origin_details and only update urls within it
          origin_details: { ...dataSource.origin_details, urls: editableUrls }
      };
      // Use the store action
      const updatedSource = await updateDataSource(dataSource.id, updatePayload);
      setIsSavingUrls(false);
      if (updatedSource) {
          // Update local dataSource state to reflect changes immediately
          setDataSource(updatedSource);
          toast({ title: "Success", description: "URL list saved." });
      } else {
          // Error handled in store action
          // Revert editableUrls to original state if save failed
          setEditableUrls((dataSource.origin_details as any)?.urls || []);
      }
    // Dependencies: dataSource, activeWorkspace, editableUrls, updateDataSource, toast
  }, [dataSource, activeWorkspace?.id, editableUrls, updateDataSource, toast]);

  const handleRefetch = useCallback(async () => {
      if (!dataSource || !activeWorkspace?.id) return;
      setIsRefetching(true);
      // Use the store action
      const success = await refetchDataSource(dataSource.id);
      setIsRefetching(false);
      if (success) {
         // Optionally trigger fetchAll again after a delay or rely on polling
         // setTimeout(fetchAll, 2000);
      }
      // Dependencies: dataSource, activeWorkspace, refetchDataSource
  }, [dataSource, activeWorkspace?.id, refetchDataSource]);

  // Add function to create dataset from current data
  const handleCreateDataset = () => {
    if (!dataSource) return;

    // Get all record IDs
    const recordIds = dataRecords.map(r => r.id);
    
    // Get all job IDs from results
    const jobIds = Array.from(new Set(classificationResults.map(r => r.job_id)));
    
    // Get all scheme IDs from results
    const schemeIds = Array.from(new Set(classificationResults.map(r => r.scheme_id)));

    setIsDatasetCreateDialogOpen(true);
  };

  // Add dataset creation button to the header actions
  const renderHeaderActions = () => (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCreateDataset}
        disabled={!dataSource || dataRecords.length === 0}
      >
        <PlusCircle className="h-4 w-4 mr-2" />
        Create Dataset
      </Button>
      {/* ... other header actions ... */}
    </div>
  );

  // Add helper functions for display
  const displayTitle = (dataSource: DataSourceRead | null) => {
    if (!dataSource) return 'No source selected';
    return dataSource.name;
  };

  const displayType = (dataSource: DataSourceRead | null) => {
    if (!dataSource) return '';
    return dataSource.type;
  };

  // Add selected row detail rendering
  const renderSelectedRowDetail = () => {
    if (!selectedRowData || dataSource?.type !== 'csv') {
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

  // Add job name for dialog
  const jobNameForDialog = useMemo(() => {
    if (!dataSource) return '';
    return `${dataSource.name} - ${new Date().toLocaleString()}`;
  }, [dataSource]);

  // --- Rendering Logic Starts Here ---

  if (isLoadingSource && !dataSource) {
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

  const renderPdfButtons = () => {
    if (dataSource?.type === 'pdf') {
      return (
        <div className="flex items-center gap-2 mb-4">
          <Button onClick={handleViewPdf} variant="outline" size="sm" disabled={isFetchingPdfForView}>
            {isFetchingPdfForView ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isPdfViewerOpen ? (
              <X className="mr-2 h-4 w-4" /> // Show X icon when open
            ) : (
              <Eye className="mr-2 h-4 w-4" /> // Show Eye icon when closed
            )}
            {isPdfViewerOpen ? 'Close Viewer' : 'View Inline'}
          </Button>
          <Button onClick={handleDownloadPdf} variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
        </div>
      );
    }
    return null; // Return null if not a PDF source
  };

  const renderClassificationSection = () => {
    const renderTimeSeriesChart = () => {
      if (!filteredResults.length) {
        return (
          <div className="text-center py-8 text-muted-foreground">
            No classification results available {selectedJobId !== null ? 'for the selected job' : 'for this data source'}.
          </div>
        );
      }

      // Group results by scheme
      const resultsByScheme = filteredResults.reduce((acc, result) => {
        const scheme = schemes.find(s => s.id === result.scheme_id);
        if (!scheme) return acc;
        
        if (!acc[scheme.id]) {
          acc[scheme.id] = {
            scheme,
            results: []
          };
        }
        acc[scheme.id].results.push(result);
        return acc;
      }, {} as Record<number, { scheme: ClassificationSchemeRead, results: EnhancedClassificationResultRead[] }>);

      return (
        <div className="space-y-4">
          {Object.values(resultsByScheme).map(({ scheme, results }) => (
            <Card key={scheme.id} className="p-4">
              <CardHeader className="p-0 pb-4">
                <CardTitle className="text-base flex items-center justify-between">
                  {scheme.name}
                  <Badge variant="outline" className="ml-2">
                    {results.length} results
                  </Badge>
                </CardTitle>
              </CardHeader>
              <div className="space-y-2">
                {results.map(result => (
                  <div
                    key={result.id}
                    className="p-2 bg-muted/20 rounded border text-sm cursor-pointer hover:bg-muted/30"
                    onClick={() => {
                      setSelectedResult(result);
                      setIsResultDialogOpen(true);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        {result.job_id && (
                          <Badge variant="outline" className="text-xs">
                            {availableJobsFromStore[result.job_id]?.name || `Job ${result.job_id}`}
                          </Badge>
                        )}
                        {result.timestamp && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(result.timestamp), "PP")}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (result.job_id && onLoadIntoRunner) {
                            handleLoadIntoRunner(result);
                          }
                        }}
                        disabled={!result.job_id || !onLoadIntoRunner}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Load in Runner
                      </Button>
                    </div>
                    <ClassificationResultDisplay
                      result={result}
                      scheme={scheme}
                      compact={true}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      );
    };

    return (
      <div className="p-4 w-full bg-card rounded-lg shadow-sm border">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {renderJobSelector()}
        </div>

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
          <Tabs defaultValue="list" className="mt-2">
            <TabsList className="mb-2">
              <TabsTrigger value="list">List View</TabsTrigger>
              <TabsTrigger value="chart">Time Series</TabsTrigger>
            </TabsList>
            
            <TabsContent value="list" className="min-h-[400px]">
              {renderTimeSeriesChart()}
            </TabsContent>
            
            <TabsContent value="chart" className="min-h-[400px]">
              {filteredResults.length > 0 ? (
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg">
                    <ClassificationTimeAxisControls
                      config={timeAxisConfig}
                      onChange={setTimeAxisConfig}
                      schemes={schemes}
                    />
                  </div>
                  <div className="p-4 border rounded-lg">
                    <ResultsChart
                      results={filteredResults.map(adaptEnhancedResultReadToFormattedResult)}
                      schemes={schemes}
                      onDataPointClick={handleChartPointClick}
                      timeAxisConfig={timeAxisConfig}
                      filters={[]}
                    />
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No classification results available {selectedJobId !== null ? 'for the selected job' : 'for this data source'}.
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    );
  };

  const renderContent = () => {
    if (!dataSource) {
      return null;
    }

    // Extract text content logic (similar to text_block)
    let displayTextContent: string | null = null;
    if (dataSource.type === 'pdf' || dataSource.type === 'text_block') {
      if (dataRecords.length > 0 && dataRecords[0].text_content) {
          displayTextContent = dataRecords[0].text_content;
      } else if (!sourceError && !isLoadingSource) {
          displayTextContent = "(No text content extracted or available for this source)";
      }
    }

    const renderTextDisplay = (text: string | null) => (
      <div
        className={cn(
          "whitespace-pre-wrap text-sm bg-secondary/30 p-3 rounded-lg relative border border-border/30",
          "max-h-[65vh] overflow-auto mt-4" // Add margin top if viewer is above
        )}
      >
        {isLoadingSource && !text ? (
          <span className="text-muted-foreground italic">Loading text content...</span>
        ) : text ? (
          text
        ) : sourceError ? (
          <span className="text-red-500 italic">{sourceError}</span>
        ) : (
          <span className="text-muted-foreground italic">(No text content available)</span>
        )}
      </div>
    );

    switch (dataSource.type) {
      case 'csv':
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
                 <div className="relative max-w-xs">
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

                 <div className="border rounded-md overflow-auto relative w-full max-h-[30vh] max-w-[50vw] flex-grow">
                   <Table className="text-xs max-w-screen-3xl">
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
                               setSelectedRowData(prev => prev?.row_number === row.row_number ? null : row);
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
                                  "h-8 px-2" // Smaller pagination buttons
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
                                 "h-8 px-2" // Smaller pagination buttons
                               )}
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
        );
      case 'url_list':
        const originalUrls = (dataSource.origin_details as any)?.urls || [];
        const hasUrlListChanged = JSON.stringify([...editableUrls].sort()) !== JSON.stringify([...originalUrls].sort());

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* --- Left Column: URL Editor --- */}
              <div className="space-y-3">
                  <h4 className="text-md font-semibold flex items-center justify-between">
                      Source URLs ({editableUrls.length})
                      <Button onClick={handleRefetch} variant="outline" size="sm" disabled={isRefetching || isSavingUrls}>
                          {isRefetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                          Re-fetch All
                      </Button>
                  </h4>
                  <ScrollArea className="h-[250px] w-full border rounded-md p-3">
                      <div className="space-y-2 ">
                          {editableUrls.map((url, index) => (
                              <div key={index} className="flex items-center justify-between gap-2 text-sm bg-background p-1.5 rounded">
                                  <a href={url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline text-blue-600 flex-1" title={url}>
                                      {url}
                                  </a>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleRemoveUrl(url)} disabled={isSavingUrls}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                              </div>
                          ))}
                          {editableUrls.length === 0 && (
                              <p className="text-sm text-muted-foreground italic text-center py-2">No URLs added yet.</p>
                          )}
                      </div>
                  </ScrollArea>
                  <div className="flex items-center gap-2">
                      <Input
                          type="url"
                          placeholder="Add new URL (e.g., https://...)"
                          value={newUrlInput}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewUrlInput(e.target.value)}
                          className="h-9 text-sm"
                          onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                          disabled={isSavingUrls}
                      />
                      <Button onClick={handleAddUrl} size="sm" disabled={isSavingUrls || !newUrlInput.trim()}>
                          <PlusCircle className="h-4 w-4 mr-1" /> Add
                      </Button>
                  </div>
                  <Button onClick={handleSaveUrls} size="sm" disabled={isSavingUrls || !hasUrlListChanged}>
                      {isSavingUrls ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                      Save URL List Changes
                  </Button>
              </div>

              {/* --- Right Column: Scraped Records --- */}
              <div className="space-y-3">
                  <h4 className="text-md font-semibold">Scraped Content ({urlListTotalRecords} records)</h4>
                  {/* ---> ADDED: View Mode Toggle Buttons --- */}
                  <div className="flex items-center space-x-2 mb-2">
                    <Button
                      variant={scrapedContentViewMode === 'flat' ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => setScrapedContentViewMode('flat')}
                    >
                      Flat List (Time)
                    </Button>
                    <Button
                      variant={scrapedContentViewMode === 'grouped' ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => setScrapedContentViewMode('grouped')}
                    >
                      Grouped by URL
                    </Button>
                  </div>
                  {/* <--- END ADDED --- */}

                  {isLoadingUrlList ? (
                       <div className="text-center py-4 text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading scraped content...</div>
                  ) : urlListError ? (
                       <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Error Loading Records</AlertTitle><AlertDescription>{urlListError}</AlertDescription></Alert>
                  ) : urlListDataRecords.length > 0 ? (
                      <>
                          <ScrollArea className="h-[400px] w-full border rounded-md p-3">
                              <div className="space-y-3">
                                  {scrapedContentViewMode === 'flat' ? (
                                      // --- Flat List View (Sorted by Time) ---
                                      sortedFlatList.map((record) => {
                                          const originalUrl = (record.source_metadata as any)?.original_url;
                                          return (
                                              <div
                                                key={record.id}
                                                className={cn(
                                                  "p-2 rounded bg-background space-y-1 border cursor-pointer transition-colors",
                                                  highlightedRecordId === record.id ? "bg-primary/10 border-primary/30 ring-1 ring-primary/30" : "hover:bg-muted/50"
                                                )}
                                                onClick={() => setHighlightedRecordId(prev => prev === record.id ? null : record.id)}
                                              >
                                                  <div className="text-xs font-medium text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
                                                      <span>Record ID: {record.id}</span>
                                                      {originalUrl &&
                                                          <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary hover:underline inline-flex items-center text-xs" title={originalUrl}>
                                                              <span className="truncate max-w-[200px]">{originalUrl}</span>
                                                              <ExternalLink className="h-3 w-3 ml-1 shrink-0" />
                                                          </a>
                                                      }
                                                      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                                                         {record.event_timestamp ? formatDistanceToNow(new Date(record.event_timestamp), { addSuffix: true }) : 'No timestamp'}
                                                      </span>
                                                  </div>
                                                  <p className={cn(
                                                    "text-sm whitespace-pre-wrap bg-secondary/30 p-1.5 rounded border",
                                                    highlightedRecordId === record.id ? "max-h-none" : "max-h-[100px] overflow-y-auto"
                                                  )}>
                                                      {record.text_content ? record.text_content : <span className="italic text-muted-foreground/70">No content extracted.</span>}
                                                  </p>
                                              </div>
                                          );
                                      })
                                  ) : (
                                      Object.entries(groupedRecords).map(([url, recordsInGroup]) => (
                                          <div key={url} className="mb-4 border rounded-md">
                                              <div className="bg-muted/50 px-3 py-1.5 border-b">
                                                  <a href={url !== 'Unknown URL' ? url : undefined} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary hover:underline flex items-center" title={url}>
                                                      {url}
                                                      {url !== 'Unknown URL' && <ExternalLink className="h-3.5 w-3.5 ml-1.5 shrink-0" />}
                                                  </a>
                                              </div>
                                              <div className="p-2 space-y-2">
                                                  {recordsInGroup.map((record) => (
                                                      <div
                                                        key={record.id}
                                                        className={cn(
                                                          "p-1.5 rounded bg-background space-y-0.5 border cursor-pointer transition-colors",
                                                          highlightedRecordId === record.id ? "bg-primary/10 border-primary/30 ring-1 ring-primary/30" : "hover:bg-muted/50"
                                                        )}
                                                        onClick={() => setHighlightedRecordId(prev => prev === record.id ? null : record.id)}
                                                      >
                                                          <div className="text-xs font-medium text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
                                                              <span>Record ID: {record.id}</span>
                                                              <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                                                                 {record.event_timestamp ? formatDistanceToNow(new Date(record.event_timestamp), { addSuffix: true }) : 'No timestamp'}
                                                              </span>
                                                          </div>
                                                          <p className={cn(
                                                            "text-sm whitespace-pre-wrap bg-secondary/30 p-1 rounded border",
                                                            highlightedRecordId === record.id ? "max-h-none" : "max-h-[80px] overflow-y-auto"
                                                          )}>
                                                              {record.text_content ? record.text_content : <span className="italic text-muted-foreground/70">No content extracted.</span>}
                                                          </p>
                                                      </div>
                                                  ))}
                                              </div>
                                          </div>
                                      ))
                                  )}
                              </div>
                          </ScrollArea>
                          {urlListTotalPages > 0 && (
                              <div className="flex justify-center items-center pt-1 flex-none">
                                  <Pagination>
                                      <PaginationContent>
                                          <PaginationItem><PaginationPrevious href="#" onClick={(e) => { e.preventDefault(); handleUrlListPageChange(urlListCurrentPage - 1); }} className={cn(urlListCurrentPage === 1 ? "pointer-events-none opacity-50" : "", "h-8 px-2")} /></PaginationItem>
                                          <PaginationItem><span className="px-3 text-sm">Page {urlListCurrentPage} of {urlListTotalPages}</span></PaginationItem>
                                          <PaginationItem><PaginationNext href="#" onClick={(e) => { e.preventDefault(); handleUrlListPageChange(urlListCurrentPage + 1); }} className={cn(urlListCurrentPage === urlListTotalPages ? "pointer-events-none opacity-50" : "", "h-8 px-2")} /></PaginationItem>
                                      </PaginationContent>
                                  </Pagination>
                              </div>
                          )}
                      </>
                  ) : (
                      <div className="text-center py-4 text-muted-foreground italic">No scraped content records found for this URL list source.</div>
                  )}
              </div>
          </div>
        );
      case 'pdf':
        return (
          <div className="space-y-3">
            {renderPdfButtons()}
            {isPdfViewerOpen && pdfBlobUrl && (
              <div className="border rounded-md overflow-hidden">
                <iframe
                  src={pdfBlobUrl}
                  width="100%"
                  height="600px" // Adjust height as needed
                  title={`PDF Viewer - ${dataSource.name}`}
                  style={{ border: 'none' }}
                />
              </div>
            )}
            {renderTextDisplay(displayTextContent)}
          </div>
        );
      case 'text_block':
         return renderTextDisplay(displayTextContent);
      default:
        return <div className="text-center text-muted-foreground p-8">Unsupported data source type for detailed view.</div>;
    }
  };

  const renderJobSelector = () => {
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
              <SelectItem value="all">
                All jobs for this data source ({classificationResults.length} results)
              </SelectItem>
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

  return (
    <div className="flex flex-col h-full">
      {/* Add header with actions */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">{displayTitle(dataSource)}</h2>
        {renderHeaderActions()}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {dataSource && (
            <div className="flex items-start gap-4 text-sm">
              <Avatar>
                <AvatarImage alt={displayTitle(dataSource) ?? ''} />
                <AvatarFallback>
                  {displayTitle(dataSource)
                    ?.substring(0, 2)
                    ?.toUpperCase() || 'DS'}
                </AvatarFallback>
              </Avatar>
              <div className="grid gap-1 flex-1">
                <div className="font-semibold flex items-center gap-2 flex-wrap">
                  {displayTitle(dataSource)}
                  <Badge variant="outline">{displayType(dataSource)}</Badge>
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
                    {dataSource.status === 'complete' ? 'Completed' : dataSource.status === 'failed' ? 'Failed' : dataSource.status === 'processing' ? 'Processing' : dataSource.status === 'pending' ? 'Pending' : 'Not Started'}
                  </Badge>
                </div>
                <div className="text-xs">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger className="cursor-default text-left">
                        <span className="font-medium">Origin Details:</span> <span className="italic">Hover to see</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-md">
                        <pre className="text-xs whitespace-pre-wrap break-all">{dataSource.origin_details ? JSON.stringify(dataSource.origin_details) : 'No origin details available'}</pre>
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
                        <pre className="text-xs whitespace-pre-wrap break-all">{dataSource.source_metadata ? JSON.stringify(dataSource.source_metadata) : 'No source metadata available'}</pre>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
              {dataSource.created_at && (
                <div className="ml-auto text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  Created: {format(new Date(dataSource.created_at), "PPp")}
                </div>
              )}
            </div>
        )}

        {dataSource && renderScheduledIngestionCard()}

        {dataSource && (
          <Tabs defaultValue="content" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-2">
              <TabsTrigger value="content">Source Content / Summary</TabsTrigger>
              <TabsTrigger value="results">Overall Classification Results</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="mt-2 rounded-md p-1">
               <div className="space-y-4">
                {renderContent()}
              </div>
            </TabsContent>

            <TabsContent value="results" className="mt-2 border rounded-md p-1">
               <div className="flex items-center justify-between mb-2">
                  <h4 className="text-md font-semibold">Overall Classification Results ({classificationResults.length} total)</h4>
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
        )}

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

      {/* Add DatasetCreateDialog */}
      <DatasetCreateDialog
        open={isDatasetCreateDialogOpen}
        onOpenChange={setIsDatasetCreateDialogOpen}
        onSuccess={() => {
          toast({
            title: "Dataset created successfully",
            description: "You can now view the dataset in the datasets page",
          });
          setIsDatasetCreateDialogOpen(false);
        }}
        initialDatarecordIds={dataRecords.map(r => r.id)}
        initialSchemeIds={Array.from(new Set(classificationResults.map(r => r.scheme_id)))}
        initialJobIds={Array.from(new Set(classificationResults.map(r => r.job_id)))}
      />

      {/* Add Toaster */}
      <Toaster />
    </div>
  );
}

export default DataRecordDetailView;