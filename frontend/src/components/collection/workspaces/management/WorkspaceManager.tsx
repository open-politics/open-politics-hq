'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import EditWorkSpaceOverlay from '@/components/collection/workspaces/management/EditWorkSpaceOverlay';
import WorkspacesPage from '@/components/collection/workspaces/tables/workspaces/page';
import { Workspace } from '@/components/collection/workspaces/tables/workspaces/columns';
import { Boxes, PlusCircle } from 'lucide-react';
import { WorkspaceRead } from '@/client/models';

interface WorkspaceManagerProps {
  activeWorkspace: WorkspaceRead | null;
}

export default function WorkspaceManager({ activeWorkspace }: WorkspaceManagerProps) {
  const {
    createWorkspace,
    deleteWorkspace,
  } = useWorkspaceStore();

  const [isCreateOverlayOpen, setIsCreateOverlayOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [workspaceToEdit, setWorkspaceToEdit] = useState<WorkspaceRead | null>(null);

  const handleEdit = (workspace: Workspace) => {
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
      await createWorkspace({
        name,
        description,
        icon,
        system_prompt: systemPrompt,
      });
      setIsCreateOverlayOpen(false);
      console.log('Workspace created successfully via overlay');
    } catch (error) {
      console.error('Error creating workspace via overlay:', error);
    }
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex justify-end">
        <Button onClick={handleOpenCreateOverlay}>
          <PlusCircle className="mr-2 h-4 w-4" /> Create New Workspace
        </Button>
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

      <EditWorkSpaceOverlay
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        workspaceId={selectedWorkspaceId ?? 0}
        defaultName={workspaceToEdit?.name ?? ''}
        defaultDescription={workspaceToEdit?.description ?? ''}
        defaultIcon={workspaceToEdit?.icon ?? ''}
        defaultSystemPrompt={workspaceToEdit?.system_prompt ?? ''}
      />
    </div>
  );
}
