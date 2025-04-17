'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import EditWorkSpaceOverlay from '@/components/collection/workspaces/management/EditWorkSpaceOverlay';
import { IconPickerDialog } from '@/components/collection/workspaces/utilities/icons/IconPickerOverlay';
import { Label } from '@/components/ui/label';
import WorkspacesPage from '@/components/collection/workspaces/tables/workspaces/page';
import { Workspace } from '@/components/collection/workspaces/tables/workspaces/columns';
import { Boxes } from 'lucide-react';
import { WorkspaceRead } from '@/client/models';

interface WorkspaceManagerProps {
  activeWorkspace: WorkspaceRead | null;
}

export default function WorkspaceManager({ activeWorkspace }: WorkspaceManagerProps) {
  const {
    createWorkspace,
    deleteWorkspace,
  } = useWorkspaceStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sources, setSources] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  const [icon, setIcon] = useState('Boxes');

  const defaultIcon = 'Boxes';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    try {
      await createWorkspace({
        name,
        description,
        sources: sources ? sources.split(',').map(s => s.trim()) : [],
        icon,
      });
      setName('');
      setDescription('');
      setSources('');
      setIcon(defaultIcon);
      console.log('Workspace created successfully');
    } catch (error) {
      setErrorMessage('Failed to create workspace. Please try again.');
      console.error('Error creating workspace:', error);
    }
  };

  const handleDelete = async (workspaceId: number) => {
    if (confirm('Are you sure you want to delete this workspace?')) {
      try {
        await deleteWorkspace(workspaceId);
        console.log('Workspace deleted successfully');
      } catch (error) {
        console.error('Error deleting workspace:', error);
      }
    }
  };

  const handleEdit = (workspace: Workspace) => {
    setSelectedWorkspaceId(workspace.uid);
    setIsEditDialogOpen(true);
  };

  const handleView = (workspace: Workspace) => {
    console.log('Viewing workspace:', workspace);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 w-full">
      {/* Create Workspace Card */}
      <div className="col-span-1 md:col-span-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-xl font-semibold text-secondary-500 text-center">
              <Boxes className="mr-2 h-4 w-4" />
              Create New Workspace
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="workspace-name" className="text-sm text-secondary-300">
                  Name
                </Label>
                <Input
                  id="workspace-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Workspace Name"
                  className="w-full p-3 bg-primary-800 shadow-inner"
                />
            <div className="flex items-center justify-start gap-2 p-2 pl-0">
              <IconPickerDialog onIconSelect={setIcon} defaultIcon={defaultIcon} />
            </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workspace-description" className="text-sm text-secondary-300">
                  Description
                </Label>
                <Input
                  id="workspace-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Workspace Description"
                  className="w-full p-3 bg-primary-800 shadow-inner"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workspace-sources" className="text-sm text-secondary-300">
                  Sources (comma-separated URLs)
                </Label>
                <Input
                  id="workspace-sources"
                  type="text"
                  value={sources}
                  onChange={(e) => setSources(e.target.value)}
                  placeholder="http://example.com, http://another.com"
                  className="w-full p-3 bg-primary-800 shadow-inner"
                />
              </div>
              {errorMessage && <p className="text-red-400">{errorMessage}</p>}
              <Button variant="default" type="submit" className="max-w-44 py-2 shadow-morphic">
                Create Workspace
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Manage Workspaces Card */}
      <div className="col-span-1 md:col-span-3">
        <Card className="p-0">
          <WorkspacesPage onEdit={handleEdit} />
        </Card>
      </div>

      {/* Edit Workspace Overlay */}
      <EditWorkSpaceOverlay
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        workspaceId={selectedWorkspaceId ?? 0}
        defaultName={activeWorkspace?.name ?? ''}
        defaultDescription={activeWorkspace?.description ?? ''}
        defaultSources={activeWorkspace?.sources ?? []}
        defaultIcon={activeWorkspace?.icon ?? ''}
      />
    </div>
  );
}
