'use client';

import React, { useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import EditWorkSpaceOverlay from '@/components/collection/workspaces/management/EditWorkSpaceOverlay';
import WorkspacesPage from '@/components/collection/workspaces/tables/workspaces/page';
import { WorkspaceRowData } from '@/components/collection/workspaces/tables/workspaces/columns';
import { PlusCircle, Upload } from 'lucide-react';
import { WorkspaceRead } from '@/client/models';
import { toast } from 'sonner';

interface WorkspaceManagerProps {
  activeWorkspace: WorkspaceRead | null;
}

export default function WorkspaceManager({ activeWorkspace }: WorkspaceManagerProps) {
  const {
    createWorkspace,
    importWorkspace,
    isLoading,
  } = useWorkspaceStore();

  const [isCreateOverlayOpen, setIsCreateOverlayOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [workspaceToEdit, setWorkspaceToEdit] = useState<WorkspaceRead | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEdit = (workspace: WorkspaceRowData) => {
    const fullWorkspaceData = useWorkspaceStore.getState().workspaces.find(ws => ws.id === workspace.id);
    setSelectedWorkspaceId(workspace.id);
    setWorkspaceToEdit(fullWorkspaceData || null);
    setIsEditDialogOpen(true);
  };

  const handleOpenCreateOverlay = () => {
    setIsCreateOverlayOpen(true);
  };

  const handleCreateWorkspace = async (name: string, description: string, icon: string, systemPrompt: string) => {
    try {
      const newWs = await createWorkspace({
        name,
        description,
        icon,
        system_prompt: systemPrompt,
      });
      setIsCreateOverlayOpen(false);
      if (newWs) {
        toast.success(`Workspace "${newWs.name}" created successfully.`);
      } else {
        // Error toast handled by store
      }
    } catch (error) {
      // Error toast handled by store
      console.error('Error creating workspace via overlay:', error);
    }
  };

  const handleImportButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      toast.error("No file selected for import.");
      return;
    }

    const placeholderWorkspaceIdForApi = 0;

    try {
      const imported = await importWorkspace(file, placeholderWorkspaceIdForApi);
      if (imported) {
        toast.success(`Workspace "${imported.name}" imported successfully and set as active.`);
      } else {
        // Error handled by store, but can add a generic one if needed
        // toast.error("Failed to import workspace. Check console for details.");
      }
    } catch (error) {
      // Error handled by store
      console.error('Error importing workspace:', error);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex justify-end gap-2">
        <Button onClick={handleImportButtonClick} variant="outline" disabled={isLoading}>
          <Upload className="mr-2 h-4 w-4" /> {isLoading ? 'Importing...' : 'Import Workspace'}
        </Button>
        <Button onClick={handleOpenCreateOverlay}>
          <PlusCircle className="mr-2 h-4 w-4" /> Create New Workspace
        </Button>
        <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileImport} 
            className="hidden" 
            accept=".zip,.json"
        />
      </div>

      <Card className="p-0">
        <WorkspacesPage onEdit={handleEdit} />
      </Card>

      <EditWorkSpaceOverlay
        open={isCreateOverlayOpen}
        onClose={() => setIsCreateOverlayOpen(false)}
        isCreating={true}
        onCreateWorkspace={handleCreateWorkspace}
      />

      {workspaceToEdit && (
      <EditWorkSpaceOverlay
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
            workspaceId={workspaceToEdit.id}
            defaultName={workspaceToEdit.name}
            defaultDescription={workspaceToEdit.description ?? ''}
            defaultIcon={workspaceToEdit.icon ?? ''}
            defaultSystemPrompt={workspaceToEdit.system_prompt ?? ''}
      />
      )}
    </div>
  );
}
