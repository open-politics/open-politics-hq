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
import { ArrowUpDown, MoreHorizontal, Eye, Download, Share2, Trash2, PlayCircle, CheckCircle, XCircle, Loader2, PauseCircle, AlertTriangle, Star, HelpCircle } from 'lucide-react';
import { AnnotationRunRead, RunStatus, ResourceType } from '@/client/models';
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import { useFavoriteRunsStore } from "@/zustand_stores/storeFavoriteRuns";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
// import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";

export type AnnotationRunRowData = AnnotationRunRead;

const renderRunStatusBadge = (status: RunStatus | null | undefined) => {
  if (!status) return <Badge variant="outline">Unknown</Badge>;

  const statusConfig = {
    completed: { icon: CheckCircle, color: "text-green-500", label: "Completed" },
    failed: { icon: AlertTriangle, color: "text-red-500", label: "Failed" },
    running: { icon: Loader2, color: "text-blue-500", label: "Running", animate: "animate-spin" },
    pending: { icon: Loader2, color: "text-yellow-500", label: "Pending", animate: "animate-spin" }
  }[status] || { icon: HelpCircle, color: "text-gray-500", label: "Unknown" };

  const Icon = statusConfig.icon;

  return (
    <Badge variant="outline">
      <Icon className={`mr-1 h-3 w-3 ${statusConfig.animate ? "animate-spin" : ""} ${statusConfig.color}`} />
      {statusConfig.label}
    </Badge>
  );
};

interface RunColumnProps {
  onViewResults: (run: AnnotationRunRowData) => void;
  onExport: (runId: number) => void;
  onShare: (runId: number) => void;
  onDelete: (run: AnnotationRunRowData) => void;
}

export const annotationRunColumns = ({ onViewResults, onExport, onShare, onDelete }: RunColumnProps): ColumnDef<AnnotationRunRowData>[] => {
  const { activeInfospace } = useInfospaceStore.getState();
  const { favoriteRuns, addFavoriteRun, removeFavoriteRun } = useFavoriteRunsStore.getState();
  
  const isFavorite = (runId: number) => {
    if (!activeInfospace?.id) return false;
    return favoriteRuns.some(fav => fav.id === runId && Number(fav.InfospaceId) === activeInfospace.id);
  };

  const toggleFavorite = (run: AnnotationRunRowData) => {
    if (!activeInfospace) {
      toast.error("An active Infospace is required to manage favorites.");
      return;
    }
    const { id, name, created_at } = run;
    const config = run.configuration as any;
    const fav = { 
        id, 
        name: name || `Run ${id}`, 
        InfospaceId: activeInfospace.id.toString(), 
        type: 'run' as const,
        timestamp: format(new Date(created_at), "PP pp"),
        documentCount: config?.target_asset_ids?.length || 0,
        schemeCount: config?.schema_ids?.length || 0,
    };
    
    if (isFavorite(id)) {
      removeFavoriteRun(id);
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
          aria-label="Select all runs"
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
      header: 'Run Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name || `Run ${row.original.id}`}</span>,
      size: 200,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>Status<ArrowUpDown className="ml-2 h-4 w-4" /></Button>,
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        const statusConfig = {
          completed: { icon: CheckCircle, color: "text-green-500", label: "Completed" },
          failed: { icon: AlertTriangle, color: "text-red-500", label: "Failed" },
          running: { icon: Loader2, color: "text-blue-500", label: "Running", animate: "animate-spin" },
          pending: { icon: Loader2, color: "text-yellow-500", label: "Pending", animate: "animate-spin" }
        }[status] || { icon: HelpCircle, color: "text-gray-500", label: "Unknown" };

        const Icon = statusConfig.icon;

        return renderRunStatusBadge(status as RunStatus);
      },
      size: 120,
    },
    {
      accessorKey: 'target_schema_ids',
      header: 'Schemes',
      cell: ({ row }) => {
        const config = row.original.configuration as any;
        return config?.schema_ids?.length || 0;
      },
      size: 80,
    },
    {
      accessorKey: 'target_asset_ids',
      header: 'Assets',
      cell: ({ row }) => {
        const config = row.original.configuration as any;
        return config?.target_asset_ids?.length || 'N/A';
      },
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
        const run = row.original;
        return (
          <Button variant="ghost" size="icon" onClick={() => toggleFavorite(run)}>
            <Star className={cn("h-4 w-4", isFavorite(run.id) && "fill-yellow-400 text-yellow-500")} />
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
        const run = row.original;
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
              <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onViewResults(run);}}>
                <Eye className="mr-2 h-4 w-4" /> View Results
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onExport(run.id);}}>
                <Download className="mr-2 h-4 w-4" /> Export Run
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onShare(run.id);}}>
                <Share2 className="mr-2 h-4 w-4" /> Share Run
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={(e) => {e.stopPropagation(); onDelete(run);}}
                className="text-red-600 focus:text-red-500 focus:bg-red-100 dark:focus:bg-red-800/50"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete Run
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