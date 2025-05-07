'use client';

import React, { useState, useEffect, useCallback, useMemo, ChangeEvent, useRef } from 'react';
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { format } from "date-fns"
import { Button } from '@/components/ui/button';
import { ClassificationSchemeRead, FieldType, EnhancedClassificationResultRead, CsvRowData, CsvRowsOut, DataSourceRead as ClientDataSourceRead, DataSourceRead, DataRecordUpdate as ClientDataRecordUpdate } from '@/client/models'; // Renamed DataSourceRead to avoid conflict, Added ClientDataRecordUpdate
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClassificationResultsService, ClassificationSchemesService, ClassificationJobsService } from '@/client/services';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import ClassificationResultDisplay from '../classifications/ClassificationResultDisplay';
import { useToast } from '@/components/ui/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { useClassificationJobsStore, useClassificationJobsActions, useIsClassificationJobsLoading, useClassificationJobsError } from "@/zustand_stores/storeClassificationJobs";
import { DatarecordsService, DatasourcesService } from '@/client/services';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DataRecordRead, DataSourceRead as ClientDataSourceReadAlias, DataSourceType, DataSourceStatus, DataSourceUpdate } from '@/client/models'; // Use Alias, import DataSourceUpdate
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
import { adaptDataSourceReadToDataSource } from '@/lib/classification/adapters'; // Ensure correct adapters are imported
import { useDataSourceStore } from '@/zustand_stores/storeDataSources'; // Import store
import { toast } from 'sonner';
import { ExternalLink, Info, Edit2, Trash2, UploadCloud, Download, RefreshCw, Eye, Play, FileText, List, ChevronDown, ChevronUp, Search, File, PlusCircle, Save, X, CheckCircle } from 'lucide-react'; // Added FileText, List, CheckCircle
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertCircle, ArrowUp, ArrowDown, Files, Type } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
// Define Sort Direction type
type SortDirection = 'asc' | 'desc' | null;

import DocumentDetailViewPdf from './DocumentDetailViewPdf';
import DocumentDetailViewCsv from './DocumentDetailViewCsv';
import DocumentDetailViewUrlList from './DocumentDetailViewUrlList';
import DocumentDetailViewTextBlock from './DocumentDetailViewTextBlock';

// ---> ADDED: State for inline editing <---
interface EditState {
  recordId: number;
  field: 'title' | 'event_timestamp';
  value: string;
}
// ---> END ADDED <---

interface DocumentDetailViewProps {
  onEdit: (item: ClientDataSourceReadAlias) => void;
  schemes: ClassificationSchemeRead[];
  selectedDataSourceId: number | null;
  highlightRecordIdOnOpen: number | null; // <-- Add prop
  onLoadIntoRunner?: (jobId: number, jobName: string) => void;
}

const DocumentDetailView = ({
  onEdit,
  schemes,
  selectedDataSourceId,
  highlightRecordIdOnOpen, // <-- Destructure prop
  onLoadIntoRunner
}: DocumentDetailViewProps) => {
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
  const [selectedRowResults, setSelectedRowResults] = useState<EnhancedClassificationResultRead[]>([]);
  const [localIngestTask, setLocalIngestTask] = useState<RecurringTask | null>(null);
  const [enableScheduledIngestion, setEnableScheduledIngestion] = useState(false);
  const [ingestionSchedule, setIngestionSchedule] = useState('0 0 * * *');
  const [cronExplanation, setCronExplanation] = useState('');
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const [initialScheduleState, setInitialScheduleState] = useState({ enabled: false, schedule: '' });
  const [selectedIndividualRecord, setSelectedIndividualRecord] = useState<DataRecordRead | null>(null);
  const prevDataSourceIdRef = useRef<number | null>(null);
  const [editingRecord, setEditingRecord] = useState<EditState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [fetchedHighlightRecord, setFetchedHighlightRecord] = useState<DataRecordRead | null>(null);
  const [isLoadingHighlightRecord, setIsLoadingHighlightRecord] = useState(false);

  // --- Custom Hook Calls --- 
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
    getDataSourceUrls,
    updateDataRecord
  } = useDataSourceStore();

  const { createDataset } = useDatasetStore();

  const [isDatasetCreateDialogOpen, setIsDatasetCreateDialogOpen] = useState(false);

  // First, add state for time axis configuration
  const [timeAxisConfig, setTimeAxisConfig] = useState<TimeAxisConfig>({
    type: 'default',
    schemeId: undefined,
    fieldKey: 'event_timestamp'
  });

  // --- NEW: State for data records associated with a bulk PDF source ---
  const [associatedRecords, setAssociatedRecords] = useState<DataRecordRead[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);

  // Fetch associated records when a bulk PDF datasource is selected
  useEffect(() => {
      const fetchRecords = async () => {
          if (dataSource && dataSource.type === 'pdf' && dataSource.source_metadata && typeof dataSource.source_metadata.file_count === 'number' && dataSource.source_metadata.file_count > 1 && activeWorkspace) {
              setIsLoadingRecords(true);
              try {
                  // Fetch all records for this datasource
                  const records = await DatarecordsService.listDatarecords({
                      workspaceId: activeWorkspace.id,
                      datasourceId: dataSource.id,
                      limit: 1000 // Adjust limit as needed
                  });
                  setAssociatedRecords(records || []); // Assuming service returns array or null/undefined
              } catch (error) {
                  console.error("Error fetching associated data records:", error);
                  toast({ title: "Error", description: "Could not load individual file records.", variant: "destructive" });
                  setAssociatedRecords([]);
              } finally {
                  setIsLoadingRecords(false);
              }
          } else {
              // Clear records if it's not a bulk PDF
              setAssociatedRecords([]);
          }
      };

      fetchRecords();
  }, [dataSource, activeWorkspace?.id, toast]); // Rerun when datasource or workspace changes

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

  // ---> Function to fetch a single data record <---
  const fetchSingleDataRecord = useCallback(async (recordId: number): Promise<DataRecordRead | null> => {
    if (!activeWorkspace?.id) return null;
    try {
      console.log(`[DocumentDetailView] Fetching single record ID: ${recordId}`);
      const record = await DatarecordsService.getDatarecord({
        workspaceId: activeWorkspace.id,
        datarecordId: recordId,
      });
      return record;
    } catch (error) {
      console.error(`Error fetching single data record ${recordId}:`, error);
      toast({ title: "Error", description: `Could not load details for record ${recordId}.`, variant: "destructive"});
      return null;
    }
  }, [activeWorkspace?.id, toast]);
  // ---> END ADDED <---

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
        // >>> ADD THIS LOG <<<
        console.log('[DocumentDetailView] Raw recordsResponse for URL List:', recordsResponse);
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
        setUrlListTotalRecords(0); setUrlListError(null); setLocalIngestTask(null); 
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
  }, [selectedDataSourceId, activeWorkspace?.id, fetchClassificationResults]); // Removed pdfBlobUrl from dependencies

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
  }, [onLoadIntoRunner, activeWorkspace?.id, toast, selectedIndividualRecord]);

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

  // --- NEW: Effect to update selectedRowResults when selectedRowData or classificationResults change ---
  useEffect(() => {
      if (dataSource?.type === 'csv' && selectedRowData) {
          const recordIdStr = selectedRowData.row_data?.id as string | null | undefined;
          const recordId = recordIdStr ? parseInt(recordIdStr, 10) : NaN;
          if (!isNaN(recordId)) {
              setSelectedRowResults(getResultsForRecord(recordId));
          } else {
              setSelectedRowResults([]);
          }
      } else {
          setSelectedRowResults([]);
      }
  }, [selectedRowData, classificationResults, getResultsForRecord, dataSource?.type]);
  // --- END NEW ---


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

  // --- NEW: useEffect to parse cron expression ---
  useEffect(() => {
      if (ingestionSchedule) {
          try {
              setCronExplanation(Cronstrue.toString(ingestionSchedule));
          } catch (e) {
              setCronExplanation('Invalid cron format');
          }
      } else {
          setCronExplanation('Enter a 5-part cron schedule.');
      }
  }, [ingestionSchedule]);
  // --- END NEW ---

  // --- NEW: useEffect to initialize scheduling state ---
  useEffect(() => {
      // Fix: Check if recurringTasks object is not empty instead of length
      if (dataSource?.type === 'url_list' && activeWorkspace?.id && Object.keys(recurringTasks).length > 0) {
          const task = getIngestTaskForDataSource(dataSource.id);
          setLocalIngestTask(task);
          const enabled = !!task && task.status === 'active';
          const schedule = task?.schedule || '0 0 * * *';
          setEnableScheduledIngestion(enabled);
          setIngestionSchedule(schedule);
          setInitialScheduleState({ enabled, schedule }); // Store initial state
          console.log("Initialized schedule state:", { task, enabled, schedule });
      } else if (dataSource?.type !== 'url_list') {
           // Reset when not a URL list
           setLocalIngestTask(null);
           setEnableScheduledIngestion(false);
           setIngestionSchedule('0 0 * * *');
           setInitialScheduleState({ enabled: false, schedule: '' });
           console.log("Reset schedule state as dataSource is not URL list");
      }
  }, [dataSource?.id, dataSource?.type, activeWorkspace?.id, recurringTasks, getIngestTaskForDataSource]);
  // --- END NEW ---


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
                if (success) {
                    taskName = updated!.name;
                    setLocalIngestTask(updated!); // Update local task state
                }
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
                if (success) {
                     taskName = created!.name;
                     setLocalIngestTask(created!); // Set local task state
                }
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
                     setLocalIngestTask(updated!); // Update local task state
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
    // --- MODIFIED: Determine target URL based on context ---
    let downloadUrl: string | null = null;
    let isRecordDownload = false;
    const isBulkSource = dataSource?.type === 'pdf' && (dataSource.source_metadata as any)?.file_count > 1;

    if (isBulkSource && selectedIndividualRecord?.id && activeWorkspace?.id) {
      // Bulk PDF: Use the DataRecord content endpoint
      downloadUrl = `/api/v1/workspaces/${activeWorkspace.id}/datarecords/${selectedIndividualRecord.id}/content`;
      isRecordDownload = true;
      toast({ title: "Starting Download", description: `Preparing file: ${(selectedIndividualRecord.source_metadata as any)?.original_filename || `Record ${selectedIndividualRecord.id}`}...` });
    } else if (dataSource?.type === 'pdf' && !isBulkSource && activeWorkspace?.id && dataSource.id) {
      // Single PDF: Use the DataSource download endpoint
      downloadUrl = `/api/v1/workspaces/${activeWorkspace.id}/datasources/${dataSource.id}/pdf_download`;
      isRecordDownload = false;
      toast({ title: "Starting Download", description: `Preparing file: ${dataSource.name}...` });
    } else {
      // Conditions not met
      console.error("Cannot initiate PDF download: Missing workspace, datasource ID, record selection, or incorrect type.", { isBulkSource, selectedIndividualRecord, dataSource, activeWorkspace });
      toast({
        title: "Download Error",
        description: isBulkSource ? "Please select an individual file to download." : "Could not determine the file to download.",
        variant: "destructive",
      });
      return;
    }
    // --- END MODIFICATION ---

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
      let filename = `download.pdf`; // Default filename
      if (isRecordDownload && selectedIndividualRecord) {
        // Try getting filename from record metadata first for record downloads
        filename = (selectedIndividualRecord.source_metadata as any)?.original_filename || filename;
      }
      if (disposition) {
        const filenameRegex = /filename[^;=\n]*=((['"])(.*?)\2|([^;\n]*))/;
        const matches = filenameRegex.exec(disposition);
        if (matches?.[3]) {
          filename = matches[3].replace(/^"|"$/g, ''); // Use header filename if found
        } else if (matches?.[4]) {
          filename = matches[4]; // Use header filename if found
        }
      } else if (!isRecordDownload && dataSource) {
          // Fallback for DataSource download if header missing
          // --- LINTER FIX: Explicitly cast after type check ---
          const originDetails = dataSource.origin_details;
          // Check if originDetails is an object and has the filename property
          if (typeof originDetails === 'object' && originDetails !== null && typeof (originDetails as { filename?: string }).filename === 'string' && (originDetails as { filename: string }).filename) {
             filename = (originDetails as { filename: string }).filename;
          } else if (dataSource.name) {
             // --- LINTER FIX: Add nullish check for name ---
             filename = dataSource.name ?? `datasource_${dataSource.id}.pdf`;
          } else {
             filename = `datasource_${dataSource.id}.pdf`; // Guaranteed string fallback
          }
          // --- END LINTER FIX ---
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
  // Dependencies updated
  }, [dataSource, activeWorkspace?.id, toast, selectedIndividualRecord]);

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
    // --- ADDED LOG --- 
    console.log(`Effect[dataSource]: Running due to dataSource change. ID: ${dataSource?.id}, Type: ${dataSource?.type}`);
    const currentId = dataSource?.id;
    const previousId = prevDataSourceIdRef.current;

    if (!dataSource || !activeWorkspace?.id) {
        console.log("Effect[dataSource]: dataSource or activeWorkspace missing, returning.");
        // Store current ID (or null) before returning
        prevDataSourceIdRef.current = currentId ?? null;
        return;
    }

    // --- MODIFICATION: Only reset selections if ID actually changed ---
    const hasIdChanged = currentId !== previousId;
    if (hasIdChanged) {
        console.log(`Effect[dataSource]: ID changed from ${previousId} to ${currentId}. Resetting selections.`);
        setSelectedIndividualRecord(null);
        setEditableUrls([]);
        setDataRecords([]); // Clear general records
        setSelectedRowData(null); // Clear CSV selection
        setCsvData(null); // Clear raw CSV data
        setSelectedRowResults([]); // Clear results for selected row
        // Also close viewer and revoke URL if ID changes
        setHighlightedRecordId(null); // Reset highlight
        setScrapedContentViewMode('flat'); // Reset view mode
    }
    // --- END MODIFICATION ---

    console.log(`Effect[dataSource]: ID ${currentId}. Type: ${dataSource.type}. Triggering type-specific actions. ID Changed: ${hasIdChanged}`);

    // Trigger actions based on type (only fetch if ID changed or data not present)
    // Fetch CSV Data
    if (hasIdChanged || (dataSource.type === 'csv' && !csvData)) {
        if (dataSource.type === 'csv') {
            console.log(`Effect[dataSource]: Fetching CSV data for ID ${currentId}`);
            fetchCsvData(activeWorkspace.id, dataSource.id, 1);
            setCurrentPage(1); // Reset page on new CSV load
        }
    }

    // Fetch URL List Data & Initialize URLs
    if (hasIdChanged || (dataSource.type === 'url_list' && editableUrls.length === 0)) {
        if (dataSource.type === 'url_list') {
             console.log(`Effect[dataSource]: Fetching URL list data/setting initial URLs for ID ${currentId}`);
            // Initialize editableUrls from the fetched dataSource
            const initialUrls = (dataSource.origin_details as any)?.urls || [];
            setEditableUrls(initialUrls);
            // Fetch associated data records (scraped content)
            fetchUrlListData(activeWorkspace.id, dataSource.id, 1, dataSource.data_record_count ?? 0);
            setUrlListCurrentPage(1); // Reset page on new URL list load
        }
    }

    // Fetch PDF Records
    if (hasIdChanged || (dataSource.type === 'pdf' && associatedRecords.length === 0)) {
        if (dataSource.type === 'pdf') {
          console.log(`Effect[dataSource]: Fetching records for PDF source ID ${currentId}`);
          setIsLoadingRecords(true); // Set loading state
          const isBulk = dataSource.source_metadata && typeof dataSource.source_metadata.file_count === 'number' && dataSource.source_metadata.file_count > 1;
          const limit = isBulk ? 1000 : 1; // Fetch all for bulk, 1 for single
          DatarecordsService.listDatarecords({
              workspaceId: activeWorkspace.id,
              datasourceId: dataSource.id,
              limit: limit
          }).then(recordsResponse => {
              setAssociatedRecords(recordsResponse || []);
              console.log(`Effect[dataSource]: Fetched ${recordsResponse?.length || 0} records for PDF source ${currentId}`);
          }).catch(err => {
              console.error(`Effect[dataSource]: Failed to fetch records for PDF source ${currentId}:`, err);
              setAssociatedRecords([]);
          }).finally(() => {
              setIsLoadingRecords(false); // Clear loading state
          });
        }
    }

    // Fetch Text Block Record
    if (hasIdChanged || (dataSource.type === 'text_block' && associatedRecords.length === 0)) {
        if (dataSource.type === 'text_block') {
           console.log(`Effect[dataSource]: Fetching record for text_block source ID ${currentId}`);
           setIsLoadingRecords(true); // Set loading state
          DatarecordsService.listDatarecords({
              workspaceId: activeWorkspace.id,
              datasourceId: dataSource.id,
              limit: 1
          }).then(recordsResponse => {
              // Store in associatedRecords for consistency
              setAssociatedRecords(recordsResponse || []);
          }).catch(err => {
              console.error(`Effect[dataSource]: Failed to fetch record for text_block source ${currentId}:`, err);
              setAssociatedRecords([]);
          }).finally(() => {
              setIsLoadingRecords(false); // Clear loading state
          });
        }
    }
    // Store the current ID for the next run
    prevDataSourceIdRef.current = currentId ?? null;

  }, [dataSource, activeWorkspace?.id, fetchCsvData, fetchUrlListData]); // Removed dataRecords, csvData, editableUrls from deps


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
      // --- MODIFIED: Call store action directly ---
      const updatedSource = await updateDataSourceUrls(dataSource.id, editableUrls);
      // --- END MODIFICATION ---
      setIsSavingUrls(false);
      if (updatedSource) {
          // Update local dataSource state to reflect changes immediately
          // Fetching happens automatically in store, but update local DS for responsiveness
          const updatedClientSource = await DatasourcesService.getDatasource({workspaceId: activeWorkspace.id, datasourceId: dataSource.id});
          setDataSource(updatedClientSource);
          toast({ title: "Success", description: "URL list saved." });
      } else {
          // Error handled in store action
          // Revert editableUrls to original state if save failed
          setEditableUrls((dataSource.origin_details as any)?.urls || []);
      }
    // Dependencies: dataSource, activeWorkspace, editableUrls, updateDataSourceUrls, toast
  }, [dataSource, activeWorkspace?.id, editableUrls, updateDataSourceUrls, toast]);

  const handleRefetch = useCallback(async () => {
      if (!dataSource || !activeWorkspace?.id) return;
      setIsRefetching(true);
      // Use the store action
      const success = await refetchDataSource(dataSource.id);
      setIsRefetching(false);
      if (success) {
         // Optionally trigger fetchAll again after a delay or rely on polling
         // For URL lists, we might also want to refetch records
          if (dataSource.type === 'url_list') {
              setTimeout(() => fetchUrlListData(activeWorkspace.id, dataSource.id, 1, dataSource.data_record_count ?? 0), 1000); // Delay fetch
      }
      }
      // Dependencies: dataSource, activeWorkspace, refetchDataSource, fetchUrlListData
  }, [dataSource, activeWorkspace?.id, refetchDataSource, fetchUrlListData]);

  // Add function to create dataset from current data
  const handleCreateDataset = () => {
    if (!dataSource) return;

    // Determine record IDs based on type and current view/selection
    let recordIds: number[] = [];
    if (dataSource.type === 'csv') {
        recordIds = filteredAndSortedCsvData.map(r => {
            const idStr = r.row_data?.id as string | null | undefined;
            const idNum = idStr ? parseInt(idStr, 10) : NaN;
            return !isNaN(idNum) ? idNum : null;
        }).filter(id => id !== null) as number[];
    } else if (dataSource.type === 'url_list') {
        recordIds = (scrapedContentViewMode === 'flat' ? sortedFlatList : urlListDataRecords).map(r => r.id);
    } else if (dataSource.type === 'pdf' || dataSource.type === 'text_block') {
        recordIds = associatedRecords.map(r => r.id);
    }

    // Get all job IDs from results for *this* datasource
    const jobIds = Array.from(new Set(classificationResults.map(r => r.job_id).filter(id => id != null) as number[]));

    // Get all scheme IDs from results for *this* datasource
    const schemeIds = Array.from(new Set(classificationResults.map(r => r.scheme_id)));

    // Open the dialog (props will be passed internally now)
    setIsDatasetCreateDialogOpen(true);
  };

  // Add dataset creation button to the header actions
  const renderHeaderActions = () => (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCreateDataset}
        disabled={!dataSource || (associatedRecords.length === 0 && urlListDataRecords.length === 0 && filteredAndSortedCsvData.length === 0)}
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

  // --- MOVED: renderSelectedRowDetail moved to DocumentDetailViewCsv ---
  // --- MOVED: renderScheduledIngestionCard moved to DocumentDetailViewUrlList ---

  // Add job name for dialog
  const jobNameForDialog = useMemo(() => {
    if (!dataSource) return '';
    return `${dataSource.name} - ${new Date().toLocaleString()}`;
  }, [dataSource]);

  // ---> MOVED & REFINED: Helper functions for rendering, including editable fields --- START
  const getFormattedTimestamp = (isoString: string | null | undefined): string => {
      if (!isoString) return '';
      try {
          const date = new Date(isoString);
          if (isNaN(date.getTime())) return '';
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          return `${year}-${month}-${day}T${hours}:${minutes}`;
      } catch (e) {
          console.error("Error formatting timestamp:", e);
          return '';
      }
  };

  const renderEditableField = (record: DataRecordRead | null, field: 'title' | 'event_timestamp') => {
    if (!record) return null;

    const isEditingThisField = editingRecord?.recordId === record.id && editingRecord?.field === field;
    const displayValue = field === 'title' ? record.title : record.event_timestamp;
    const inputType = field === 'event_timestamp' ? 'datetime-local' : 'text';
    const label = field === 'title' ? 'Title' : 'Event Timestamp';

    const currentDisplayValue = field === 'event_timestamp' ? getFormattedTimestamp(displayValue) : (displayValue || 'N/A');

    return (
      <div className="flex items-center gap-2 text-sm mb-1">
        <strong className="w-28 shrink-0">{label}:</strong>
        {isEditingThisField ? (
          <div className="flex items-center gap-1 flex-grow min-w-0">
            <Input
              type={inputType}
              value={editingRecord.value}
              onChange={(e) => setEditingRecord({ ...editingRecord, value: e.target.value })}
              className="h-7 text-xs px-1 py-0.5 flex-grow"
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600 hover:bg-green-100" onClick={handleSaveEdit} disabled={isSavingEdit}>
              {isSavingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 hover:bg-red-100" onClick={handleCancelEdit} disabled={isSavingEdit}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-grow min-w-0">
            <span className="truncate flex-grow" title={typeof currentDisplayValue === 'string' ? currentDisplayValue : undefined}>
              {currentDisplayValue}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => startEditing(record.id, field, field === 'event_timestamp' ? getFormattedTimestamp(displayValue) : displayValue)}>
              <Edit2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderTextDisplay = (text: string | null) => (
      <ScrollArea className="h-[200px] w-full rounded-md border p-3 text-sm bg-background">
          {text || <span className="text-muted-foreground italic">No text content available.</span>}
      </ScrollArea>
  );
  // ---> MOVED & REFINED: Helper functions for rendering --- END

  // ---> ADDED: Functions for handling inline edits --- START
  const handleSaveEdit = async () => {
    if (!editingRecord || !activeWorkspace?.id) return;
    setIsSavingEdit(true);

    const updatePayload: ClientDataRecordUpdate = {};
    if (editingRecord.field === 'title') {
      updatePayload.title = editingRecord.value;
    } else if (editingRecord.field === 'event_timestamp') {
      // Validate timestamp format (basic ISO 8601 check)
      try {
        const parsedDate = new Date(editingRecord.value);
        if (isNaN(parsedDate.getTime())) {
          throw new Error("Invalid date format");
        }
        updatePayload.event_timestamp = parsedDate.toISOString();
      } catch (e) {
        toast({ title: "Error", description: "Invalid timestamp format. Use YYYY-MM-DDTHH:mm format." });
        setIsSavingEdit(false);
        return;
      }
    }

    // --- MODIFIED: Use imported store function ---
    // Fix: updatedRecord is expected to be DataRecordRead | null from the service/store
    const updatedRecord: DataRecordRead | null = await updateDataRecord(editingRecord.recordId, updatePayload) as DataRecordRead | null; // Assuming store returns compatible type
    // --- END MODIFICATION ---

    setIsSavingEdit(false);
    if (updatedRecord) {
      setEditingRecord(null); // Exit edit mode on success
      toast({ title: "Success", description: "Record updated." });

      // Update the relevant local state array based on the *original* dataSource type
      // Fix: Use updatedRecord directly, don't adapt with wrong adapter
      if (dataSource?.type === 'pdf' || dataSource?.type === 'text_block') {
         setAssociatedRecords(prev => prev.map(rec => rec.id === updatedRecord!.id ? updatedRecord! : rec));
         // Update selected record if it was the one edited
         if (selectedIndividualRecord?.id === updatedRecord!.id) {
             setSelectedIndividualRecord(updatedRecord);
         }
      } else if (dataSource?.type === 'url_list') {
           setUrlListDataRecords(prev => prev.map(rec => rec.id === updatedRecord!.id ? updatedRecord! : rec));
           // Update highlighted record? No, just let the list re-render
      }
       // Note: CSV records aren't directly held in state like this, their data comes from csvData
    }
    // Error handling is now managed within the store action (updateDataRecord)
  };

  const handleCancelEdit = () => {
    setEditingRecord(null);
  };

  const startEditing = (recordId: number, field: 'title' | 'event_timestamp', currentValue: string | null | undefined) => {
    setEditingRecord({ recordId, field, value: currentValue || '' });
  };
  // ---> ADDED: Functions for handling inline edits --- END

  // ---> RE-INSERTED RENDER FUNCTIONS - START <---

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
                      className="p-2 bg-muted/20 rounded border text-sm cursor-pointer hover:bg-muted/30 mb-1 last:mb-0"
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
                        result={adaptEnhancedResultReadToFormattedResult(result)}
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
                        schemes={schemes}
                        initialConfig={timeAxisConfig}
                        onTimeAxisConfigChange={timeAxisConfig => setTimeAxisConfig(timeAxisConfig || { type: 'default' })}
                      />
                    </div>
                  <div className="p-4 border rounded-lg">
                    <ResultsChart
                      results={filteredResults.map(adaptEnhancedResultReadToFormattedResult)}
                      schemes={schemes}
                      dataSources={dataSource ? [dataSource] : []}
                      dataRecords={dataRecords} // Make sure dataRecords holds the necessary records for the chart
                      onDataPointClick={handleChartPointClick}
                      timeAxisConfig={timeAxisConfig} // This controls WHICH timestamp is used
                      filters={[]}
                      selectedDataSourceIds={dataSource ? [dataSource.id] : []}
                      onDataSourceSelectionChange={(ids) => {
                        console.log("Chart requested source change (ignored in detail view):", ids);
                      }}
                      // --- Correction ---
                      selectedTimeInterval={chartTimeInterval} // Use the dedicated state for interval
                      onTimeIntervalChange={setChartTimeInterval} // Pass the setter for the interval state
                      // --- End Correction ---
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
  }

  // ---> REFACTORED: renderContent now uses sub-components --- START
  const renderContent = () => {
    if (!dataSource) {
        return <div className="p-4 text-center text-muted-foreground">Data source details not loaded.</div>;
    }

    // Fix: Handle all expected types explicitly or provide a better default
    switch (dataSource.type) {
        case 'pdf':
        // case 'bulk_pdf': // Handled within DocumentDetailViewPdf logic
            return (
                <DocumentDetailViewPdf
                  dataSource={dataSource}
                  associatedRecords={associatedRecords}
                  isLoadingRecords={isLoadingRecords}
                  selectedIndividualRecord={selectedIndividualRecord}
                  setSelectedIndividualRecord={setSelectedIndividualRecord}
                  renderEditableField={renderEditableField}
                  renderTextDisplay={renderTextDisplay}
                  handleDownloadPdf={handleDownloadPdf}
                  activeWorkspaceId={activeWorkspace?.id || 0} // Pass activeWorkspaceId
                />
            );

        case 'csv':
                           return (
                <DocumentDetailViewCsv
                  dataSource={dataSource}
                  csvData={csvData}
                  isLoadingCsv={isLoadingCsv}
                  csvError={csvError}
                  csvSearchTerm={csvSearchTerm}
                  setCsvSearchTerm={setCsvSearchTerm}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  handleSort={handleSort}
                  selectedRowData={selectedRowData}
                  setSelectedRowData={setSelectedRowData}
                  filteredAndSortedCsvData={filteredAndSortedCsvData}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  handlePageChange={handlePageChange}
                  selectedRowResults={selectedRowResults}
                  schemes={schemes}
                  availableJobsFromStore={availableJobsFromStore}
                  selectedJobId={selectedJobId}
                  setSelectedResult={setSelectedResult}
                  setIsResultDialogOpen={setIsResultDialogOpen}
                />
            );

        case 'url_list':
        // case 'url': // Assuming url_list covers this conceptually
            return (
                <DocumentDetailViewUrlList
                    dataSource={dataSource}
                    urlListDataRecords={urlListDataRecords}
                    isLoadingUrlList={isLoadingUrlList}
                    urlListError={urlListError}
                    scrapedContentViewMode={scrapedContentViewMode}
                    setScrapedContentViewMode={setScrapedContentViewMode}
                    highlightedRecordId={highlightedRecordId}
                    setHighlightedRecordId={setHighlightedRecordId}
                    editableUrls={editableUrls}
                    setEditableUrls={setEditableUrls}
                    newUrlInput={newUrlInput}
                    setNewUrlInput={setNewUrlInput}
                    handleAddUrl={handleAddUrl}
                    handleRemoveUrl={handleRemoveUrl}
                    handleSaveUrls={handleSaveUrls}
                    isSavingUrls={isSavingUrls}
                    handleRefetch={handleRefetch}
                    isRefetching={isRefetching}
                    renderEditableField={renderEditableField}
                    renderTextDisplay={renderTextDisplay}
                    urlListTotalRecords={urlListTotalRecords}
                    groupedRecords={groupedRecords}
                    localIngestTask={localIngestTask}
                    enableScheduledIngestion={enableScheduledIngestion}
                    setEnableScheduledIngestion={setEnableScheduledIngestion}
                    ingestionSchedule={ingestionSchedule}
                    setIngestionSchedule={setIngestionSchedule}
                    cronExplanation={cronExplanation}
                    isUpdatingSchedule={isUpdatingSchedule}
                    handleScheduleUpdate={handleScheduleUpdate}
                    initialScheduleState={initialScheduleState}
                    fetchedHighlightRecord={fetchedHighlightRecord}
                />
            );

        case 'text_block':
             return (
                <DocumentDetailViewTextBlock
                  dataSource={dataSource}
                  associatedRecords={associatedRecords}
                  isLoadingRecords={isLoadingRecords}
                  renderEditableField={renderEditableField}
                  renderTextDisplay={renderTextDisplay}
                />
            );
        default:
            // Fix: Remove exhaustive check or ensure all client types are handled
            // const _exhaustiveCheck: never = dataSource.type;
            console.warn("Unsupported data source type in renderContent:", dataSource.type);
            return <div className="p-4 text-center text-muted-foreground">Unsupported data source type '{dataSource.type}'.</div>;
    }
  };
  // ---> REFACTORED: renderContent --- END

  // Determine initial record IDs for Dataset Create Dialog based on current view
  const initialDatasetRecordIds = useMemo(() => {
    if (!dataSource) return [];
    switch (dataSource.type) {
      case 'csv':
        return filteredAndSortedCsvData
          .map(r => {
            const idStr = r.row_data?.id as string | null | undefined;
            const idNum = idStr ? parseInt(idStr, 10) : NaN;
            return !isNaN(idNum) ? idNum : null;
          })
          .filter(id => id !== null) as number[];
      case 'url_list':
        return (scrapedContentViewMode === 'flat' ? sortedFlatList : urlListDataRecords).map(r => r.id);
      case 'pdf':
        case 'text_block':
        return associatedRecords.map(r => r.id);
        default:
        return [];
    }
  }, [dataSource, filteredAndSortedCsvData, scrapedContentViewMode, sortedFlatList, urlListDataRecords, associatedRecords]);

  // --- NEW: Effect to handle initial highlight ---
  useEffect(() => {
    // Only run if highlightRecordIdOnOpen is provided and dataSource is loaded
    if (highlightRecordIdOnOpen && dataSource) {
      console.log(`[DocumentDetailView] Effect: Applying highlight for ID ${highlightRecordIdOnOpen}, Type: ${dataSource.type}`);
      if (dataSource.type === 'pdf') {
        // For PDFs, we need associatedRecords to be loaded first
        if (associatedRecords.length > 0) {
          const recordToHighlight = associatedRecords.find(r => r.id === highlightRecordIdOnOpen);
          if (recordToHighlight) {
            console.log(`[DocumentDetailView] Effect: Setting selected PDF record: ${recordToHighlight.id}`);
            setSelectedIndividualRecord(recordToHighlight);
          } else {
             console.log(`[DocumentDetailView] Effect: Highlight ID ${highlightRecordIdOnOpen} not found in associated PDF records.`);
          }
        } else {
          // Wait for associatedRecords to load if not yet available
          console.log(`[DocumentDetailView] Effect: Waiting for associated PDF records to load before highlighting.`);
        }
      } else if (dataSource.type === 'url_list') {
        // For URL lists, we can set the highlight ID directly
        console.log(`[DocumentDetailView] Effect: Setting highlighted URL list record ID: ${highlightRecordIdOnOpen}`);
        setHighlightedRecordId(highlightRecordIdOnOpen);
      }
      // No need to clear highlightRecordIdOnOpen here, provider clears it on close.
    }
  }, [highlightRecordIdOnOpen, dataSource, associatedRecords]); // Dependencies: trigger when highlight ID, source, or PDF records change
  
  // --- Effect to fetch the specific highlight record if needed ---
  useEffect(() => {
    if (highlightRecordIdOnOpen && dataSource?.type === 'url_list' && !fetchedHighlightRecord && !isLoadingHighlightRecord) {
        // Check if the record is already in the current page's data to avoid unnecessary fetch
        const recordInPage = urlListDataRecords.find(r => r.id === highlightRecordIdOnOpen);
        if (!recordInPage) {
            console.log(`[DocumentDetailView] Effect: Highlight record ${highlightRecordIdOnOpen} not on current page. Fetching individually.`);
            setIsLoadingHighlightRecord(true);
            fetchSingleDataRecord(highlightRecordIdOnOpen)
                .then(record => {
                    if (record) {
                        setFetchedHighlightRecord(record);
                    } else {
                        // Handle case where record fetch fails but highlight ID is still set
                         console.warn(`[DocumentDetailView] Effect: Failed to fetch highlight record ${highlightRecordIdOnOpen}, highlight might not display correctly.`);
                    }
                })
                .finally(() => {
                    setIsLoadingHighlightRecord(false);
                });
        } else {
            console.log(`[DocumentDetailView] Effect: Highlight record ${highlightRecordIdOnOpen} found on current page. No extra fetch needed.`);
            // Clear any previously fetched record if the user navigated to its page
            setFetchedHighlightRecord(null);
        }
    } else if (!highlightRecordIdOnOpen && fetchedHighlightRecord) {
         // Clear fetched record if highlight ID is removed
         setFetchedHighlightRecord(null);
    }
    // Add urlListDataRecords to deps to re-check if fetch is needed when page changes
  }, [highlightRecordIdOnOpen, dataSource?.type, fetchSingleDataRecord, fetchedHighlightRecord, isLoadingHighlightRecord, urlListDataRecords]);
  // --- END NEW Effect ---

  // Inside DocumentDetailView component, near other state hooks
  const [chartTimeInterval, setChartTimeInterval] = useState<'day' | 'week' | 'month' | 'quarter' | 'year'>('day');

  // Add this at the end of the DocumentDetailView function, before export default
  return (
    <div className="document-detail-view w-full h-full flex flex-col">
      {isLoadingSource && !dataSource ? ( // Show loading only if no datasource is yet loaded
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Loading data source...</span>
        </div>
      ) : sourceError ? (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Source</AlertTitle>
          <AlertDescription>{sourceError}</AlertDescription>
        </Alert>
      ) : !dataSource ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-muted-foreground">No data source selected.</span>
        </div>
      ) : (
        <>
          {/* Top Section: Header/Metadata (Simplified from old version) */}
          <div className="flex-none p-4 border-b">
             <div className="flex justify-between items-start mb-1">
                 <h2 className="text-lg font-semibold">{dataSource.name || `DataSource ${dataSource.id}`}</h2>
                 {/* Dataset Creation Button (Consider placement) */}
                  {renderHeaderActions && renderHeaderActions()}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <Badge variant="outline" className="capitalize">{dataSource.type}</Badge>
                <span>ID: {dataSource.id}</span>
                <span>Records: {dataSource.data_record_count ?? '-'}</span>
                 {dataSource.created_at && (
                    <span>Created: {format(new Date(dataSource.created_at), "PP")}</span>
                 )}
                 {dataSource.updated_at && (
                    <span>Updated: {formatDistanceToNow(new Date(dataSource.updated_at), { addSuffix: true })}</span>
                 )}
                 {/* Display status concisely */}
                 {dataSource.status && (
                      <Badge variant={
                          dataSource.status === 'complete' ? 'default'
                          : dataSource.status === 'failed' ? 'destructive'
                          : 'secondary' }
                          className="capitalize flex items-center gap-1"
                          title={dataSource.status === 'failed' ? dataSource.error_message || 'Failed' : dataSource.status}
                      >
                           {dataSource.status === 'processing' || dataSource.status === 'pending' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                           {dataSource.status === 'complete' ? <CheckCircle className="h-3 w-3" /> : null}
                           {dataSource.status === 'failed' ? <AlertCircle className="h-3 w-3" /> : null}
                           {dataSource.status}
                      </Badge>
                  )}
              </div>
          </div>

          {/* Main Content Area with Tabs */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Tabs defaultValue="content" className="w-full h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-2 flex-none sticky top-0 bg-background z-10 px-4 pt-2 mb-1">
                <TabsTrigger value="content">Source Content</TabsTrigger>
                <TabsTrigger value="results">Classification Results</TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="flex-1 min-h-0 overflow-y-auto p-4">
                 {renderContent()} {/* Render the actual data source content */}
              </TabsContent>

              <TabsContent value="results" className="flex-1 min-h-0 overflow-y-auto p-4">
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
                 {renderClassificationSection()} {/* Render the classification results section */}
              </TabsContent>
            </Tabs>
          </div>

          {/* Dialogs and Toaster outside the main flex container */}
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
                  {selectedResult && schemes.find(s => s.id === selectedResult.scheme_id) && ( // Added check for scheme
                    <ClassificationResultDisplay
                      result={adaptEnhancedResultReadToFormattedResult(selectedResult)}
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

           <DatasetCreateDialog
             open={isDatasetCreateDialogOpen}
             onOpenChange={setIsDatasetCreateDialogOpen}
             onSuccess={() => {
                toast({
                  title: "Dataset created successfully",
                });
                setIsDatasetCreateDialogOpen(false);
             }}
             initialDatarecordIds={initialDatasetRecordIds} // Use the memoized value
             initialSchemeIds={Array.from(new Set(classificationResults.map(r => r.scheme_id)))}
             initialJobIds={Array.from(new Set(classificationResults.map(r => r.job_id).filter(id => id != null) as number[]))}
            />
            {/* Toaster is likely handled globally */}
        </>
      )}
    </div>
  );
}

export default DocumentDetailView;