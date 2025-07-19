'use client';

import React, { useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import EditInfospaceOverlay from '@/components/collection/infospaces/management/EditInfospaceOverlay';
import InfospacesPage from '@/components/collection/infospaces/tables/workspaces/page';
import { InfospaceRowData } from '@/components/collection/infospaces/tables/workspaces/columns';
import { PlusCircle, Upload, Trash2, Loader2 } from 'lucide-react';
import { InfospaceRead } from '@/client/models';
import { toast } from 'sonner';
import useAuth from '@/hooks/useAuth';
import { RowSelectionState } from '@tanstack/react-table';

interface InfospaceManagerProps {
  activeInfospace: InfospaceRead | null;
}

export default function InfospaceManager({ activeInfospace }: InfospaceManagerProps) {
  const { user } = useAuth();
  const {
    createInfospace,
    importInfospace,
    deleteInfospace,
    isLoading,
    infospaces,
  } = useInfospaceStore();

  const [isCreateOverlayOpen, setIsCreateOverlayOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedInfospaceId, setSelectedInfospaceId] = useState<number | null>(null);
  const [InfospaceToEdit, setInfospaceToEdit] = useState<InfospaceRead | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Multi-selection state
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

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
    if (!user) {
      toast.error("User not authenticated.");
      return;
    }
    try {
      const newWs = await createInfospace({
        name,
        description,
        icon,
        owner_id: user.id,
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

  const handleBulkDelete = async () => {
    const selectedIds = Object.keys(rowSelection).filter(id => rowSelection[id]);
    const selectedInfospaces = infospaces.filter(info => selectedIds.includes(info.id.toString()));
    
    if (selectedInfospaces.length === 0) {
      toast.error("No infospaces selected for deletion.");
      return;
    }

    // Check if any selected infospace is the active one
    const isActiveInfospaceSelected = selectedInfospaces.some(info => info.id === activeInfospace?.id);
    if (isActiveInfospaceSelected) {
      toast.error("Cannot delete the currently active infospace. Please switch to a different infospace first.");
      return;
    }

    setIsBulkDeleting(true);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const infospace of selectedInfospaces) {
      try {
        await deleteInfospace(infospace.id);
        successCount++;
        toast.success(`Infospace "${infospace.name}" deleted successfully.`);
      } catch (error) {
        errorCount++;
        console.error(`Error deleting infospace ${infospace.id}:`, error);
        toast.error(`Failed to delete infospace "${infospace.name}".`);
      }
    }
    
    // Clear selection after deletion attempt
    setRowSelection({});
    setIsBulkDeleting(false);
    
    // Show summary toast
    if (successCount > 0 && errorCount === 0) {
      toast.success(`Successfully deleted ${successCount} infospace${successCount > 1 ? 's' : ''}.`);
    } else if (successCount > 0 && errorCount > 0) {
      toast.warning(`Deleted ${successCount} infospace${successCount > 1 ? 's' : ''}, but ${errorCount} failed.`);
    } else if (errorCount > 0) {
      toast.error(`Failed to delete ${errorCount} infospace${errorCount > 1 ? 's' : ''}.`);
    }
  };

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  return (
    <div className="space-y-4 w-full">
      <div className="flex justify-between items-center">
        {/* Bulk Actions - shown when items are selected */}
        {selectedCount > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {selectedCount} infospace{selectedCount > 1 ? 's' : ''} selected
            </span>
            <Button 
              variant="destructive" 
              size="sm"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting || isLoading}
            >
              {isBulkDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete Selected
            </Button>
          </div>
        ) : (
          <div /> // Empty div to maintain layout
        )}

        {/* Regular Actions */}
        <div className="flex gap-2">
          <Button onClick={handleImportButtonClick} variant="outline" disabled={isLoading || isBulkDeleting}>
            <Upload className="mr-2 h-4 w-4" /> {isLoading ? 'Importing...' : 'Import Infospace'}
          </Button>
          <Button onClick={handleOpenCreateOverlay} disabled={isBulkDeleting}>
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
      </div>

      <Card className="p-0">
        <InfospacesPage 
          onEdit={handleEdit}
          enableRowSelection={true}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
        />
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
