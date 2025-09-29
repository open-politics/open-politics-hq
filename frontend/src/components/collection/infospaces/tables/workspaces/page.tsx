'use client';

import React, { useEffect, useState } from 'react';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { DataTable } from '@/components/collection/infospaces/tables/data-table';
import { columns, InfospaceRowData } from '@/components/collection/infospaces/tables/workspaces/columns';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { toast } from 'sonner';
import { ResourceType } from '@/client';
import { RowSelectionState } from '@tanstack/react-table';

interface InfospacesPageProps {
  onEdit: (Infospace: InfospaceRowData) => void;
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: React.Dispatch<React.SetStateAction<RowSelectionState>>;
}

export default function InfospacesPage({ 
  onEdit, 
  enableRowSelection = false,
  rowSelection = {},
  onRowSelectionChange
}: InfospacesPageProps) {
  const { infospaces, fetchInfospaces, deleteInfospace, exportInfospace } = useInfospaceStore();
  const { createLink, isLoading: isShareLoading, error: shareError } = useShareableStore();

  useEffect(() => {
    fetchInfospaces().catch(console.error);
  }, [fetchInfospaces]);

  const handleEdit = (Infospace: InfospaceRowData) => {
    onEdit(Infospace);
  };

  const handleDeleteInfospace = async (Infospace: InfospaceRowData) => {
    try {
      await deleteInfospace(Infospace.id);
      toast.success(`Infospace "${Infospace.name}" deleted.`);
    } catch (error) {
      toast.error(`Failed to delete Infospace "${Infospace.name}".`);
      console.error("Error deleting Infospace:", error);
    }
  };

  const handleExportInfospace = async (InfospaceId: number) => {
    try {
      await exportInfospace(InfospaceId);
    } catch (error) {
      console.error("Error exporting Infospace from page:", error);
    }
  };

  const handleShareInfospace = (InfospaceId: number) => {
    console.log(`Attempting to share Infospace ID: ${InfospaceId}`);
    toast.info("Share functionality: Opening share dialog soon...");
  };

  const tableColumns = columns({
    onEdit: handleEdit,
    onDelete: handleDeleteInfospace,
    onExport: handleExportInfospace,
    onShare: handleShareInfospace,
  });

  return (
    <div className="h-full p-4">
      <div className="flex justify-center items-center">
      </div>
      <DataTable
        columns={tableColumns}
        data={infospaces as unknown as InfospaceRowData[]}
        enableRowSelection={enableRowSelection}
        rowSelection={rowSelection}
        onRowSelectionChange={onRowSelectionChange}
        />
    </div>
  );
} 