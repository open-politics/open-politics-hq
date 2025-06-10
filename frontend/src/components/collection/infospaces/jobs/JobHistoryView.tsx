/* frontend/src/components/collection/infospaces/jobs/JobHistoryView.tsx */
'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
// import {
//   useClassificationJobsStore,
//   useClassificationJobsActions,
//   useIsClassificationJobsLoading,
//   useClassificationJobsError
// } from '@/zustand_stores/storeClassificationJobs';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
// import { ClassificationJobRead, ResourceType, ClassificationJobStatus as ClassificationJobStatusType } from '@/client/models';
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
// import { classificationJobColumns, ClassificationJobRowData } from '../classifications/tables/jobs/columns';
// import { DataTable } from '@/components/collection/infospaces/tables/data-table';
import { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useShareableStore } from '@/zustand_stores/storeShareables';

// --- Temporary Types ---
export type ClassificationJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'completed_with_errors';
export type ResourceType = 'bundle' | 'asset' | 'schema' | 'infospace' | 'run' | 'package';
export type ClassificationJobStatusType = ClassificationJobStatus;

export interface ClassificationJobRead {
  id: number;
  name: string;
  status: ClassificationJobStatus;
  created_at: string;
  updated_at: string;
}

export type ClassificationJobRowData = ClassificationJobRead;

const DUMMY_COLUMNS: ColumnDef<ClassificationJobRowData>[] = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'status', header: 'Status' },
    { accessorKey: 'created_at', header: 'Created' },
];
// --- End Temporary Types ---

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
  const { activeInfospace } = useInfospaceStore();
  // Placeholder data and functions
  const allJobs: ClassificationJobRead[] = [];
  const isLoading = false;
  const error = null;
  const fetchClassificationJobs = () => console.log('fetchClassificationJobs');
  const deleteClassificationJob = () => console.log('deleteClassificationJob');
  const exportClassificationJob = () => console.log('exportClassificationJob');
  const exportMultipleClassificationJobs = () => console.log('exportMultipleClassificationJobs');
  const importClassificationJob = () => console.log('importClassificationJob');
  const { createLink } = useShareableStore();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeInfospace?.id) {
      fetchClassificationJobs();
    }
  }, [activeInfospace?.id, fetchClassificationJobs]);

  const handleShareJob = useCallback(async (jobId: number) => {
    if (!activeInfospace?.id) {
      toast.error('No active Infospace selected for sharing.');
      return;
    }
    const jobToShare = allJobs.find(j => j.id === jobId);
    const jobName = jobToShare?.name || `Job ${jobId}`;

    toast.promise(createLink({
      resource_type: 'run' as ResourceType, // Use 'run' as per backend
      resource_id: jobId,
      name: `Share link for Classification Job: ${jobName}`,
    }), {
      loading: `Generating share link for ${jobName}...`,
      success: (newLink: any) => {
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
  }, [activeInfospace, createLink, allJobs]);
  
  // Rest of the component logic is simplified or removed for now
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Classification Job History</CardTitle>
        <CardDescription>Select an Infospace to view job history.</CardDescription>
      </CardHeader>
      <CardContent className="text-center text-muted-foreground">
        <p>Job history view is temporarily simplified.</p>
      </CardContent>
    </Card>
  );
} 