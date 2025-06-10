'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Eye, Search, XCircle, Loader2, Download, Upload, Share2 } from 'lucide-react';
import { DatasetRead, ResourceType } from '@/client';
import { useDatasetStore, ExportOptions, ImportOptions } from '@/zustand_stores/storeDatasets';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox";
import { formatDistanceToNow } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DatasetCreateDialog from './DatasetCreateDialog';

interface ExportDialogState {
    open: boolean;
    datasetsToExport: DatasetRead[];
    options: ExportOptions;
}

interface ImportDialogState {
    open: boolean;
    mode: 'file' | 'token';
    tokenInput?: string;
    options: ImportOptions;
}

const DatasetManager: React.FC = () => {
    const {
        datasets,
        isLoading,
        error,
        fetchDatasets,
        exportDataset,
        exportMultipleDatasets,
        importDataset,
        importFromToken,
        deleteDataset
    } = useDatasetStore();

    const { createLink: createShareLink } = useShareableStore();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDatasetIds, setSelectedDatasetIds] = useState<Set<number>>(new Set());
    const [datasetToDelete, setDatasetToDelete] = useState<DatasetRead | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const [exportDialog, setExportDialog] = useState<ExportDialogState>({
        open: false,
        datasetsToExport: [],
        options: {
            includeRecordContent: false,
            includeResults: true,
            includeSourceFiles: true
        }
    });

    const [importDialog, setImportDialog] = useState<ImportDialogState>({
        open: false,
        mode: 'file',
        tokenInput: '',
        options: {
            conflictStrategy: 'skip'
        }
    });

    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

    useEffect(() => {
        fetchDatasets();
    }, [fetchDatasets]);

    useEffect(() => {
        setSelectedDatasetIds(new Set());
    }, [datasets]);

    const filteredDatasets = datasets.filter(dataset =>
        dataset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (dataset.description && dataset.description.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleDeleteClick = (dataset: DatasetRead) => {
        setDatasetToDelete(dataset);
    };

    const confirmDelete = async () => {
        if (!datasetToDelete) return;
        setIsDeleting(true);
        try {
            await deleteDataset(datasetToDelete.id);
            setSelectedDatasetIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(datasetToDelete.id);
                return newSet;
            });
            setDatasetToDelete(null);
        } catch (error) {
            console.error("Error during delete from component:", error);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleExportClick = (datasetsToExport: DatasetRead[]) => {
        if (datasetsToExport.length === 0) {
            toast.info("No datasets selected to export.");
            return;
        }
        setExportDialog({
            open: true,
            datasetsToExport,
            options: {
                includeRecordContent: false,
                includeResults: true,
                includeSourceFiles: true
            }
        });
    };

    const handleImportButtonClick = (mode: 'file' | 'token') => {
        if (mode === 'file') {
            fileInputRef.current?.click();
        } else {
        setImportDialog({
            open: true,
            mode,
                tokenInput: '',
                options: { conflictStrategy: 'skip' }
        });
        }
    };

    const confirmExport = async () => {
        const { datasetsToExport, options } = exportDialog;
        try {
        if (datasetsToExport.length === 1) {
            await exportDataset(datasetsToExport[0].id, options);
            } else if (datasetsToExport.length > 1) {
            await exportMultipleDatasets(datasetsToExport.map(d => d.id), options);
            }
        } catch (error) {
            console.error("Export error from component:", error);
        }
        setExportDialog(prev => ({ ...prev, open: false }));
    };

    const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            await importDataset(file, importDialog.options.conflictStrategy);
        } catch (error) {
            console.error("Import failed from component:", error);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        setImportDialog(prev => ({ ...prev, open: false }));
    };

    const confirmTokenImport = async () => {
        if (!importDialog.tokenInput) {
            toast.error("Please enter a share token.");
            return;
        }
        try {
            await importFromToken(importDialog.tokenInput, importDialog.options);
            setImportDialog(prev => ({ ...prev, open: false, tokenInput: '' }));
        } catch (error) {
            console.error("Token import failed from component:", error);
        }
    };
    
    const handleShareDataset = (datasetId: number, datasetName: string) => {
        console.log(`Sharing dataset: ${datasetName} (ID: ${datasetId})`);
        toast.info(`Share functionality for "${datasetName}" coming soon!`);
    };

    const handleSelectAll = (checked: boolean | 'indeterminate') => {
        if (checked === true) {
            const allIds = new Set(filteredDatasets.map(d => d.id));
            setSelectedDatasetIds(allIds);
        } else {
            setSelectedDatasetIds(new Set());
        }
    };

    const handleRowSelect = (datasetId: number, checked: boolean) => {
        setSelectedDatasetIds(prev => {
            const newSet = new Set(prev);
            if (checked) {
                newSet.add(datasetId);
            } else {
                newSet.delete(datasetId);
            }
            return newSet;
        });
    };

    const numSelected = selectedDatasetIds.size;
    const numFiltered = filteredDatasets.length;
    const isAllSelected = numFiltered > 0 && numSelected === numFiltered;
    const isIndeterminate = numSelected > 0 && numSelected < numFiltered;

    return (
        <div className="flex flex-col h-full p-4 bg-muted/10">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                <h2 className="text-xl font-semibold">Manage Datasets</h2>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative w-48 sm:w-64">
                        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="Search datasets..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8 h-9"
                        />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleImportButtonClick('file')} disabled={isLoading}>
                        <Upload className="h-4 w-4 mr-2" />
                        Import File
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleImportButtonClick('token')} disabled={isLoading}>
                        <Upload className="h-4 w-4 mr-2" />
                        Import Token
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleExportClick(Array.from(selectedDatasetIds).map(id => datasets.find(d => d.id === id)!).filter((d): d is DatasetRead => !!d))}
                        disabled={numSelected === 0 || isLoading}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Export Selected ({numSelected})
                    </Button>
                    <Button size="sm" onClick={() => setIsCreateDialogOpen(true)} disabled={isLoading}>
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Create Dataset
                    </Button>
                </div>
            </div>

            {isLoading && !error && (
                <div className="flex-grow flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="ml-2 text-muted-foreground">Loading datasets...</span>
                </div>
            )}

            {error && (
                <div className="flex-grow flex flex-col items-center justify-center p-4 border border-destructive/50 bg-destructive/10 rounded-lg">
                    <XCircle className="h-10 w-10 text-destructive mb-2"/>
                    <p className="text-destructive font-medium">Error loading datasets</p>
                    <p className="text-xs text-destructive/80 text-center mt-1">{error}</p>
                    <Button variant="outline" size="sm" onClick={() => fetchDatasets()} className="mt-4">Retry</Button>
                </div>
            )}

            {!isLoading && !error && (
                <div className="flex-grow overflow-hidden border rounded-lg bg-card">
                    <ScrollArea className="h-full">
                        <Table>
                            <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm shadow-sm">
                                <TableRow>
                                    <TableHead className="w-[50px] px-2">
                                        <Checkbox
                                            checked={isAllSelected ? true : (isIndeterminate ? 'indeterminate' : false)}
                                            onCheckedChange={handleSelectAll}
                                            aria-label="Select all"
                                            disabled={numFiltered === 0}
                                        />
                                    </TableHead>
                                    <TableHead className="w-[250px]">Name</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead className="w-[100px] text-center">Records</TableHead>
                                    <TableHead className="w-[100px] text-center">Schemes</TableHead>
                                    <TableHead className="w-[100px] text-center">Jobs</TableHead>
                                    <TableHead className="w-[150px]">Last Updated</TableHead>
                                    <TableHead className="w-[150px] text-right pr-4">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredDatasets.length > 0 ? (
                                    filteredDatasets.map((dataset) => (
                                        <TableRow
                                            key={dataset.id}
                                            data-state={selectedDatasetIds.has(dataset.id) ? "selected" : ""}
                                        >
                                            <TableCell className="px-2">
                                                <Checkbox
                                                    checked={selectedDatasetIds.has(dataset.id)}
                                                    onCheckedChange={(checked) => handleRowSelect(dataset.id, !!checked)}
                                                    aria-label="Select row"
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium truncate" title={dataset.name}>{dataset.name}</TableCell>
                                            <TableCell className="text-muted-foreground truncate text-sm" title={dataset.description || undefined}>{dataset.description || '-'}</TableCell>
                                            <TableCell className="text-center text-sm">{dataset.datarecord_ids?.length || 0}</TableCell>
                                            <TableCell className="text-center text-sm">{dataset.source_scheme_ids?.length || 0}</TableCell>
                                            <TableCell className="text-center text-sm">{dataset.source_job_ids?.length || 0}</TableCell>
                                            <TableCell className="text-muted-foreground text-xs">
                                                {dataset.updated_at ? formatDistanceToNow(new Date(dataset.updated_at), { addSuffix: true }) : '-'}
                                            </TableCell>
                                            <TableCell className="text-right pr-4">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleExportClick([dataset])} title="Export Dataset" disabled={isLoading}>
                                                        <Download className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleShareDataset(dataset.id, dataset.name)} title="Share Dataset" disabled={isLoading}>
                                                        <Share2 className="h-4 w-4" />
                                                    </Button>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteClick(dataset)} title="Delete Dataset" disabled={isDeleting || isLoading}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                            {datasets.length === 0 ? "No datasets created yet." : "No datasets match your search."}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </div>
            )}

            <Dialog open={exportDialog.open} onOpenChange={(open) => setExportDialog(prev => ({ ...prev, open }))}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Export Dataset{exportDialog.datasetsToExport.length > 1 ? 's' : ''}</DialogTitle>
                        <DialogDescription>
                            Configure export options for {exportDialog.datasetsToExport.length} dataset{exportDialog.datasetsToExport.length > 1 ? 's' : ''}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="includeContent"
                                checked={exportDialog.options.includeRecordContent}
                                onCheckedChange={(checked) => setExportDialog(prev => ({
                                    ...prev,
                                    options: { ...prev.options, includeRecordContent: !!checked }
                                }))}
                            />
                            <label htmlFor="includeContent" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Include record content
                            </label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="includeResults"
                                checked={exportDialog.options.includeResults}
                                onCheckedChange={(checked) => setExportDialog(prev => ({
                                    ...prev,
                                    options: { ...prev.options, includeResults: !!checked }
                                }))}
                            />
                            <label htmlFor="includeResults" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Include classification results
                            </label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="includeFiles"
                                checked={exportDialog.options.includeSourceFiles}
                                onCheckedChange={(checked) => setExportDialog(prev => ({
                                    ...prev,
                                    options: { ...prev.options, includeSourceFiles: !!checked }
                                }))}
                            />
                            <label htmlFor="includeFiles" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Include source files (if applicable)
                            </label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setExportDialog(prev => ({ ...prev, open: false }))} disabled={isLoading}>Cancel</Button>
                        <Button onClick={confirmExport} disabled={isLoading}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4"/>}
                            Export
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={importDialog.open} onOpenChange={(open) => setImportDialog(prev => ({ ...prev, open }))}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import Dataset</DialogTitle>
                    </DialogHeader>
                    {importDialog.mode === 'file' && (
                        <div className="py-4">
                            <p className="text-sm text-muted-foreground mb-2">Select a previously exported dataset file (.zip).</p>
                            <Button onClick={() => fileInputRef.current?.click()} className="w-full" disabled={isLoading}>
                                <Upload className="mr-2 h-4 w-4" /> Choose File to Import
                            </Button>
                            <p className="text-xs text-muted-foreground mt-2">Conflict strategy for imported items:</p>
                            <select 
                                value={importDialog.options.conflictStrategy}
                                onChange={(e) => setImportDialog(prev => ({...prev, options: {...prev.options, conflictStrategy: e.target.value as 'skip' | 'update' | 'replace'}}))}
                                className="w-full mt-1 p-2 border rounded-md text-sm"
                                disabled={isLoading}
                            >
                                <option value="skip">Skip duplicates</option>
                                <option value="update">Update existing</option>
                                <option value="replace">Replace existing</option>
                            </select>
                        </div>
                    )}
                    {importDialog.mode === 'token' && (
                        <div className="space-y-4 py-4">
                            <Input 
                                placeholder="Enter share token..." 
                                value={importDialog.tokenInput}
                                onChange={(e) => setImportDialog(prev => ({...prev, tokenInput: e.target.value}))}
                                disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground mt-2">Conflict strategy for imported items:</p>
                             <select 
                                value={importDialog.options.conflictStrategy}
                                onChange={(e) => setImportDialog(prev => ({...prev, options: {...prev.options, conflictStrategy: e.target.value as 'skip' | 'update' | 'replace'}}))}
                                className="w-full mt-1 p-2 border rounded-md text-sm"
                                disabled={isLoading}
                            >
                                <option value="skip">Skip duplicates</option>
                                <option value="update">Update existing</option>
                                <option value="replace">Replace existing</option>
                            </select>
                            </div>
                        )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setImportDialog(prev => ({ ...prev, open: false }))} disabled={isLoading}>Cancel</Button>
                        {importDialog.mode === 'token' && (
                            <Button onClick={confirmTokenImport} disabled={isLoading || !importDialog.tokenInput}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4"/>}
                                Import from Token
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!datasetToDelete} onOpenChange={(open) => !open && setDatasetToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the dataset
                            <span className="font-semibold"> "{datasetToDelete?.name}"</span>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setDatasetToDelete(null)} disabled={isDeleting || isLoading}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            disabled={isDeleting || isLoading}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4"/>}
                            Delete Dataset
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <DatasetCreateDialog
                open={isCreateDialogOpen}
                onOpenChange={setIsCreateDialogOpen}
            />

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileImport}
                accept=".zip,.json"
                style={{ display: 'none' }}
            />
        </div>
    );
};

export default DatasetManager; 