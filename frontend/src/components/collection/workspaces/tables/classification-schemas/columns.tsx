'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Button } from "@/components/ui/button";
import { ClassificationSchemeRead, ClassificationResultRead } from "@/client/models";
import { Eye, Pencil, Trash, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface ColumnProps {
  onView?: (scheme: ClassificationSchemeRead) => void;
  onEdit?: (scheme: ClassificationSchemeRead) => void;
  onDelete?: (scheme: ClassificationSchemeRead) => void;
  onViewDocuments?: (scheme: ClassificationSchemeRead) => void;
  onViewRuns?: (scheme: ClassificationSchemeRead) => void;
}

export const columns = ({ onView, onEdit, onDelete, onViewDocuments, onViewRuns }: ColumnProps): ColumnDef<ClassificationSchemeRead>[] => [
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'description',
    header: 'Description',
  },
  {
    accessorKey: 'type',
    header: 'Type',
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
    accessorKey: "classification_count",
    header: "Classifications",
    cell: ({ row }) => {
      const count = row.original.classification_count || 0;
      const scheme = row.original;
      return (
        <Button 
          variant="ghost" 
          className="hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            onViewRuns?.(scheme);
          }}
        >
          {count} runs
        </Button>
      );
    },
  },
  {
    accessorKey: "document_count",
    header: "Documents",
    cell: ({ row }) => {
      const count = row.original.document_count || 0;
      const scheme = row.original;
      return (
        <Button 
          variant="ghost" 
          className="hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            onViewDocuments?.(scheme);
          }}
        >
          {count} docs
        </Button>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const scheme = row.original;

      return (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(scheme);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-700"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(scheme);
            }}
          >
            <Trash className="h-4 w-4" />
          </Button>
        </div>
      );
    },
  },
];

const formatComplexValue = (value: any) => {
  if (!value) return 'N/A';

  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    const displayValues = keys.slice(0, 2).map(key => {
      const val = value[key];
      const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `${key}: ${strVal.length > 20 ? strVal.substring(0, 20) + '...' : strVal}`;
    });
    return displayValues.join(', ');
  }

  return String(value);
};