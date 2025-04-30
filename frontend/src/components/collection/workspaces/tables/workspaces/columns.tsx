'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Pencil, Trash } from 'lucide-react';

export type Workspace = {
  id: number;
  name: string;
  description?: string;
  sources?: string[];
  icon?: string;
  created_at: string;
  updated_at: string;
};

// Define props for the columns function
interface ColumnProps {
  onEdit: (workspace: Workspace) => void;
  onDelete: (workspace: Workspace) => void;
}

// Export a function that generates the columns
export const columns = ({ onEdit, onDelete }: ColumnProps): ColumnDef<Workspace>[] => [
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'description',
    header: 'Description',
  },
  {
    accessorKey: 'sources',
    header: 'Sources',
    cell: ({ row }) => row.original.sources?.join(', ') || '',
  },
  {
    accessorKey: 'created_at',
    header: 'Created At',
    cell: ({ row }) =>
      new Date(row.original.created_at).toLocaleString(),
  },
  {
    accessorKey: 'updated_at',
    header: 'Updated At',
    cell: ({ row }) =>
      new Date(row.original.updated_at).toLocaleString(),
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => {
      const workspace = row.original;

      return (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation(); // Prevent row click event
              onEdit(workspace); // Use the passed-in onEdit directly
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-700"
            onClick={(e) => {
              e.stopPropagation(); // Prevent row click event
              onDelete(workspace); // Use the passed-in onDelete directly
            }}
          >
            <Trash className="h-4 w-4" />
          </Button>
        </div>
      );
    },
  },
];
