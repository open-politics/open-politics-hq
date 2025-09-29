'use client';

import React, { useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import EditInfospaceOverlay from '@/components/collection/infospaces/management/EditInfospaceOverlay';
import InfospacesPage from '@/components/collection/infospaces/tables/workspaces/page';
import { InfospaceRowData } from '@/components/collection/infospaces/tables/workspaces/columns';
import { PlusCircle, Upload, Trash2, Loader2, Archive, History, Download } from 'lucide-react';
import { InfospaceRead, InfospaceBackupRead, InfospaceBackupCreate } from '@/client';
import { BackupsService } from '@/client';
import { toast } from 'sonner';
import useAuth from '@/hooks/useAuth';
import { RowSelectionState } from '@tanstack/react-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow, format } from 'date-fns';

interface InfospaceManagerProps {
  activeInfospace: InfospaceRead | null;
}

interface BackupData {
  id: number;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'expired';
  backup_type: string;
  file_size_bytes?: number;
  included_sources: number;
  included_assets: number;
  included_schemas: number;
  included_runs: number;
  included_datasets: number;
  created_at: string;
  completed_at?: string;
  is_ready: boolean;
  is_expired: boolean;
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

  // Backup-related state
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false);
  const [isBackupsViewOpen, setIsBackupsViewOpen] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [backups, setBackups] = useState<BackupData[]>([]);
  const [newBackupName, setNewBackupName] = useState('');
  const [newBackupDescription, setNewBackupDescription] = useState('');
  const [selectedInfospaceForBackup, setSelectedInfospaceForBackup] = useState<InfospaceRead | null>(null);

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

  // Backup Functions
  const handleBackupInfospace = (infospace: InfospaceRead) => {
    setSelectedInfospaceForBackup(infospace);
    setNewBackupName(`Backup of ${infospace.name} - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`);
    setNewBackupDescription(`Manual backup created on ${format(new Date(), 'PPP')}`);
    setIsBackupDialogOpen(true);
  };

  const createBackup = async () => {
    if (!selectedInfospaceForBackup || !newBackupName.trim()) {
      toast.error("Please provide a backup name.");
      return;
    }

    setIsCreatingBackup(true);
    
    try {
      const backupData: InfospaceBackupCreate = {
        name: newBackupName,
        description: newBackupDescription || undefined,
        backup_type: 'manual',
        include_sources: true,
        include_schemas: true,
        include_runs: true,
        include_datasets: true,
        include_annotations: true,
      };

      const backup = await BackupsService.createBackup({
        infospaceId: selectedInfospaceForBackup.id,
        requestBody: backupData,
      });

      toast.success(`Backup "${backup.name}" created successfully. It will be processed in the background.`);
      setIsBackupDialogOpen(false);
      setNewBackupName('');
      setNewBackupDescription('');
      setSelectedInfospaceForBackup(null);
    } catch (error: any) {
      console.error('Error creating backup:', error);
      toast.error(`Failed to create backup: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    }
    
    setIsCreatingBackup(false);
  };

  const loadBackups = async (infospaceId: number) => {
    setIsLoadingBackups(true);
    
    try {
      const response = await BackupsService.listBackups({
        infospaceId: infospaceId,
        limit: 50,
        skip: 0,
      });

      // Convert InfospaceBackupRead[] to BackupData[] for compatibility
      const backupData: BackupData[] = response.data.map((backup: InfospaceBackupRead) => ({
        id: backup.id,
        name: backup.name,
        description: backup.description ? backup.description : undefined,
        status: backup.status as 'pending' | 'running' | 'completed' | 'failed' | 'expired',
        backup_type: backup.backup_type || 'manual',
        file_size_bytes: backup.file_size_bytes ? backup.file_size_bytes : undefined,
        included_sources: backup.included_sources || 0,
        included_assets: backup.included_assets || 0,
        included_schemas: backup.included_schemas || 0,
        included_runs: backup.included_runs || 0,
        included_datasets: backup.included_datasets || 0,
        created_at: backup.created_at,
        completed_at: backup.completed_at ? backup.completed_at : undefined,
        is_ready: backup.is_ready,
        is_expired: backup.is_expired,
      }));

      setBackups(backupData);
    } catch (error: any) {
      console.error('Error loading backups:', error);
      toast.error(`Failed to load backups: ${error?.body?.detail || error?.message || 'Unknown error'}`);
      setBackups([]);
    }
    
    setIsLoadingBackups(false);
  };

  const handleViewBackups = (infospace: InfospaceRead) => {
    setSelectedInfospaceForBackup(infospace);
    setIsBackupsViewOpen(true);
    loadBackups(infospace.id);
  };

  const restoreBackup = async (backup: BackupData) => {
    if (!backup.is_ready) {
      toast.error('This backup is not ready for restoration.');
      return;
    }

    const confirmRestore = window.confirm(
      `Are you sure you want to restore from "${backup.name}"? This will create a new infospace with the backup data.`
    );
    
    if (!confirmRestore) return;

    try {
      const restoredInfospace = await BackupsService.restoreBackup({
        backupId: backup.id,
        requestBody: {
          backup_id: backup.id,
          target_infospace_name: `${backup.name} (Restored)`,
          conflict_strategy: 'skip',
        },
      });

      toast.success(`Infospace restored successfully as "${restoredInfospace.name}"`);
      // Refresh infospaces list
      useInfospaceStore.getState().fetchInfospaces();
      setIsBackupsViewOpen(false);
    } catch (error: any) {
      console.error('Error restoring backup:', error);
      toast.error(`Failed to restore backup: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    }
  };

  const downloadBackup = async (backup: BackupData) => {
    if (!backup.is_ready) {
      toast.error('This backup is not ready for download.');
      return;
    }

    try {
      // First create a share link
      const shareData = await BackupsService.createBackupShareLink({
        backupId: backup.id,
        requestBody: {
          backup_id: backup.id,
          is_shareable: true,
          expiration_hours: 1, // 1 hour expiration for download
        },
      });

      // Download the file  
      const downloadUrl = (shareData as any).download_url as string;
      if (downloadUrl) {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${backup.name}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast.success('Backup download started.');
      } else {
        toast.error('Download URL not available.');
      }
    } catch (error: any) {
      console.error('Error downloading backup:', error);
      toast.error(`Failed to download backup: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'expired': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
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

      {/* Quick Actions for Active Infospace */}
      {activeInfospace && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Quick Actions for "{activeInfospace.name}"</h3>
              <p className="text-sm text-muted-foreground">Manage backups for your active infospace</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleBackupInfospace(activeInfospace)}
                disabled={isBulkDeleting}
              >
                <Archive className="mr-2 h-4 w-4" />
                Create Backup
              </Button>
              <Button
                variant="outline"
                onClick={() => handleViewBackups(activeInfospace)}
                disabled={isBulkDeleting}
              >
                <History className="mr-2 h-4 w-4" />
                View Backups
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Create Backup Dialog */}
      <Dialog open={isBackupDialogOpen} onOpenChange={setIsBackupDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create Backup</DialogTitle>
            <DialogDescription>
              Create a backup of "{selectedInfospaceForBackup?.name}". This will include all sources, schemas, runs, datasets, and annotations.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="backup-name" className="text-right">
                Name
              </Label>
              <Input
                id="backup-name"
                value={newBackupName}
                onChange={(e) => setNewBackupName(e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="backup-description" className="text-right">
                Description
              </Label>
              <Textarea
                id="backup-description"
                value={newBackupDescription}
                onChange={(e) => setNewBackupDescription(e.target.value)}
                className="col-span-3"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBackupDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createBackup} disabled={isCreatingBackup || !newBackupName.trim()}>
              {isCreatingBackup ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Archive className="mr-2 h-4 w-4" />
                  Create Backup
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Backups Dialog */}
      <Dialog open={isBackupsViewOpen} onOpenChange={setIsBackupsViewOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[600px]">
          <DialogHeader>
            <DialogTitle>Backups for "{selectedInfospaceForBackup?.name}"</DialogTitle>
            <DialogDescription>
              View and manage backups for this infospace. You can restore from any completed backup.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[400px] overflow-y-auto">
            {isLoadingBackups ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2">Loading backups...</span>
              </div>
            ) : backups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No backups found for this infospace.
              </div>
            ) : (
              <div className="space-y-4">
                {backups.map((backup) => (
                  <Card key={backup.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium">{backup.name}</h3>
                          <Badge className={getStatusColor(backup.status)}>
                            {backup.status}
                          </Badge>
                          {backup.is_expired && (
                            <Badge variant="outline" className="text-red-600">
                              Expired
                            </Badge>
                          )}
                        </div>
                        {backup.description && (
                          <p className="text-sm text-muted-foreground mb-2">{backup.description}</p>
                        )}
                        <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                          <div>Sources: {backup.included_sources}</div>
                          <div>Assets: {backup.included_assets}</div>
                          <div>Schemas: {backup.included_schemas}</div>
                          <div>Runs: {backup.included_runs}</div>
                          <div>Datasets: {backup.included_datasets}</div>
                          <div>Size: {formatFileSize(backup.file_size_bytes)}</div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Created {formatDistanceToNow(new Date(backup.created_at))} ago
                          {backup.completed_at && (
                            <span> • Completed {formatDistanceToNow(new Date(backup.completed_at))} ago</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadBackup(backup)}
                          disabled={!backup.is_ready}
                          title="Download backup"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => restoreBackup(backup)}
                          disabled={!backup.is_ready}
                          title="Restore from backup"
                        >
                          Restore
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBackupsViewOpen(false)}>
              Close
            </Button>
            <Button 
              onClick={() => {
                setIsBackupsViewOpen(false);
                if (selectedInfospaceForBackup) {
                  handleBackupInfospace(selectedInfospaceForBackup);
                }
              }}
            >
              <Archive className="mr-2 h-4 w-4" />
              Create New Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
