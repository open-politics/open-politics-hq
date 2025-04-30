'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DataTable } from '@/components/collection/workspaces/tables/data-table';
import { columns, Workspace } from '@/components/collection/workspaces/tables/workspaces/columns';
import EditWorkSpaceOverlay from '@/components/collection/workspaces/management/EditWorkSpaceOverlay';

interface WorkspacesPageProps {
  onEdit: (workspace: Workspace) => void;
}

export default function WorkspacesPage({ onEdit }: WorkspacesPageProps) {
  const { workspaces, fetchWorkspaces, deleteWorkspace } = useWorkspaceStore();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    fetchWorkspaces().catch(console.error);
  }, []);

  const handleEdit = (workspace: Workspace) => {
    onEdit(workspace);
  };

  // Call the columns function to generate definitions, passing handlers
  const tableColumns = columns({
    onEdit: handleEdit, // Pass the function received via props
    onDelete: (workspace) => deleteWorkspace(workspace.id), // Changed from workspace.uid to workspace.id
  });

  return (
    <div className="h-full p-4">
      <div className="flex justify-center items-center">
        <h1 className="text-xl font-semibold text-center mb-8">Workspaces</h1>
      </div>
      <DataTable
        columns={tableColumns} // Use the generated columns
        data={workspaces as Workspace[]}
      />
      {selectedWorkspace && (
        <EditWorkSpaceOverlay
          open={isEditDialogOpen}
          onClose={() => setIsEditDialogOpen(false)}
          workspaceId={selectedWorkspace.id} // Changed from selectedWorkspace.uid to selectedWorkspace.id
          defaultName={selectedWorkspace.name}
          defaultDescription={selectedWorkspace.description}
          defaultSources={selectedWorkspace.sources}
          defaultIcon={selectedWorkspace.icon}
        />
      )}
    </div>
  );
} 