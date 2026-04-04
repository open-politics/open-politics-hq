'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MoreHorizontal, Pencil, Trash, Download, Share2, Archive, ArrowRightCircle } from 'lucide-react';
import { InfospaceRead } from '@/client';
import { formatDistanceToNowStrict } from 'date-fns';

export type InfospaceRowData = Pick<InfospaceRead, 'id' | 'name' | 'description' | 'icon' | 'created_at' | 'current_user_role' | 'is_owner'> & {
  sources_display?: string;
};

interface ColumnProps {
  onEdit: (Infospace: InfospaceRowData) => void;
  onDelete: (Infospace: InfospaceRowData) => void;
  onExport: (InfospaceId: number) => void;
  onShare: (InfospaceId: number) => void;
  onBackup: (Infospace: InfospaceRowData) => void;
  onSwitchTo: (Infospace: InfospaceRowData) => void;
}

export const columns = ({ onEdit, onDelete, onExport, onShare, onBackup, onSwitchTo }: ColumnProps): ColumnDef<InfospaceRowData>[] => [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <span className="font-medium text-sm">{row.original.name}</span>
    ),
  },
  {
    accessorKey: 'description',
    header: 'Description',
    cell: ({ row }) => {
      const description = row.original.description;
      return <div className="truncate max-w-[200px] text-xs text-muted-foreground" title={description || ''}>{description || '—'}</div>;
    }
  },
  {
    accessorKey: 'current_user_role',
    header: 'Role',
    cell: ({ row }) => {
      const role = row.original.current_user_role;
      if (!role) return <span className="text-xs text-muted-foreground">—</span>;
      return <span className="text-xs capitalize text-muted-foreground">{role}</span>;
    },
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => {
      const raw = row.original.created_at;
      if (!raw) return <span className="text-xs text-muted-foreground">—</span>;
      const date = new Date(raw);
      if (isNaN(date.getTime())) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <span className="text-xs text-muted-foreground" title={date.toLocaleString()}>
          {formatDistanceToNowStrict(date)} ago
        </span>
      );
    },
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      const Infospace = row.original;
      return (
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-1.5" onClick={() => onSwitchTo(Infospace)}>
                <ArrowRightCircle className="h-3.5 w-3.5 mr-1" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Set this infospace as active</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-7 w-7 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(Infospace)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport(Infospace.id)}>
              <Download className="mr-2 h-3.5 w-3.5" /> Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onBackup(Infospace)}>
              <Archive className="mr-2 h-3.5 w-3.5" /> Backup
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onShare(Infospace.id)}>
              <Share2 className="mr-2 h-3.5 w-3.5" /> Share
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(Infospace)} className="text-red-600 focus:text-red-700 focus:bg-red-50">
              <Trash className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      );
    },
  },
];
