'use client';

import React, { useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import EditInfospaceOverlay from '@/components/collection/infospaces/management/EditInfospaceOverlay';
import InfospacesPage from '@/components/collection/infospaces/tables/workspaces/page';
import { InfospaceRowData } from '@/components/collection/infospaces/tables/workspaces/columns';
import { PlusCircle, Upload } from 'lucide-react';
import { InfospaceRead } from '@/client/models';
import { toast } from 'sonner';

interface InfospaceManagerProps {
  activeInfospace: InfospaceRead | null;
}

export default function InfospaceManager({ activeInfospace }: InfospaceManagerProps) {
  const {
    createInfospace,
    importInfospace,
    isLoading,
  } = useInfospaceStore();

  const [isCreateOverlayOpen, setIsCreateOverlayOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedInfospaceId, setSelectedInfospaceId] = useState<number | null>(null);
  const [InfospaceToEdit, setInfospaceToEdit] = useState<InfospaceRead | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEdit = (Infospace: InfospaceRowData) => {
    const fullInfospaceData = useInfospaceStore.getState().infospaces.find(ws => ws.id === Infospace.id);
    setSelectedInfospaceId(Infospace.id);
    setInfospaceToEdit(fullInfospaceData || null);
    setIsEditDialogOpen(true);
  };

  const handleOpenCreateOverlay = () => {
    setIsCreateOverlayOpen(true);
  };

  const handleCreateInfospace = async (name: string, description: string, icon: string, systemPrompt: string) => {
    try {
      const newWs = await createInfospace({
        name,
        description,
        icon,
      });
      setIsCreateOverlayOpen(false);
      if (newWs) {
        toast.success(`Infospace "${newWs.name}" created successfully.`);
      } else {
        // Error toast handled by store
      }
    } catch (error) {
      // Error toast handled by store
      console.error('Error creating Infospace via overlay:', error);
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

    const placeholderInfospaceIdForApi = 0;

    try {
      const imported = await importInfospace(file, placeholderInfospaceIdForApi);
      if (imported) {
        toast.success(`Infospace "${imported.name}" imported successfully and set as active.`);
      } else {
        // Error handled by store, but can add a generic one if needed
        // toast.error("Failed to import Infospace. Check console for details.");
      }
    } catch (error) {
      // Error handled by store
      console.error('Error importing Infospace:', error);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex justify-end gap-2">
        <Button onClick={handleImportButtonClick} variant="outline" disabled={isLoading}>
          <Upload className="mr-2 h-4 w-4" /> {isLoading ? 'Importing...' : 'Import Infospace'}
        </Button>
        <Button onClick={handleOpenCreateOverlay}>
          <PlusCircle className="mr-2 h-4 w-4" /> Create New Infospace
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
        <InfospacesPage onEdit={handleEdit} />
      </Card>

      <EditInfospaceOverlay
        open={isCreateOverlayOpen}
        onClose={() => setIsCreateOverlayOpen(false)}
        isCreating={true}
        onCreateInfospace={handleCreateInfospace}
      />

      {InfospaceToEdit && (
      <EditInfospaceOverlay
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
            InfospaceId={InfospaceToEdit.id}
            defaultName={InfospaceToEdit.name}
            defaultDescription={InfospaceToEdit.description ?? ''}
            defaultIcon={InfospaceToEdit.icon ?? ''}
      />
      )}
    </div>
  );
}
