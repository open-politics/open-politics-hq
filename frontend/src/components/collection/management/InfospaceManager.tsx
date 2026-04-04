'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useUserPreferencesStore } from '@/zustand_stores/storeUserPreferences';
import EditInfospaceOverlay from '@/components/collection/management/EditInfospaceOverlay';
import EmbeddingManager from '@/components/collection/management/EmbeddingManager';
import EnrichmentConfig from '@/components/collection/enrichment/EnrichmentConfig';
import LocalStorageImport from '@/components/collection/storage/LocalStorageImport';
import ProviderHub from '@/components/collection/management/ProviderHub';
import { InfospaceRowData } from '@/components/collection/tables/columns';
import InfospacesPage from '@/components/collection/tables/page';
import { PlusCircle, Upload, Trash2, Loader2, Archive, Download, Database } from 'lucide-react';
import { InfospaceRead, InfospaceBackupRead, InfospaceBackupCreate } from '@/client';
import { BackupsService } from '@/client';
import { toast } from 'sonner';
import useAuth from '@/hooks/useAuth';
import { CollaboratorList } from '@/components/collaboration/CollaboratorList';
import { RowSelectionState } from '@tanstack/react-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { IconRenderer } from '@/components/collection/utilities/icons/icon-picker';
import { formatDistanceToNowStrict, format } from 'date-fns';

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
    setActiveInfospace,
  } = useInfospaceStore();

  if (!activeInfospace && infospaces.length > 0) {
    setActiveInfospace(infospaces[0].id);
  }

  const { preferences, togglePreference } = useUserPreferencesStore();

  const [isCreateOverlayOpen, setIsCreateOverlayOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [InfospaceToEdit, setInfospaceToEdit] = useState<InfospaceRead | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Backup state
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [backups, setBackups] = useState<InfospaceBackupRead[]>([]);
  const [backupTarget, setBackupTarget] = useState<InfospaceRead | null>(null);
  const [newBackupName, setNewBackupName] = useState('');
  const [newBackupDescription, setNewBackupDescription] = useState('');

  // --- Handlers ---

  const handleEdit = (infospace: InfospaceRowData) => {
    const full = useInfospaceStore.getState().infospaces.find(ws => ws.id === infospace.id);
    setInfospaceToEdit(full || null);
    setIsEditDialogOpen(true);
  };

  const handleBackupFromRow = (infospace: InfospaceRowData) => {
    const full = useInfospaceStore.getState().infospaces.find(ws => ws.id === infospace.id);
    if (!full) return;
    setBackupTarget(full);
    setNewBackupName(`Backup of ${full.name} - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`);
    setNewBackupDescription('');
    setIsBackupDialogOpen(true);
  };

  const handleCreateBackupClick = () => {
    if (!activeInfospace) return;
    setBackupTarget(activeInfospace);
    setNewBackupName(`Backup of ${activeInfospace.name} - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`);
    setNewBackupDescription('');
    setIsBackupDialogOpen(true);
  };

  const handleCreateInfospace = async (name: string, description: string, icon: string) => {
    if (!user) { toast.error("Not authenticated."); return; }
    try {
      const ws = await createInfospace({ name, description, icon, owner_id: user.id });
      setIsCreateOverlayOpen(false);
      if (ws) toast.success(`Infospace "${ws.name}" created.`);
    } catch (error) {
      console.error('Error creating infospace:', error);
    }
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) { toast.error("No file selected."); return; }
    try {
      const imported = await importInfospace(file, 0);
      if (imported) toast.success(`Infospace "${imported.name}" imported.`);
    } catch (error) {
      console.error('Error importing infospace:', error);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleBulkDelete = async () => {
    const selectedIds = Object.keys(rowSelection).filter(id => rowSelection[id]);
    const selected = infospaces.filter(i => selectedIds.includes(i.id.toString()));
    if (selected.length === 0) { toast.error("No infospaces selected."); return; }
    if (selected.some(i => i.id === activeInfospace?.id)) {
      toast.error("Cannot delete the active infospace. Switch first.", { duration: 5000 });
      return;
    }

    setIsBulkDeleting(true);
    let ok = 0, fail = 0;
    for (const i of selected) {
      try { await deleteInfospace(i.id); ok++; }
      catch { fail++; }
    }
    setRowSelection({});
    setIsBulkDeleting(false);

    if (ok > 0 && fail === 0) toast.success(`Deleted ${ok} infospace${ok > 1 ? 's' : ''}.`);
    else if (ok > 0) toast.warning(`Deleted ${ok}, ${fail} failed.`);
    else toast.error(`Failed to delete ${fail} infospace${fail > 1 ? 's' : ''}.`);
  };

  // --- Backup handlers ---

  const loadBackups = useCallback(async (infospaceId: number) => {
    setIsLoadingBackups(true);
    try {
      const res = await BackupsService.listBackups({ infospaceId, limit: 10, skip: 0 });
      setBackups(res.data);
    } catch {
      setBackups([]);
    }
    setIsLoadingBackups(false);
  }, []);

  const createBackup = async () => {
    if (!backupTarget || !newBackupName.trim()) {
      toast.error("Please provide a backup name.");
      return;
    }
    setIsCreatingBackup(true);
    try {
      const data: InfospaceBackupCreate = {
        name: newBackupName,
        description: newBackupDescription || undefined,
        backup_type: 'manual',
        include_sources: true, include_schemas: true, include_runs: true,
        include_datasets: true, include_annotations: true,
      };
      const backup = await BackupsService.createBackup({ infospaceId: backupTarget.id, requestBody: data });
      toast.success(`Backup "${backup.name}" created. Processing in background.`);
      setIsBackupDialogOpen(false);
      setNewBackupName('');
      setNewBackupDescription('');
      setBackupTarget(null);
      if (activeInfospace) loadBackups(activeInfospace.id);
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    }
    setIsCreatingBackup(false);
  };

  const restoreBackup = async (backup: InfospaceBackupRead) => {
    if (!backup.is_ready) { toast.error('Backup not ready.'); return; }
    if (!window.confirm(`Restore from "${backup.name}"? This creates a new infospace.`)) return;
    try {
      const restored = await BackupsService.restoreBackup({
        backupId: backup.id,
        requestBody: { backup_id: backup.id, target_infospace_name: `${backup.name} (Restored)`, conflict_strategy: 'skip' },
      });
      toast.success(`Restored as "${restored.name}"`);
      useInfospaceStore.getState().fetchInfospaces();
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    }
  };

  const downloadBackup = async (backup: InfospaceBackupRead) => {
    if (!backup.is_ready) { toast.error('Backup not ready.'); return; }
    try {
      const shareData = await BackupsService.createBackupShareLink({
        backupId: backup.id,
        requestBody: { backup_id: backup.id, is_shareable: true, expiration_hours: 1 },
      });
      const url = (shareData as any).download_url as string;
      if (url) {
        const a = document.createElement('a');
        a.href = url; a.download = `${backup.name}.zip`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toast.success('Download started.');
      } else { toast.error('Download URL not available.'); }
    } catch (error: any) {
      toast.error(`Failed: ${error?.body?.detail || error?.message || 'Unknown error'}`);
    }
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes, i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  // --- Effects ---

  const pathname = usePathname();
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash?.replace('#', '') : '';
    if (!hash) return;
    const scroll = () => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scroll();
    const t = setTimeout(scroll, 300);
    return () => clearTimeout(t);
  }, [pathname, activeInfospace?.id]);

  useEffect(() => {
    if (activeInfospace) loadBackups(activeInfospace.id);
  }, [activeInfospace?.id, loadBackups]);

  return (
    <div className="space-y-3 w-full md:px-8 md:pr-10">

      {infospaces.length > 0 ? (
        activeInfospace && (
          <>
            {/* Current Infospace */}
            <section className="px-3 mt-4">
              <h3 className="text-sm font-medium mb-4.5">Current Infospace</h3>
              <div className="rounded-md border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-0.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {activeInfospace.icon && (
                      <IconRenderer icon={activeInfospace.icon} className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 mr-1" title="Active infospace"></span>
                      <span className="text-sm font-medium truncate">{activeInfospace.name}</span>
                      {activeInfospace.current_user_role && (
                        <Badge variant="secondary" className="ml-2 text-[10px] capitalize">{activeInfospace.current_user_role}</Badge>
                      )}
                      {activeInfospace.description && (
                        <span className="ml-2 text-[11px] text-muted-foreground truncate">"{activeInfospace.description}"</span>
                      )}
                    </div>
                  </div>

                  {/* Backups popover */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-1.5">
                          <Archive className="h-3 w-3 mr-1" />
                          {isLoadingBackups ? '...' : `${backups.length} backup${backups.length !== 1 ? 's' : ''}`}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-80 p-0">
                        <div className="flex items-center justify-between px-3 py-2 border-b">
                          <span className="text-xs font-medium">Backups</span>
                          <Button size="sm" variant="ghost" className="h-6 text-xs px-1.5" onClick={handleCreateBackupClick}>
                            <Archive className="h-3 w-3 mr-1" /> New
                          </Button>
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                          {backups.length === 0 ? (
                            <div className="text-xs text-muted-foreground text-center py-4">No backups yet</div>
                          ) : (
                            <div className="divide-y">
                              {backups.map((b) => (
                                <div key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      <span className="truncate">{b.name}</span>
                                      <Badge className={`${getStatusColor(b.status)} text-[9px] px-1 py-0`}>{b.status}</Badge>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      {formatFileSize(b.file_size_bytes)} · {formatDistanceToNowStrict(new Date(b.created_at))} ago
                                    </div>
                                  </div>
                                  <div className="flex gap-0.5 shrink-0">
                                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => downloadBackup(b)} disabled={!b.is_ready} title="Download">
                                      <Download className="h-3 w-3" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1" onClick={() => restoreBackup(b)} disabled={!b.is_ready}>
                                      Restore
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <Separator className="my-2" />

                <EmbeddingManager
                  infospace={activeInfospace}
                  onInfospaceUpdate={(updated) => {
                    useInfospaceStore.getState().fetchInfospaceById(updated.id);
                  }}
                />

                <Separator className="my-2" />

                <CollaboratorList
                  infospaceId={activeInfospace.id}
                  isOwner={activeInfospace.is_owner ?? activeInfospace.owner_id === user?.id}
                />
              </div>
            </section>

            {/* All Infospaces */}
            <section className="px-3 mt-4 md:mt-6">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-sm font-medium">All Infospaces</h3>
              </div>
              <div className="flex items-center gap-1.5 mb-2.5">
                  <Button onClick={() => setIsCreateOverlayOpen(true)} size="sm" className="h-7 text-xs">
                    <PlusCircle className="mr-1.5 h-3 w-3" /> New
                  </Button>
                  <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline" className="h-7 text-xs" disabled={isLoading}>
                    <Download className="mr-1.5 h-3 w-3" /> Import
                  </Button>
                  <input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept=".zip,.json" />
              </div>
              <InfospacesPage
                onEdit={handleEdit}
                onBackup={handleBackupFromRow}
                enableRowSelection={true}
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
              />
              <div
                className="flex items-center gap-2 mt-1"
                style={{
                  minHeight: "32px",
                  visibility: selectedCount > 0 ? "visible" : "hidden",
                }}
              >
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleBulkDelete}
                  disabled={isBulkDeleting || isLoading || !selectedCount}
                  style={{ opacity: selectedCount > 0 ? 1 : 0, pointerEvents: selectedCount > 0 ? "auto" : "none" }}
                >
                  {isBulkDeleting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1.5 h-3 w-3" />}
                  Delete
                </Button>
              </div>
            </section>

            {/* Providers */}
            <section className="px-3" id="provider-section">
              <ProviderHub />
            </section>

            {/* Processing + Storage */}
            <section className="px-3 mt-6 md:mt-12">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div id="enrichment-section">
                  <EnrichmentConfig />
                </div>
                <div id="local-storage-section">
                  <LocalStorageImport />
                </div>
              </div>
            </section>
          </>
        )
      ) : (
        !isLoading && (
          <div className="flex flex-col items-center justify-center py-10 text-center border rounded-lg bg-muted/30 mx-3">
            <Database className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="text-base font-semibold mb-1">No Infospaces Yet</h3>
            <p className="text-sm text-muted-foreground mb-3 max-w-sm">
              Create your first infospace or import an existing one.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setIsCreateOverlayOpen(true)} size="sm">
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Create
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm">
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
              </Button>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept=".zip,.json" />
          </div>
        )
      )}

      {/* Backup Dialog */}
      <Dialog open={isBackupDialogOpen} onOpenChange={setIsBackupDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create Backup</DialogTitle>
            <DialogDescription>
              Back up &ldquo;{backupTarget?.name}&rdquo; including all sources, schemas, runs, datasets, and annotations.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <div className="grid grid-cols-4 items-center gap-3">
              <Label htmlFor="backup-name" className="text-right text-sm">Name</Label>
              <Input id="backup-name" value={newBackupName} onChange={(e) => setNewBackupName(e.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <Label htmlFor="backup-desc" className="text-right text-sm">Note</Label>
              <Textarea id="backup-desc" value={newBackupDescription} onChange={(e) => setNewBackupDescription(e.target.value)} className="col-span-3" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBackupDialogOpen(false)} size="sm">Cancel</Button>
            <Button onClick={createBackup} disabled={isCreatingBackup || !newBackupName.trim()} size="sm">
              {isCreatingBackup ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating...</> : <><Archive className="mr-1.5 h-3.5 w-3.5" /> Create Backup</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit / Create overlays */}
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

      {/* Globe easter egg */}
      <div className="flex items-center gap-1 px-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  togglePreference('globe_enabled');
                  toast.success(preferences.globe_enabled ? 'Globe disabled' : 'Globe enabled');
                }}
                className="text-lg hover:scale-110 transition-transform cursor-pointer"
              >
                ✨
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle globe visualization</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
