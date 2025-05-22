/* frontend/src/components/collection/workspaces/jobs/JobHistoryView.tsx */
'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  useClassificationJobsStore,
  useClassificationJobsActions,
  useIsClassificationJobsLoading,
  useClassificationJobsError
} from '@/zustand_stores/storeClassificationJobs';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { ClassificationJobRead, ResourceType, ClassificationJobStatus as ClassificationJobStatusType } from '@/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, ExternalLink, RefreshCw, Filter, Star, Upload, Download, Trash2, Eye, Share2, Plus } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFavoriteRunsStore, FavoriteRun } from '@/zustand_stores/storeFavoriteRuns';
import { cn } from "@/lib/utils";
import { toast } from 'sonner';
import { classificationJobColumns, ClassificationJobRowData } from '../classifications/tables/jobs/columns';
import { DataTable } from '@/components/collection/workspaces/tables/data-table';
import { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useShareableStore } from '@/zustand_stores/storeShareables';

interface JobHistoryViewProps {
  onLoadJob: (jobId: number | null) => void;
}

const formatJobStatus = (status: ClassificationJobStatusType | string | null | undefined) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    const statusLower = typeof status === 'string' ? status.toLowerCase() : status;
    switch (statusLower) {
        case 'completed':
            return <Badge variant="default" className="bg-green-600 hover:bg-green-700">Completed</Badge>;
        case 'failed':
            return <Badge variant="destructive">Failed</Badge>;
        case 'completed_with_errors':
            return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Completed (Errors)</Badge>;
        case 'running':
            return <Badge variant="secondary" className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Running</Badge>;
        case 'pending':
            return <Badge variant="secondary" className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Pending</Badge>;
        case 'cancelled':
            return <Badge variant="destructive" className="bg-amber-500 hover:bg-amber-600 text-white">Cancelled</Badge>;
        default:
            return <Badge variant="outline" className="capitalize">{status}</Badge>;
    }
};

export default function JobHistoryView({ onLoadJob }: JobHistoryViewProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const jobsObject = useClassificationJobsStore((state) => state.classificationJobs);
  const allJobs = useMemo(() => Object.values(jobsObject || {}).sort((a,b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()), [jobsObject]);
  const isLoading = useIsClassificationJobsLoading();
  const error = useClassificationJobsError();
  const { 
    fetchClassificationJobs, 
    deleteClassificationJob, 
    exportClassificationJob, 
    exportMultipleClassificationJobs, 
    importClassificationJob 
  } = useClassificationJobsActions();
  const { createLink } = useShareableStore();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const prevWorkspaceIdRef = useRef<number | null | undefined>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const currentWorkspaceId = activeWorkspace?.id;
    if (currentWorkspaceId) {
      fetchClassificationJobs(currentWorkspaceId);
    }
    if (currentWorkspaceId !== prevWorkspaceIdRef.current) {
      setStatusFilter('all');
      setShowFavoritesOnly(false);
      setRowSelection({});
    }
    prevWorkspaceIdRef.current = currentWorkspaceId;
  }, [activeWorkspace?.id, fetchClassificationJobs]);

  const handleRefresh = () => {
    if (activeWorkspace?.id) {
      fetchClassificationJobs(activeWorkspace.id);
      toast.info('Refreshing job history...');
    }
  };

  const handleViewResults = useCallback((job: ClassificationJobRowData) => {
    onLoadJob(job.id);
    toast.info(`Loading results for job: ${job.name || job.id}`);
  }, [onLoadJob]);

  const handleExportJob = useCallback(async (jobId: number) => {
    if (!activeWorkspace?.id) {
      toast.error('No active workspace selected.');
      return;
    }
    await exportClassificationJob(jobId);
  }, [activeWorkspace?.id, exportClassificationJob]);

  const handleShareJob = useCallback(async (jobId: number) => {
    if (!activeWorkspace?.id) {
      toast.error('No active workspace selected for sharing.');
      return;
    }
    const jobToShare = allJobs.find(j => j.id === jobId);
    const jobName = jobToShare?.name || `Job ${jobId}`;

    toast.promise(createLink({
      resource_type: 'classification_job' as ResourceType,
      resource_id: jobId,
      name: `Share link for Classification Job: ${jobName}`,
      description: `A shareable link to access Classification Job ${jobName} (ID: ${jobId}) from workspace ${activeWorkspace.name}`,
      // permission_level: 'read_only', // Default in backend schema
      // is_public: true, // Default false
      // requires_login: true, // Default true
    }), {
      loading: `Generating share link for ${jobName}...`,
      success: (newLink) => {
        if (newLink && newLink.share_url) {
          navigator.clipboard.writeText(newLink.share_url)
            .then(() => toast.success(`Share link for ${jobName} copied to clipboard!`))
            .catch(() => toast.success(`Share link for ${jobName}: ${newLink.share_url}`));
          return `Share link created: ${newLink.share_url}`;
        } else {
          throw new Error("Failed to generate a valid share link.");
        }
      },
      error: (err) => {
        console.error("Failed to create share link:", err);
        return `Failed to create share link for ${jobName}.`;
      }
    });
  }, [activeWorkspace, createLink, allJobs]);

  const handleDeleteJob = useCallback(async (job: ClassificationJobRowData) => {
    if (!activeWorkspace?.id) {
      toast.error('No active workspace selected.');
      return;
    }
    toast.promise(deleteClassificationJob(activeWorkspace.id, job.id), {
      loading: `Deleting job: ${job.name || job.id}...`,
      success: () => {
        setRowSelection({}); 
        return `Job '${job.name || job.id}' deleted successfully.`;
      },
      error: `Failed to delete job: ${job.name || job.id}.`,
    });
  }, [activeWorkspace?.id, deleteClassificationJob]);

  const columns: ColumnDef<ClassificationJobRowData>[] = useMemo(() => 
    classificationJobColumns({
      onViewResults: handleViewResults,
      onExport: handleExportJob,
      onShare: handleShareJob,
      onDelete: handleDeleteJob,
    }), 
  [handleViewResults, handleExportJob, handleShareJob, handleDeleteJob]);

  const { favoriteRuns } = useFavoriteRunsStore();
  const currentWorkspaceFavoriteRunIds = useMemo(() => {
    if (!activeWorkspace?.id) return [];
    return favoriteRuns
      .filter(fav => Number(fav.workspaceId) === activeWorkspace.id)
      .map(fav => fav.id);
  }, [favoriteRuns, activeWorkspace?.id]);

  const filteredJobs = useMemo(() => {
    let processedJobs = [...allJobs];
    if (showFavoritesOnly) {
      processedJobs = processedJobs.filter(job => currentWorkspaceFavoriteRunIds.includes(job.id));
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'active') {
        processedJobs = processedJobs.filter(job => 
          job.status === 'running' || 
          job.status === 'pending'
        );
      } else {
        processedJobs = processedJobs.filter(job => job.status === statusFilter || job.status?.toString() === statusFilter);
      }
    }
    return processedJobs;
  }, [allJobs, statusFilter, showFavoritesOnly, currentWorkspaceFavoriteRunIds]);

  const selectedJobIds = useMemo(() => {
    const selectedIndices = Object.keys(rowSelection).map(Number);
    return filteredJobs
      .filter((_, index) => selectedIndices.includes(index))
      .map(job => job.id)
      .filter((id): id is number => typeof id === 'number');
  }, [rowSelection, filteredJobs]);

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      toast.error("No file selected for import.");
      return;
    }
    if (!activeWorkspace?.id) {
      toast.error("No active workspace. Cannot import job.");
      return;
    }
    toast.promise(importClassificationJob(file), {
      loading: 'Importing job...',
      success: (importedJob) => {
        if (importedJob) return `Job '${importedJob.name || importedJob.id}' imported successfully.`;
        return 'Job import initiated.';
      },
      error: 'Failed to import job.',
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleExportSelectedJobs = async () => {
    if (selectedJobIds.length === 0) {
      toast.info("No jobs selected for export.");
      return;
    }
    if (!activeWorkspace?.id) {
      toast.error("No active workspace. Cannot export jobs.");
      return;
    }
    await exportMultipleClassificationJobs(selectedJobIds);
  };

  if (!activeWorkspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Classification Job History</CardTitle>
          <CardDescription>Select a workspace to view job history.</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground">
          <p>Please select or create a workspace.</p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
          <div>
            <CardTitle>Classification Job History</CardTitle>
            <CardDescription>
              View, manage, and import/export classification jobs for this workspace.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="h-8">
              <Upload className="mr-1 h-3.5 w-3.5" /> Import Job
            </Button>
            <input type="file" ref={fileInputRef} onChange={handleImportFile} className="hidden" accept=".json,.zip" />
            <Button variant="outline" size="sm" onClick={handleExportSelectedJobs} disabled={selectedJobIds.length === 0} className="h-8">
              <Download className="mr-1 h-3.5 w-3.5" /> Export Selected ({selectedJobIds.length})
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading} className="h-8">
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={showFavoritesOnly ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFavoritesOnly(prev => !prev)}
            className="h-8"
            title={showFavoritesOnly ? "Show All Jobs" : "Show Only Favorite Jobs"}
          >
            <Star className={cn("mr-1 h-3 w-3", showFavoritesOnly && "fill-yellow-400 text-yellow-400")}/> Favorites
          </Button>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-auto sm:w-[180px] h-8 text-xs">
              <Filter className="h-3 w-3 mr-1 text-muted-foreground"/>
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="completed_with_errors">Completed with Errors</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && filteredJobs.length === 0 && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2">Loading job history...</span>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center py-10 text-destructive">
            <AlertCircle className="h-8 w-8 mb-2" />
            <span className="font-medium">Error loading job history</span>
            <p className="text-sm">{error}</p>
          </div>
        )}
        {!isLoading && !error && (
          <DataTable 
            columns={columns} 
            data={filteredJobs} 
            rowSelection={rowSelection} 
            onRowSelectionChange={setRowSelection}
          />
        )}
        {!isLoading && !error && filteredJobs.length === 0 && (
           <div className="text-center py-10 text-muted-foreground">
             <p>No classification jobs found matching your criteria.</p>
           </div>
        )}
      </CardContent>
    </Card>
  );
} 