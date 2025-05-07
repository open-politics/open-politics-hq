/* frontend/src/components/collection/workspaces/jobs/JobHistoryView.tsx */
'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  useClassificationJobsStore,
  useClassificationJobsActions,
  useIsClassificationJobsLoading,
  useClassificationJobsError
} from '@/zustand_stores/storeClassificationJobs';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { ClassificationJobRead, ClassificationJobStatus } from '@/client';
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
import { Loader2, AlertCircle, ExternalLink, RefreshCw, Filter, Star } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFavoriteRunsStore, FavoriteRun } from '@/zustand_stores/storeFavoriteRuns';
import { cn } from "@/lib/utils";

interface JobHistoryViewProps {
  // Function to trigger loading a job's results into the runner view
  onLoadJob: (jobId: number | null) => void;
}

const formatJobStatus = (status: ClassificationJobStatus | string | null | undefined) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    const statusLower = status.toLowerCase();
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
        default:
            return <Badge variant="outline" className="capitalize">{status}</Badge>;
    }
};

export default function JobHistoryView({ onLoadJob }: JobHistoryViewProps) {
  const { activeWorkspace } = useWorkspaceStore();

  // 1. Select the jobs object (more stable reference)
  const jobsObject = useClassificationJobsStore((state) => state.classificationJobs);
  const { favoriteRuns } = useFavoriteRunsStore();

  // 2. Derive the array using useMemo
  const allJobs = useMemo(() => Object.values(jobsObject || {}), [jobsObject]);

  // Now allJobs should be correctly typed and stable
  const isLoading = useIsClassificationJobsLoading();
  const error = useClassificationJobsError();
  const { fetchClassificationJobs } = useClassificationJobsActions();

  const [statusFilter, setStatusFilter] = useState<string>('all'); // 'all', 'active', 'completed', 'failed', etc.
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const prevWorkspaceIdRef = useRef<number | null | undefined>(null);

  useEffect(() => {
    const currentWorkspaceId = activeWorkspace?.id;
    // Fetch jobs if workspace ID is present
    if (currentWorkspaceId) {
      fetchClassificationJobs(currentWorkspaceId);
    }

    // Reset filter ONLY if workspace ID has changed
    if (currentWorkspaceId !== prevWorkspaceIdRef.current) {
        setStatusFilter('all');
        setShowFavoritesOnly(false);
    }

    // Update the ref AFTER the check
    prevWorkspaceIdRef.current = currentWorkspaceId;

  }, [activeWorkspace?.id, fetchClassificationJobs]);

  const handleRefresh = () => {
    if (activeWorkspace?.id) {
      fetchClassificationJobs(activeWorkspace.id);
    }
  };

  const parseFavoriteTimestamp = (ts: string): number => {
    try {
      const date = new Date(ts.replace(' at ', ' '));
      if (!isNaN(date.getTime())) return date.getTime();
    } catch (e) { /* ignore */ }
    try {
      const date = new Date(ts);
      if (!isNaN(date.getTime())) return date.getTime();
    } catch (e) { /* ignore */ }
    return 0;
  };

  const currentWorkspaceFavoriteRuns = useMemo(() => {
    if (!activeWorkspace?.id) return [];
    return favoriteRuns
      .filter(fav => Number(fav.workspaceId) === activeWorkspace.id)
      .sort((a, b) => parseFavoriteTimestamp(b.timestamp) - parseFavoriteTimestamp(a.timestamp));
  }, [favoriteRuns, activeWorkspace?.id]);

  const currentWorkspaceFavoriteRunIds = useMemo(() => {
    return currentWorkspaceFavoriteRuns.map(fav => fav.id);
  }, [currentWorkspaceFavoriteRuns]);

  const latestThreeFavoritesForDisplay = useMemo(() => {
    return currentWorkspaceFavoriteRuns.slice(0, 3);
  }, [currentWorkspaceFavoriteRuns]);

  const filteredJobs = useMemo(() => {
    let processedJobs = [...allJobs];

    // 1. Filter by favorites if the toggle is active
    if (showFavoritesOnly) {
      processedJobs = processedJobs.filter(job => currentWorkspaceFavoriteRunIds.includes(job.id));
    }

    // 2. Apply status filter
    if (statusFilter === 'all') {
      // No status filter needed
    } else if (statusFilter === 'active') {
      processedJobs = processedJobs.filter(job => job.status === 'running' || job.status === 'pending');
    } else if (statusFilter === 'completed') {
      processedJobs = processedJobs.filter(job => job.status === 'completed' || job.status === 'completed_with_errors');
    } else if (statusFilter === 'failed') {
      processedJobs = processedJobs.filter(job => job.status === 'failed');
    }
    // No 'else' needed as statusFilter must be one of the above or 'all' based on SelectItems

    // 3. Sort
    return processedJobs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [allJobs, statusFilter, showFavoritesOnly, currentWorkspaceFavoriteRunIds]);

  const getEmptyStateMessage = () => {
    if (isLoading && allJobs.length === 0) return ""; // Loading message will show
    if (error) return ""; // Error message will show

    if (filteredJobs.length > 0) return ""; // Not empty

    if (showFavoritesOnly) {
      if (statusFilter === 'all') return "No favorite jobs found for this workspace.";
      return `No favorite jobs found matching status: ${statusFilter}.`;
    }
    // Not showing favorites only
    if (statusFilter === 'all') return "No classification jobs found for this workspace.";
    return `No jobs found matching status: ${statusFilter}.`;
  };
  const emptyStateMessage = getEmptyStateMessage();

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start mb-2">
          <div>
             <CardTitle>Classification Job History</CardTitle>
             <CardDescription>
               View past and currently running classification jobs for this workspace.
             </CardDescription>
          </div>
          <div className="flex items-center gap-2">
             <Button
                variant={showFavoritesOnly ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowFavoritesOnly(prev => !prev)}
                className="h-8"
                title={showFavoritesOnly ? "Show All Jobs" : "Show Only Favorite Jobs"}
             >
                <Star className={cn("mr-1 h-3 w-3", showFavoritesOnly && "fill-yellow-400 text-yellow-400")}/> Favorites
             </Button>
             <Select value={statusFilter} onValueChange={(value) => {
                setStatusFilter(value);
             }}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                    <Filter className="h-3 w-3 mr-1 text-muted-foreground"/>
                    <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active (Running/Pending)</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
             </Select>
             <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading} className="h-8">
               <RefreshCw className={`mr-1 h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
             </Button>
           </div>
         </div>
         {latestThreeFavoritesForDisplay.length > 0 && (
            <div className="mb-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium">Latest Favorites:</span>
                {latestThreeFavoritesForDisplay.map(fav => (
                    <TooltipProvider key={fav.id} delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge
                                    variant="outline"
                                    onClick={() => onLoadJob(fav.id)}
                                    className="cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                >
                                    <Star className="h-2.5 w-2.5 mr-1 fill-yellow-500 text-yellow-500" />
                                    {fav.name || `Job ${fav.id}`}
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Load Job: {fav.name || `Job ${fav.id}`}</p>
                                {fav.description && <p className="text-xs text-muted-foreground max-w-xs truncate">{fav.description}</p>}
                                <p className="text-xs text-muted-foreground">Favorited: {fav.timestamp}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ))}
            </div>
         )}
      </CardHeader>
      <CardContent>
        {isLoading && allJobs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading job history...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-destructive">
            <AlertCircle className="h-5 w-5 mr-2" />
            <span>Error loading job history: {error}</span>
          </div>
        ) : !isLoading && filteredJobs.length === 0 ? (
           <div className="text-center py-8 text-muted-foreground">
               {emptyStateMessage}
           </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Actions</TableHead>
                <TableHead>Job Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Targets</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onLoadJob(job.id)}
                      disabled={!job.status || ['pending', 'running'].includes(job.status)}
                      className="h-7 text-xs"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Load Results
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">
                     <TooltipProvider delayDuration={100}>
                       <Tooltip>
                         <TooltipTrigger className="cursor-default text-left">
                            <span className="truncate max-w-[200px] inline-block">{job.name || `Job ${job.id}`}</span>
                         </TooltipTrigger>
                         <TooltipContent>
                            <p>Name: {job.name || `Job ${job.id}`}</p>
                            {job.description && <p>Desc: {job.description}</p>}
                            <p>ID: {job.id}</p>
                         </TooltipContent>
                       </Tooltip>
                     </TooltipProvider>
                  </TableCell>
                  <TableCell>
                    <TooltipProvider delayDuration={100}>
                       <Tooltip>
                         <TooltipTrigger>
                            {formatJobStatus(job.status)}
                         </TooltipTrigger>
                         <TooltipContent>
                             {job.error_message ? <p className="text-xs max-w-xs">{job.error_message}</p> : <p>Status: {job.status}</p>}
                         </TooltipContent>
                       </Tooltip>
                     </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {job.target_datasource_ids?.length ?? 0} Source(s)<br/>
                    {job.target_scheme_ids?.length ?? 0} Scheme(s)
                  </TableCell>
                   <TableCell className="text-xs text-muted-foreground">
                    {job.configuration?.recurring_task_id ? (
                       `Task ID: ${job.configuration.recurring_task_id}`
                    ) : (
                       'Manual'
                    )}
                   </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger>
                          {formatDistanceToNow(new Date(job.updated_at), { addSuffix: true })}
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Created: {format(new Date(job.created_at), 'PPp')}</p>
                          <p>Updated: {format(new Date(job.updated_at), 'PPp')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
} 