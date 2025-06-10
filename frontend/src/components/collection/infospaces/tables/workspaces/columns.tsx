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
} from "@/components/ui/dropdown-menu"
import { ArrowUpDown, MoreHorizontal, Pencil, Trash, Download, Share2 } from 'lucide-react';
import { InfospaceRead } from '@/client/models'; // Using InfospaceRead from client for consistency

// Re-defining Infospace type here based on InfospaceRead to ensure properties match client model
// This is because the table might display a subset or formatted version.
// For actions, we'll often need the full ID.
export type InfospaceRowData = Pick<InfospaceRead, 'id' | 'name' | 'description' | 'icon' | 'created_at' | 'updated_at'> & {
  // Add any client-side specific formatted fields if necessary, e.g., sources as string
  sources_display?: string; 
};


// Define props for the columns function
interface ColumnProps {
  onEdit: (Infospace: InfospaceRowData) => void;
  onDelete: (Infospace: InfospaceRowData) => void;
  onExport: (InfospaceId: number) => void;
  onShare: (InfospaceId: number) => void;
  // Add onSelect when Infospaces can be selected for import/export to specific ws
}

// Export a function that generates the columns
export const columns = ({ onEdit, onDelete, onExport, onShare }: ColumnProps): ColumnDef<InfospaceRowData>[] => [
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'description',
    header: 'Description',
    cell: ({ row }) => {
        const description = row.original.description;
        return <div className="truncate w-64" title={description || ''}>{description || '-'}</div>;
    }
  },
  // If 'sources_display' is prepared in InfospacesPage, it can be used directly
  // Otherwise, if 'sources' (assuming it was part of InfospaceRead and processed into InfospaceRowData)
  // {
  //   accessorKey: 'sources_display',
  //   header: 'Sources',
  // },
  {
    accessorKey: 'created_at',
    header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Created At
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
    cell: ({ row }) =>
      new Date(row.original.created_at).toLocaleString(),
  },
  {
    accessorKey: 'updated_at',
    header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Updated At
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
    cell: ({ row }) =>
      new Date(row.original.updated_at).toLocaleString(),
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => {
      const Infospace = row.original;

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
            <DropdownMenuItem onClick={() => onEdit(Infospace)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport(Infospace.id)}>
              <Download className="mr-2 h-4 w-4" /> Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onShare(Infospace.id)}>
              <Share2 className="mr-2 h-4 w-4" /> Share
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(Infospace)} className="text-red-600 focus:text-red-700 focus:bg-red-50">
              <Trash className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
