'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ColumnDef,
  RowSelectionState,
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
// Removed DataTable import: import { DataTable } from '@/components/collection/workspaces/tables/data-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import useAuth from "@/hooks/useAuth";
import { Separator } from "@/components/ui/separator";
import { Search, Plus, FileText, Upload, LinkIcon, ArrowUpDown, Loader2, CheckCircle, XCircle, AlertCircle, Trash2, Eye, FileSpreadsheet, List, Type, File } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { format, formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import CreateDataSourceDialog from './DocumentCreateDataSourceDialog';
import DocumentDetailView from './DocumentDetailView';
import Image from 'next/image';
import {
  Tabs,
  TabsContent,
} from "@/components/ui/tabs"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge"
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import EditDocumentOverlay from './EditDocumentOverlay';
import { DataSourceRead as ClientDataSourceRead } from '@/client/models';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import DocumentDetailProvider from './DocumentDetailProvider';
import DocumentDetailWrapper from './DocumentDetailWrapper';
import { useDataSourceStore } from '@/zustand_stores/storeDataSources';
import { DataSource, DataSourceStatus, DataSourceType } from '@/lib/classification/types';
import DocumentCardComponent from './DocumentCardComponent';
import { DocumentTransferPopover } from './DocumentTransferPopover';
import { useDebounce } from '@/hooks/useDebounce';
import { Checkbox } from "@/components/ui/checkbox";

const renderOrigin = (datasource: DataSource) => {
  const details = datasource.origin_details;
  switch (datasource.type) {
    case 'csv':
      return (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger className="flex items-center gap-1 cursor-default">
              <FileSpreadsheet className="h-3.5 w-3.5 text-green-600/80 shrink-0" />
              <span className="truncate text-xs">{details?.filename || 'CSV File'}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Path: {details?.filepath || 'N/A'}</p>
              <p>Type: {details?.content_type || 'N/A'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'pdf':
      return (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger className="flex items-center gap-1 cursor-default">
              <FileText className="h-3.5 w-3.5 text-primary/80 shrink-0" />
              <span className="truncate text-xs">{details?.filename || 'PDF File'}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Path: {details?.filepath || 'N/A'}</p>
              <p>Type: {details?.content_type || 'N/A'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'url_list':
      const count = details?.urls?.length || 0;
      return (
         <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger className="flex items-center gap-1 cursor-default">
              <List className="h-3.5 w-3.5 text-blue-600/80 shrink-0" />
              <span className="truncate text-xs">{count} URL(s)</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs max-h-40 overflow-y-auto">
              <ul>
                {(details?.urls || []).slice(0, 10).map((url: string, i: number) => <li key={i} className="text-xs truncate">{url}</li>)}
                {count > 10 && <li className="text-xs italic">...and {count - 10} more</li>}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'text_block':
      return (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger className="flex items-center gap-1 cursor-default">
              <Type className="h-3.5 w-3.5 text-primary/80 shrink-0" />
              <span className="truncate text-xs">Text Block</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Inline text content</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger className="flex items-center gap-1 cursor-default">
              <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate text-xs">Unknown</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Source type is unknown or not specified.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
  }
};

const renderStatusBadge = (status: DataSourceStatus, errorMessage?: string | null) => {
  let icon = <Loader2 className="h-3 w-3 animate-spin mr-1" />;
  let variant: "default" | "secondary" | "outline" | "destructive" = "secondary";
  let text = status;

  switch (status) {
    case 'pending':
      variant = "outline";
      text = "pending";
      break;
    case 'processing':
      variant = "secondary";
      text = "processing";
      break;
    case 'complete':
      variant = "default";
      icon = <CheckCircle className="h-3 w-3 text-green-500 mr-1" />;
      text = "complete";
      break;
    case 'failed':
      variant = "destructive";
      icon = <XCircle className="h-3 w-3 mr-1" />;
      text = "failed";
      break;
  }

  return (
     <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger>
           <Badge variant={variant} className="capitalize text-xs whitespace-nowrap">
              {icon}
              {text}
           </Badge>
         </TooltipTrigger>
         {status === 'failed' && errorMessage && (
           <TooltipContent className="max-w-xs bg-destructive text-destructive-foreground">
             <p className="text-xs font-semibold flex items-center"><AlertCircle className="h-3 w-3 mr-1" /> Error:</p>
             <p className="text-xs mt-1">{errorMessage}</p>
           </TooltipContent>
         )}
         {status === 'complete' && (
           <TooltipContent className="max-w-xs">
             <p className="text-xs">Processing finished successfully.</p>
           </TooltipContent>
         )}
      </Tooltip>
     </TooltipProvider>
  );
};

// Adjusted getColumns for alignment
const getColumns = (
  handleDataSourceSelect: (dataSource: DataSource) => void,
  handleDeleteClick: (dataSource: DataSource) => void,
  isLoading: boolean
): ColumnDef<DataSource>[] => [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
        // Removed alignment tweaks, rely on cell padding
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        // Removed alignment tweaks, rely on cell padding
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 40,
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 px-2" // Adjust button padding for alignment with checkbox header
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Name
        <ArrowUpDown className="ml-1.5 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="font-medium truncate hover:underline cursor-pointer" // Removed pl-1
              onClick={(e) => { e.stopPropagation(); handleDataSourceSelect(row.original); }}
              style={{ maxWidth: 'calc(100% - 5px)' }}
            >
              {row.original.name || `DataSource ${row.original.id}`}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{row.original.name || `DataSource ${row.original.id}`}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ),
    size: 250,
    minSize: 150,
  },
  {
    accessorKey: 'type',
    header: ({ column }) => (
        <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 px-2" // Adjust button padding
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
            Type
            <ArrowUpDown className="ml-1.5 h-3 w-3" />
        </Button>
    ),
    cell: ({ row }) => <Badge variant="outline" className="capitalize text-xs whitespace-nowrap">{row.original.type}</Badge>, // Removed ml-1
    size: 100,
    minSize: 80,
  },
  {
    accessorKey: 'origin_details',
    header: 'Origin',
    cell: ({ row }) => renderOrigin(row.original),
    size: 130,
    minSize: 100,
    maxSize: 200,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => renderStatusBadge(row.original.status, row.original.error_message),
    size: 100,
    minSize: 90,
  },
  {
    accessorKey: 'data_record_count',
    header: 'Records',
    cell: ({ row }) => {
        const count = row.original.data_record_count;
        return <span className="text-xs text-muted-foreground text-center w-full block pr-2">{typeof count === 'number' ? count : '-'}</span>;
    },
    size: 70,
    minSize: 60,
  },
  {
    accessorKey: 'updated_at',
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 px-2" // Adjust button padding
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Updated
        <ArrowUpDown className="ml-1.5 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => (
       <span className="text-xs text-muted-foreground whitespace-nowrap"> {/* Removed ml-1 */}
        {formatDistanceToNow(new Date(row.original.updated_at || row.original.created_at), { addSuffix: true })}
       </span>
    ),
    size: 130,
    minSize: 120,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => {
      const scheme = row.original;
      return (
        <div className="flex justify-end items-center gap-1 pr-2">
          <Button
             variant="ghost"
             size="icon"
             className="h-7 w-7"
             onClick={(e) => { e.stopPropagation(); handleDataSourceSelect(scheme); }}
             title="View Details"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <AlertDialogTrigger asChild>
             <Button
                 variant="ghost"
                 size="icon"
                 className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                 onClick={(e) => { e.stopPropagation(); handleDeleteClick(scheme); }}
                 title="Delete"
                 disabled={isLoading}
             >
               <Trash2 className="h-4 w-4" />
             </Button>
          </AlertDialogTrigger>
        </div>
      );
    },
    size: 80,
    minSize: 80,
  },
];

interface DocumentListProps {
  items: DataSource[];
  onDataSourceSelect: (dataSource: DataSource) => void;
  selectedDataSourceId: number | null;
}

interface DocumentManagerProps {
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  onDataSourceSelect?: (dataSource: DataSource) => void;
}

const AVAILABLE_TYPES: DataSourceType[] = ['text_block', 'pdf', 'csv', 'url_list'];

export default function DocumentManager({ onLoadIntoRunner, onDataSourceSelect }: DocumentManagerProps) {
  const {
    dataSources,
    fetchDataSources,
    isLoading: isLoadingDataSources,
    error: dataSourceError,
    startPollingDataSourceStatus,
    stopAllPolling,
    deleteDataSource,
  } = useDataSourceStore();

  const { activeWorkspace } = useWorkspaceStore();
  const { schemes, loadSchemes } = useClassificationSystem({
    autoLoadSchemes: false
  });

  const { isLoggedIn } = useAuth();

  const [isCreateDocumentOpen, setIsCreateDocumentOpen] = useState(false);
  const [createDocumentMode, setCreateDocumentMode] = useState<'single' | 'bulk' | 'scrape'>('single');
  const [isCardView, setIsCardView] = useState(false);
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<number | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [selectedTypes, setSelectedTypes] = useState<Set<DataSourceType>>(new Set(AVAILABLE_TYPES));
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([]); // Added sorting state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [dataSourceToDelete, setDataSourceToDelete] = useState<DataSource | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchingRef = useRef(false);
  const currentWorkspaceIdRef = useRef<number | null | undefined>(null);

  const handleDataSourceSelect = useCallback((dataSource: DataSource) => {
    setSelectedDataSourceId(dataSource.id);
    onDataSourceSelect?.(dataSource);
  }, [onDataSourceSelect]);

  const openCreateDocument = (mode: 'single' | 'bulk' | 'scrape') => {
    setCreateDocumentMode(mode);
    setIsCreateDocumentOpen(true);
  };

  const filteredDataSources = useMemo(() => {
    return dataSources.filter(ds => {
      const searchMatch = debouncedSearchTerm
        ? ds.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
          (ds.origin_details?.filename && ds.origin_details.filename.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
        : true;
      const typeMatch = selectedTypes.size === AVAILABLE_TYPES.length || selectedTypes.has(ds.type);
      return searchMatch && typeMatch;
    });
  }, [dataSources, debouncedSearchTerm, selectedTypes]);

  const selectedDataSourceIds = useMemo(() => {
      // Use table.getSelectedRowModel() for potentially better performance if filtering/pagination were involved
      // For now, mapping over filteredDataSources based on rowSelection indices is fine.
      const selectedIndices = Object.keys(rowSelection).map(Number);
      return filteredDataSources
          .filter((_, index) => selectedIndices.includes(index))
          .map(ds => ds.id)
          .filter((id): id is number => id !== undefined && !isNaN(id));
  }, [rowSelection, filteredDataSources]);

  const handleDeleteClick = useCallback((dataSource: DataSource) => {
      setDataSourceToDelete(dataSource);
      setIsDeleteDialogOpen(true);
  }, []);

  const handleDeleteSelectedClick = useCallback(() => {
      setDataSourceToDelete(null); // Ensure we delete selected, not a single one
      setIsDeleteDialogOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
      const idsToDelete = dataSourceToDelete ? [dataSourceToDelete.id] : selectedDataSourceIds;
      if (idsToDelete.length === 0) return;

      setIsDeleting(true);
      try {
          await Promise.all(idsToDelete.map(id => deleteDataSource(id)));
          setRowSelection({}); // Clear selection after delete
          setDataSourceToDelete(null); // Clear single delete target
          setSelectedDataSourceId(prev => idsToDelete.includes(prev as number) ? null : prev); // Deselect if deleted
      } catch (error) {
          console.error('Error deleting data sources:', error);
          // TODO: Add user feedback (e.g., toast notification)
      } finally {
          setIsDeleting(false);
          setIsDeleteDialogOpen(false);
      }
  }, [dataSourceToDelete, selectedDataSourceIds, deleteDataSource]);

  const handleTransferComplete = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleTypeToggle = useCallback((type: DataSourceType) => {
    setSelectedTypes(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(type)) {
        newSelection.delete(type);
      } else {
        newSelection.add(type);
      }
      // If empty, select all; otherwise, use the new selection
      return newSelection.size === 0 ? new Set(AVAILABLE_TYPES) : newSelection;
    });
  }, []);

  const toggleAllTypes = useCallback(() => {
      // If all are selected, deselect all (show none initially, maybe better UX to select all?)
      // Current logic: if all selected -> empty set -> which then gets reset to ALL by handleTypeToggle logic.
      // Let's simplify: if all selected -> empty set (meaning filter none), if not all selected -> select all.
      // Actually, the requirement seems to be: if all selected -> empty set which means ALL, if some selected -> select ALL
      // Let's stick to the original logic: if all are selected -> clear selection (which defaults to ALL), otherwise select ALL
      setSelectedTypes(prev => prev.size === AVAILABLE_TYPES.length ? new Set() : new Set(AVAILABLE_TYPES));
  }, []);

  useEffect(() => {
    const workspaceId = activeWorkspace?.id;
    if (workspaceId && workspaceId !== currentWorkspaceIdRef.current && !fetchingRef.current) {
      console.log("[DocumentManager] Workspace changed, fetching data for:", workspaceId);
      fetchingRef.current = true;
      currentWorkspaceIdRef.current = workspaceId;
      setSelectedDataSourceId(null);
      setRowSelection({});
      setSorting([]); // Reset sorting on workspace change

      Promise.allSettled([
        fetchDataSources(),
        loadSchemes()
      ]).finally(() => {
          fetchingRef.current = false;
          console.log("[DocumentManager] Fetching complete for workspace:", workspaceId);
      });
    }

    // Cleanup function
    return () => {
      // Check if the component is unmounting or the workspace ID is changing
      if (activeWorkspace?.id !== currentWorkspaceIdRef.current) {
          console.log("[DocumentManager] Cleanup: Stopping polling due to workspace change/unmount.");
          stopAllPolling();
          currentWorkspaceIdRef.current = null; // Reset ref on cleanup related to workspace change
          fetchingRef.current = false; // Reset fetching flag
      }
    };
  }, [activeWorkspace?.id, fetchDataSources, loadSchemes, stopAllPolling]); // Added dependencies

  // Effect for polling based on dataSources
  useEffect(() => {
    // Only poll if the workspace hasn't changed and we are not currently fetching
    if (activeWorkspace?.id === currentWorkspaceIdRef.current && !fetchingRef.current && dataSources.length > 0) {
        console.log("[DocumentManager] Checking data sources for polling status.");
        dataSources.forEach(ds => {
            if (ds.status === 'pending' || ds.status === 'processing') {
                startPollingDataSourceStatus(ds.id);
            }
        });
    }
  }, [dataSources, startPollingDataSourceStatus, activeWorkspace?.id]); // Added dependencies

  // Memoize columns definition
  const columns = useMemo(
      () => getColumns(handleDataSourceSelect, handleDeleteClick, isDeleting),
      [handleDataSourceSelect, handleDeleteClick, isDeleting] // Dependencies for getColumns
  );

  // Initialize React Table instance
  const table = useReactTable({
    data: filteredDataSources,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // meta can be used to pass down functions/data if needed by cell/header renderers
    // meta: {
    //   deleteHandler: handleDeleteClick,
    // }
  });

  // Calculate description for delete dialog
  const deleteDescription = useMemo(() => {
      const count = dataSourceToDelete ? 1 : selectedDataSourceIds.length;
      const name = dataSourceToDelete ? `"${dataSourceToDelete.name}"` : `${count} selected data source(s)`;
      if (count === 0) return "No data sources selected for deletion."; // Should not happen if button is disabled
      return `This action will permanently delete ${name} and all associated data records. This cannot be undone.`;
  }, [dataSourceToDelete, selectedDataSourceIds.length]);

  // Moved this check AFTER ALL hook calls, just before the main return
  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-center text-muted-foreground">
          Please select a workspace to manage data sources.
        </p>
      </div>
    );
  }

  return (
    <DocumentDetailProvider>
      <DocumentDetailWrapper onLoadIntoRunner={onLoadIntoRunner}>
        <TooltipProvider delayDuration={0}>
           <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
               setIsDeleteDialogOpen(open);
               if (!open) setDataSourceToDelete(null); // Clear single delete target when dialog closes
           }}>
             <div className="flex flex-col h-full w-full max-w-screen-3xl mx-auto px-1 sm:px-2 overflow-hidden">

               {/* Top Action Buttons */}
               <div className="flex-none py-2 px-1 sm:px-2-b mb-2">
                 <div className="flex items-center justify-between gap-2 flex-wrap">
                   <div className="flex flex-wrap gap-2">
                     <Button variant="outline" onClick={() => openCreateDocument('single')} className="h-9 flex items-center">
                       <FileText className="h-4 w-4 mr-1 sm:mr-2" />
                       <span className="hidden sm:inline">New Text</span>
                       <span className="sm:hidden">Text</span>
                     </Button>
                     <Button variant="outline" onClick={() => openCreateDocument('bulk')} className="h-9 flex items-center">
                       <Upload className="h-4 w-4 mr-1 sm:mr-2" />
                       <span className="hidden sm:inline">Upload File</span>
                       <span className="sm:hidden">Upload</span>
                     </Button>
                     <Button variant="outline" onClick={() => openCreateDocument('scrape')} className="h-9 flex items-center">
                       <LinkIcon className="h-4 w-4 mr-1 sm:mr-2" />
                       <span className="hidden sm:inline">Add URLs</span>
                       <span className="sm:hidden">URLs</span>
                     </Button>
                   </div>
                   {/* Placeholder for potential right-aligned actions */}
                   <div></div>
                 </div>
               </div>

               {/* Main Content Area (Resizable Panels) */}
               <div className="flex-1 min-h-0 flex flex-col min-h-[calc(100vh-200px)] max-h-[calc(100vh-200px)] overflow-y-auto">
                 <ResizablePanelGroup
                   direction="horizontal"
                   className="h-full w-full rounded-lg border" // Added border
                 >
                   {/* Left Panel: List/Table View */}
                   <ResizablePanel
                     defaultSize={40}
                     minSize={25}
                     maxSize={65}
                     className="min-w-[320px] flex flex-col"
                     id="document-list-panel"
                   >
                     {/* List Header/Toolbar */}
                     <div className="flex-none p-1.5 sm:p-2 flex items-center justify-between gap-2 flex-wrap bg-muted/30 border-b">
                         {/* View Toggle & Type Filters */}
                         <div className="flex items-center gap-1.5 flex-wrap">
                             <div className="flex items-center space-x-1 rounded-md px-1 py-0.5 bg-background border h-7 mr-1">
                                 <Switch id="card-view" checked={isCardView} onCheckedChange={setIsCardView} className="scale-[0.7] data-[state=checked]:bg-primary" />
                                 <label htmlFor="card-view" className="text-xs font-medium cursor-pointer">
                                     Card
                                 </label>
                             </div>
                           <Button
                               variant={selectedTypes.size === AVAILABLE_TYPES.length || selectedTypes.size === 0 ? "secondary" : "ghost"} // Highlight if all types shown
                               size="sm"
                               className="h-7 text-xs px-2"
                               onClick={toggleAllTypes}
                           >
                             All Types
                           </Button>
                           {AVAILABLE_TYPES.map(type => (
                               <Button
                                   key={type}
                                   variant={selectedTypes.has(type) ? 'secondary' : 'ghost'}
                                   size="sm"
                                   className="h-7 text-xs px-2 capitalize"
                                   onClick={() => handleTypeToggle(type)}
                               >
                                   {type.replace('_', ' ')}
                               </Button>
                           ))}
                         </div>
                         {/* Search & Actions */}
                         <div className="flex items-center gap-1.5 flex-grow justify-end sm:flex-grow-0 flex-wrap">
                             <div className="relative flex-grow sm:flex-grow-0 max-w-[160px] sm:max-w-[200px]">
                               <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                               <Input
                                   placeholder="Search..."
                                   className="pl-7 h-7 text-xs w-full"
                                   value={searchTerm}
                                   onChange={(e) => setSearchTerm(e.target.value)}
                               />
                             </div>
                             {/* Transfer Popover */}
                             <DocumentTransferPopover
                               selectedDataSourceIds={selectedDataSourceIds}
                               onComplete={handleTransferComplete}
                             />
                             {/* Delete Button (for selected items) */}
                             <AlertDialogTrigger asChild>
                               <Button
                                 variant="outline"
                                 size="sm"
                                 onClick={handleDeleteSelectedClick}
                                 disabled={selectedDataSourceIds.length === 0 || isDeleting}
                                 className="text-destructive hover:text-destructive h-7 px-2"
                               >
                                 <Trash2 className="mr-1 h-3.5 w-3.5" />
                                 ({selectedDataSourceIds.length})
                               </Button>
                             </AlertDialogTrigger>
                         </div>
                     </div>

                     {/* List Content Area */}
                     <div className="flex-1 min-h-0 overflow-hidden">
                       {isLoadingDataSources && (
                         <div className="h-full flex items-center justify-center p-4">
                           <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                           <span className="ml-2 text-muted-foreground">Loading Data Sources...</span>
                         </div>
                       )}
                       {dataSourceError && (
                         <div className="h-full flex items-center justify-center text-red-500 p-4">
                           <AlertCircle className="h-5 w-5 mr-2" />
                           <span>Error loading data: {dataSourceError}</span>
                         </div>
                       )}
                       {!isLoadingDataSources && !dataSourceError && (
                         <div className="h-full flex flex-col">
                           {isCardView ? (
                             <ScrollArea className="h-full">
                               <DocumentCardComponent
                                 items={filteredDataSources} // Use filtered data for cards too
                                 selectedDataSourceId={selectedDataSourceId}
                                 onDataSourceSelect={handleDataSourceSelect}
                               />
                             </ScrollArea>
                           ) : (
                             // Inlined Table Rendering
                             <div className="relative w-full h-full overflow-auto">
                               <table className="w-full text-sm table-fixed">{/* Use table-fixed for better size control */}
                                 <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm z-10">
                                   {table.getHeaderGroups().map(headerGroup => (
                                     <tr key={headerGroup.id} className="border-b transition-colors hover:bg-muted/70">
                                       {headerGroup.headers.map(header => (
                                         <th
                                           key={header.id}
                                           className="h-9 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:px-2" // Ensure checkbox header has padding
                                           style={{ width: header.getSize() }} // Use tanstack size directly
                                         >
                                           {header.isPlaceholder
                                             ? null
                                             : flexRender(
                                                 header.column.columnDef.header,
                                                 header.getContext()
                                               )}
                                         </th>
                                       ))}
                                     </tr>
                                   ))}
                                 </thead>
                                 <tbody className="[&_tr:last-child]:border-0">
                                   {table.getRowModel().rows?.length ? (
                                     table.getRowModel().rows.map(row => (
                                       <tr
                                         key={row.id}
                                         data-state={row.getIsSelected() && "selected"}
                                         className={cn(
                                           "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted cursor-pointer",
                                           selectedDataSourceId === row.original.id && "bg-muted" // Highlight selected row for detail view
                                         )}
                                         onClick={() => handleDataSourceSelect(row.original)}
                                       >
                                         {row.getVisibleCells().map(cell => (
                                           <td
                                             key={cell.id}
                                             className="p-2 align-middle [&:has([role=checkbox])]:px-2 truncate" // Ensure checkbox cell has padding, add truncate
                                             style={{ width: cell.column.getSize() }} // Use tanstack size directly
                                           >
                                             {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                           </td>
                                         ))}
                                       </tr>
                                     ))
                                   ) : (
                                     <tr>
                                       <td colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                                         No data sources found.
                                       </td>
                                     </tr>
                                   )}
                                 </tbody>
                               </table>
                             </div>
                           )}
                         </div>
                       )}
                     </div>
                   </ResizablePanel>

                   <ResizableHandle withHandle className="hidden sm:flex bg-border" />

                   {/* Right Panel: Detail View */}
                   <ResizablePanel
                     defaultSize={60}
                     minSize={35}
                     maxSize={75}
                     className="min-w-[320px] bg-background"
                     id="document-detail-panel"
                   >
                     <div className="h-full border-l">
                       <DocumentDetailView
                         onEdit={() => console.warn('Edit DataSource triggered but not implemented')} // TODO: Implement Edit
                         schemes={schemes}
                         selectedDataSourceId={selectedDataSourceId}
                         onLoadIntoRunner={onLoadIntoRunner}
                       />
                     </div>
                   </ResizablePanel>
                 </ResizablePanelGroup>
               </div>

               {/* Dialogs */}
               <CreateDataSourceDialog
                 open={isCreateDocumentOpen}
                 onClose={() => setIsCreateDocumentOpen(false)}
                 initialMode={createDocumentMode}
               />
               <AlertDialogContent>
                 <AlertDialogHeader>
                   <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
                   <AlertDialogDescription>
                      {deleteDescription}
                   </AlertDialogDescription>
                 </AlertDialogHeader>
                 <AlertDialogFooter>
                   <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>Cancel</AlertDialogCancel>
                   <AlertDialogAction
                     onClick={confirmDelete}
                     disabled={isDeleting || (!dataSourceToDelete && selectedDataSourceIds.length === 0)} // Disable if nothing to delete
                     className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                   >
                     {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                     Delete
                   </AlertDialogAction>
                 </AlertDialogFooter>
               </AlertDialogContent>
             </div>
           </AlertDialog>
         </TooltipProvider>
       </DocumentDetailWrapper>
     </DocumentDetailProvider>
  );
}