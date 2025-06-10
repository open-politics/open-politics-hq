'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpDown, MoreHorizontal, Eye, Download, Share2, Trash2, PlayCircle, CheckCircle, XCircle, Loader2, PauseCircle, AlertTriangle, Star } from 'lucide-react';
import { ClassificationJobRead, ClassificationJobStatus, ResourceType } from '@/client/models';
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import { useFavoriteRunsStore } from "@/zustand_stores/storeFavoriteRuns";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type ClassificationJobRowData = ClassificationJobRead;

const renderJobStatusBadge = (status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'completed_with_errors' | null | undefined) => {
  if (!status) return <Badge variant="outline">Unknown</Badge>;

  switch (status) {
    case 'pending':
      return <Badge variant="outline"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Pending</Badge>;
    case 'running':
      return <Badge variant="secondary"><PlayCircle className="mr-1 h-3 w-3" /> Running</Badge>;
    case 'completed':
      return <Badge variant="default"><CheckCircle className="mr-1 h-3 w-3 text-green-500" /> Completed</Badge>;
    case 'failed':
      return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Failed</Badge>;
    case 'cancelled':
      return <Badge variant="destructive" className="bg-amber-500 hover:bg-amber-600 text-white"><PauseCircle className="mr-1 h-3 w-3" /> Cancelled</Badge>;
    case 'completed_with_errors':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><AlertTriangle className="mr-1 h-3 w-3" /> Partial</Badge>;
    default:
      const exhaustiveCheck: never = status;
      return <Badge variant="outline">{status}</Badge>;
  }
};

interface JobColumnProps {
  onViewResults: (job: ClassificationJobRowData) => void;
  onExport: (jobId: number) => void;
  onShare: (jobId: number) => void;
  onDelete: (job: ClassificationJobRowData) => void;
}

export const classificationJobColumns = ({ onViewResults, onExport, onShare, onDelete }: JobColumnProps): ColumnDef<ClassificationJobRowData>[] => {
  const { activeInfospace } = useInfospaceStore.getState();
  const { favoriteRuns, addFavoriteRun, removeFavoriteRun } = useFavoriteRunsStore.getState();
  
  const isFavorite = (jobId: number) => {
    if (!activeInfospace?.id) return false;
    return favoriteRuns.some(fav => fav.id === jobId && Number(fav.InfospaceId) === activeInfospace.id);
  };

  const toggleFavorite = (job: ClassificationJobRowData) => {
    if (!activeInfospace) {
      toast.error("An active Infospace is required to manage favorites.");
      return;
    }
    const { id, name } = job;
    const fav = { id, name: name || `Job ${id}`, InfospaceId: activeInfospace.id.toString(), type: 'run' as 'run' };
    
    if (isFavorite(id)) {
      removeFavoriteRun(id, activeInfospace.id.toString());
      toast.info(`'${fav.name}' removed from favorites.`);
    } else {
      addFavoriteRun(fav);
      toast.success(`'${fav.name}' added to favorites.`);
    }
  };

  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all jobs"
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          className="translate-y-[2px]"
          onClick={(e) => e.stopPropagation()} // Prevent row click if checkbox is clicked
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      accessorKey: 'name',
      header: 'Job Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name || `Job ${row.original.id}`}</span>,
      size: 200,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => renderJobStatusBadge(row.original.status),
      size: 120,
    },
    {
      accessorKey: 'target_scheme_ids',
      header: 'Schemes',
      cell: ({ row }) => row.original.target_scheme_ids?.length || 0,
      size: 80,
    },
    {
      accessorKey: 'target_datasource_ids',
      header: 'Sources',
      cell: ({ row }) => row.original.target_datasource_ids?.length || 0,
      size: 80,
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Created At
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => format(new Date(row.original.created_at), "PP pp"),
      size: 180,
    },
    {
      id: 'favorite',
      header: () => <Star className="h-4 w-4" />,
      cell: ({ row }) => {
        const job = row.original;
        return (
          <Button variant="ghost" size="icon" onClick={() => toggleFavorite(job)}>
            <Star className={cn("h-4 w-4", isFavorite(job.id) && "fill-yellow-400 text-yellow-500")} />
          </Button>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const job = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onViewResults(job);}}>
                <Eye className="mr-2 h-4 w-4" /> View Results
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onExport(job.id);}}>
                <Download className="mr-2 h-4 w-4" /> Export Job
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onShare(job.id);}}>
                <Share2 className="mr-2 h-4 w-4" /> Share Job
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={(e) => {e.stopPropagation(); onDelete(job);}}
                className="text-red-600 focus:text-red-500 focus:bg-red-100 dark:focus:bg-red-800/50"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete Job
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      size: 100,
      enableResizing: false,
    },
  ]; 
} 