'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DataTable } from '@/components/collection/workspaces/tables/data-table';
import { columns, WorkspaceRowData } from '@/components/collection/workspaces/tables/workspaces/columns';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { toast } from 'sonner';
import { ResourceType } from '@/client/models';

interface WorkspacesPageProps {
  onEdit: (workspace: WorkspaceRowData) => void;
}

export default function WorkspacesPage({ onEdit }: WorkspacesPageProps) {
  const { workspaces, fetchWorkspaces, deleteWorkspace, exportWorkspace } = useWorkspaceStore();
  const { createLink, isLoading: isShareLoading, error: shareError } = useShareableStore();

  useEffect(() => {
    fetchWorkspaces().catch(console.error);
  }, [fetchWorkspaces]);

  const handleEdit = (workspace: WorkspaceRowData) => {
    onEdit(workspace);
  };

  const handleDeleteWorkspace = async (workspace: WorkspaceRowData) => {
    try {
      await deleteWorkspace(workspace.id);
      toast.success(`Workspace "${workspace.name}" deleted.`);
    } catch (error) {
      toast.error(`Failed to delete workspace "${workspace.name}".`);
      console.error("Error deleting workspace:", error);
    }
  };

  const handleExportWorkspace = async (workspaceId: number) => {
    try {
      await exportWorkspace(workspaceId);
    } catch (error) {
      console.error("Error exporting workspace from page:", error);
    }
  };

  const handleShareWorkspace = (workspaceId: number) => {
    console.log(`Attempting to share workspace ID: ${workspaceId}`);
    toast.info("Share functionality: Opening share dialog soon...");
  };

  const tableColumns = columns({
    onEdit: handleEdit,
    onDelete: handleDeleteWorkspace,
    onExport: handleExportWorkspace,
    onShare: handleShareWorkspace,
  });

  return (
    <div className="h-full p-4">
      <div className="flex justify-center items-center">
      </div>
      <DataTable
        columns={tableColumns}
        data={workspaces as WorkspaceRowData[]}
        />
    </div>
  );
} 